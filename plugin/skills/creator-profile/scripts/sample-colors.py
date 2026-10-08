"""Dominant colour of boxes in video frames -> JSON, so palette hex values are measured, not guessed.

usage: python sample-colors.py <frame.jpg> <label>=<x>,<y>,<w>,<h> [<label>=...] [--saturated]
       python sample-colors.py --selftest
Coordinates are in the frame's own pixels. --saturated ignores near-grey pixels
(use it for accent colours sitting on dark or noisy backgrounds).
Needs Pillow:  uv run --with pillow python sample-colors.py ...
"""
import json, sys
from collections import Counter
from PIL import Image


def dominant(img, box, saturated=False):
    x, y, w, h = box
    raw = img.convert("RGB").crop((x, y, x + w, y + h)).tobytes()
    px = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]
    if saturated:
        px = [p for p in px if max(p) - min(p) > 40] or px
    # Bucket to 8 levels per channel so JPEG noise doesn't split one colour into many.
    buckets = Counter((r // 32, g // 32, b // 32) for r, g, b in px)
    top = buckets.most_common(1)[0][0]
    members = [p for p in px if (p[0] // 32, p[1] // 32, p[2] // 32) == top]
    avg = [round(sum(c) / len(members)) for c in zip(*members)]
    return {"hex": "#%02x%02x%02x" % tuple(avg), "share": round(len(members) / len(px), 2)}


def selftest():
    img = Image.new("RGB", (100, 100), (11, 11, 12))
    for x in range(50, 100):
        for y in range(100):
            img.putpixel((x, y), (225, 10, 20) if (x + y) % 10 else (128, 128, 128))
    assert dominant(img, (0, 0, 50, 100))["hex"] == "#0b0b0c"
    assert dominant(img, (50, 0, 50, 100), saturated=True)["hex"] == "#e10a14"
    print("selftest ok")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--selftest"]:
        selftest()
        sys.exit(0)
    if len(args) < 2:
        print(__doc__)
        sys.exit(2)
    sat = "--saturated" in args
    args = [a for a in args if a != "--saturated"]
    img = Image.open(args[0])
    out = {}
    for spec in args[1:]:
        label, box = spec.split("=")
        out[label] = dominant(img, tuple(int(v) for v in box.split(",")), sat)
    print(json.dumps({"frame": args[0], "size": img.size, "samples": out}, indent=1))
