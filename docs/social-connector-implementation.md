# TikTok and Instagram read-only connectors

Implemented and reviewed: 2026-09-27. The founder explicitly requested TikTok, then Instagram in this chat, superseding the earlier reservation of integration work for another chat. YouTube code, credentials and its saved connection are preserved.

## Delivered behavior

Both Edge Functions are deployed to `siacpdaiovnliamhorrf`; Connections now has connect/reconnect, refresh and disconnect controls for each provider. Account status comes from the authenticated backend. Callback results select the matching service. Data is fetched on demand into component memory, cleared on auth/provider changes, and labeled with provider and observation time. Up to ten owned items are returned. Missing counters remain unavailable; zero is preserved. These providers are not wired into Overview, which continues to show real YouTube data.

Shared handler verifies the Creator OS bearer session with `auth.getUser`, derives ownership server-side, allows only configured origins, hashes ten-minute one-time state, atomically consumes provider-bound state, and encrypts tokens with AES-GCM authenticated data `provider:user_id`. Browser database roles have no table or state-RPC privileges; RLS is enabled without browser policies intentionally. Conditional token updates and a final connection check prevent stale sync results and refresh resurrection after disconnect. Credential values and provider error bodies are never logged or returned. Normal API calls use bearer headers; Instagram's documented server-only token exchange/refresh URLs necessarily carry tokens and the app secret and must not be logged.

`social_connections` has one account per provider and creator. `social_oauth_states` and `consume_social_state` are separate from YouTube's storage. Runtime uses pinned Supabase JS 2.117.2. Environment values are trimmed; live testing found a newline in the existing TikTok key. `SOCIAL_TOKEN_ENCRYPTION_KEY` / `SOCIAL_APP_ORIGINS` are optional; existing YouTube key/origins are reused without rotation when absent, with distinct provider/creator encryption binding. See `supabase/functions/.env.example` for server-only configuration.

## TikTok

### Sandbox continuation — 2026-09-27

Subsequent prerequisite work supersedes the missing-URLs blocker below: the creator authorized creation/publication and confirmed operator Madhur Gupta and public contact madhur.gupta455@gmail.com. Website https://creator-os-sandbox.madhur-gupta455.chatgpt.site and its `/terms/` and `/privacy/` pages are published and anonymously HTTP-verified (200 each). The URLs are entered in the sandbox form; saving awaits action-time confirmation. See [prerequisite evidence](tiktok-sandbox-requisites-2026-09-27.md). Target account and live OAuth/data remain unverified.

Existing sandbox `7690122975395743765` was inspected and its form prepared with Web, Login Kit, callback below, only `user.info.basic,video.list`, Productivity category, a truthful description, and a 1024px orange/brown CE icon. The current Add products dialog does not list Display API separately; `video.list` is available through Add scopes. **These settings are unsaved**: required official website, Terms of Service and Privacy Policy URLs are missing, and Apply changes has not been clicked. The creator has been asked for the real URLs; no substitute legal pages were invented.

No target user is listed. Add account → Continue dismissed its modal but produced no visible login tab or registered user. Complete that flow after configuration, with creator sign-in and acceptance of terms. TikTok's current [sandbox documentation](https://developers.tiktok.com/docs/en/add-a-sandbox) says target results can take up to an hour. The local app is running and signed in; remote read-only `select provider, count(*) from public.social_connections group by provider` returned no rows. Credential pair validity, successful consent/callback and actual profile/video results remain unverified. Existing credentials, deployment and YouTube setup were unchanged. Portal and local Connections tabs are preserved for continuation.

Uses Web Login Kit and Display API with `user.info.basic,video.list`. Server exchanges and refreshes renewable access, persisting rotated refresh tokens. Profile identity must match token `open_id`. Reads public video metadata, views, likes, comments and shares. Revoke is best effort; local credentials are removed first, even if provider revocation fails.

Register this exact HTTPS Web redirect URI in the matching app/sandbox:

`https://siacpdaiovnliamhorrf.supabase.co/functions/v1/tiktok-connector/callback`

Backend secret names `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` exist. The real signed-in UI successfully called status/start and navigated to TikTok login. The creator must finish login/consent; app/sandbox target-user eligibility, callback acceptance and actual owned data remain unverified. No connected TikTok account or live video result is claimed.

