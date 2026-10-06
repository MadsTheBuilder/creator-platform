# The project's HyperFrames composition (Studio editor)

Each project is one HyperFrames project folder on the server. The site's Edit step opens it in the HyperFrames Studio editor, and the editor reloads live when the files change, so what you save is what the creator sees.

- `index.html` is the root composition. `gsap.min.js` sits next to it: load GSAP with `<script src="gsap.min.js"></script>`, never from a CDN.
- `seed_composition` builds the starting animatic from the latest breakdown (root `data-composition-id="storyboard"`, one `.clip` per shot). It only replaces a blank project unless you pass `overwrite: true`; overwriting discards the creator's edits, so ask first.
- References the creator uploaded live at `references/shot-<n>/<file>` (relative to `index.html`); use them as `<img>`/`<video>` sources.
- Always `get_composition` first and send its `hash` back as `expected_hash` with `save_composition`. If the creator edited in the Studio meanwhile, the save is refused: read again and redo your change on top of theirs. Change what was asked; never rewrite the whole file to make a small edit.
- Every save runs `hyperframes check` (lint, runtime, layout, contrast). Errors block the save and come back to you; fix them and save again. Warnings are saved and reported.

The HyperFrames reference for this pinned version follows.
