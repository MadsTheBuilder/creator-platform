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
- **2026-10-06 — Hosting: Railway (Hobby), one project, two services.** `site` serves the built frontend; `worker` is a Docker container (Node + Chrome + FFmpeg + HyperFrames 0.8.91 + Claude Agent SDK) that authors and renders compositions from a Supabase job table and writes MP4s to Supabase Storage. Supabase stays the backend. Move `site` to Cloudflare Pages if traffic grows.
- **2026-10-06 — HyperFrames is the video engine** for storyboard animatics, animation, edits and short-form. Preview in-app with `<hyperframes-player>`; render MP4 only on export. First slice: script → shot breakdown → animatic (template: `tarun-mirzapur/red-balloon-sketch`).

## Open decisions (ask before assuming)

- **Higgsfield access**: API key vs MCP, and which models/workflows map to modules 5 and 6.
- **Creator profile (onboarding analysis)**: leaning `creator-profile` skill over `ig-profile`. It has to be adapted for the deployed app: OAuth data in place of yt-dlp, Claude API calls in place of subagents. Still open is how we get the video files. The existing connections cover Instagram (Reel `media_url`). YouTube and TikTok APIs don't return files, so the choice is creator uploads vs adding the YouTube `youtube.force-ssl` scope for transcripts.

Record each decision above once it's made.

## Rules

- Consolidate first. Before writing a module, find its existing implementation in the sources above.
- No platform integration is "done" until it runs against a real account. Until then, the UI shows clearly labelled demo data and pending-integration states. Never fabricate metrics or promise virality.
- Storyboards need camera position, angle, lens, lighting, motion and timing for every shot (the 3D and Higgsfield steps depend on them).
- Secrets go in `.env` (gitignored). Never copy keys out of the old projects' `.env` files into code.
- Don't carry over clutter: test scripts, logs, `tmp/`, `scratch/`, `__pycache__`, duplicate vaults.
- Keep it small. One module working end to end beats seven half-wired.

## Structure

```
frontend/                 React + Vite app (run commands from here)
  src/App.tsx             Shell + hash routing (#overview, #connections)
  src/pages/              Overview (metrics), Connections (sign-in + connect)
  src/components/         GoogleAccount, YouTube/Social connection, per-platform overviews, ui
  src/data/               supabase client, connector request helpers, metric math (+ tests)
supabase/
  functions/              youtube-connector, instagram-connector, tiktok-connector, _shared
  migrations/             connection + OAuth state tables (RLS)
  tests/                  SQL boundary tests
docs/                     Supabase auth + connector setup notes (from Creator_OS)
```

## Commands

From `frontend/`: `npm run dev` (http://127.0.0.1:5173), `npm run build` (typecheck + build), `npm test` (vitest, covers frontend and Edge Function core logic).

Backend: `supabase link --project-ref siacpdaiovnliamhorrf` once, then `supabase functions deploy <name>`. Server secrets (Google/TikTok/Instagram client secrets, `*_TOKEN_ENCRYPTION_KEY`, `*_APP_ORIGINS`) live in Supabase function secrets, never in `VITE_*` vars. See `supabase/functions/.env.example`.

## Known leftovers

`styles.css` / `workspace.css` still contain styles for Creator_OS screens that weren't ported (studio, library, projects). Prune when touching them.
