---
name: script
description: Write or rewrite the script for a Content Engine project and save it to the project (Script step). Use when the creator wants a video script, a hook, a rewrite, or a script for a new project in Content Engine / Creator Platform.
---

1. `get_project` (or `create_project` for a new idea). Note `script_hash`.
2. `get_guide` with topic `script`, and follow it.
3. Show the creator the script. When they are happy, `save_script` with `expected_script_hash`. If it is refused, the script changed in the site: read it again and merge.
4. Offer the `shot-breakdown` skill next.
