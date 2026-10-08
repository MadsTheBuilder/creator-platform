# Brief: palette

**Goal:** the measured colour system: roles, hex values and era variants.

Read `_contract.md` first.

**Inputs:** `frames/contact-*`, `frames/hook-*`, `frames/thumb-*` and `frames/dense-*`, plus `scripts/sample-colors.py` from the skill folder. Run it as `uv run --with pillow python <skill>/scripts/sample-colors.py <frame> label=x,y,w,h [--saturated]`.

**Produce:**
1. **Colour roles:** background, foreground text, one accent, and any secondary roles (highlighter, paper, era-specific fields). Give each role a hex **sampled with the script**, cite the frame and box, and say what it means (e.g. "red = the one hot word / stat").
   - Grid sheets are downscaled JPEGs. For exact values, extract a full-size frame first: `ffmpeg -ss <t> -i raw-media/<id>.mp4 -frames:v 1 frames/key-<id>-<t>.jpg`.
2. **Era variants:** colours that appear only in an older look, marked opt-in.
3. **Contrast:** check each text-on-background pair against 4.5:1 and flag failures.
4. **Usage rules:** what share of the frame the accent takes, where it never appears, and how gradients, grain and vignettes are used.
5. Keep the core palette to 3–5 colours. More than that means you are recording stock-footage colours, not the creator's system.
