---
name: shot-breakdown
description: Break a Content Engine project's script into a director's shot breakdown and save it to the project (Shots step), with camera position, angle, lens, lighting, movement and timing for every shot. Use when the creator wants a shot list, storyboard, breakdown or coverage plan for one of their Content Engine / Creator Platform projects, or wants to revise one.
---

The playbook lives on the server so it always matches the site. Follow it, not your own defaults.

1. `get_project` (use `list_projects` to find it). If there is no script, offer the `script` skill first.
2. `get_guide` with topic `breakdown`, and follow it exactly. It tells you to interview the creator about their vision first.
3. `save_breakdown`. If it is refused, fix the field the message names and save again.
4. Offer the next step: `seed_composition` (animatic in the Studio editor) or the `blockout` skill.
