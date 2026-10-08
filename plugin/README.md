# Creator Platform plugin (Claude Code and Codex)

Connects your own Claude or Codex to your Content Engine projects through the platform's MCP server (https://worker-production-b2a3.up.railway.app/mcp). It writes scripts, shot breakdowns, the HyperFrames edit, Blender blockouts, AI video prompts and takes, and Studio-track motion graphics straight into your Playground, which updates live.

The skills here are short on purpose: the real playbooks come from the server (`get_guide`), so they change with the site and this plugin rarely needs updating.

## Install

**Claude Code**

```
/plugin marketplace add MadsTheBuilder/creator-platform
/plugin install creator-platform@creator-platform
```

**Codex**

```
codex plugin marketplace add https://github.com/MadsTheBuilder/creator-platform
```
then install **Creator Platform** from `/plugins`.

**Claude.ai or Claude Desktop** (no plugin needed): Settings → Connectors → Add custom connector → `https://worker-production-b2a3.up.railway.app/mcp`

The first tool call opens a browser to sign in with the Google account you use for Content Engine and approve access. Disconnect it any time from Connections in the site.

## Skills

| Skill | Does |
|---|---|
| `script` | Writes the project's script |
| `shot-breakdown` | Interviews you about the vision, then writes and saves the shot breakdown |
| `composition` | Edits the HyperFrames animatic / edit in the Studio |
| `blockout` | Runs a Blender blockout on your PC, looks at the stills, refines the breakdown |
| `storyboard` | Lays the blockout out as a shot-by-shot storyboard and checks each frame against its shot |
| `ai-video` | Writes timed AI video prompts from the blockout (checked before saving) and generates takes with your own Higgsfield account |
| `studio-video` | Studio track: plans beats from your recording's transcript, builds the motion-graphics video, checks its own frames |
| `creator-profile` | Studies a creator's channel and videos on your computer (yt-dlp, ffmpeg, local whisper), writes their style profile, and saves it under Style in Content Engine. Also saves a profile folder you already have |
