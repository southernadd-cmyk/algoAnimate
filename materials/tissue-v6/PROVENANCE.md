# ALGO/ART Tissue & Graphite V6 — pinned source

The three source files under `materials/tissue-v6/` are **byte-identical** to
`southernadd-cmyk/algoart` at commit
`481bf9c615a5bf9c188a61dfca7bfcf8ecdff7cc` (13 October 2026).

| Local file | Upstream path | Git blob SHA-1 |
| --- | --- | --- |
| `oil-render.js` | `js/oil-render.js` | `f0b6f527763aa95e946af64db58ebcdd6a6a1c01` |
| `oil-surface.js` | `js/oil-surface.js` | `0df22afe878d372b3a045f5a6b98db92aa391406` |
| `oil-material.js` | `js/oil-material.js` | `af5f748a3b1822977ec9e015c95e3b54117398cc` |

**Verification:** `bash scripts/verify-vendor.sh` checks SHA-256 of all three
local files against the checked-out pinned upstream source, in addition to the
older composition engine and marker font. CI runs this before deployment.

Do not edit the three source files inside AlgoAnimate. Changes to material
coherence belong in the adapter, or require a separately versioned material
revision and dedicated visual regression tests. The ALGO/ART renderer's own
material-specific regression tests should also be inspected before future syncs.