Primary evidence: [Web Login Kit](https://developers.tiktok.com/doc/login-kit-web/), [token lifecycle](https://developers.tiktok.com/doc/oauth-user-access-token-management/), [video list](https://developers.tiktok.com/doc/tiktok-api-v2-video-list/), [video object](https://developers.tiktok.com/doc/tiktok-api-v2-video-object/). Existing review/sandbox instructions are in `social-connectors.md`.

## Instagram

Uses Instagram Login for Business/Creator professional accounts with `instagram_business_basic` and `instagram_business_manage_insights`. Short-lived authorization grants are exchanged server-side for long-lived tokens. On requested sync, a token within seven days of expiry is refreshed only after it is at least 24 hours old; expired grants require reconnect. No background refresh scheduler is configured. Personal accounts fail the eligibility check.

Ownership uses the app-scoped account `id` matching the authorization grant; media retrieval uses the professional `user_id`. Large numeric `user_id` values are preserved as decimal strings before JSON parsing. `/me` handles the documented data-array form and direct-object form. Reads top-level media type, permalink, UTC timestamp, likes and comments. Captions and cross-surface engagement totals are excluded because the current reference marks these fields Facebook Login only. Hidden/omitted like counters remain unavailable. Media, story and 28-day account insights (views, reach, saves, shares, interactions, follows) come from `instagram_business_manage_insights`; a failed insight request leaves those metrics unavailable. Messaging, comments and publishing permissions are not requested.

Local disconnect removes stored credentials and pending state. Instagram provider-side revocation is not implemented or claimed; the UI explicitly asks the creator to remove app access in Instagram settings. Do not infer provider revocation from local disconnect.

Register this exact redirect URI under Instagram API → Instagram Login → Business login settings:

`https://siacpdaiovnliamhorrf.supabase.co/functions/v1/instagram-connector/callback`

Add server secrets `INSTAGRAM_CLIENT_ID` (Instagram app ID, not the parent Meta app ID), `INSTAGRAM_CLIENT_SECRET` (Instagram app secret), and `INSTAGRAM_GRAPH_VERSION=v26.0`. Update 2026-09-27: all three Instagram secrets are now set (ID/secret by the creator, `INSTAGRAM_GRAPH_VERSION=v26.0` added later), so Connect should now be enabled. Whether the ID/secret match the Instagram app (2526935411123118) is not verified. Professional account/app setup, own-account role access and live consent/data remain unverified.

Update 2026-10-06, checked in the Meta dashboard (Meta app 960168933182854, Instagram app "Creator OS-IG"): `INSTAGRAM_CLIENT_ID` and `INSTAGRAM_GRAPH_VERSION` match the Instagram app ID and `v26.0` (Supabase secret digests compared); the business login redirect URI is registered; `jackedmads` has the Instagram Tester role (invite acceptance not shown by Meta); `instagram_business_basic` and `instagram_business_manage_insights` were added to the Instagram API use case (Ready for testing). `INSTAGRAM_CLIENT_SECRET` is set but its value was not compared. A live connect against the owned account is still pending.

Meta pages were inaccessible to the web fetch tool, then successfully read in the in-app browser. [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) (updated March 13, 2026) verifies `force_reauth`, Boolean `enable_fb_login`, authorization/token endpoints, response permissions, 60-day access and 24-hour refresh eligibility. [Get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started) verifies profile fields and the distinct app-scoped/professional IDs. [Media reference](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) (updated August 12, 2026) verifies basic permission, selected fields and current v26.0. Standard Access is for owned/managed professional accounts added in the app dashboard; external accounts require Advanced Access/App Review. No production approval is claimed.

## Verification evidence

- Frontend `npm test`: 64 tests pass, including existing YouTube/domain tests and 21 new social tests. Contracts cover verified auth/forged owner, allowed origins, hashed one-time/replayed/expired/cross-provider state, cancellation, partial scope, encryption owner/provider binding, account mismatch, concurrent refresh/disconnect, revocation outage, normalized counters/links, rotating TikTok tokens, Instagram long-lived lifecycle and separate IDs.
- `npm run build`: passes; existing large-bundle warning remains.
- Migration `20260927101051_social_connectors` applied and present in remote migration history. CLI emitted a pg-delta catalog-cache certificate warning after applying; direct SQL verification confirmed schema/history and permissions.
- `supabase db query --linked --file supabase/tests/social-boundaries.sql`: passes; transaction rolls back all test state. Checks browser role privileges, RLS, cross-provider state and replay.
- Deployed POST status: both providers return 401 for unsigned allowed-origin requests and 403 for unapproved origins.
- Real signed-in browser: TikTok Connect enabled, start reaches TikTok login; Instagram setup-pending notice and disabled Connect verified. Existing YouTube saved connection remains; live TikTok/Instagram profile/media retrieval awaits provider consent/configuration.
- Supabase advisors report informational RLS-without-policy findings for intentionally server-only token tables. Pre-existing `rls_auto_enable()` public SECURITY DEFINER warnings and leaked-password protection notice remain outside this change: [function advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Next executable action: complete TikTok login/consent in this chat's browser and refresh actual account data; configure the Instagram app/account and three backend secrets, then verify owned-account consent, refresh and local disconnect. A provider login screen alone does not demonstrate accepted app configuration or a working live data connection.
