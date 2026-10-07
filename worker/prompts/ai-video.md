# AI video: from the blockout to a generated take

Production track, after the 3D visual. You turn the project's Blender blockout, its shot breakdown and its reference images into timed, paste-ready prompts for an AI video model, save them (`save_prompts` checks them), and, only when the creator asks, generate a take with **the creator's own Higgsfield account**: their Higgsfield MCP connector, or their Higgsfield API key on their own computer. The platform never holds their key and never pays for a generation.

Three sources, three jobs:
- **The blockout** is the authority on **timing and camera**: where each cut lands, what the lens does, where people stand.
- **The shot breakdown and script** decide **what happens and what is said**.
- **The reference images** decide **what everything looks like**.

## 1. Gather inputs

- `get_project`: the latest blockouts, the references, the breakdown summary, and any prompts or takes already saved (`ai_video`).
- **Blockout video (required):** `get_blockout` gives the job's files; the video is `blockout/<job_id>/preview.mp4`. No blockout with a preview: the creator builds one first (3D visual step, or the `blockout` guide).
- `get_breakdown` and the script from `get_project`. `list_references` shows every reference image; its paths (`references/shot-N/<name>`) are what your prompts name. The blockout's stills (`blockout/<job_id>/shot-NN.png`) can be references too.
- **Target model and aspect ratio.** The aspect is the breakdown's. If the creator has not named a model, ask once; recommend Seedance 2.5 on Higgsfield for anything with several cuts over 10 s.
- Ask the creator for a budget before any generation.

## 2. Read the blockout

`analyze_video` with path `blockout/<job_id>/preview.mp4`. It returns the shot table (cuts from scene detection) and contact sheets: 2 frames a second, 15 s per sheet, left to right, top to bottom, so frame k of a sheet starting at S is at S + 0.5·(k−1) s. **Read every sheet.** For each shot, note:
- burned-in labels, if the blockout has them (shot number, magnification, movement, lens, angle, VO). They tie each cut to a breakdown row;
- the camera move as you actually see it: start and end framing, direction, how far, whether the lens height changes. Where a label says one thing and the frames show another, the frames win; write what is on screen;
- where each person and prop sits in frame, and their screen direction;
- moments inside a shot (a foreground wipe at 11.5 s, a hand slipping free at 26.5 s). These become timed triggers.

If scene detection misses or invents a cut (fast motion, flashes), fix the table by eye or run it again with `threshold` 0.15 or 0.35.

## 3. Map shots to the breakdown

Line each blockout shot up with its breakdown row: description, notes (plants, motifs, "keep red the only saturated colour"), audio. **Timing follows the blockout** even where the breakdown's durations differ. List every such difference under "Director's calls" at the top of the prompts.

## 4. Read the references

For each character write down the concrete identity: face, hair, age, every wardrobe item and colour, props. Then:
- **Check against the script and breakdown.** Flag conflicts (the sheet says dupatta, the reference shows a saree) and resolve them in favour of the reference unless the story needs otherwise. Record it in Director's calls. If a conflict changes the story, ask the creator.
- **Choose which images to send.** Prefer clean single-subject identity images (cut-outs, character sheets). **A reference's framing gets copied even when told not to**, so a framed scene image goes in only if its framing is wanted, usually as the opening frame. Keep to the model's limit (Seedance: 9 images) and skip refs for things that do not appear in that segment.

## 5. Pick the model and split the timeline

| Model (`model`) | Max per call | References | Notes |
|---|---|---|---|
| `seedance-2.5` (Higgsfield) | 30 s | `@ImageN` = position N in the images sent | Holds several cuts in one call; 720p max; `( ) < > { } 【 】` reserved. The only model the API kit generates. |
| `seedance-2.0` | 15 s | `@ImageN` | |
| `veo-3` | 8 s | by file path / first frame | strong native audio |
| `kling` | 10 s | by file path, start/end frame | one or two shots per call |
| `wan-2.2` | 5 s | start image | one shot per call |
| `sora-2` | 20 s | by file path | |

If the film is longer than one call, split it **at cuts** into segments under the limit. Write the whole film first (`## The whole film`), then one standalone prompt per segment (`## Segment 1`, `## Segment 2`…), timings relative to the segment. If the whole film fits in one call, the whole-film block is the one that gets generated.

