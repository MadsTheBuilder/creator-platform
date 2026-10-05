# Lighting design

Light is the main way emotion reaches the audience before they've understood a single word. Plan it in three layers:

1. **The Lighting bible** (from the interview, in the Vision Brief): the film's overall philosophy, its arc of light, and the look of each key scene.
2. **A scene setup** (the scene's `lighting` field, shown in the scene header row): the motivated sources, quality, colour temperature, key and mood for that scene. Its emotion and style come from the bible.
3. **Per-shot lighting** (the Lighting column): how that shot is lit *within* the scene setup, adapted to its framing, lens and moment.

Shots in a scene share the setup so the cut is invisible. Scenes change their setup when the story's emotion or style changes, so the light moves with the story instead of sitting flat across the film. Two scenes can share a look only when the bible says they rhyme (a mirror, a return to a place); note that as `Same setup as Scene N`.

## Vocabulary (gaffer level)
- **Key / fill / back (rim) / kicker / practical:** main source, shadow lift, separation from the background, edge on the cheek, a lamp in frame.
- **Quality:** hard (a crisp shadow edge: sun, bare bulb, fresnel) vs soft (a wrapping falloff: window, bounce, big diffusion).
- **Direction:** front, 45°, side (split), back, top, under.
- **Colour temperature:** about 1900K for candle or sodium, 3200K tungsten, 4300K mixed, 5600K daylight, 7000K+ shade or blue hour. Say whether the mix is deliberate (a warm interior against a cold window).
- **Contrast ratio / key:** high key (low ratio, bright, few shadows) vs low key (8:1 or more, deep shadows). Use negative fill to deepen one side.
- **Atmosphere:** haze or smoke for visible beams and depth.
- **Motivated vs stylised:** does the light come from a source in the world, or is it expressive (a coloured gel, a moving light, an impossible beam)?

## Formula for a shot's Lighting cell
`<key source + direction>, <hard/soft>, <colour temp>, <ratio or key>, <practicals/background>, <why: the emotion>`

Example: `Window key camera-left at 90°, soft, 5600K against 3200K practicals behind, 6:1 with negative fill right, face half in shadow, she is hiding the truth`

## The scene setup line
`<time/place logic>, <main motivated sources>, <overall quality + key>, <palette>, <mood>`

Example: `Night interior, single sodium streetlight through blinds + a dying tube light, hard and low key, sodium orange vs cyan, trapped and watched`

## Shot size changes the lighting
- **EWS/WS/LS:** describe where the sources are in the environment, the depth (separating foreground, mid and background), the practicals in frame, and the sky or windows.
- **MS/MLS/2S:** key and fill relationship, how light falls across the characters' relationship (who is in shadow?).
- **MCU/CU/ECU:** the eye light (catchlight or none), modelling across the face, the contrast ratio on skin, skin tone, and small cutters or flags.
- **INS/macro:** specular highlights on surfaces, texture raking light, and reflections to control.
- **GFX:** no lighting (leave blank or write `N/A`).

## Emotion → light (starting points; the bible overrides)
| Emotion | Light |
|---|---|
| Safety / warmth / nostalgia | Soft, warm 3000–3500K, low contrast, practicals glowing |
| Dread / suspense | Low key, hard top or side light, pools of light with darkness between, cold or sodium |
| Guilt / secrecy | Split light, a face half in shadow, light through blinds or slats |
| Grief / loneliness | A single soft source, a lot of negative space, a cool, flat fill |
| Interrogation / pressure | A hard overhead single source, sweat specular, no fill |
| Hope / release / dawn | A rising warm backlight, haze, the ratio opening up |
| Comedy | High key, even, bright; the light never competes with the joke |
| Glamour / product | Big soft key + a rim; product edges defined with strip lights; clean specular highlights |
| Unreality / memory / flash | A stylised shift: a colour cast, overexposure, flicker or a moving source |

## Arc of light
Plan how the light changes across the story, e.g. warm, then cold, then false dawn, darkness, and a real dawn at the end. Turning points get a visible change of light. The final scene usually resolves the arc (or deliberately refuses to).

## Method variants
- **High-budget live action:** name fixtures if useful (an HMI through the window, a SkyPanel overhead, a 20x20 diffusion frame, haze).
- **Run-and-gun:** available light first, plus a bounce board, one LED panel and practicals; pick a time of day as the lighting decision.
- **AI-generated:** write the lighting as prompt words the generator understands: `golden hour backlight, volumetric haze, low key, teal shadows, hard rim light`. Keep the same lighting words for one scene so the clips match.
- **3D / animation:** free control; describe the light rig and any animated light changes.
