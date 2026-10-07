# Studio track: a motion-graphics video built in code

Studio projects (get_project says `track: "studio"`) are not shot or storyboarded. The picture is code: one
HyperFrames composition, built around the creator's own recording (timed to their words and the music) or,
with no recording, around the music and the concept alone. You are
the only author. The creator judges the result against motion graphics they admire online, so the bar is
"looks produced", not "has the content".

## The order of work

Do every step yourself, in order. The creator should only have to write the direction, attach references,
approve the plan and watch the result.

**Two layers decide the look.** The **creator style** (`get_project` gives `style`; read it with `get_style`) is
how this creator's videos always look and sound: palette, type, motion, pacing, card templates, voice. The
**project** (direction, references, transcript, approved plan) is what this one video needs. When they disagree,
the higher one wins: the project's direction, then its references, then the style's `notes.md` (the creator's
own rules), then the rest of the style, then this guide's defaults. No style: the references and this guide
decide.

1. **Read the project and refine the ask.** `get_project` gives the direction, the beat plan if one exists, the
   media files and the transcript status. Work out the **idea**, the **format** (9:16 or 16:9) and the **length**.
   If any of the three is missing and can't be inferred, ask the creator at most three short questions, once;
   otherwise go on. If the project has a style, `get_style` it now (and `get_style` with `path` for
   `analysis.md` or a card template you want to adapt) and treat it as the default for everything below. Then
   pick the mode:
   - **Recording-led:** the creator recorded themselves (or a voiceover). The transcript is the spine. If there is
     no transcript yet, ask them to upload the recording in Playground > Direct (or, if the file is on this
     computer, upload it with `create_upload_url` target `media`, then `transcribe_recording`). Speech to text
     runs on the creator's computer: if you have a shell there, run the two commands `transcribe_recording`
     returns (in the background: the first run downloads ~1.6 GB); otherwise pass `on: "helper"`.
   - **Music- or visual-led:** no recording (the direction is a concept, like "the evolution of humans drawn by
     one point of light"). The music's beat grid, or your own timing in the brief, is the spine. Don't ask for
     a recording.
2. **Study the references before you plan.** `list_references` returns the creator's images and each reference
   video as a sheet of 16 frames: look at every one. If the direction names files on the creator's computer
   (e.g. `C:\Videos\ref.mp4`, used for references too big to upload) and you have a shell, study them there:
   frames at every cut (`ffmpeg -i ref.mp4 -vf "select='gt(scene,0.3)',scale=480:-2,tile=4x4" -fps_mode vfr
   -frames:v 1 cuts.jpg`, more sheets for long clips), the cut rhythm (count the cuts over the duration), and the
   music's tempo. Links you can't open: say so rather than guess.
3. **Read the words** (recording-led). `get_transcript` returns every word with start and end times in seconds.
   Cuts, reveals and captions land on its words and pauses. Speech-to-text mishears names and sometimes leaves
   stray characters from other alphabets: if the project has a script (or the creator gives you one), compare
   and correct the words with `fix_transcript` before you time anything to them.
   **Devanagari to Roman:** whisper often writes Hindi in Devanagari whatever the creator chose. If `get_project`
   says `writing: "roman"` and `get_transcript` reports Devanagari words, convert them all with `fix_transcript`
   before anything else. Use the script's spelling where it has the word; otherwise common Roman Hinglish
   ("shaam", "bheed", "hai"). Keep English words in English.
4. **Sound.** If there is music in `media/`, `analyze_beats` it: section changes on bar lines (every 4 or 8
   beats), hits and cuts on beats. If `media/` has no music or no sound effects and you have a shell, make
   them: synthesize a score and hit sounds timed to your beats (Python with numpy if it is installed, otherwise
   ffmpeg `-f lavfi` sources: `sine`, `anoisesrc`, with `afade`, `lowpass`, `aecho`): a pad that changes with
   the sections, a soft pulse or whoosh into each reveal, a bell or impact on each hit. Normalise to −14 LUFS
   (`ffmpeg -i score.wav -af loudnorm=I=-14:TP=-1:LRA=11 -ar 48000 score-final.wav`) and upload with
   `create_upload_url` target `media`. No shell: ask the creator for music and sound effects, or tell them the
   piece will be quieter than the references.
5. **Write the plan** (format below) and save it with `save_plan`. It shows on the Direct step and is saved as
   `BRIEF.md` in the project folder. Then **stop** and ask the creator to approve or change it. Do not build
   before they approve. Whenever a later change departs from the approved plan (a new length, a different
   layout, a beat moved), `save_plan` again with the plan as it now is, so the Direct step and `BRIEF.md` stay
   true.
6. **Build** one composition (`get_composition`, then `save_composition` with its hash).
7. **Review it yourself, then fix it, until it passes.** Don't hand over after the first save that works. Pick
   the review moments once (every section change, the biggest hit, a caption mid-word, the last frame; up to 8)
   and `snapshot` the same moments every round, so rounds compare. Call `list_references` again and put each
   frame next to them. Score every item below **pass / fail, with the evidence** (what you see at which second,
   or the number you measured):
   - **Look matches the style and the references:** background tone and texture, palette, accent colour, type
     style, pacing. Name the difference if there is one ("references are cream paper, build is near-black":
     fail), unless the plan's "Changed for this project" says why.
   - **The frame is full:** no large dead area (a quarter of the frame or more with nothing on it) outside a
     deliberate pause.
   - **Hero type is big:** at each key word of the plan, one word or phrase at 50–80% of the frame width.
   - **The direction's rules hold:** check each rule the creator wrote (e.g. the webcam never covers the
     important part of the footage) at every frame.
   - **Captions** are readable, centred, on their words, nothing important under them.
   - **Footage:** no visible repeats of the same span, nothing soft or stretched, no stray artifacts.
   - **Sound:** with a shell, measure the music you placed (`ffmpeg -i score.mp3 -af ebur128=framelog=quiet -f null -`):
     music near −14 LUFS before its clip volume, a sound on every hit in the plan, the voice always clear.
   Fix every fail, save, snapshot the same moments, score again. At least two rounds; stop when everything
   passes or after four rounds. Then tell the creator, in a short table, each item, its result, and what you
   changed per round, plus anything still failing and why (e.g. "the b-roll is 480p, only a sharper source
   fixes it").
8. Tell the creator it is in Playground > Video edit, where they can scrub, tweak and render.
9. **What to remember.** If the project has a style and the creator gave feedback along the way (in the
   approval, in later change requests, in what they asked you to fix), turn the lasting part into at most five
   specific proposals for the style, each quoting what they said: e.g. "notes.md: add *Captions at least 64px;
   bottom-centre pill.*" or "DESIGN.md › Colors: background is cream paper `#efe6d2`, not near-black". One-off
   choices for this video stay out. Show the list and save **only the ones the creator accepts**, with
   `save_style_file` (rules from feedback go in `notes.md`). Never change the style without a yes.

## The plan (what save_plan holds)

These sections, in this order, in Markdown:

- **From your style** (only when the project has one): the style's name and one line each for what you will
  take from it (palette, type, motion, pacing, cards you'll adapt).
- **Changed for this project** (only when the project has a style): each place the direction or references
  override the style, and fonts the renderer can't resolve with the stand-in you'll use. "None" if nothing.

- **What I took from the references:** one specific line each for look (medium, light, lens, texture), colour
  and accent, type (family, weight, size, how it moves), camera, transitions, cut rhythm (e.g. "a cut every
  ~1.2 s, hard cuts on the kick"), and sound. Specific enough that the creator can tell if you misread them. No
  references: say so in one line.
- **Brief, in four lines:** the one idea that carries the piece; the single visual device that carries the
  whole thing (one continuous world, not a slideshow of frames); the look named as medium + light + lens +
  texture (e.g. "light painting in a black room, long exposure, wide lens, haze and film grain"); one accent
  colour. Then the format, length and mode, and where the sound comes from.
- **Beats:** one line per beat: `start–end s · what is said (or "—") · what we see · the sound on the hit`. Times
  come from the transcript (and the beat grid when there is music). 2–6 seconds per beat for short-form.
- **Length and format:** match the recording's length and aspect (9:16 for Shorts/Reels/TikTok, 16:9 for
  YouTube) unless the creator says otherwise.

## What makes it look produced (from a calibration test that matched the reference Shorts)

- **One author, one world.** Build the whole piece yourself in one composition. Never hand frames to separate
  workers; the seams show. One device carries the piece; the camera moves through it rather than cutting
  between unrelated slides. Hard cuts are rare and land on the music.
- **Light and depth.** Glow (draw bright layers additively, blur copies at two radii and add them back), haze,
  depth of field (blur what is far), reflections, particles, grain and a vignette. Flat shapes with hairline
  strokes read as a web page, not a film.
- **Everything is a function of time.** For rich scenes use one `<canvas>` (2D with projected 3D, or WebGL /
  Three.js) and draw each frame from `t`, driven by a GSAP proxy tween:
  `const p = { t: 0 }; tl.to(p, { t: DUR, duration: DUR, ease: 'none', onUpdate: () => render(p.t) }, 0);`.
  Seeded randomness only (no `Math.random()`), so every render is identical.
- **Type fills the frame.** Hero words at 60–80% of the frame width, inside the safe area (keep 8% clear on
  every side; on 9:16 keep the bottom 20% clear of key text for platform UI). Video sizes, not web sizes:
  nothing under 24px, labels 18–24px at least, headlines 64–120px+ (bigger on 9:16).
- **One accent colour**, at full strength where the eye should go. Muted is fine, flat is not. No full-screen
  linear gradients on dark backgrounds (they band in H.264): use radial gradients or solid + local glow.
- **Motion everywhere.** Subtle reads as static at 30 fps. Ambient drift on everything, 3+ different eases per
  section, transitions matched in velocity (exit fast with blur, enter fast with blur).
- **Sound on every hit.** Each reveal, cut and impact gets a sound effect from `media/`. If there are none,
  ask the creator for some, or tell them the piece will be quieter than the references. Mix so speech is
  always clear: voice at `data-volume="1"`, music around 0.25–0.4 under speech and up to 0.8–1 in gaps, with
  `data-fade-in` / `data-fade-out` on music edges. The references are mixed loud (about −14 LUFS).

## Cards from the creator's style

A style can carry **cards**: ready-made HyperFrames sub-compositions in the creator's look, with named text slots.
`get_style` lists them (`cards`: where to mount each, and its slots); `style.json` says each card's tier, purpose,
slot limits (`maxChars`) and length. **Tier 1** cards take over the whole frame (a big stat, a quote, a section
title); **tier 2** cards sit over the footage and must never cover the speaker's face. When the project uses a
style, its cards are copied into the project's `style/` folder (with `style/tokens.css`) every time you read,
save or snapshot the composition, so they always match the style as the creator last edited it.

- Mount a card where the plan has that kind of beat, timed to its words, and fill its slots per beat:
  `<div id="stat-1" data-composition-id="stat-1" data-composition-src="style/cards/tier1/t1-stat-redtear.html" data-start="23.6" data-duration="5" data-track-index="3" data-variable-values='{"lead":"Kareeb das minute baad","stat":"10 MIN","source":"Source- FIR"}'></div>`.
  Each mount needs its own `id` and `data-composition-id`; the same card can be mounted many times.
- Keep slot text inside its `maxChars`. Slots you leave out (or leave empty) keep the card's sample text, so fill
  every slot. An `image` slot takes a path relative to `index.html`, e.g. `media/cutout.png`.
- Never edit the files in `style/` (they are rewritten from the style). To change how a card looks for this
  video only, copy its code into the composition; to change it for good, propose the edit to the style.
- Plan the cards in the beat plan ("23.6 s · tier 1 stat card: 10 MIN"), and use them instead of hand-building
  the same graphic: they are how this creator's videos look.

## The recording in the composition

- The working copy is `media/recording.mp4` (or `media/recording.m4a` for a voiceover), relative to
  `index.html`. Place it as a timed clip with its sound, e.g.
  `<video class="clip" src="media/recording.mp4" data-start="0" data-duration="<seconds>" data-has-audio="true" data-track-index="0"></video>`.
  The framework owns playback: never call `play()` or set `currentTime` yourself.
- The creator's face is part of the world, not a box in a corner: frame it, mask it, put graphics behind and
  in front of it, push in on emphasis. For a voiceover, the world carries the picture alone.
- **Captions** come from the transcript. Put the word timings you got from `get_transcript` into the script as
  a data array and reveal words on their own start times (a word or a short phrase at a time, big, on the
  accent colour for the stressed word). Hindi is transcribed in the writing the creator chose (Roman Hinglish by
  default, or Devanagari); keep it, and check the glyphs in a snapshot (Noto fonts cover Devanagari).

## Mechanics

- Composition rules, the root element and GSAP loading are the same as any project here (see below). Load
  GSAP from the local `gsap.min.js`, never a CDN. The root's `data-width`/`data-height` must match the chosen
  aspect (1080x1920 for 9:16, 1920x1080 for 16:9) and `data-duration` the recording's length.
- **Every video you upload to `media/`** (b-roll, generated clips) must have a keyframe every second, or every
  check, snapshot and editor scrub crawls (a long GOP made a 60 s check take ~90 s, past the save's time limit).
  Re-encode before uploading: `ffmpeg -i in.mp4 -vf "scale=-2:'min(1080,ih)',fps=30" -c:v libx264 -preset veryfast
  -crf 20 -g 30 -pix_fmt yuv420p -c:a aac -movflags +faststart out.mp4` (add `-an` for silent b-roll). The
  recording's working copy is already made this way.
- Every `save_composition` runs `hyperframes check` (about 20–40 s); errors block the save and come back to fix.
  Each error names the element (`where`) and, for overlaps and overflows, the other element (`with`). Waivers
  (`data-layout-allow-overlap`, `data-layout-allow-overflow`) only count on the flagged element itself, never on a
  parent. Stacked text in one card (a big number over a label): make the card `display:flex;flex-direction:column`,
  which the check treats as managed layout, instead of tight line-heights or negative margins.
  Fonts: use only families the renderer resolves (e.g. Playfair Display, Montserrat, Bebas Neue, Noto Sans,
  Times New Roman, Arial) or declare `@font-face`; anything else (e.g. Noto Serif) is an error.
- `snapshot` renders real frames on the server (about 10 s) and returns them as images. Use it as your eyes.

The general composition guide and the HyperFrames reference for this pinned version follow.
