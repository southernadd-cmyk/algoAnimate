#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PIN="$(grep -oE '[0-9a-f]{40}' vendor/algoart/PROVENANCE.md | head -n 1)"
[[ "$PIN" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid vendor provenance commit' >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp" >/dev/null 2>&1 || true' EXIT
git -C "$tmp" init -q
git -C "$tmp" remote add origin https://github.com/southernadd-cmyk/algoart.git
git -C "$tmp" -c gc.auto=0 fetch -q --depth 1 origin "$PIN"
git -C "$tmp" checkout -q --detach FETCH_HEAD
test "$(git -C "$tmp" rev-parse HEAD)" = "$PIN"
shopt -s nullglob
files=(vendor/algoart/*.js)
(( ${#files[@]} >= 5 )) || { echo "Expected at least five vendored JavaScript files" >&2; exit 1; }
for source in "${files[@]}"; do
  original="$tmp/js/${source##*/}"
  test -f "$original" || { echo "Missing upstream file for $source" >&2; exit 1; }
  expected="$(sha256sum "$original" | cut -d' ' -f1)"
  actual="$(sha256sum "$source" | cut -d' ' -f1)"
  if [[ "$actual" != "$expected" ]]; then
    echo "Vendor drift: $source (actual SHA-256 $actual, expected $expected)" >&2
    exit 1
  fi
  echo "Verified $source SHA-256 $actual"
done
font=fonts/AlgoArt-Marker-Regular.woff2
original="$tmp/fonts/AlgoArt-Marker-Regular.woff2"
test -f "$font" && test -f "$original" || { echo 'Marker font missing' >&2; exit 1; }
expected="$(sha256sum "$original" | cut -d' ' -f1)"
actual="$(sha256sum "$font" | cut -d' ' -f1)"
[[ "$expected" == "$actual" ]] || { echo "Marker font drift: $actual != $expected" >&2; exit 1; }
echo "Verified $font SHA-256 $actual"
echo "Vendor matches pinned AlgoArt $PIN"

# The Tissue & Graphite renderer is pinned independently of the older V8
# composition source. Never silently rebase the material to upstream main.
MATERIAL_PIN="$(grep -oE '[0-9a-f]{40}' materials/tissue-v6/PROVENANCE.md | head -n 1)"
[[ "$MATERIAL_PIN" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid material provenance commit' >&2; exit 1; }
git -C "$tmp" -c gc.auto=0 fetch -q --depth 1 origin "$MATERIAL_PIN"
git -C "$tmp" checkout -q --detach FETCH_HEAD
test "$(git -C "$tmp" rev-parse HEAD)" = "$MATERIAL_PIN"
for name in oil-render.js oil-surface.js oil-material.js; do
  local_file="materials/tissue-v6/$name"
  original="$tmp/js/$name"
  test -f "$local_file" && test -f "$original" || { echo "Material source missing: $name" >&2; exit 1; }
  expected="$(sha256sum "$original" | cut -d' ' -f1)"
  actual="$(sha256sum "$local_file" | cut -d' ' -f1)"
  [[ "$expected" == "$actual" ]] || { echo "Material vendor drift: $name ($actual != $expected)" >&2; exit 1; }
  echo "Verified $local_file SHA-256 $actual"
done
echo "Material V6 matches pinned AlgoArt $MATERIAL_PIN"
