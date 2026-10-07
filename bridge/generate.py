"""Generate one AI video take on this computer with the creator's own Higgsfield API key, from the manifest
that the Content Engine's prepare_generation made, then put the take into the project.

Usage: python generate.py "<manifest url>" [--budget=USD]
Needs: pip install higgsfield-client, and the creator's key in the environment as HF_KEY=KEY_ID:KEY_SECRET.
The key is only used here, against Higgsfield; it is never sent to the Content Engine.
"""
import json, os, sys, tempfile, urllib.request
from pathlib import Path


def fetch(url, to=None):
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    if to:
        to.write_bytes(data)
    return data


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    budget = next((float(a.split("=", 1)[1]) for a in sys.argv if a.startswith("--budget=")), 1.0)
    if len(args) != 1:
        sys.exit(__doc__)
    job = json.loads(fetch(args[0]))
    est = job.get("estimate_usd") or 0
    if est > budget:
        sys.exit(f"Estimated ${est:.2f} is over the budget ${budget:.2f}: nothing was sent. "
                 f"Ask the creator, then pass --budget={est:.2f}.")
    if not os.getenv("HF_KEY"):
        sys.exit("Set HF_KEY=KEY_ID:KEY_SECRET (the creator's own Higgsfield API key) in this computer's environment.")
    try:
        import higgsfield_client as hf
    except ImportError:
        sys.exit("Install Higgsfield's client first: pip install higgsfield-client")

    tmp = Path(tempfile.mkdtemp(prefix="take-"))
    image_urls = []  # position N is @ImageN
    for i, ref in enumerate(job["images"], 1):
        local = tmp / f"{i}{Path(ref['file']).suffix or '.jpg'}"
        fetch(ref["url"], local)
        image_urls.append(hf.upload_file(local))
        print(f"reference {i}/{len(job['images'])} uploaded: {ref['file']}", flush=True)

    print(f"submitting {job['duration']}s {job['resolution']} {job['aspect_ratio']} to {job['higgsfield_model']}, "
          f"about ${est:.2f}", flush=True)
    result = hf.subscribe(job["higgsfield_model"], arguments={
        "prompt": job["prompt"],
        "image_urls": image_urls,
        "duration": int(round(job["duration"])),
        "resolution": job["resolution"],
        "aspect_ratio": job["aspect_ratio"],
        "bitrate_mode": "high",
        "generate_audio": True,  # diegetic sound only; music goes in the edit
    }, on_enqueue=lambda rid: print(f"queued: {rid}", flush=True),
       on_queue_update=lambda s: print(type(s).__name__, flush=True))
    video = result.get("video", {}).get("url") if isinstance(result, dict) else None
    if not video:
        sys.exit(f"No video came back: {result}")

    take = tmp / "take.mp4"
    fetch(video, take)
    put = urllib.request.Request(job["upload_url"], data=take.read_bytes(), method="PUT",
                                 headers={"Content-Type": "video/mp4"})
    with urllib.request.urlopen(put, timeout=600) as r:
        r.read()
    print(f"done: {job['take']} is in the project ({take.stat().st_size / 1e6:.1f} MB)", flush=True)


if __name__ == "__main__":
    main()
