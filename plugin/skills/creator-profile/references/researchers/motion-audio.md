# Brief: motion-audio

**Goal:** how things move and sound: transitions, entrances, easing feel, music and sound-effect usage, and loudness.

Read `_contract.md` first.

**Inputs:** `frames/dense-*` (one frame every 3s), `captions/<id>.cuts.txt`, `captions/<id>.audio.txt`, and transcripts for `[Music]` or `[Applause]` tags.

**Produce:**
1. **Transitions:** hard cut vs dissolve vs whip vs zoom. Estimate the share from dense sheets around cut times; cuts.txt only catches hard changes.
   - To see an entrance, extract 8 frames at 0.1s steps around one cut: `ffmpeg -ss <t-0.3> -i raw-media/<id>.mp4 -vf fps=10 -frames:v 8 frames/motion-<id>-<t>-%02d.jpg`. Do this for 3–5 signature graphics.
2. **Entrance and exit vocabulary:** slide, scale-pop, wipe, type-on, marker draw. Give the approximate duration in frames at 10 fps and the feel (snappy, eased, elastic), and map each to a CSS cubic-bezier suggestion.
3. **Camera:** static, push-ins, punch-in jump cuts on the presenter.
4. **Audio:** integrated loudness and loudness range per video, and the silence-gap pattern (pauses for effect?), from `audio.txt`. Note music and sound effects only where a transcript tag or an obvious on-screen cue supports it.
5. **Not assessed:** be explicit. Music genre, sound-effect choice and voice tone cannot be heard by you. Do not invent them.
