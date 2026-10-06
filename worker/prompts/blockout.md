# Blender blockout (3D previs)

The blockout runs in Blender on the creator's own PC (the paired "Blender helper"). It builds grey-box stand-ins and places one camera per shot **from the breakdown's text fields, by keyword**. So the blockout is only as good as those fields. Write them with these words when you want the blockout to follow.

## What each field drives

| Field | Read as |
|---|---|
| `magnification` | A shot code: EWS, ELS, WS, LS, FS, MLS, MWS, MS, MCU, CU, BCU, ECU, INS, OTS, POV, 2S. Sets how much of the subject fills the frame. Missing code: "extreme close", "close", "wide"/"establish" in the description, else MS. |
| `lens` | The first number, in mm (8-600). Missing: 35 mm. Distance to subject = frame height x lens / sensor, so lens and magnification together place the camera. |
| `angle` | "overhead"/"top"/"bird" (85 deg down), "worm" (40 deg up), "high" (30 deg down), "low" (18 deg up); "dutch"/"cant"/"tilted" rolls 14 deg. Otherwise eye level. |
| `position` (+ `angle`) | Side of the subject: "behind"/"rear" (180), "over the shoulder"/"OTS" (160), "profile"/"side" (90), "three-quarter"/"3/4" (40), "front"/"head-on"/"straight on" (0). Default 15 deg. "left" (but not "camera-left") mirrors it. |
| `movement` | "push"/"dolly in"/"track in"/"zoom in"; "pull"/"dolly out"/"pull back"; "pan"/"whip"; "tilt up"/"tilt down"; "truck"/"crab"/"tracking"/"slide" ("left" sets the direction); "crane up"/"jib up"/"rise"; "crane down"/"descend"; "orbit"/"arc"; "handheld"/"shaky". Several can combine. |
| `lighting` | Colour temperature from "NNNNK" (e.g. 3200K), else warm/tungsten/golden/practical = 3200K, cool/blue/moon/night = 7500K, else 5600K. "hard"/"low key"/"night"/"moody" = dark ratio; "soft"/"high key"/"even" = bright. "camera right" moves the key right (default left), "overhead"/"top light" raises it, "rim"/"backlight"/"edge"/"silhouette" adds a rim, "silhouette" kills the key. |
| `duration` | Seconds on the timeline. |

## Loop

1. `get_project` tells you whether a Blender helper is online. If not, ask the creator to open the 3D step in the site and pair their PC (Connect Blender), then start the helper.
2. `queue_blockout` with the shot numbers (numbered from 1 across the whole film).
3. Poll `get_job` every 20-30 s until it is `done` or `failed`. A render takes minutes.
4. `get_blockout` returns a still per shot as an image. Look at them: is the framing what the shot meant? If not, fix that shot's fields in the breakdown (`save_breakdown`) and run the blockout again for just those shots.
