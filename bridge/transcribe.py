# transcribe.py - speech to text for a Studio-track recording, on the creator's own computer (never our server).
# The helper (creator_bridge.py) runs it for transcribe jobs; the creator's Claude Code runs it directly with the
# two arguments transcribe_recording hands out:
#   python transcribe.py <job-url> <key>
# It fetches the speech as 16 kHz audio, runs whisper.cpp with the large-v3-turbo model and uploads whisper's JSON;
# the server makes the transcript and the working copy from it. Standard library only.
# The first run downloads whisper.cpp (Windows; elsewhere it uses whisper-cli from PATH) and the model (~1.6 GB).
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

# whisper.cpp v1.9.4 (its Windows build is release b5130), the version tested on Hindi narration.
WINDOWS_BUILD = "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip"
MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
CACHE = os.path.join(os.path.expanduser("~"), ".cache")
MODEL = os.path.join(CACHE, "hyperframes", "whisper", "models", "ggml-large-v3-turbo.bin")  # shared with the HyperFrames CLI
TOOLS = os.path.join(CACHE, "creator-bridge", "whisper-b5130")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="replace")         # whisper's messages can carry characters the console can't show


def download(url, dest, label):
    """Fetch url to dest, resuming a partial download and printing progress."""
    part = dest + ".part"
    have = os.path.getsize(part) if os.path.exists(part) else 0
    req = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
    with urllib.request.urlopen(req, timeout=60) as res:
        if have and res.status != 206:
            have = 0                                     # the server ignored the range: start over
        total = have + int(res.headers.get("Content-Length") or 0)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(part, "ab" if have else "wb") as f:
            done, shown = have, -1
            while chunk := res.read(1 << 20):
                f.write(chunk)
                done += len(chunk)
                pct = done * 100 // total if total else 0
                if pct != shown and pct % 5 == 0:
                    print(f"  {label}: {pct}% of {total >> 20} MB", flush=True)
                    shown = pct
    if total and os.path.getsize(part) != total:
        raise RuntimeError(f"The {label} download stopped early. Run it again to resume.")
    os.replace(part, dest)


def utf8_arguments(exe):
    """Windows hands a program its arguments in the system code page, so a Devanagari prompt reaches
    whisper-cli as '?????'. A manifest asking for UTF-8 (Windows 10 1903+) fixes that."""
    import ctypes
    from ctypes import wintypes
    manifest = (b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">'
                b'<application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings><activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">'
                b'UTF-8</activeCodePage></windowsSettings></application></assembly>')
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.BeginUpdateResourceW.restype = wintypes.HANDLE
    k.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    k.UpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.LPVOID, wintypes.WORD, ctypes.c_char_p, wintypes.DWORD]
    k.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    handle = k.BeginUpdateResourceW(exe, False)       # RT_MANIFEST (24), id 1, US English
    if not (handle and k.UpdateResourceW(handle, 24, 1, 0x0409, manifest, len(manifest)) and k.EndUpdateResourceW(handle, False)):
        raise RuntimeError(f"Could not prepare whisper.cpp (Windows error {ctypes.get_last_error()}).")


def whisper_cli():
    found = shutil.which("whisper-cli")
    if found:
        return found
    if platform.system() == "Windows" and platform.machine().lower() in ("amd64", "x86_64"):
        exe = os.path.join(TOOLS, "Release", "whisper-cli.exe")
        if not os.path.exists(exe):
            print("First run: downloading whisper.cpp...", flush=True)
            zip_path = os.path.join(TOOLS, "whisper.zip")
            download(WINDOWS_BUILD, zip_path, "whisper.cpp")
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(TOOLS)
            os.remove(zip_path)
            utf8_arguments(exe)
        return exe
    if platform.system() == "Darwin":
        raise RuntimeError("whisper.cpp is missing. Install it with Homebrew: brew install whisper-cpp")
    raise RuntimeError("whisper.cpp is missing. Install whisper-cli (https://github.com/ggml-org/whisper.cpp) and put it on PATH.")


def ensure_model():
    if not os.path.exists(MODEL):
        print("First run: downloading the speech model (about 1.6 GB, once)...", flush=True)
        download(MODEL_URL, MODEL, "speech model")
    return MODEL


def call(method, url, key, body=None, content_type="application/json"):
    data = json.dumps(body).encode() if content_type == "application/json" and body is not None else body
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + key, "Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=600) as res:
        return json.loads(res.read().decode() or "null")


def transcribe(job_url, key):
    """Transcribe one job and upload the result. Raises on failure (the caller reports it)."""
    job = call("GET", job_url, key)                       # {"language": "hi" | "en", "prompt": "..."}
    cli, model = whisper_cli(), ensure_model()
    work = tempfile.mkdtemp(prefix="transcribe-")
    try:
        wav = os.path.join(work, "speech.wav")
        print("Fetching the recording's speech...", flush=True)
        req = urllib.request.Request(job_url + "/audio", headers={"Authorization": "Bearer " + key})
        with urllib.request.urlopen(req, timeout=600) as res, open(wav, "wb") as f:
            shutil.copyfileobj(res, f, 1 << 20)
        minutes = max(1, (os.path.getsize(wav) - 44) // (16000 * 2 * 60))
        print(f"Transcribing about {minutes} min of speech (roughly a minute per minute)...", flush=True)
        out = os.path.join(work, "whisper")
        prompt = ["--prompt", job["prompt"], "--carry-initial-prompt"] if job.get("prompt") else []
        threads = str(max(4, min(8, (os.cpu_count() or 4) - 1)))
        done = subprocess.run([cli, "--model", model, "--language", job["language"], "--threads", threads, "--output-json-full",
                               "--output-file", out, "--dtw", "large.v3.turbo", "--suppress-nst", *prompt, wav],
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3 * 60 * 60)
        if done.returncode != 0 or not os.path.exists(out + ".json"):
            tail = (done.stdout + done.stderr).strip().splitlines()[-12:]
            raise RuntimeError("whisper.cpp stopped before finishing:\n" + "\n".join(tail))
        print("Uploading the transcript...", flush=True)
        with open(out + ".json", "rb") as f:
            call("PUT", job_url + "/files/whisper.json", key, f.read(), "application/octet-stream")
        call("POST", job_url + "/finish", key, {"ok": True})
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run(job_url, key):
    """transcribe(), reporting any failure to the job. Returns True when it worked."""
    try:
        transcribe(job_url, key)
        print("Done. The server is making the working copy; the transcript shows in the Recording step.", flush=True)
        return True
    except Exception as e:
        print("Failed:", e, flush=True)
        try:
            call("POST", job_url + "/finish", key, {"ok": False, "error": str(e)[-1500:]})
        except Exception as report:
            print("Could not report the failure:", report, flush=True)
        return False


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python transcribe.py <job-url> <key>   (transcribe_recording gives you both)")
    sys.exit(0 if run(sys.argv[1], sys.argv[2]) else 1)
