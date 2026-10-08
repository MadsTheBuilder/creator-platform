---
name: storyboard
description: Make the storyboard of a Content Engine Production project from its 3D blockout (3 frames per shot, 6 for long shots, with each shot's camera, action, notes and audio), then check every frame against its shot. Use when the creator wants a storyboard, a shot-by-shot board, a previs sheet or a review of their blockout in Content Engine / Creator Platform.
---

1. `get_project`: the storyboard needs a shot breakdown and a finished blockout (`blockouts`). If there is none, make one first (the blockout skill).
2. `make_storyboard` with `blockout/<job_id>/preview.mp4` of the newest finished blockout, or a reference video the creator cut to the whole breakdown.
3. `get_storyboard` and look at the overview next to `get_breakdown`: does each frame show the shot's magnification, angle and subject?
4. Where one misses, fix that shot with `save_breakdown`, block it out again (`queue_blockout`), then `make_storyboard` again. Tell the creator it is in Playground > Storyboard.
