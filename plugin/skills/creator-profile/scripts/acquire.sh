#!/usr/bin/env bash
# Deterministic source acquisition for a creator profile. Safe to re-run: finished
# steps are skipped per video. Transcription is separate (transcribe.py) because it is slow.
#
# usage: [COOKIES_FROM=chrome] bash acquire.sh <style-dir>/references "<channel-url>" ID|URL [ID|URL ...]
#   A bare ID is a YouTube video. Full URLs work for anything yt-dlp supports (TikTok, Instagram reels).
#   COOKIES_FROM=<browser> adds --cookies-from-browser: Instagram usually needs it, TikTok sometimes.
#
# Writes (all under references/, which .gitignore keeps out of the repo):
#   raw-media/<id>.mp4               720p, or 720 wide for vertical video (check-kit skips raw-media/)
#   captions/<id>.info.json          yt-dlp metadata (title, date, views, duration, description, chapters)
#   captions/<id>.cuts.txt           ffmpeg scene-cut times, threshold 0.3 (input to cut-stats.mjs)
#   captions/<id>.audio.txt          integrated loudness / loudness range + silence gaps
#   frames/thumb-<id>.jpg            thumbnail
#   frames/hook-<id>.jpg             first 60s, one frame per 2s (6x5 grid)
#   frames/contact-<id>.jpg          30 frames spread over the whole video
#   frames/dense-<id>-NN.jpg         one frame per 3s (per 1s if under 90s), 30 per sheet (motion/layout)
#   channel-uploads.txt              id | title | duration | views for the latest 60 uploads (YouTube/TikTok; Instagram has none)
#   manifest.json                    the analysed videos (read by every researcher and the validator)
set -euo pipefail
REF="$1"; CHANNEL="$2"; shift 2
mkdir -p "$REF"/{raw-media,captions,frames,research}
cd "$REF"

# yt-dlp needs a JS runtime for YouTube; node is always present in this kit.
YT=(yt-dlp -q --no-warnings --js-runtimes node ${COOKIES_FROM:+--cookies-from-browser "$COOKIES_FROM"})

if [ ! -s channel-uploads.txt ]; then
  case "$CHANNEL" in
    *youtube.com*|*youtu.be*) LIST="${CHANNEL%/}/videos" ;;
    *instagram.com*) LIST="" ;; # yt-dlp can't reliably list Instagram profiles; the user supplies reel URLs
    *) LIST="$CHANNEL" ;;       # TikTok @user pages list as-is
  esac
  [ -n "$LIST" ] && { "${YT[@]}" --flat-playlist --playlist-end 60 \
    --print "%(id)s | %(title)s | %(duration_string)s | %(view_count)s" "$LIST" > channel-uploads.txt || true; }
  [ -s channel-uploads.txt ] || echo "# listing unavailable for this platform; analyse the manifest videos only" > channel-uploads.txt
fi

