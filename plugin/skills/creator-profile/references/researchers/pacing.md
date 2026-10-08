# Brief: pacing

**Goal:** the measured editing rhythm per video and per era. Numbers only, no adjectives without a number behind them.

Read `_contract.md` first.

**Inputs:** `research/pacing.json`, written by the orchestrator with `scripts/cut-stats.mjs`. If it's missing, run `node <skill>/scripts/cut-stats.mjs <references>/captions > <references>/research/pacing.json` yourself. Also `manifest.json` and `captions/<id>.cuts.txt`.

**Produce:**
1. **Per-video table:** id, title, date, duration, cuts, median shot, mean, cuts in first 60s, shots >10s, copied exactly from pacing.json. The aggregator pastes this table, and the validator checks that it matches pacing.json.
2. **Per-era or per-format summary:** the range of medians, e.g. "1.3–1.7s". Every number must appear in the table.
3. **Opening vs body:** cuts in the first 60s compared with the whole-video rate (cuts ÷ duration × 60). Does the creator front-load cuts?
4. **Long holds:** for the 2–3 videos with the most shots over 10s, find what is on screen during the holds. Use the `.cuts.txt` gaps and the matching `dense-` frame (one frame per 3s, 30 per sheet).
   - If a hold looks suspiciously long (low-contrast styles like paper or whiteboard), re-scan just that window at a lower threshold, e.g. `ffmpeg -ss <a> -to <b> -i raw-media/<id>.mp4 -vf "select='gt(scene,0.1)',showinfo" -f null -`. That catches white-on-white page turns and blur-ins the 0.3 pass misses. Report them as a note; never change `pacing.json`.
5. **Method note:** ffmpeg `select=gt(scene,0.3)`, shots under 0.15s dropped. Hard cuts are measured; dissolves and whip-pans can be missed. Say so under Not assessed.
