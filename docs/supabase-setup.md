# Supabase account connector

Updated: 2026-09-27.

## Scope and acceptance

The founder selected Supabase after the backend comparison and confirmed Google sign-in only. This slice links the existing project, configures the Vite client, and provides sign-in/session/sign-out controls in Connections. Acceptance: the linked project is verified, no privileged key is placed in the frontend, the build/tests pass, and provider availability is represented honestly. A real Google login remains pending provider setup and an interactive account test.

## Current configuration

- Project: `creator-os`, reference `siacpdaiovnliamhorrf`, verified `ACTIVE_HEALTHY` through the CLI.
- CLI configuration: `supabase/config.toml` under Content Engine. Link metadata is in ignored `supabase/.temp`.
- Frontend: `@supabase/supabase-js` pinned to 2.117.2; public URL and publishable key in ignored `frontend/.env.local`. Never place service-role, secret, Google client secret, or platform tokens in Vite environment variables.
- Auth uses PKCE and requests only Google identity scopes. No Gmail permissions are requested.
- Public Auth settings returned Google disabled on 2026-09-27. The UI checks availability before enabling sign-in.
- Existing projects remain browser-local. App login does not authorize platform data or upload the workspace. No database schema, channel connector, or media worker is enabled by this slice.

## Enable Google sign-in

1. In Google Cloud, configure the application's consent screen and create a Web application OAuth client. Use identity scopes only: OpenID, email, and profile.
2. Add `https://siacpdaiovnliamhorrf.supabase.co/auth/v1/callback` as the Google client's authorized redirect URI.
3. In Supabase Authentication → Sign In / Providers → Google, enable Google and enter the client ID and client secret there. Keep the secret out of chat and frontend files.
4. In Supabase Authentication → URL Configuration, configure the local app URL and allow `http://127.0.0.1:5173/` as an app redirect. If using localhost instead, also allow `http://localhost:5173/`. The app returns to its origin root so its existing hash navigation remains compatible with the OAuth callback.
5. Restart the Vite dev server to load `.env.local`, open Connections, and test Google login, reload, cancelled consent, and sign-out. Until these are observed, end-to-end auth is unverified.

Documentation reviewed: [React/Vite client](https://supabase.com/docs/guides/auth/quickstarts/react), [Google provider and callbacks](https://supabase.com/docs/guides/auth/social-login/auth-google), and Supabase changelog. No applicable hosted Auth breaking change was found in the reviewed recent changelog entries.

Next slice: server-authorized cloud workspace persistence with RLS, then separate YouTube consent and server-side token storage. Instagram, TikTok, and Substack remain unconfigured.

## Verification

`supabase projects list` verified the correct healthy project and linked state. A request to the project's public Auth settings endpoint succeeded and returned Google disabled. `npm run build` passed TypeScript and the production build; Vite reported a 640 kB main-chunk warning. `npm run test` passed all 8 existing domain tests. These tests do not cover the new OAuth UI; interactive Google login and visual checks remain pending. No database changes were made.
