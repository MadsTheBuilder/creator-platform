---
name: creator-profile
description: Research a YouTube, TikTok or Instagram creator from their channel (or pasted reel URLs) and a set of their videos, build an evidence-backed style profile (analysis.md, DESIGN.md, voice.md, tokens.css, style.json, cards) on this computer, then save it as a style in the creator's Content Engine account. Use whenever the user gives a creator, channel or reference videos and wants their style, voice, pacing or "make videos like X", wants to refine a profile with more videos, or has a style-library / creator-profile folder and asks to add, upload or save it to Content Engine (Creator Platform), even if they don't say "profile".
---

# Creator Profile

Turn a creator's channel plus N of their videos into a style **profile** that captures how they make videos: pacing, structure, voice, look and motion. Every claim traces back to a frame, a timestamp or a measured number. Then save it to Content Engine, where it shows up under **Style** and can be picked per project.

The work is split three ways on purpose:
- **Scripts** do what must be identical every time: downloading, scene cuts, stats, colour sampling and validation. Numbers that a model estimates drift.
- **Researchers** (seven subagents) each chase one goal in parallel, so no single context fills up.
- **One aggregator** owns the five files and the checklist, so contradictions get resolved in one place.

`<skill>` is the folder this SKILL.md is in. The profile is written to `style-library/<slug>/` in the current working folder (`<style>`), with the creator's material in `<style>/references` (`<ref>`). The references never leave this computer.

