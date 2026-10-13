# Demo music

These three MP3 recordings are from **Public Domain Lo-fi** by **HoliznaCC0**.

| Track | Artist's source | Duration |
| --- | --- | --- |
| Bubbles | https://holiznacc0.bandcamp.com/track/bubbles | 2:27 |
| Calm Current | https://holiznacc0.bandcamp.com/track/calm-current | 2:27 |
| Tokyo Sunset | https://holiznacc0.bandcamp.com/track/tokyo-sunset | 2:19 |

Album: https://holiznacc0.bandcamp.com/album/public-domain-lo-fi

The album's About section states: “Creative commons CC0 (same as public domain).”
Verified 11 October 2026. The artist profile also dedicates the music archive to CC0.

Licence: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/

The 128 kb/s MP3 recordings are distributed unchanged. The original title and
artist are shown beside the demo player, with links to the source and licence.
No attribution is required by CC0; credit is retained to support the artist and
make the origin of the music clear. Audio may be included in exported videos.

The player streams one same-origin track at a time. It has no API keys,
remote playback dependency, third-party embed, or decoded-audio cache.

## Expanded genres (CC0)

All additional tracks are from OpenGameArt.org, with CC0 marked on each
artist's track page. These are distributed from GitHub Pages as same-origin MP3s,
not streamed from third parties by visiting users. Credit is retained.

| Genre | Track | Creator | Original source |
| --- | --- | --- | --- |
| Drum & bass | Final Hour | isaiah658 | https://opengameart.org/content/final-hour |
| Drum & bass | Black Diamond | Joth | https://opengameart.org/content/black-diamond |
| Jazz | Public Domain Jazz | Alex McCulloch | https://opengameart.org/content/public-domain-jazz |
| Jazz | 8-bit Bossa Nova | Joth | https://opengameart.org/content/bossa-nova |
| Classical | Aftermath | Indieteur | https://opengameart.org/content/aftermath |
| Classical | Classical Pop (Instrumental) | Alex McCulloch | https://opengameart.org/content/classical-pop-instrumental |
| Synthwave | Synthwave Type | G_P | https://opengameart.org/content/synthwavetype |
| Synthwave | Electronic Synth | Alex McCulloch | https://opengameart.org/content/electronic-synth |

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

During the Pages build, `scripts/fetch-demo-music.sh` downloads and validates
the source MP3s, then stages them with the existing lo-fi files. Source filenames
and URLs are pinned in `js/demo.js`.