**Image models / keyframes:** if the creator wants stills, write one prompt per shot for its opening frame: subject and wardrobe from the refs, composition from that shot's blockout still (who is where, how big in frame, horizon height), lens, angle and light. Those frames can start a video model with an image input.

## 6. Write the prompts

### The file

One markdown document. At the top, a short `Director's calls` list (every deliberate departure from the breakdown or the references, with the reason) and a `Post` list (what is added in the edit, not generated). Then each prompt is a ``` block under a `## ` heading. `save_prompts` checks every block that holds `[GOAL]`.

### Rules

- **Whole film first, at a high level.** GOAL is the entire video in one flowing sentence plus one line on the idea. The shot-by-shot lives in STAGES.
- **No placeholders, ever.** `<same as above>`, "see above" are banned. Every segment repeats REFERENCES, CONTINUITY and LOOK in full; each block must paste on its own.
- **References.** Seedance: one line per image, in send order: `@ImageN (references/shot-3/boy.png) - what it is. Take only x. Do not take y.` The `(path)` is a project path and is stripped before sending; numbers run 1..N with no gaps. Other models: `references/shot-3/boy.png - what it is. Take x. Do not take y.` Never group references. Close the block with: *Do not use the framing or the composition of any reference image. They define the subject and the place, never the shot.*
- **Tags never act as the subject of a stage sentence.** A stage says "the boy…" and ends with `References: @Image3, @Image6.` The model binds by appearance.
- **Every reference gets a negative** ("Do not…"): say what to take, then what to ignore.
- **One STAGE per blockout shot**, using the blockout's times, written exactly `STAGE n - a to bs - beat name - what happens and what the camera does - CUT` (the last `- NO CUT`; one continuous take is all `NO CUT`). Write time ranges as "9.5 to 11.5s", never with brackets. Stages run contiguously from 0 to the Duration.
- **Camera numbers come from the blockout.** The move in metres and degrees, the lens height, and the lens as a field of view, because models read degrees better than mm. Horizontal FOV, full frame: 18 mm ≈ 90°, 24 ≈ 74°, 35 ≈ 54°, 50 ≈ 40°, 85 ≈ 24°, 100 ≈ 20°, 135 ≈ 15°, 200 ≈ 10°. "Arcs around to the side" is a defect.
- **Define the screen-direction key once** in FIRST FRAME AND BLOCKING (e.g. "the vendor is always frame-right of the family") and keep every stage consistent with it.
- **Plants and motifs become locks** (a safety pin visible "in every shot that shows his chest", exactly one red balloon). Repeat each lock in CONTINUITY, the relevant reference line, the stage and LOOK.
- **Hard negatives repeat in four places** (CONTINUITY, the reference note, the stages, the LOOK ban list). Stated once, they get ignored. Use a member-count lock: "exactly one boy, no other children".
- **Timestamp every change** in CONTINUITY: what appears, changes or leaves, and at which second. Say outright what stays constant.
- **Name the light source that causes a change**, not just the change: "the stall's bulbs light the balloon at 3.5s".
- **Generated vs post.** Supers, lower thirds, narration in a language the model may mangle, and music usually go to post. Say so in the Post list, start AUDIO with `NO BGM` and time only the diegetic sounds, and ban text in LOOK (at most one named on-screen text exception). Anything the model can plausibly do (smoke, reflections, a gauge) stays generated; ask before demoting it to post.
- **Dialogue the model should speak** goes in braces in its stage, voice and language named: `In his voice, Hindi: {the line}`. Seedance only; braces are reserved there for exactly this.
- **One location, one lighting setup** unless the creator asks otherwise; lighting states inside it each get a time range.
- **Parameters are not prose.** Duration, resolution and aspect ratio are API fields; the `Duration:` line is for the checks and is stripped before sending.

### Template (every block, sections in this order)

