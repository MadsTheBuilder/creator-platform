# Studio track: a motion-graphics video built around the creator's recording

Studio projects (get_project says `track: "studio"`) are not shot or storyboarded. The picture is code: one
HyperFrames composition around the creator's own recording, timed to their words and to the music. You are
the only author. The creator judges the result against motion graphics they admire online, so the bar is
"looks produced", not "has the content".

## The order of work

1. **Read the project.** `get_project` gives the direction (their look and feel in a few lines, often with
   reference links; `references` with `shot: 0` are the creator's own visual references for the whole video, look at them), the beat plan if one exists, the media files and the transcript status. If there is no
   transcript yet, ask the creator to upload their recording in Playground > Direct (or upload one for
   them with `create_upload_url` target `media`, then `transcribe_recording`). Speech to text runs on the
   creator's computer: if you have a shell there, run the two commands `transcribe_recording` returns (in the
   background: the first run downloads ~1.6 GB); otherwise pass `on: "helper"` for their helper app.
2. **Read the words.** `get_transcript` returns every word with start and end times in seconds. The recording
   is the spine: cuts, reveals and captions land on its words and pauses. Speech-to-text mishears names and
   sometimes leaves stray characters from other alphabets: if the project has a script (or the creator gives you
   one), compare and correct the words with `fix_transcript` before you time anything to them.
   **Devanagari to Roman:** whisper often writes Hindi in Devanagari whatever the creator chose. If `get_project`
   says `writing: "roman"` and `get_transcript` reports Devanagari words, convert them all with `fix_transcript`
   before anything else. Use the script's spelling where it has the word; otherwise common Roman Hinglish
   ("shaam", "bheed", "hai"). Keep English words in English.
3. **Pick the music first** (if there is any in `media/`), then `analyze_beats` it. Section changes go on bar
   lines (every 4 or 8 beats), hits and cuts on beats. Without music, the transcript's phrase ends are the beat.
4. **Write the beat plan** and save it with `save_plan`. It shows on the Direct step. Then stop and ask the
   creator to approve or change it. Do not build before they approve.
5. **Build** one composition (`get_composition`, then `save_composition` with its hash).
6. **Look at it.** `snapshot` at the moments that matter (every section change, the biggest hit, a caption
   mid-word, the last frame). Critique each frame against the brief and the rules below, fix, save, snapshot
   again. At least one full round before you tell the creator it's ready. Say what you changed.
7. Tell the creator it is in Playground > Video edit, where they can scrub, tweak and render.

## The beat plan (what save_plan holds)

- **The brief, in four lines:** the one idea that carries the piece; the single visual device that carries the
  whole thing (one continuous world, not a slideshow of frames); the look named as medium + light + lens +
  texture (e.g. "light painting in a black room, long exposure, wide lens, haze and film grain"); one accent
  colour.
- **Beats:** one line per beat: `start–end s · what is said · what we see · the sound on the hit`. Times come
  from the transcript (and the beat grid when there is music). 2–6 seconds per beat for short-form.
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
- Every `save_composition` runs `hyperframes check`; errors block the save and come back to fix.
- `snapshot` renders real frames on the server (about 10 s) and returns them as images. Use it as your eyes.

The general composition guide and the HyperFrames reference for this pinned version follow.
