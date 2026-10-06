# Creator Platform plugin (Claude Code and Codex)

Connects your own Claude or Codex to your Content Engine projects through the platform's MCP server (https://worker-production-b2a3.up.railway.app/mcp). It writes scripts, shot breakdowns, the HyperFrames edit and Blender blockouts straight into your Playground, which updates live.

The skills here are short on purpose: the real playbooks come from the server (`get_guide`), so they change with the site and this plugin rarely needs updating.

## Install

**Claude Code**

```
/plugin marketplace add <path or git URL of this repo>
/plugin install creator-platform@creator-platform
```

**Codex**

```
codex plugin marketplace add <path or git URL of this repo>
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
