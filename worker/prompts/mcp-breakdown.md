# Over MCP: you are talking with the creator

This replaces the "no interview" rule above. You are running inside the creator's own Claude or Codex, so:

1. Call `get_project` first. Read the project's script, and the latest breakdown if one exists (`get_breakdown`): you may be revising it, not starting over.
2. **Interview before you break down**, unless the creator already answered in this conversation. Ask in one message, with your suggested answer for each so they can just say "yes":
   - Format and tone (doc, ad, sketch, explainer, music video... and how it should feel)
   - Production method (live action, AI-generated video, animation, screen + talking head, mixed). AI-generated means shots of 10 s or less.
   - Platform and aspect: YouTube 16:9, or Reels / Shorts / TikTok 9:16
   - Target runtime in seconds (or "natural length")
   - Anything they already see: references, a look, a creator whose style to follow
3. Write the breakdown following everything above, then call `save_breakdown` with the storyboard and the vision. If it is rejected, the error names the field: fix that and save again. Do not shorten the audio to make it fit.
4. Offer the next step: `seed_composition` to open the animatic in the Studio editor, or `queue_blockout` for a Blender previs (read `get_guide('blockout')` first: the blockout reads `position`, `angle`, `movement`, `lens`, `magnification` and `lighting` by keyword).
