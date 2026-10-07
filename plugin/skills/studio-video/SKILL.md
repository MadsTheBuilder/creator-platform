---
name: studio-video
description: Plan and build a Content Engine Studio-track video, a motion-graphics piece made in HyperFrames code around the creator's own recording (or around music and a concept alone), timed to their words and music, then check its frames and fix them. Use when the creator says "make my Studio video", "build my Studio project", "make a video like this reference", "make a video from my recording" or "add motion graphics to my talking head", or wants a Studio project planned, built or restyled in Content Engine / Creator Platform.
---

The playbook lives on the server so it always matches the site. Follow it, not your own defaults.

1. `get_project` (use `list_projects` to find it). It must say `track: "studio"`; for a Production project use the `composition` skill instead.
2. `get_guide` with topic `studio`, and follow it exactly, step by step: refine the ask, study the references, read the words, sound, plan, **stop for approval**, build, snapshot and fix.
3. If you have a shell on the creator's computer, check `ffmpeg -version` and `python --version` (and `python -c "import numpy"`) once at the start. They are optional: they let you study reference videos stored on this computer and synthesize the score and sound effects. Tell the creator in one line what is missing and what that means for the result; don't install anything without asking.
4. Recording over 1 GB? Make a 1080p copy before uploading: `ffmpeg -i in.mov -vf scale=-2:1080 -c:v libx264 -crf 20 -c:a aac out.mp4`. Any other video you put in `media/` (b-roll, generated clips) gets re-encoded first with a keyframe every second (`-g 30`, command in the guide), or saves time out.
5. When it's done, tell the creator it is in Playground > Video edit, which updates live.
