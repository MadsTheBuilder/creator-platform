# creator_bridge.py - runs on the creator's PC and does the Playground's heavy work there, never on our server:
#   blockouts: runs Blender in the background (blockout.py) and uploads the preview MP4, stills and .blend;
#   transcriptions: runs whisper.cpp on a Studio recording (transcribe.py) and uploads the words.
# Standard library only.
#   python creator_bridge.py          (or start-windows.bat, which can use Blender's own Python)
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # Blender's Python doesn't add this folder
import transcribe  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
SERVER, TOKEN = CONFIG["server"].rstrip("/"), CONFIG["token"]
POLL_SECONDS = 5


def find_blender():
    if CONFIG.get("blender") and os.path.exists(CONFIG["blender"]):
        return CONFIG["blender"]
    if "blender" in os.path.basename(sys.executable).lower():
        return sys.executable                    # started through Blender's own Python
    candidates = sorted(glob.glob(r"C:\Program Files\Blender Foundation\Blender *\blender.exe"), reverse=True)
    candidates += ["/Applications/Blender.app/Contents/MacOS/Blender", shutil.which("blender") or ""]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def call(method, path, body=None, content_type="application/json"):
    data = json.dumps(body).encode() if content_type == "application/json" and body is not None else body
    req = urllib.request.Request(SERVER + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=600) as res:
        text = res.read().decode() or "null"
        return json.loads(text)


def upload(job_id, path):
    name = os.path.basename(path)
    with open(path, "rb") as f:
        call("PUT", f"/bridge/jobs/{job_id}/files/{name}", f.read(), "application/octet-stream")


def run(job, blender):
    if not blender:
        call("POST", f"/bridge/jobs/{job['id']}/finish", {"ok": False, "error": 'Blender was not found on this computer. Install Blender 4.2 or newer, or put its path in the helper\'s config.json as "blender".'})
        print("Skipped a blockout: Blender is not installed.")
        return
    work = tempfile.mkdtemp(prefix="blockout-")
    try:
        spec = os.path.join(work, "shots.json")
        json.dump(job["spec"], open(spec, "w", encoding="utf-8"))
        out = os.path.join(work, "out")
        # Isolated user folder: a headless run must never touch the creator's own add-ons or prefs.
        env = dict(os.environ, BLENDER_USER_RESOURCES=os.path.join(work, "blender-user"))
        print(f"Building blockout for {len(job['spec']['shots'])} shot(s)...")
        done = subprocess.run([blender, "-b", "--factory-startup", "-P", os.path.join(HERE, "blockout.py"), "--", spec, out],
                              env=env, capture_output=True, text=True, timeout=3 * 60 * 60)
        if "BLOCKOUT_DONE" not in done.stdout:
            tail = (done.stdout + done.stderr).strip().splitlines()[-12:]
            raise RuntimeError("Blender stopped before finishing:\n" + "\n".join(tail))
        manifest = json.load(open(os.path.join(out, "manifest.json"), encoding="utf-8"))
        for name in manifest["files"]:
            print("  uploading", name)
            upload(job["id"], os.path.join(out, name))
        call("POST", f"/bridge/jobs/{job['id']}/finish", {"ok": True, "files": manifest["files"], "shots": manifest["shots"]})
        print("Done. The blockout is in the 3D step of your project.")
    except Exception as e:
        print("Failed:", e)
        try:
            call("POST", f"/bridge/jobs/{job['id']}/finish", {"ok": False, "error": str(e)[-1500:]})
        except Exception as report:
            print("Could not report the failure:", report)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    blender = find_blender()
    print(f"Creator bridge connected to {SERVER}\nBlender: {blender or 'not found (blockouts need Blender 4.2 or newer)'}\n"
          "Waiting for blockouts and transcriptions (Ctrl+C to stop).")
    while True:
        try:
            job = call("POST", "/bridge/claim", {"kinds": ["blockout", "transcribe"]})
            if job and job.get("kind") == "transcribe":
                print("Transcribing a recording...")
                transcribe.run(f"{SERVER}/bridge/jobs/{job['id']}", TOKEN)
                continue
            if job:
                run(job, blender)
                continue
        except urllib.error.HTTPError as e:
            if e.code == 401:
                sys.exit("This helper was disconnected. Download a new one from the Playground (3D visual or Recording step).")
            print("Server error:", e.code)
        except OSError as e:  # URLError, timeouts, dropped connections
            print("Can't reach the app, retrying:", e)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
