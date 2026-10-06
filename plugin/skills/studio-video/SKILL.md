---
name: studio-video
description: Plan and build a Content Engine Studio-track video, a motion-graphics piece made in HyperFrames code around the creator's own recording and timed to their words and music, then check its frames and fix them. Use when the creator wants their Studio project built, planned, restyled or made to look like a reference, or asks to "make a video from my recording", "build my Studio video" or "add motion graphics to my talking head" in Content Engine / Creator Platform.
---

The playbook lives on the server so it always matches the site. Follow it, not your own defaults.

1. `get_project` (use `list_projects` to find it). It must say `track: "studio"`; for a Production project use the `composition` skill instead.
2. `get_guide` with topic `studio`, and follow it exactly.
3. No transcript yet? Ask the creator to upload their recording in Playground > Recording. Or, if the file is on this computer, `create_upload_url` (target `media`), PUT it with curl, then `transcribe_recording` and poll `get_job`.
4. `get_transcript`, then `analyze_beats` on the music if there is any. Write the beat plan, `save_plan`, and **stop until the creator approves it**.
5. Build with `get_composition` / `save_composition`, then `snapshot` and critique, fix, and save again before calling it done.
6. Tell the creator it is in Playground > Video edit, which updates live.
