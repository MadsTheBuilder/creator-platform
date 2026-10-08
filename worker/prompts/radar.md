# Radar (Trends & News)

Radar gives the creator video ideas every week and checks the stories they saved every day. The server only collects and scores:
YouTube videos, news headlines (Google News) and Google Trends. **You do the thinking**: you group the pool into ideas, and you
review them. Nothing here runs a model on the server.

## Turn a scan into ideas
1. `list_radar_runs`. Pick the latest scan with status `done` and no ideas yet (`summary.ideas` missing). If there is none, tell the
   creator to press "Find new ideas" on the site and wait for it to finish.
2. `get_radar_run`. `run.raw` has `creator` (channel, buckets, recent titles, ideas to skip), `videos` (id, title, channel, views,
   `x` = views vs that channel's usual, `vph`) and `news` (url, title, source, date).
3. Group it into 4 to 10 ideas and call `save_radar_ideas`. Rules:
   - Each idea is a concrete event, decision or question, named in plain English, not a broad theme.
   - At least two pieces of evidence from different sources. One viral video alone is noise.
   - `summary`: one or two sentences using only the listed titles and headlines. Never add facts, names, numbers or dates.
   - `angle`: how this creator could explain it, in their buckets (`creator.buckets`). One sentence.
   - `keywords`: 2 to 5 short search phrases a viewer would type (English or Hinglish); `query`: the best one.
   - `bucket`: copied exactly from `creator.buckets`, or null.
   - Skip routine market prices, exam results, sport, celebrity gossip, anything in `skip_saved_or_dropped`, and anything that repeats
     one of the creator's `recent_titles` without a new angle.
   - Copy `video_ids` and `news_urls` exactly. The server drops invented ones and tells you what it dropped.
4. Tell the creator how many ideas were saved and which you left out and why.

## Review ideas
`get_radar_run` returns the ideas a run produced. For each, check it is grounded in its evidence, concrete, fresh (a recycled old clip
is a `drop`), not already covered by the creator, and fits their buckets. Then `review_radar_idea` with `keep`, `fix` (give the corrected
name, summary or angle) or `drop`, with notes a creator can read in ten seconds. A video is a coverage signal, never proof that
something happened. "Rising" needs smaller channels beating their usual views plus search growth; check the metrics agree.

## Rules
- Never invent metrics, quotes or sources. If you could not verify something, say "not verified".
- Do not change the creator's decisions. A review never saves, drops or plans an idea by itself.
