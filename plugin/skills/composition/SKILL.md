---
name: composition
description: "Edit a Content Engine project's HyperFrames video (the animatic or edit open in the site's Studio editor): timing, text, layout, animation, references. Use when the creator asks to change, animate, restyle or fix their project's edit or animatic in Content Engine / Creator Platform."
---

1. `get_guide` with topic `composition` (HyperFrames rules for this project and pinned version).
2. If the project's composition is blank and there is a breakdown, `seed_composition` to start from the animatic.
3. `get_composition`, make only the change asked for, then `save_composition` with its `hash` as `expected_hash`.
4. If the save is refused: a hash mismatch means the creator edited in the Studio, so read again and redo the change on top; check errors name what to fix.
5. Tell the creator it is in Playground > Video edit, which updates live.