IDS=()
for arg in "$@"; do
  if [[ "$arg" == *://* ]]; then url="$arg"; id=$("${YT[@]}" --print id --skip-download "$url")
  else id="$arg"; url="https://youtu.be/$arg"; fi
  IDS+=("$id")
  if [ ! -s "raw-media/$id.mp4" ]; then
    # Prefer H.264 (AV1 throws decode warnings in some ffmpeg builds). Separate mp4+m4a sometimes 403s; the single-file fallback works.
    "${YT[@]}" -f "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b[width<=720][vcodec^=h264]/b[width<=720]/bv*[width<=720]+ba" --merge-output-format mp4 \
      -o "raw-media/%(id)s.%(ext)s" --write-info-json --write-thumbnail --convert-thumbnails jpg \
      -o "infojson:captions/%(id)s" -o "thumbnail:frames/thumb-%(id)s" "$url" \
    || "${YT[@]}" -f "b[height<=720]/b[width<=720][vcodec^=h264]/b[width<=720]/bv*[width<=720]+ba" -o "raw-media/%(id)s.%(ext)s" --write-info-json \
      -o "infojson:captions/%(id)s" "$url"
  fi
  v="raw-media/$id.mp4"
  # Corrupt downloads happen (seen: AAC errors from 2:11 on). ffmpeg conceals them, but
  # whisper's decoder silently stops there, truncating the transcript. Re-fetch once as H.264.
  bad=$(ffmpeg -hide_banner -v error -i "$v" -map 0:a -f null - 2>&1 | wc -l)
  if [ "$bad" -gt 0 ] && [ ! -e "raw-media/$id.refetched" ]; then
    echo "WARNING $id: $bad audio decode errors, re-downloading"; rm -f "$v" "raw-media/$id.16k.wav"
    "${YT[@]}" -f "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720]/b[width<=720][vcodec^=h264]/b[width<=720]/bv*[width<=720]+ba" --merge-output-format mp4 \
      -o "raw-media/%(id)s.%(ext)s" "$url"; touch "raw-media/$id.refetched"
    rm -f "captions/$id.cuts.txt" "captions/$id.audio.txt" "frames/hook-$id.jpg" "frames/contact-$id.jpg" frames/dense-"$id"-*.jpg
    bad=$(ffmpeg -hide_banner -v error -i "$v" -map 0:a -f null - 2>&1 | wc -l)
  fi
  [ "$bad" -gt 0 ] && echo "WARNING $id: audio still has $bad decode errors; note it under Not assessed"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$v")
  # Instagram's info.json has no duration; cut-stats and the manifest need it.
  node -e 'const fs=require("fs"),[f,d]=process.argv.slice(1),j=JSON.parse(fs.readFileSync(f,"utf8"));
    if (j.duration==null) { j.duration=Math.round(+d); fs.writeFileSync(f,JSON.stringify(j)); }' "captions/$id.info.json" "$d"
  [ -s "captions/$id.cuts.txt" ] || ffmpeg -hide_banner -nostats -i "$v" -vf "select='gt(scene,0.3)',showinfo" -an -f null - 2>&1 \
    | { grep -o 'pts_time:[0-9.]*' || true; } | cut -d: -f2 > "captions/$id.cuts.txt"
  [ -s "frames/hook-$id.jpg" ] || ffmpeg -hide_banner -loglevel error -y -t 60 -i "$v" -vf "fps=1/2,scale=320:-1,tile=6x5" -frames:v 1 "frames/hook-$id.jpg"
  [ -s "frames/contact-$id.jpg" ] || ffmpeg -hide_banner -loglevel error -y -i "$v" -vf "fps=30/$d,scale=320:-1,tile=6x5" -frames:v 1 "frames/contact-$id.jpg"
  [ -s "frames/dense-$id-01.jpg" ] || ffmpeg -hide_banner -loglevel error -y -i "$v" -vf "fps=$(awk "BEGIN{print ($d<90)?1:1/3}"),scale=320:-1,tile=6x5" "frames/dense-$id-%02d.jpg"
  if [ ! -s "captions/$id.audio.txt" ]; then
    { ffmpeg -hide_banner -nostats -i "$v" -af ebur128=framelog=quiet -f null - 2>&1 | grep -E "^\s+(I|LRA):" || true
      echo "silences (>0.4s below -35dB):"
      ffmpeg -hide_banner -nostats -i "$v" -af silencedetect=n=-35dB:d=0.4 -f null - 2>&1 | grep -o "silence_end: [0-9.]* | silence_duration: [0-9.]*" || true
    } > "captions/$id.audio.txt"
  fi
  echo "acquired $id (${d%.*}s, $(wc -l < "captions/$id.cuts.txt") cuts)"
done

CHANNEL="$CHANNEL" node -e '
const fs = require("fs");
const ids = process.argv.slice(1); // with node -e, argv[1] is already the first id
const videos = ids.map(id => {
  const j = JSON.parse(fs.readFileSync(`captions/${id}.info.json`, "utf8"));
  return { id, platform: j.extractor_key, url: j.webpage_url, title: j.title, upload_date: j.upload_date, view_count: j.view_count, like_count: j.like_count, comment_count: j.comment_count, repost_count: j.repost_count, duration: j.duration,
           channel: j.channel ?? j.uploader, channel_follower_count: j.channel_follower_count };
});
const prev = fs.existsSync("manifest.json") ? JSON.parse(fs.readFileSync("manifest.json", "utf8")) : { videos: [] };
const merged = [...prev.videos.filter(v => !ids.includes(v.id)), ...videos];
fs.writeFileSync("manifest.json", JSON.stringify({ creator: { name: videos[0]?.channel ?? prev.creator?.name, url: process.env.CHANNEL }, videos: merged }, null, 1));
console.log(`manifest.json: ${merged.length} videos`);
' "${IDS[@]}"
