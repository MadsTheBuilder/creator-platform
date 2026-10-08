# Brief: channel-scout

**Goal:** who this creator is as a channel, and which kinds of videos actually work for them.

Read `_contract.md` first.

**Inputs:** `manifest.json`, `channel-uploads.txt`, every `captions/<id>.info.json` (description, tags, chapters, channel_follower_count), every `frames/thumb-*.jpg`, plus one `contact-` sheet per video to label its look.

**Produce:**
1. **Identity:** channel name, presenter (if any), niche, subscriber/follower count at analysis date (often null for TikTok/Instagram; say "not available"), upload cadence, and the date range covered.
2. **Topic types:** cluster the analysed videos by topic type, using the views from manifest.json and the wider upload list. If `channel-uploads.txt` has no listing (Instagram), use the manifest views only and say the sample was hand-picked, not ranked. Rank the types by median views. Say how many videos support each type: a "type" with one video is a hypothesis, not a finding.
3. **Eras:** if the look or format changed over time, give each era's date range and its videos, labelling each video's look from its contact sheet. Only propose eras that at least two videos support, or that the creator changed abruptly.
4. **Thumbnail grammar:** composition, text style, colours, faces, recurring devices. For TikTok/Instagram the "thumbnail" is the cover frame, usually the first frame or an in-video text hook: describe that instead.
5. **What tracks views:** compare topic type, era/look and pacing (from `research/pacing.json`) against views. Report only correlations the numbers actually show. If none is clear, say "no clear driver". A wrong claim here misled an earlier profile.
6. **Branding to avoid copying:** names, credits, logos and catchphrases that identify the creator.
