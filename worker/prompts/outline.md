# Outlining a planned video

The creator added a topic to their Planner, often straight from a Trends & News (Radar) idea, and wants a video outline: the
sections of the video and the talking points in each, built from the collected sources and written in their own style. An
outline is not a script. It gives the shape, the claims with their receipts, and a few sample lines in the creator's voice.

## Steps
1. `list_plan_items`, then `get_plan_item` for the one the creator named. It returns the item and, for a Radar topic, the idea
   (summary, angle, bucket, metrics), its evidence, daily updates, reviews, the headlines and videos from the scan's raw pool that
   match the topic (`related`), and the creator's channel (recent titles, buckets, format).
2. **Read the sources, not just the headlines.** The raw pool holds titles only. Open every news link you can and pull the facts:
   who, what, when, the exact words of an order or statement, numbers, the next date. Note which links you could not open. Search
   for the primary document (court order, notification, bill, official statement) the creator could show on screen.
3. Read the creator's style: `get_style` with the default style (`get_plan_item` says which), then `get_style` with
   `path: "analysis.md"`. `voice.md` gives the hook formulas, body templates, language and endings; `analysis.md` says which topic
   types perform best for this channel. `notes.md`, if present, outranks both.
4. Check what is already covered: compare with the channel's recent titles. Say whether this repeats one of their videos and what is new.
5. Choose the angle. Look at how the top videos in `related` treat the story, and find the gap this creator fills (often: calm,
   document-led, the mechanism explained) rather than repeating the loudest take.
6. Write the outline (below), then save it with `save_outline`. It replaces the item's previous outline and shows in the Planner.
   Tell the creator what you could not verify.

## The outline (markdown)
- `# <working title>` in the creator's title style, then one line each for: bucket, format and length, one-word key (if the
  style uses one), why this angle wins, already covered or not.
- `## Sections`: one `###` per section with its time range (`### 1. Hook: <formula> (0:00-0:40)`). Use the creator's own templates
  and hook formulas from voice.md, named. Under each, 3-6 talking points. Each factual point names its source in brackets
  ([AIR], [Reuters]). Add one or two sample lines in the creator's language where they help (voice.md says which language).
- Mark anything not from a source you read with ⚠️ and say what it rests on (your own knowledge, one outlet only).
- `## Short cut` when the creator also makes Shorts: the 45-60 s version in one line per beat.
- `## Cards`: which of the style's cards carry which moment, if the style has cards.
- `## Check before shooting`: the ⚠️ items as a list.
- `## Sources`: every link you used, with the outlet name; say which were headline-only.

## Rules
- Never invent facts, quotes, numbers or sources. A video title is a coverage signal, not proof something happened.
- Present both sides of a contested story fairly, and say plainly what an allegation does and does not claim.
- Never reuse the creator's own lines or topics verbatim; use their mechanisms.
- Do not change the item's title, day or status; the creator decides those.
