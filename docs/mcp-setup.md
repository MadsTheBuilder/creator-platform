# MCP server: setup and operation

The app service serves an MCP server at `/mcp` (`worker/mcp.ts`). Creators connect their own Claude (Code, Desktop, claude.ai) or Codex to it and sign in with their Content Engine Google account. The client model does the generating; the server validates and stores the results where the site reads them.

- Spec: MCP 2026-07-28 (stateless Streamable HTTP), with stateless fallback for 2025-era clients. SDK: `@modelcontextprotocol/server` v2.
- Auth: Supabase Auth's OAuth 2.1 server is the authorization server. `/mcp` only accepts its OAuth access tokens (they carry `client_id`), never a site session.
- Discovery: `/.well-known/oauth-protected-resource/mcp` points clients at `https://<ref>.supabase.co/auth/v1`.

## One-time Supabase setup (dashboard)

1. **Authentication > OAuth Server**: enable it, set **Authorization Path** to `/oauth/consent`, and turn on **Dynamic client registration** (Claude and Codex register themselves).
2. **Authentication > URL Configuration**: Site URL must be the app service (`https://worker-production-b2a3.up.railway.app`), since the consent page is Site URL + path.
3. Apply `supabase/migrations/20261008090000_realtime.sql` (adds `projects` and `video_jobs` to Realtime so MCP changes appear live).

Check: `curl https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1` returns JSON (404 `feature_disabled` means step 1 is not done).

## Connect

- Claude Code: `claude mcp add --transport http creator https://worker-production-b2a3.up.railway.app/mcp`, or install `plugin/` (see `plugin/README.md`).
- Codex: `codex mcp add creator --url https://worker-production-b2a3.up.railway.app/mcp` then `codex mcp login creator`, or install the plugin.
- Claude.ai / Desktop: Settings > Connectors > Add custom connector > the `/mcp` URL.
- Debug: `npx @modelcontextprotocol/inspector` against the URL.

## Keeping it in step with the site

- Tools call the same code as the site's routes (`worker/project-files.ts`) and the same validator (`parseStoryboard`). The breakdown schema is `worker/schemas.ts`, shared with the worker's own Claude call.
- Playbooks are served by `get_guide` from `worker/prompts/` and the pinned HyperFrames docs, so editing a prompt changes agent behaviour on the next call. The plugin's skills only route to them.
- `serverInfo.version` is a hash of the tools, schemas and prompts: it changes exactly when the surface does.
- `worker/mcp.test.ts` (`npm test` in `worker/`) is the contract: a real MCP client in both protocol eras against the real tools. The tool-list assertion fails when a tool is added, removed or renamed; update it on purpose.
- Studio-track tools (`get_transcript`, `transcribe_recording`, `save_plan`, `analyze_beats`, `snapshot`) run the pinned CLI's `transcribe`, `beats` and `snapshot` on the server. `snapshot` writes `snapshots/` in the project (the Build step shows its contact sheet) and returns 960 px JPEGs. Transcription needs `whisper-cli` and `ggml-small.bin` in the image (`worker/Dockerfile`).
- New site feature that an agent should use: add a tool in `mcp.ts` that calls the same helper as the route, add it to the test's list, and mention it in the relevant guide.