**Already have a profile folder** (from an earlier run, or another kit's `style-library/NN-slug`)? Skip to Phase 6.

## Phase 0: Intake and preflight
1. **Get the inputs:**
   - the channel URL (YouTube channel, TikTok `@user` page, or Instagram profile);
   - the video links, or "pick the top N by views" (default 5; 8–10 if the channel has had visibly different eras). **Instagram:** yt-dlp can't list profiles, so the user must paste the reel URLs and "top N" isn't available;
   - the spoken language;
   - whether this is a new profile or a **refine** of an existing `style-library/<slug>`.
2. **Refine runs:** read the existing five files and `<ref>/manifest.json`, and add only videos not already in the manifest.
3. **Preflight, before downloading anything:**
   - Run `yt-dlp --version`, `ffmpeg -version`, `uv --version` and `node --version`. Say in one line what is missing and ask before installing anything.
   - If yt-dlp is missing, put the standalone exe in a user bin directory that is on PATH, rather than pip-installing into the user's Python.
   - Transcription uses `faster-whisper` through `uv`. CUDA is often missing on Windows, so the script defaults to the CPU, at roughly 3–6 minutes of processing per 10 minutes of video.
   - On Windows the `.sh` script runs in Git Bash.
4. **State the blind spots to the user up front:** nobody watches or listens. The work uses transcripts, frame grids, cut detection and loudness stats. Music, voice tone and the exact animation curves will be approximate or "not assessed".
5. **Scaffold a new style:** `node <skill>/scripts/new-style.mjs <slug> "Name"`. It copies `<skill>/blueprint` to `style-library/<slug>/`.

## Phase 1: Acquire (deterministic, in the background)
```bash
bash <skill>/scripts/acquire.sh <ref> "<channel-url>" ID1 ID2 ...   # or full video/reel URLs
uv run --python 3.11 --with faster-whisper python <skill>/scripts/transcribe.py <ref> --lang <code> ID1 ID2 ...
node <skill>/scripts/cut-stats.mjs <ref>/captions > <ref>/research/pacing.json
```
- **acquire.sh** writes the videos, metadata, scene cuts, audio stats, frame sheets, `channel-uploads.txt` and `manifest.json`. See its header for the full list.
- **URLs in, IDs out.** acquire.sh takes bare YouTube IDs or full URLs (TikTok, Instagram reels, YouTube). transcribe.py takes **IDs**: read them from `<ref>/manifest.json` after acquire finishes.
- **Run transcription in the background.** It is the slow step. Researchers that don't need transcripts (pacing, palette, type-layout) can start before it finishes.
- **Keep the creator's material private.** If the working folder is a git repo, make sure `style-library/*/references/` is in `.gitignore`. The creator's material must never be committed or uploaded.
- **If a platform rate-limits (HTTP 429),** wait and retry with `--sleep-requests 2`. Don't burn retries in a loop.
- **Login walls (Instagram almost always, TikTok sometimes):** re-run with `COOKIES_FROM=chrome bash <skill>/scripts/acquire.sh ...`, using whichever browser the user is logged in on. Ask before using their cookies.

## Phase 2: Research fan-out (seven subagents, one message)
Spawn all seven in a **single message** (Claude Code: the Agent tool, `model: "sonnet"`, general-purpose; Codex: parallel sub-tasks, or run them one after another). Each prompt contains only:
- its brief path, `<skill>/references/researchers/<role>.md`, and the contract, `<skill>/references/researchers/_contract.md`;
- the absolute paths of `<ref>` and `<skill>`, the creator's name and the spoken language.

| Role | One goal | Feeds |
|---|---|---|
| channel-scout | Identity, topic types vs views, eras, thumbnail grammar, branding | analysis, style.json |
| pacing | Per-video and per-era table from `pacing.json`, long holds | analysis table, DESIGN motion |
| structure | Opening beat tables, body shapes, endings, mechanisms, don't-copy | analysis |
| voice | Persona, language mix, connectors, wpm, hook formulas, script template | voice.md |
| palette | Colour roles with hex sampled by `sample-colors.py`, era variants, contrast | tokens.css, DESIGN, style.json |
| type-layout | Fonts (closest Google Font), captions, layout grammar, card inventory with slots | DESIGN, style.json cards |
| motion-audio | Transitions, entrance vocabulary, easing, loudness and silences | DESIGN motion, tokens easings |

Wait for all seven, then check that each `<ref>/research/<role>.md` exists. Re-spawn only the ones that are missing.

## Phase 3: Aggregate (one subagent, the strongest model)
Spawn one subagent (Claude Code: `model: "opus"`), giving it `<skill>/references/aggregator.md` and the absolute paths of `<style>`, `<ref>` and `<skill>`. It:
- reads all the research files and `<skill>/references/checklists.json`;
- writes the five files;
- runs the validator and fixes what it reports;
- writes `<ref>/research/gaps.json`.

## Phase 4: Gap loop (at most one round)
If `gaps.json` isn't empty:
1. Group the gaps by researcher.
2. Re-spawn agents only for those researchers, giving each the specific questions. Each appends a `## Follow-up` section to the owning findings file instead of rewriting it.
3. Re-run the aggregator with "update only the sections named in gaps.json".

Leftover gaps go into the files' "Not assessed" sections rather than starting another loop.

## Phase 5: Cards, verify, report
1. **Cards:** restyle the two blueprint cards (`cards/tier1/t1-stat.html`, `cards/tier2/t2-list.html`) to the new tokens and DESIGN.md so the style has working cards, and keep them listed in `style.json.cards`. Cards take every colour, font and easing from `../../tokens.css`, keep `data-slot` on each fillable text element, and keep one paused GSAP timeline on `window.__timelines`. Meet the floor in `<skill>/references/production-baseline.md`.
2. **Verify now** (earlier output doesn't count): `node <skill>/scripts/validate-profile.mjs <style>`. Claim the profile is done only when it passes, and quote its last line.
3. **Tell the user:** how many videos were used and how each was analysed; the headline findings (topic vs views, pacing per era, the voice in one line, the look in one line); what was not assessed.

## Phase 6: Save it to Content Engine
Do this when the profile passes, or whenever the user asks to add an existing profile folder to Content Engine / the web app.
1. Run the validator on the folder first if it hasn't passed in this session. Fix what it reports, or tell the user what fails and ask whether to save anyway.
2. Collect the files to send, each as `{ path, text }` with the path relative to the style folder and forward slashes:
   - `DESIGN.md`, `voice.md`, `analysis.md`, `style.json`, `tokens.css`, and `notes.md` if it exists;
   - every card at `cards/<tier>/<name>.html` (lowercase letters, digits and dashes only; rename a card that doesn't fit, and update `style.json` to match).
   - **Never** `references/`, videos, images or anything else. At most 60 files, each under 256 KB.
3. Call the Content Engine MCP tool **`create_style`** with `name` (the creator's name or the user's choice) and `files`. Ask whether it should be the default style for new projects (`make_default`).
   - No `create_style` tool? The Content Engine connection isn't set up. Tell the user to install this plugin (or add the MCP server `https://worker-production-b2a3.up.railway.app/mcp`); the first tool call opens a browser to sign in and approve.
   - Refused? The message says what to fix. Fix it and call again.
4. **Updating a style that is already saved** (a refine run): don't create a second copy. Call `list_styles`, then `get_style` for the one to update, and save each changed file with `save_style_file`, passing the file's hash from `get_style` as `expected_hash` (call `get_style` with `path` for analysis.md and cards; use `""` for a new file). Show the user what changes first.
5. Tell the user it is under **Style** on the site, where they can read and edit it and pick it for a project.

## Validator rules (why the profile can fail)
`scripts/validate-profile.mjs` reads `references/checklists.json` and checks:
- **Files and sections:** all five files exist and every required section heading is present.
- **style.json:** it has the blueprint keys.
- **Analysis table:** every manifest video has a row, and each median matches `pacing.json` to within 0.05s.
- **DESIGN.md medians:** every median DESIGN.md quotes exists in that table.
- **Colours:** every hex in DESIGN.md and in `style.json.palette` is defined in tokens.css, which also has the required tokens and an easing.
- **Paths:** there are no machine-specific paths.

Fix the content, not the validator. Each rule exists because an earlier hand-built profile broke it.

## Ethics line
Profile the **mechanisms** (rhythm, structure, layout grammar, hook patterns), never the identity:
- no verbatim scripts;
- no creator name, credit or logo on new videos unless the creator commissioned them;
- the reference footage stays in `references/` on this computer.
