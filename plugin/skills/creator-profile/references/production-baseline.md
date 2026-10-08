# Production baseline (the quality floor for every reel)

The minimum quality for every video made in any style, set after a first test reel was rejected for the reasons
below. A style's DESIGN.md may change the look (palette, type, material) but not this floor.

## What the user rejected, and what replaces it
| Rejected in v1 | Required instead |
|---|---|
| A generated still with a push or sway ("cheap motion") | A layered SVG/HTML illustration where parts move on their own: hands typing, the head turning, screens with live content (an editor typing with a cursor, a terminal streaming, a log scrolling), icons floating on separate phases, one element reacting to another. A camera move is only the last layer |
| A diagram animated by shaking or jitter | Edges draw in and carry moving packets. A state change propagates through the graph (e.g. an error cascade: chips pop, edges and packets turn the fail colour, status lights flip). The camera settles smoothly |
| A stat on its own black card | The stat goes on its evidence: capture the real page at 2x density or more, pan and push in to the real figure, ring it, then count the number up over the softly dimmed, lightly blurred page. A takeover stat is only for numbers nothing on screen produced |
| A crowded 0.7s knock-off | One container, one sequenced action per spoken word (build, then strike line by line, then fold away) and a clean final state. If a multi-step action needs more than about 1.2s, start it on an earlier word instead of cramming it |
| A flat black background | A lit environment behind every graphic scene: a light pool, a faint key-light colour, a drifting dot field or floor grid, grain and a vignette, drifting in absolute time so cuts don't jump. Panels have edge highlights and depth shadows |

## Checklist before the first draft render
- [ ] Every graphic scene has motion inside the frame tied to its words. No still-plus-camera beats remain.
- [ ] Each number is overlaid on its evidence where that evidence exists.
- [ ] Code is rendered from real files, with whitespace preserved: the code container is `white-space: pre`, rows are joined with no newline between them, and flex rows wrap their code in a `white-space: pre` span.
- [ ] Brand marks are official files with saved URL and checksum, geometry and colour unaltered. Other products appear as plain text.
- [ ] Fonts: local woff2 `@font-face` rules in the host `index.html` plus a frame-0 warm-up element (families used only via `var()` fall back silently in renders).
- [ ] Captions follow transcript word onsets, never cross a hard cut, never sit on the face, and turn off when the CTA keyword is spoken.
- [ ] SFX cues are placed by each file's measured audible onset, on contacts and state changes, and some cuts are left silent.
- [ ] Debug snapshots seek with callbacks on (`tl.seek(t, false)`). Otherwise `onUpdate`-driven typing and counters look frozen and you'll chase a bug that isn't there.

## Checklist on the encoded draft
- [ ] Make 2fps contact sheets of the whole reel and three frames around every cut. Look for empty panels, text clipped by its own container, overlays that hide their evidence, and frames that look static.
- [ ] Compare adjacent graphic beats with their headings hidden: each one should use a different mechanism.
- [ ] Check every illustrated or diagram beat at phone scale: the moving parts must still read.
