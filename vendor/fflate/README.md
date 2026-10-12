# Score geometry codec

fflate 0.8.3, MIT licensed, from https://github.com/101arrowz/fflate and the published npm package. Only `deflateSync`, `Inflate`, `strToU8` and `strFromU8` are bundled. The application serves this local module and makes no CDN requests. Original ALGO/ART vendor files are unchanged.

Rebuild with esbuild using an entry that exports those four functions from `fflate/esm/browser.js`, then `--bundle --format=esm --platform=browser --minify --legal-comments=inline`.

Upstream browser module SHA-256: `b7ca4450b19559a1d50eb381adcee94b82449674be4cd17789d9beba7e6122a1`

Bundle SHA-256: `f25864c3d617a81831e8d4c399c4140f12a435ed2e5688be2ac01aa652f2edde`
