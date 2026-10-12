# AlgoArt V8

These five JavaScript files are copied unchanged from
[southernadd-cmyk/algoart](https://github.com/southernadd-cmyk/algoart), commit
`395e473a826d7c481fde2e0198f753467332b04b` (12 October 2026).

The marker font is copied from the same commit into `fonts/`.
AlgoAnimate's audio, scene animation and recording code lives separately in `js/`.
The animation adapter records the engine's existing marker paths, then animates
them without changing the original engine or its archived artwork output.

## Reproducible integrity check

Run `bash scripts/verify-vendor.sh` from the repository root. CI runs this before
application tests or deployment. It fetches the pinned upstream commit into a
temporary Git checkout, compares SHA-256 digests of every vendored JavaScript
file against the same paths in AlgoArt, and fails on any mismatch. Vendored
files must remain byte-identical: adaptations belong in AlgoAnimate's own code.
