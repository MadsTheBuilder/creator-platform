---
name: blockout
description: Make a Blender 3D blockout (previs) of a Content Engine project's shots on the creator's own PC, look at the result and refine the breakdown until each framing is right. Use when the creator wants 3D previs, a blockout, camera placement in 3D, or references for AI video generation from their Content Engine / Creator Platform project.
---

1. `get_guide` with topic `blockout`: the blockout reads the breakdown's fields by keyword, so write them its way.
2. `get_project`: if `blender_helper_online` is false, ask the creator to start their Blender helper (Playground > 3D visual > Connect Blender).
3. `queue_blockout` with the shots, then `get_job` every 20-30 s until done or failed.
4. `get_blockout` and look at each still. Where a framing misses the shot's intent, fix that shot with `save_breakdown` and blockout just those shots again.
5. Then lay it out as the storyboard: `make_storyboard` (the storyboard skill).
