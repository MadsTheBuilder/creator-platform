# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Goal

**Content Engine**: one web app for creators that consolidates systems already built in scattered folders. The job is **consolidation, not reinvention**: port what works, wire it into one product. Opening screen is analytics. Product spec: [PRODUCT.md](PRODUCT.md) · brand: [DESIGN.md](DESIGN.md) · source folders to port from: [docs/architecture.md#existing-source-to-consolidate](docs/architecture.md).

## Status by module (2026-10-08, branch `tracks`, feature freeze)

| # | Module | State | Details |
|---|--------|-------|---------|
| 1 | Analytics | Built: Google sign-in, YouTube/IG/TikTok connect, metrics Overview | [youtube-connector](docs/youtube-connector.md), [social connectors](docs/social-connector-implementation.md) |
| 2 | Trends & News | Keyword research (fireIQ port, Firecrawl, `#trends/research`) beside Radar (topic-radar port): weekly ideas scan + daily watch of saved ideas, AI step recorded and reviewable over MCP; "Add to Planner" links an idea to a planned video the creator's Claude can outline (`save_outline`). Run 4 done on the live DB. The 8-phase build was removed | [decisions](docs/decisions.md) 2026-10-07/08 |
| 3 | Planner | Built: `plan_items`, month grid, agenda, Ideas inbox, posted-matching | [decisions](docs/decisions.md) |
| 4 | Script → Storyboard | Script + shot breakdown built; Storyboard (after 3D visual) lays the blockout out shot by shot: frames via ffmpeg, `make_storyboard` over MCP | [decisions](docs/decisions.md) 2026-10-08 |
| 5 | 3D Previs | Blender blockouts via the paired PC helper (`bridge/`); AI video step (prompts from the blockout, takes via the creator's own Higgsfield) deployed 2026-10-08 (`0df0f2f`), not yet run against a real Higgsfield account | [decisions](docs/decisions.md) |
| 6 | Video Edit | HyperFrames editor in the Playground; Studio track (motion graphics over MCP) in first end-to-end test | `private-notes/2026-10-07-studio-test-handoff.md` |
| 7 | Repurpose | Not started | — |

Playground has two tracks per project: **Production** (Script, Shot breakdown, 3D visual, Storyboard, AI video, Video edit) and **Studio** (Direct, Build, Video edit). In UI copy "Studio" means the track; the HyperFrames app is "the editor".

## Priority (next, in order)

Feature freeze from 2026-10-08: test, polish, ship; no new features. Deploy only from a clean commit (worktree, see the Studio handoff note).

1. Ship Radar + Planner outlines: set `TREG_API_KEY`, `SERPAPI_API_KEY`, `YOUTUBE_DATA_API_KEY` on Railway, deploy, then check a scan, "Check saved stories", Archive/Restore/Delete and Add to Planner on the live site.
2. Walk the whole app as a new user and fix what breaks; label anything not run against a real account as demo/pending.
3. Open it to up to 5 named people (testers on Google, Instagram, TikTok apps) with a one-page guide.

## Open decisions (ask before assuming)

- **Higgsfield access**: video is decided (creator's own connector or API key, 2026-10-07). Open: images per shot for the Storyboard step.
- **Creator profile onboarding**: leaning `creator-profile` skill (adapted: OAuth data, Claude API). Open: how to get video files for YouTube/TikTok (creator uploads vs `youtube.force-ssl` transcripts).
- Keep snapshot rounds vs overwrite them (Studio).
- Real LLM provider: currently OpenRouter free tier (~50 req/day) pending an Anthropic key.

Record each decision in [docs/decisions.md](docs/decisions.md) once made.

## Rules

- Consolidate first: find the existing implementation in the source folders before writing a module. Never edit those folders; copy into this repo.
- No integration is "done" until it runs against a real account. Until then show labelled demo/pending states. Never fabricate metrics or promise virality.
- Storyboards need camera position, angle, lens, lighting, motion and timing per shot.
- Secrets go in root `.env` (gitignored); `.env.example` lists every key and where it's deployed. Never copy keys from old projects.
- Blender, speech-to-text and (next) HyperFrames run on the creator's PC, never on our server.
- No clutter (test scripts, logs, `tmp/`, `__pycache__`). One module end to end beats seven half-wired.
- `private-notes/` is git-excluded: decisions to revisit and session handoffs.

## Architecture in one paragraph

React + TS + Vite frontend (`frontend/`, hash routing in `App.tsx`) → one Railway service `worker` (Node 24 runs `.ts` directly) that serves the built site, a per-project HyperFrames Studio (pinned **0.8.134**) at `/studio/<project>/`, the `/bridge/*` API for the PC helper, the MCP server at `/mcp`, and a job loop over `video_jobs`. Supabase is the backend (Auth, Postgres + RLS, Edge Function connectors). Project files live on the `/data` volume (no backup). Creators' own Claude/Codex generate via MCP (`worker/mcp.ts` + `plugin/`); playbooks are served by `get_guide` from `worker/prompts/`. `frontend/src/storyboard/composition.ts` is shared with the worker: no imports, erasable TS only. Full map, deploy vars and known leftovers: [docs/architecture.md](docs/architecture.md).

## Commands

| Where | Command |
|---|---|
| `frontend/` | `npm run dev` (:5173, proxies `/api`, `/studio` to :8787) · `npm run build` · `npm test` (vitest) · `npx vitest run <file>` · `npm run test:e2e` (Playwright, ports 15173/18787, isolated Postgres) |
| `worker/` | `npm start` (:8787 + live job loop) · `npm test` (all `*.test.ts`; start the disposable Postgres container first) · `node --test <file>.test.ts` |
| repo root | Deploy: `railway up --service worker` · logs: `railway logs --service worker` |
| Supabase | `supabase link --project-ref siacpdaiovnliamhorrf`, then `supabase functions deploy <name>` |

## Reference docs

- [docs/decisions.md](docs/decisions.md): full dated decision log (stack, hosting, HyperFrames, tracks, files, transcription, MCP)
- [docs/architecture.md](docs/architecture.md): directory map, deploy/env details, known leftovers (HyperFrames bump checklist)
- [docs/mcp-setup.md](docs/mcp-setup.md) · [docs/supabase-setup.md](docs/supabase-setup.md)
