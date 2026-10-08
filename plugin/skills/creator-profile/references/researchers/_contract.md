# Researcher contract (every researcher follows this)

You are one of seven research agents studying a single creator. You have **one goal**, written in your brief. Stay inside it: another agent covers each other area, and an aggregator merges the results. Going wider costs tokens and creates contradictions the aggregator then has to untangle.

## Inputs
The orchestrator gives you the absolute path of `<style-dir>/references/`. Everything is there:
- `manifest.json`: the analysed videos (id, platform, url, title, upload_date, view_count, duration). `platform` is YouTube, TikTok or Instagram; short vertical videos change what "layout" and "thumbnail" mean
- `captions/<id>.info.json`: yt-dlp metadata (description, chapters, tags)
- `captions/<id>.txt`: full transcript (English translation if the creator isn't English-speaking; names come out garbled)
- `captions/<id>.hook.<lang>.txt`: native-language transcript of the first ~2 min. Trust this over the translation for phrasing.
- `captions/<id>.cuts.txt` and `research/pacing.json`: scene cuts and the one official set of pacing stats
- `captions/<id>.audio.txt`: loudness and silence gaps
- `frames/`: `thumb-`, `hook-` (first 60s, 2s apart), `contact-` (30 frames over the whole video), `dense-<id>-NN` (one frame every 3s, or every 1s for videos under 90s)
- `channel-uploads.txt`: recent uploads with views. For Instagram it holds only a "listing unavailable" line: work from the manifest videos

Read images with the Read tool, which shows them to you. Open a grid sheet before individual frames.

## Output
Write exactly one file, `references/research/<your-role>.md`, in this shape:

```markdown
# <role> findings: <creator>

## Findings
- <one observation per line> [<id>@m:ss] or [frame:<file>] or [meta:<id>]
## Numbers
<tables or measured values, with the method used>
## Confidence
- measured: <what came from scripts or full data>
- sampled: <what came from frame grids; state the spacing>
- inferred: <judgement calls>
## Not assessed
- <what your goal needed but the inputs couldn't show>
## Gaps for the aggregator
- <specific open questions another pass could answer>
```

## Rules
- **Cite every finding.** A finding without a citation is treated as a guess and may be dropped. The citation lets the aggregator, and later the user, check the claim.
- **Observation before interpretation.** First write what is on screen or in the transcript, then what it means.
- **Mechanisms, not content.** Describe *how* the creator does things. Don't copy whole lines: paraphrase the pattern, and quote at most a 3–6 word signature phrase, marked as theirs.
- **Never estimate pacing.** Shot-length numbers come only from `research/pacing.json`.
- **When done, reply with only the path you wrote and one line of headline findings.** The aggregator reads your file, so don't repeat its contents in the reply.
