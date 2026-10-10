# Architecture and operations

Moved out of `CLAUDE.md` on 2026-10-07.

## Structure

```
frontend/                 React + Vite app (run commands from here)
  src/App.tsx             Shell + hash routing (#overview, #planner, #connections, #playground[/<project>/<step>]) + Playground dock
  src/pages/              Overview (metrics), Planner (calendar + Ideas inbox), Playground (projects), Connections (sign-in + connect)
  src/pages/playground/   Production: Script, Shots (breakdown), Storyboard (generation pending), Visual3D (references + blockouts).
                          Studio: Direct (direction + references + recording + transcript + music + beat plan), Build. Both: Edit (editor iframe)
  src/components/         GoogleAccount, YouTube/Social connection, per-platform overviews, ComputerHelper (helper download + devices), ui
  src/data/               supabase client, connector helpers, video job queue, projects, tracks (steps per track), plan (calendar days, upload matching),
                          transcript lines, app-server session + uploads, metric math (+ tests)
  src/storyboard/         composition.ts: storyboard -> HyperFrames HTML + validation (seeds the editor). Shared with the worker:
                          no imports, erasable TypeScript only (Node runs it with type stripping)
worker/                   Railway app service (Node 24, runs .ts directly)
  index.ts                starts server.ts + the job loop: claim_video_job() -> breakdown | script -> done/failed
  transcribe.ts           Studio recording: 16 kHz speech for the creator's computer, then whisper.json -> transcript.json + 1080p working copy (ffmpeg)
  server.ts               site, Supabase-cookie session, per-project HyperFrames Studio, references, Studio media uploads, Blender bridge API
  breakdown.ts            Claude API shot breakdown (structured output)
  mcp.ts                  MCP server at /mcp for the creator's Claude / Codex (OAuth via Supabase) + upload links
  project-files.ts        project folders, ownership, composition and breakdown helpers shared by server.ts and mcp.ts
  video-prompts.ts        AI video step: prompt checks, shot table from cuts, Seedance cost estimate (from the 3d-video_prompt skill)
  schemas.ts              the breakdown JSON schema (worker Claude call + MCP tools)
  script.ts               Claude API script generation (prompts/script.md, from Content Hub V2)
  prompts/                shot-breakdown skill adapted for the app + its reference files; MCP guides (mcp-breakdown, composition, blockout, studio)
bridge/                   Helper the creator downloads (zip built per device by server.ts): creator_bridge.py (claims blockout + transcribe jobs),
                          blockout.py (Blender), transcribe.py (whisper.cpp; also served at /kit/transcribe.py for Claude Code),
                          generate.py (AI video take with the creator's own Higgsfield API key; served at /kit/generate.py)
supabase/
  functions/              youtube-connector, instagram-connector, tiktok-connector, _shared
  migrations/             connection + OAuth state tables, video_jobs queue + renders bucket, projects + bridge_devices, plan_items (RLS)
  tests/                  SQL boundary tests
plugin/                   Claude Code + Codex plugin: .mcp.json pointing at /mcp, thin skills (script, shot-breakdown, composition, blockout, studio-video)
docs/                     Supabase auth + connector setup notes (from Creator_OS), mcp-setup.md
```

## Commands

From `frontend/`: `npm run dev` (http://127.0.0.1:5173), `npm run build` (typecheck + build), `npm test` (vitest, covers frontend and Edge Function core logic).

Backend: `supabase link --project-ref siacpdaiovnliamhorrf` once, then `supabase functions deploy <name>`. Server secrets (Google/TikTok/Instagram client secrets, `*_TOKEN_ENCRYPTION_KEY`, `*_APP_ORIGINS`) live in Supabase function secrets, never in `VITE_*` vars. See `supabase/functions/.env.example`.

App service (worker): deploy from the repo root with `railway up --service worker` (service var `RAILWAY_DOCKERFILE_PATH=worker/Dockerfile`). Railway variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (Supabase secret / service-role key), `ANTHROPIC_API_KEY` (or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `CLAUDE_MODEL` for OpenRouter), and `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (build args for the site). Needs a volume mounted at `/data` and a public domain. Logs: `railway logs --service worker`.

Guest account (`/#guest`, `worker/guest.ts`):
- Set `GUEST_EMAIL` and `GUEST_SOURCE_USER` (the user id whose data is copied) on the worker.
- Create or refresh the guest with `railway ssh --service worker -- node guest.ts reset`. It wipes the guest's rows, files, renders, channel connections and paired PCs, then copies the source account with every id remapped. Queued or running jobs land as failed.
- Unset `GUEST_EMAIL` to turn the link off.
- After changing the connectors, deploy `youtube-connector`, `instagram-connector` and `tiktok-connector`: they refuse the guest.

Keyword research (Trends › `#trends/research`, `worker/firecrawl.ts`): `GET /api/firecrawl/credits` and `POST /api/firecrawl/scrape` (Trends and YouTube-results calls only) with the site's `FIRECRAWL_API_KEY`; the guest gets `GUEST_FIRECRAWL_DAILY` credits a day (default 300).

Worker tests: `npm test` in `worker/` (MCP contract test, Node's test runner; one test runs `hyperframes check`).

Local: `npm start` in `worker/` runs the app server on :8787 and the job loop against the live queue; `npm run dev` in `frontend/` proxies `/api`, `/studio` and the Studio's assets to it.

## Known leftovers

- `worker/server.ts` deep-imports `hyperframes/dist/studioServer-PXNJXHMV.js`. Bump that file name whenever the pinned HyperFrames version changes.
- `frontend/public/studio-theme.css` reskins the Studio by overriding its CSS tokens (`--color-*`, `--radius-*`, `--font-sans`). Re-check the token names on a HyperFrames bump.
- Railway volumes have no automatic backup. Project folders (edits, footage, references, blockouts) live only on `/data`.

## Existing source to consolidate

Read the relevant source before building a module. Port code; don't rewrite what already works.

| Source | Path | Useful for |
|--------|------|-----------|
| Content Engine (Creator_OS) | `C:\Users\madhu\Mads_builds\Creator_OS` | `PRODUCT.md` and `DESIGN.md`: product spec, brand, orange/brown palette, React+Vite UI in `outputs/` |
| Content Hub v1 | `C:\Users\madhu\Claude cowork\Content Hub` | Next.js frontend + Python backend (`backend/`: auth, research, content, workflows), Supabase schema (`supabase/`) |
| Content Hub v2 | `C:\Users\madhu\Claude cowork\Content Hub V2` | Local-first skill engine: research, ideation, hooks, titles, short-form, YouTube pipeline (`skills/`) |
| Red Balloon pipeline | `C:\Users\madhu\Mads_builds\tarun-mirzapur` | End-to-end reference: script → animatic storyboard → Blender blockout → VO/Whisper → final edit |
| Higgsfield + Blender tests | `C:\Users\madhu\Mads_builds\Hygen-Test` | `hf-blender`, `higgsfield-skills`, `local 3d agent`, 3D/Higgsfield experiments |
| IG / creator-profile tests | `C:\Users\madhu\Mads_builds\nate hygen test` | creator-profile skill, IG skill pack, HyperFrames kit |

Never edit the source folders. Copy what's needed into this repo.
