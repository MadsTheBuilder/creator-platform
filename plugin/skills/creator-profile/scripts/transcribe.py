"""Transcribe reference videos with faster-whisper (local, no API key).

usage (from the style's references/ folder):
  uv run --python 3.11 --with faster-whisper python <skill>/scripts/transcribe.py . --lang hi ID [ID ...]

Per video (references/raw-media/<ID>.mp4; a 16 kHz <ID>.16k.wav is decoded next to it) it writes to references/captions/:
  <ID>.txt / .vtt          whole video. English translation when --lang is not "en"
                           (whisper "small"): good for structure, rough on names.
  <ID>.hook.<lang>.txt/.vtt native-language sample of the first --hook-seconds (whisper "medium"):
                           use this for real phrasing. Skipped when --lang is "en".
Runs on CPU int8 by default because CUDA libraries are often missing on Windows;
set WHISPER_DEVICE=cuda to try the GPU.
"""
import argparse, os, subprocess
from faster_whisper import WhisperModel


def ts(s, vtt=True):
    h, m = int(s // 3600), int(s % 3600 // 60)
    return f"{h:02d}:{m:02d}:{s % 60:06.3f}" if vtt else f"{int(s // 60)}:{int(s % 60):02d}"


def write(segs, base):
    with open(base + ".vtt", "w", encoding="utf-8") as v, open(base + ".txt", "w", encoding="utf-8") as t:
        v.write("WEBVTT\n\n")
        for s in segs:
            v.write(f"{ts(s.start)} --> {ts(s.end)}\n{s.text.strip()}\n\n")
            t.write(f"[{ts(s.start, False)}] {s.text.strip()}\n")


def wav_of(mp4):
    """Decode with ffmpeg, not PyAV: PyAV silently stops early on some AV1 downloads."""
    wav = os.path.splitext(mp4)[0] + ".16k.wav"
    if not os.path.exists(wav):
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", mp4,
                        "-vn", "-ac", "1", "-ar", "16000", wav], check=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                "-of", "csv=p=0", wav], capture_output=True, text=True).stdout)
    return wav, dur


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ref")
    ap.add_argument("ids", nargs="+")
    ap.add_argument("--lang", default="en", help="spoken language code, e.g. hi, en, es")
    ap.add_argument("--hook-seconds", type=float, default=130)
    a = ap.parse_args()
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute = "int8" if device == "cpu" else "float16"
    small = WhisperModel("small", device=device, compute_type=compute)
    med = WhisperModel("medium", device=device, compute_type=compute) if a.lang != "en" else None
    for i in a.ids:
        mp4, dur = wav_of(os.path.join(a.ref, "raw-media", i + ".mp4"))
        cap = os.path.join(a.ref, "captions", i)
        task = "transcribe" if a.lang == "en" else "translate"
        segs, _ = small.transcribe(mp4, task=task, language=a.lang, vad_filter=True)
        segs = list(segs)
        # Whisper sometimes stops mid-sentence on continuous speech. Retry once without
        # conditioning on earlier text, which usually recovers the rest.
        if not segs or segs[-1].end < 0.9 * dur:
            retry, _ = small.transcribe(mp4, task=task, language=a.lang, vad_filter=True,
                                        condition_on_previous_text=False)
            retry = list(retry)
            if retry and (not segs or retry[-1].end > segs[-1].end):
                segs = retry
        covered = segs[-1].end / dur if segs else 0
        write(segs, cap)
        print(f"full {i} (covers {covered:.0%} of audio)" + ("  WARNING: transcript short" if covered < 0.9 else ""), flush=True)
        if med:
            segs, _ = med.transcribe(mp4, task="transcribe", language=a.lang, vad_filter=True,
                                     clip_timestamps=[0, a.hook_seconds])
            write([s for s in segs if s.start < a.hook_seconds], f"{cap}.hook.{a.lang}")
            print("hook", i, flush=True)


if __name__ == "__main__":
    main()
