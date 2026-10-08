# Brief: aggregator

**Goal:** turn seven research files into the five profile files (these files are the requested deliverables of your task, not a summary report): `analysis.md`, `DESIGN.md`, `voice.md`, `tokens.css` and `style.json`. They have to be accurate enough that someone who never saw the creator could make a video with their method, and honest about what wasn't seen.

## Inputs (absolute paths come from the orchestrator)
- `<style-dir>/references/research/*.md`: the seven findings files (channel-scout, pacing, structure, voice, palette, type-layout, motion-audio)
- `<style-dir>/references/research/pacing.json` and `<style-dir>/references/manifest.json`
- `<skill>/references/checklists.json`: **your checklist**. Every `requiredSections` heading must exist, and every `items` entry must be filled or explicitly listed under "Not assessed".
- `<style-dir>/` as scaffolded from `<skill>/blueprint`: keep its field names and `tokens.css` conventions
- If the style already has profile files (a refine run), read them first: update and correct them, don't start over.

Spot-check against primary sources when the researchers disagree or a claim looks surprising. You can open frames and transcripts in `references/` yourself.

## How to reconcile
1. **Pacing numbers come from `pacing.json` and nowhere else.** Paste the per-video table from it. In DESIGN.md, quote only medians that appear in that table. The validator enforces both, because the last profile shipped two conflicting sets of numbers.
2. **Colours come from tokens.css and nowhere else.** Define every hex in `tokens.css` first; DESIGN.md and `style.json.palette` may only mention hex values defined there.
3. **Conflicts:** prefer measured over sampled, and sampled over inferred, using each file's Confidence section. If two researchers still disagree, check the source yourself, or record both and flag the disagreement.
4. **Claims about what drives views** need the numbers in the analysis table to show the pattern, with at least two videos per group. Otherwise write "no clear driver from N videos".
5. **Uncited findings** from researchers go in only if you verify them yourself.
6. **Mechanisms, not identity.** No verbatim lines longer than a short signature phrase, and no creator names, credits or logos in anything meant to be reused. Branding goes in analysis.md under "What would distract (don't copy)".

## Write
- **analysis.md:** sections from `checklists.json`. Start with a channel line (name, URL, presenter, subscribers, date) and the source-file list. The per-video table must have a `Median shot` column and one row per manifest video, with the id in backticks.
- **DESIGN.md:** Style Prompt, Colors (role, hex, meaning), Typography, Motion (with pacing quoted from the table), Production baseline, Card kinds in this style (built vs not yet built), Legacy variants (if there are eras), What NOT to do.
  - **Production baseline:** state how this creator's look meets the user's quality floor in `<skill>/references/production-baseline.md`: the lit environment behind graphics (in this creator's palette, with its tokens defined in tokens.css), motion inside every frame, numbers overlaid on their evidence, and outline or style-appropriate captions. The research describes the creator; the baseline describes how our output executes it, and the baseline wins on quality.
- **voice.md:** the sections from `checklists.json`. State the writing-language rule at the top (e.g. "write scripts in Hinglish"). Write the spec itself in English so any editor can read it; use the creator's language mix only for the examples, connector patterns and the script template.
- **tokens.css:** keep the blueprint structure, and comment each colour with its role. It needs `--bg --fg --accent --font-display --font-body` and at least one `--ease-*`; era-only colours go under a clearly marked opt-in block.
- **style.json:** blueprint keys (`id, name, number, status, inspiration, summary, palette.bg/fg/accent, fonts.display/body, motion, transitions, cards`). Add `variants` if there are eras. `cards` may list only card files that exist on disk; otherwise leave it as `[]`, because a card that isn't on disk can't be saved to Content Engine.
- **Not assessed** sections in analysis.md and voice.md: merge every researcher's list and state the sampling limits (frame spacing, transcript quality, no audio listening).

## Then
1. Run `node <skill>/scripts/validate-profile.mjs <style-dir>` and fix every error it reports.
2. Write `<style-dir>/references/research/gaps.json` as `[{ "researcher": "<role>", "question": "<narrow, answerable question>", "affects": "<file#section>" }]`. List only gaps that another research pass could close with the material already in `references/`. Use `[]` if there are none.
3. Reply with the validator's last output line, the gap count, and three headline findings. Don't repeat the files' contents.