```
[GOAL]
[The whole video, or this segment's part of it, in one flowing sentence from the first frame to the last.] The idea: [one line on what the film is saying.]
Duration: [n] seconds.

[REFERENCES]
@Image1 (references/shot-1/[file].png) - [The subject's identity in specifics: face, hair, age, every wardrobe item and colour, props.] Take [x] only. Do not take the framing, the camera angle or the background.
@Image2 (references/shot-0/[file].png) - [The world: the place, surfaces, markings; say if no one is in it.] Take the place. Do not take the camera angle or the light fixtures.
@Image3 (blockout/[job]/shot-01.png) - [The opening frame, if its framing is wanted.] Do not take its grey-box surfaces or its lighting.
Do not use the framing or the composition of any reference image. They define the subject and the place, never the shot.

[FIRST FRAME AND BLOCKING]
[Where everyone and everything stands in the first frame, how big in frame, horizon height.] Direction key: [e.g. anticlockwise = from the boy's front round his left side; the vendor is always frame-right of the family].

[CONTINUITY]
The subject - [the same in every frame: full description, every detail that must not drift]. [Hard negatives and member-count lock.]
The scene - [one location, concretely]. [What is always there; what appears or leaves, and at which second.]
The light - [one setup with n states; each state's time range and what causes each change.]
The camera - [n cuts / one unbroken move], [how the moves feel], [what the lens stays locked on].
Type and graphics - [what is generated in-picture]. [What is added in post and must not appear.]

[STAGES]
STAGE 1 - 0 to [a]s - [beat] - [what happens; camera height, angle, distance, and its move in degrees, metres and FOV]. References: @Image1, @Image3. - NO CUT
STAGE 2 - [a] to [b]s - [beat] - [what happens]. References: @Image1. - CUT
[…until the stages add up to the Duration]

[CAMERA AND OPTICS]
[Per stage or overall: lens as FOV, lens height, depth of field, the rig it should read as, easing. Motion blur only where wanted.]

[PHYSICS]
[How things move and weigh: cloth, hair, smoke, crowds, a balloon's drift, contact with the ground.]

[LIGHTING]
[One line per lighting state with its time range: source, position, quality, where it lands, how it models the subject, falloff.]

[AUDIO]
NO BGM. [Diegetic sounds only, each timed: 2.0 to 3.5s crowd murmur rising.] [Seedance dialogue, if any, is in the stages.]

[LOOK]
[Format and aspect, lens character, resolving power, colour, grain, highlight roll-off and shadow hold.] [Mood in three words.]
No captions or titles on screen, no lettering, no watermark, no interface graphics, [the hard negatives again].
```

## 7. Save (the checks)

`save_prompts` with the whole document, the `model` and the `blockout` path you read in step 2 (the creator sees every take played against it). It refuses with a list of problems per block: sections missing or out of order, no Duration or one over the model's limit, stages not contiguous or missing CUT marks, a reference line without "Do not", @Image numbers with gaps or undefined, a reference path that is not in the project, Seedance's reserved brackets in the text. Fix exactly those and save again. Then run these by eye before you hand it over:
- no two lines contradict each other ("lit throughout" against "switches on at 3.5s");
- every word the model reads is spelled right;
- every hard negative is in all four places; every camera move has degrees, distance and height; every change in CONTINUITY has a second.

The prompts show in the creator's Playground > AI video, with a copy button per block. Report: a shot table (time, shot, camera move as built), the Director's calls, what goes to post, the riskiest shots.

## 8. Generate (only when the creator asks)

1. `prepare_generation` with the block's heading, the model, the resolution (start at **480p**) and the route. It returns the exact prompt text to send, the reference images in tag order with short-lived download links, the duration and aspect, an upload link for the take, and, for Seedance 2.5, a cost estimate.
2. **Get an explicit yes on the cost before anything is uploaded or submitted.** Uploading the creator's references to Higgsfield counts as an outside action: say so when you ask.
3. Then one of:
   - **route "mcp"** (the creator's Higgsfield MCP connector is in this chat): follow that connector's own instructions. Bring each image in from its link (its URL import), in tag order, then generate with the prompt, duration, resolution and aspect from step 1, using the images in that order. Check its credit cost first. When the video is ready, call `import_take` with its URL. (With a shell you can also download it and PUT it to the upload link.)
   - **route "api"** (the creator has a Higgsfield API key and you have a shell on their computer): run the commands `prepare_generation` returns. The key stays in their environment as `HF_KEY`; never ask them to paste it into the chat. The script refuses to submit over its budget.
4. **Compare the take with the blockout:** `analyze_video` on `takes/<name>` and put the two shot tables side by side (cuts within about 0.4 s is normal). Read its sheets and report per shot ✅/⚠️ against the breakdown: identity, plants, camera move, screen direction. Propose concrete prompt edits for the ⚠️ shots before spending again. Only go to 720p once a 480p take holds.

Takes land in the project's `takes/` folder: they show in Playground > AI video and in the editor's Assets panel for the cut.
