# Creator Platform — Claude Code Context

One web app for creators that pulls together systems already built in scattered folders. The job here is **consolidation, not reinvention**: port what works, delete the clutter, wire it into one product.

## What the platform does

| # | Module | What the creator gets | Engine |
|---|--------|----------------------|--------|
| 1 | **Analytics** | Track social metrics and per-video performance | Platform APIs / scrapers |
| 2 | **Trends & News** | Trending topics and news in their niche, for video ideas | Research pipeline |
| 3 | **Planner** | Plan content weeks ahead on a calendar | App DB |
| 4 | **Script → Storyboard** | Upload a script, get a shot breakdown and storyboard | shot-breakdown logic, HyperFrames animatics |
| 5 | **3D Previs** | Turn the shot breakdown into a Blender blockout + render, usable as references for Higgsfield video generation | Blender (scripted), Higgsfield API |
| 6 | **Video Edit** | Upload raw footage + idea + desired style, get an edited video back | Higgsfield |
| 7 | **Repurpose** | Turn existing content into X posts, blogs, short-form | LLM pipeline |

The opening screen is the analytics view: understanding channel performance comes first.

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

## Decisions

- **2026-10-05 — Stack: Creator_OS base.** React + TS + Vite frontend, Supabase backend (Google sign-in via Supabase Auth, Deno Edge Functions for platform OAuth, Postgres for encrypted tokens). Supabase project: `creator-os` (ref `siacpdaiovnliamhorrf`).
- **2026-10-05 — Module 1 ported first:** sign-in, YouTube/Instagram/TikTok connect, and the metrics Overview. Nothing else from Creator_OS was brought over.
- **2026-10-06 — Hosting: Railway (Hobby), one project, two services.** `site` serves the built frontend; `worker` is a Docker container (`worker/Dockerfile`: Node 24 + HyperFrames' pinned Chrome + FFmpeg) that takes jobs from `video_jobs`: shot breakdowns via the Claude API. (Its old render job, which put MP4s in the private `renders` bucket, is gone: exports happen in the Studio editor. The bucket keeps earlier renders.) Supabase stays the backend. Move `site` to Cloudflare Pages if traffic grows. Railway project `creator-platform`; site live at https://site-production-a72f.up.railway.app. Deploy from repo root: `railway up frontend --path-as-root --service site`. The service var `RAILPACK_BUILD_CMD=npx vite build` skips `tsc` because the frontend tests import `supabase/`, which isn't in the upload.
- **2026-10-06 — HyperFrames is the video engine** for storyboard animatics, animation, edits and short-form. The shot breakdown becomes an animatic composition (template: `tarun-mirzapur/red-balloon-sketch`) that opens in the HyperFrames Studio editor, which handles preview, editing and export. Pinned to **0.8.134** (the worker's `hyperframes` CLI provides both the Studio and rendering). The earlier in-page `<hyperframes-player>` preview and the worker's render job were removed when the Studio arrived.
- **2026-10-06 — Storyboard v1 panels are spec cards** (framing schematic + lens/angle/camera/move/light + timed audio), not art. AI images per shot come next once Higgsfield access is decided. The breakdown takes a short vision form (format/tone, method, platform, length, feel) instead of the skill's chat interview.

- **2026-10-06 — Playground replaces the Storyboard nav item.** It's project-based (`projects` table; jobs carry `project_id`), with its own steel-blue dock (`#2C5F8A`, a new brand colour: Creator_OS had kept blue to chart accents) and four steps: Script (paste/upload/generate), Shot breakdown, 3D visual, Video edit.
- **2026-10-06 — Full HyperFrames Studio, served by the app service.** The worker becomes one Railway service: built site + Studio API + job loop, with a volume at `/data` for project folders (`/data/projects/<user>/<project>`). `worker/server.ts` reuses the CLI's own `hyperframes preview` server (`createStudioServer`, deep-imported from the pinned CLI) per project behind Supabase-cookie auth and a project-ownership check. The editor loads in a same-origin iframe at `/studio/<project>/`. The static `site` service retires once this is deployed. No new keys: HeyGen/Gemini/Figma keys only unlock optional media-use, capture and Figma import.
- **2026-10-06 — Blender runs on the creator's PC, never on our server.** A paired helper (`bridge/`, standard-library Python) claims `blockout` jobs over `/bridge/*` with a device key (only its hash is stored in `bridge_devices`), runs `blockout.py` headless, and uploads the preview MP4, stills and `.blend` into the project folder.
- **2026-10-06 — LLM via OpenRouter for now (free tier, ~50 requests/day).** No Anthropic key yet; AgentRouter keys reject non-Claude-Code clients. The worker uses OpenRouter's Anthropic-compatible API through `ANTHROPIC_BASE_URL=https://openrouter.ai/api` + `ANTHROPIC_AUTH_TOKEN`, model from `CLAUDE_MODEL` (`nvidia/nemotron-3-super-120b-a12b:free`: free and supports JSON-schema output). Unset all three and set `ANTHROPIC_API_KEY` to go back to Claude. The Anthropic-only server-side fallback in `breakdown.ts` is skipped whenever a base URL is set.
- **2026-10-06 — App service live** at https://worker-production-b2a3.up.railway.app (volume `worker-volume` at `/data`, 500 MB). Supabase Auth's Site URL points at it, and `YOUTUBE_APP_ORIGINS` (shared by all three connectors) lists it alongside the two local 5173 origins.
- **2026-10-06 — MCP server + Claude/Codex plugin (option B for Opus-level output).** The creator's own Claude or Codex does the generating; the platform supplies data, playbooks and storage. `/mcp` on the app service (`worker/mcp.ts`, MCP spec 2026-07-28 via `@modelcontextprotocol/server` v2, stateless, 2025-era fallback) with tools for projects, script, breakdown, Studio composition, references and blockouts. Auth is Supabase Auth's OAuth 2.1 server (consent page `/oauth/consent`, dynamic client registration on). Tools reuse the site's own code (`worker/project-files.ts`, `parseStoryboard`, `worker/schemas.ts`) and serve the playbooks (`get_guide`), so they follow site changes; Realtime on `projects` / `video_jobs` shows MCP writes live. Plugin for both clients in `plugin/` (marketplaces at `.claude-plugin/` and `.agents/plugins/`). Setup: `docs/mcp-setup.md`.

- **2026-10-06 — Planner (module 3) built on one table, `plan_items`.** A month grid plus a two-week Agenda, with an Ideas inbox for unscheduled items (`scheduled_on` null); items move between days and the inbox by drag-and-drop or the item's date field. Days are plain `date`s so time zones never shift them. Posting stays manual: the creator ticks "Mark posted" and the Planner matches the item to the real upload from the connected YouTube / Instagram / TikTok (the connectors' existing `sync`, nothing new to authorise), storing only the chosen post's link and title. An item can optionally link to one Playground project ("Start in Playground", or the chain-link button to pick an existing project; a project links to at most one item); its card then shows that project's progress. Clicking a day opens its board: one column per stage, cards move by drag or arrow buttons (touch and keyboard). Trends will write ideas into the same table (add a `source` column then). No auto-publishing.
- **2026-10-06 — Storyboard is its own Playground step** (dock: Script, Shot breakdown, Storyboard, 3D visual, Video edit). The breakdown no longer seeds the editor: the Studio opens empty, and storyboards (2D HyperFrames panels per shot) will live on the Storyboard step. `/api/playground/:id/seed` stays for that.
- **2026-10-06 — The Playground has two tracks, chosen per project: Film and Video** (working names). **Film** is the current production flow for footage that is shot or AI-generated (Script, Shot breakdown, Storyboard, 3D visual, Video edit). Its storyboard stays essential because footage is the expensive step. **Video** is for code-rendered motion graphics built around the creator's own recording or script (Recording/Script, Direction, Build, Video edit). Its timing comes from the transcript or the music's beats, with no storyboard or blockout. Both share the project, script, references, MCP and the Studio editor. Video builds come from the creator's own Opus over MCP, never the free worker model. A calibration test matched an Opus + HyperFrames reference short on 0.8.134 with no new dependencies: one author, one continuous world, a named look, sound on every hit, and a snapshot critique.

## Open decisions (ask before assuming)

- **Where uploaded recordings live** (Video track): the `/data` volume is 500 MB with no backup, so it's Supabase Storage vs a bigger volume. Decide before building uploads.

- **Higgsfield access**: API key vs MCP, and which models/workflows map to modules 5 and 6.
- **Creator profile (onboarding analysis)**: leaning `creator-profile` skill over `ig-profile`. It has to be adapted for the deployed app: OAuth data in place of yt-dlp, Claude API calls in place of subagents. Still open is how we get the video files. The existing connections cover Instagram (Reel `media_url`). YouTube and TikTok APIs don't return files, so the choice is creator uploads vs adding the YouTube `youtube.force-ssl` scope for transcripts.

Record each decision above once it's made.

## Rules

- Consolidate first. Before writing a module, find its existing implementation in the sources above.
- No platform integration is "done" until it runs against a real account. Until then, the UI shows clearly labelled demo data and pending-integration states. Never fabricate metrics or promise virality.
- Storyboards need camera position, angle, lens, lighting, motion and timing for every shot (the 3D and Higgsfield steps depend on them).
- Secrets go in the root `.env` (gitignored; `.env.example` lists every key and where it's deployed). Never copy keys out of the old projects' `.env` files into code.
- Don't carry over clutter: test scripts, logs, `tmp/`, `scratch/`, `__pycache__`, duplicate vaults.
- Keep it small. One module working end to end beats seven half-wired.

## Structure

```
frontend/                 React + Vite app (run commands from here)
  src/App.tsx             Shell + hash routing (#overview, #planner, #connections, #playground[/<project>/<step>]) + Playground dock
  src/pages/              Overview (metrics), Planner (calendar + Ideas inbox), Playground (projects), Connections (sign-in + connect)
  src/pages/playground/   Script, Shots (breakdown), Storyboard (2D HyperFrames storyboards, generation pending), Visual3D (references + blockouts), Edit (Studio iframe)
  src/components/         GoogleAccount, YouTube/Social connection, per-platform overviews, ui
  src/data/               supabase client, connector helpers, video job queue, projects, plan (calendar days, upload matching), app-server session, metric math (+ tests)
  src/storyboard/         composition.ts: storyboard -> HyperFrames HTML + validation (seeds the editor). Shared with the worker:
                          no imports, erasable TypeScript only (Node runs it with type stripping)
worker/                   Railway app service (Node 24, runs .ts directly)
  index.ts                starts server.ts + the job loop: claim_video_job() -> breakdown | script -> done/failed
  server.ts               site, Supabase-cookie session, per-project HyperFrames Studio, references, Blender bridge API
  breakdown.ts            Claude API shot breakdown (structured output)
  mcp.ts                  MCP server at /mcp for the creator's Claude / Codex (OAuth via Supabase) + upload links
  project-files.ts        project folders, ownership, composition and breakdown helpers shared by server.ts and mcp.ts
  schemas.ts              the breakdown JSON schema (worker Claude call + MCP tools)
  script.ts               Claude API script generation (prompts/script.md, from Content Hub V2)
  prompts/                shot-breakdown skill adapted for the app + its reference files; MCP guides (mcp-breakdown, composition, blockout)
bridge/                   Blender helper the creator downloads (zip built per device by server.ts): creator_bridge.py, blockout.py
supabase/
  functions/              youtube-connector, instagram-connector, tiktok-connector, _shared
  migrations/             connection + OAuth state tables, video_jobs queue + renders bucket, projects + bridge_devices, plan_items (RLS)
  tests/                  SQL boundary tests
plugin/                   Claude Code + Codex plugin: .mcp.json pointing at /mcp, thin skills (script, shot-breakdown, composition, blockout)
docs/                     Supabase auth + connector setup notes (from Creator_OS), mcp-setup.md
```

## Commands

From `frontend/`: `npm run dev` (http://127.0.0.1:5173), `npm run build` (typecheck + build), `npm test` (vitest, covers frontend and Edge Function core logic).

Backend: `supabase link --project-ref siacpdaiovnliamhorrf` once, then `supabase functions deploy <name>`. Server secrets (Google/TikTok/Instagram client secrets, `*_TOKEN_ENCRYPTION_KEY`, `*_APP_ORIGINS`) live in Supabase function secrets, never in `VITE_*` vars. See `supabase/functions/.env.example`.

App service (worker): deploy from the repo root with `railway up --service worker` (service var `RAILWAY_DOCKERFILE_PATH=worker/Dockerfile`). Railway variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (Supabase secret / service-role key), `ANTHROPIC_API_KEY` (or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `CLAUDE_MODEL` for OpenRouter), and `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (build args for the site). Needs a volume mounted at `/data` and a public domain. Logs: `railway logs --service worker`.

Worker tests: `npm test` in `worker/` (MCP contract test, Node's test runner; one test runs `hyperframes check`).

Local: `npm start` in `worker/` runs the app server on :8787 and the job loop against the live queue; `npm run dev` in `frontend/` proxies `/api`, `/studio` and the Studio's assets to it.

## Known leftovers

- `worker/server.ts` deep-imports `hyperframes/dist/studioServer-PXNJXHMV.js`. Bump that file name whenever the pinned HyperFrames version changes.
- `frontend/public/studio-theme.css` reskins the Studio by overriding its CSS tokens (`--color-*`, `--radius-*`, `--font-sans`). Re-check the token names on a HyperFrames bump.
- Railway volumes have no automatic backup. Project folders (edits, footage, references, blockouts) live only on `/data`.
