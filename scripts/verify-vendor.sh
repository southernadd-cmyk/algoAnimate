#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PIN=63a65fdb4105d461dc2142e8869043a8b12399a3
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" remote add origin https://github.com/southernadd-cmyk/algoart.git
git -C "$tmp" fetch -q --depth 1 origin "$PIN"
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
echo "Vendor matches pinned AlgoArt $PIN"
