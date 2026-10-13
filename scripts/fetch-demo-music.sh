#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# All new music has an artist/source/CC0 record in media/demo/README.md.
# At build time, fetch MP3s once and deploy same-origin copies to GitHub Pages.
# Never require external sites for playback or recording in the browser.
command -v curl >/dev/null
command -v ffprobe >/dev/null
mkdir -p media/demo
while IFS=$'\t' read -r filename url; do
  [[ "$filename" =~ ^[a-z0-9-]+\.mp3$ ]] || { echo "Invalid demo filename: $filename"; exit 1; }
  [[ "$url" == https://opengameart.org/sites/default/files/* ]] || { echo "Unexpected demo host"; exit 1; }
  target="media/demo/$filename"
  if [[ -s "$target" ]] && ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "$target" >/dev/null 2>&1; then
    echo "Already available: $filename"
    continue
  fi
  tmp="$target.partial"
  trap 'rm -f "$tmp"' EXIT
  echo "Fetching CC0 demo: $filename"
  curl --fail --location --silent --show-error --retry 3 --retry-all-errors --retry-delay 2 \
    --connect-timeout 20 --max-time 180 --user-agent 'AlgoAnimate-CC0-Demo/1.0' \
    --output "$tmp" "$url"
  [[ $(wc -c < "$tmp") -gt 30000 ]] || { echo "Empty/invalid audio: $filename"; exit 1; }
  ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "$tmp" | grep -q '^duration=' \
    || { echo "Cannot decode audio: $filename"; exit 1; }
  mv "$tmp" "$target"
  trap - EXIT
done < <(node --input-type=module -e 'import { DEMO_TRACKS } from "./js/demo.js"; for (const track of DEMO_TRACKS) if (track.download) console.log(track.file + "\t" + track.download)')
echo "Verified bundled multi-genre demo MP3s."
