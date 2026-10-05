# YouTube connector test slice

Date: 2026-09-27. Founder authorized implementing/deploying a testable YouTube connector and preparing all four platform connection entries. This is read-only owned-channel access; no publishing, messaging, Gmail access, or paid media jobs.

Latest access evidence: the creator reported successful login after correcting the Google client credentials. A read-only database count confirmed one saved YouTube connection on 2026-09-27. All four YouTube Edge secret names are present. The consent/callback/storage path has therefore progressed beyond setup pending; real analytics refresh, reload, and interactive disconnect/reconnect are still unverified. Preserve the existing connection.

## Implemented behavior

Live verification on 2026-09-27 now confirms Google identity and saved channel persistence after reload, plus successful real channel/upload/analytics retrieval. See [current verification evidence](youtube-live-verification-2026-09-27.md) for observation details, checks, screenshot and remaining untested lifecycle cases. Earlier refresh-unverified statements describe the previous session.

Connections contains Google account sign-in and platform entries for YouTube, Instagram, TikTok and Substack. YouTube supports consent, persistent connection status, refresh, reconnect and disconnect. Other channel buttons are explicitly unavailable pending their own adapters; Substack requires separately validated export/import support. App authentication remains distinct from platform authorization.

The deployed `youtube-connector` Edge Function validates the Creator OS session with Supabase Auth for each POST and derives ownership from that verified user. One Google/Brand channel per creator is supported. OAuth callbacks use a random, hashed, ten-minute state, atomic one-time consumption, PKCE, and fixed allowed app origins. Google tokens are encrypted using AES-GCM with creator ID as authenticated associated data, stored in server-only RLS tables, and never returned to the browser. The token encryption key is in Edge secrets and ignored `supabase/.env.youtube.local`; do not rotate it casually or existing connections will need reconnecting. Refresh updates compare the old ciphertext so an in-flight refresh cannot resurrect a disconnected connection.

The gateway's JWT verification is disabled specifically to allow Google's public callback. The handler independently validates user sessions on every non-callback action; the callback requires valid one-time OAuth state. Changing gateway settings without preserving this boundary breaks consent.

Channel refresh retrieves channel statistics, up to ten recent uploads via the uploads playlist, video lifetime counters, and a daily report for the last 28 complete UTC days. It displays source and observation time. Reporting latency and hidden/missing metrics remain visible; missing retention is not synthesized. Analytics failure preserves available channel/video data. These live results are shown inside Connections only; Overview and the existing Library remain synthetic demo data.

Disconnect removes this app's stored credentials even when Google's revocation endpoint is unavailable and then explains manual Google revocation. When Google confirms revocation, subsequent access requires reconnecting. Use a dedicated YouTube OAuth client to separate revocation from Creator OS identity-provider grants.

## Google configuration required for live testing

1. In the Google Cloud project, enable **YouTube Data API v3** and **YouTube Analytics API**.
2. Create a dedicated **Web application** OAuth client named Creator OS YouTube (recommended), or use the existing Web client for the test. Add this exact authorized redirect URI:

   `https://siacpdaiovnliamhorrf.supabase.co/functions/v1/youtube-connector?action=callback`

3. Configure the consent screen's data access for `https://www.googleapis.com/auth/youtube.readonly` and `https://www.googleapis.com/auth/yt-analytics.readonly`. For Testing audience, include the creator's Google email as a test user. External release may require Google's verification. Testing grants can expire and should not be presented as indefinite access.
4. In Supabase → Edge Functions → Secrets add `YOUTUBE_GOOGLE_CLIENT_ID` and `YOUTUBE_GOOGLE_CLIENT_SECRET`. Enter these directly in the dashboard, never in frontend variables or chat. Encryption and allowed-origin secrets are already set.
5. Open `http://127.0.0.1:5173/#connections`, sign in to Creator OS, choose YouTube, then **Connect YouTube**. Select the Google/Brand account that owns the intended channel and approve both read-only permissions. Return automatically to Connections.
6. Click **Refresh channel data**. Compare channel identity and recent upload IDs with YouTube Studio, inspect the observation date, and confirm unavailable/lagging analytics are explained.
7. Reload and confirm connection status persists. Disconnect and confirm refresh is unavailable. Reconnect to exercise renewable access. Test cancelled consent separately; it must preserve any existing connection.

If using a hosted frontend later, add its exact origin to `YOUTUBE_APP_ORIGINS` before deployment. The current allowlist contains only local port 5173 origins.

## Test suite and deployment evidence

Vitest 5 is already installed. Existing co-located `.test.ts` conventions are retained. `frontend/src/youtube-connector.test.ts` runs the actual portable server handler with isolated fake provider/DB adapters: 26 tests cover auth/origin boundaries, scope selection, PKCE, callback success/cancellation, missing/expired/replayed state, partial scopes, missing refresh grant, no channel, per-creator isolation, encrypted storage, refresh/revocation, concurrent disconnect, quota, timeouts, partial analytics failures, date boundaries and unsupported requests. `npm run test` passes 34 tests including the original 8 domain tests. `npm run build` passes with the existing large-main-chunk warning (about 647 kB).

The Edge Function is deployed to `siacpdaiovnliamhorrf`. Unsigned live requests return 401; callbacks before Google secret configuration return 503 setup_required. Both tables have RLS and explicitly deny anon/authenticated reads; those roles also cannot invoke state consumption. The migration was generated by CLI, populated from the executed schema, and recorded as applied; local and remote migration history agree.

Run `supabase db query --linked --file supabase/tests/youtube-boundaries.sql` for a real database transaction test of permissions and one-time state consumption. It rolls back its temporary state row and exposes no user identifier or credential.

Browser checks verified the signed-out Connect YouTube gate and disabled Instagram/TikTok/Substack connect controls. This browser session has no creator login. No real channel consent or owned-data response is claimed until Google configuration and the interactive smoke test are completed.

Security advisors flagged the existing Supabase-generated `rls_auto_enable` SECURITY DEFINER event-trigger function and disabled leaked-password protection. The connector itself adds no SECURITY DEFINER functions. The existing event trigger is retained; password settings are outside this Google-only slice.

Primary evidence reviewed immediately before implementation: [Google web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [owned channel retrieval](https://developers.google.com/youtube/v3/docs/channels/list), [Analytics report query and scopes](https://developers.google.com/youtube/analytics/reference/reports/query), and [Supabase Edge authentication](https://supabase.com/docs/guides/functions/auth).

## Reuse for other providers

Reuse verified app identity, creator-owned connection storage, encrypted secrets, explicit capability/status/error responses, observation provenance, and the isolation/failure tests. Provider-specific scopes, account eligibility, PKCE availability, refresh semantics, revocation, metric definitions, and app review must be verified independently. No Google permission is assumed to authorize another platform.
