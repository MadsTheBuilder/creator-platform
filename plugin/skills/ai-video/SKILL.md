---
name: ai-video
description: Turn a Content Engine Production project's Blender blockout, shot breakdown and reference images into timed, paste-ready prompts for an AI video model (Seedance, Veo, Kling, Wan, Sora), matching the blockout's cuts and camera moves second by second, and, when the creator asks, generate takes with their own Higgsfield account (their Higgsfield connector or their API key). Use when the creator wants AI video, Higgsfield or Seedance prompts, "generate the film from my blockout", "make the real video from the previs", or takes for a Production project in Content Engine / Creator Platform.
---

The playbook lives on the server so it always matches the site. Follow it, not your own defaults.

1. `get_project` (use `list_projects` to find it). It must say `track: "production"` and list a finished blockout; without one, use the `blockout` skill first.
2. `get_guide` with topic `ai-video`, and follow it step by step: read the blockout (`analyze_video`), map shots to the breakdown, read the references, write the prompts, `save_prompts` until it passes.
3. Generate only when the creator asks, and only after they say yes to the cost (`prepare_generation` gives it). It runs on **their** Higgsfield account:
   - their Higgsfield connector is in this chat: route `mcp`, then `import_take`;
   - they have a Higgsfield API key and you have a shell on their computer: route `api`, run the commands it returns. The key stays in their environment as `HF_KEY`; never ask them to paste it here. Installing `higgsfield-client` is an install on their computer: ask first.
4. Compare every take with the blockout (`analyze_video` on the take) before spending again. Tell the creator the prompts and takes are in Playground > AI video, and the takes are in the editor's Assets for the cut.
