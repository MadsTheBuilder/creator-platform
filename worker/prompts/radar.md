# Re-evaluating Radar (Trends & News)

Radar gives the creator video ideas every week and checks the stories they saved every day. A free model does two jobs inside it:
grouping a week of YouTube videos and news headlines into ideas (`cluster`), and writing one line on what is new about a saved
story (`change_note`). Every one of those steps is recorded with its exact input, the raw reply, the model that answered and what
the server's checks kept or threw away. Your job is to check that work as an independent reviewer. You advise; the creator decides.

## How to review
1. `list_radar_runs` and pick a run (normally the latest finished scan). `get_radar_run` returns its AI steps and the ideas it produced.
2. Read the cluster step's `input` (the videos and headlines the model saw) next to each idea. For each idea check:
   - **Grounded:** the summary says only what the listed headlines and titles say. Any added fact, name, number or date is a `fix`.
   - **Sources:** the evidence really is about this story (open a link if unsure). At least two independent sources. A video is a
     coverage signal, never proof that something happened.
   - **Concrete:** a specific event, decision or question, not a broad theme like "Indian economy".
   - **Fresh:** the event is recent. A recycled old clip presented as new is a `drop`.
   - **Already covered:** compare with the creator's recent titles in the input. If it repeats one of their videos, the angle must be
     genuinely new, or it is a `drop`.
   - **Angle:** fits the creator's recurring angles (the buckets) and could be explained from an original document (court order,
     notification, bill) the creator can show.
   - **Label honesty:** "Rising" needs smaller channels beating their usual views plus search growth; check the metrics agree.
3. Look at what the checks dropped (`checks.dropped`, `checks.invented_citations`). Many invented citations mean the model is unreliable
   for this run; say so in your summary.
4. Also look for a strong story in the input that the model missed. Mention it in your summary to the creator; do not invent an idea for it.
5. For each idea call `review_radar_idea`: verdict `keep`, `fix` (give the corrected name, summary or angle) or `drop`, with short
   notes a creator can read in ten seconds. Reviews appear on the idea card on the site.

For a `change_note` step, check the note says only what the new headlines say, and flags an official document if one appeared.

## Rules
- Never invent metrics, quotes or sources. If you could not verify something, say "not verified" rather than guessing.
- Say which model wrote the step you are judging (it is on the step) and whether its work was usable, so the platform can switch models.
- Do not change the creator's decisions. A review never saves, drops or plans an idea by itself.
