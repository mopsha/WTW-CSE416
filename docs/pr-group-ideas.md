## Summary

Add group-owned ideas for future activities, optionally mix them into normal Picks,
and connect the surrounding group, profile, account, messaging and history flows.
Direct group invitations now require recipient acceptance. Existing swipe/rank/vote
logic and legacy custom options remain compatible.

## What Changed

- **Group Ideas / Picks:** Group-scoped Food/Activity idea CRUD; host-controlled
  Include Group Ideas; Food/Activities/Both candidate selection; coordinate-free
  ideas; frozen candidate snapshots and Pick Again compatibility.
- **Groups / invitations:** Pending invitations with Accept/Decline, duplicate and
  retry protection, capacity checks and current friendship/blocking authorization.
  Explicit bearer-link joining retains its existing behavior.
- **Profiles / settings / auth:** Tappable friend profiles, unique usernames,
  favorites and metadata privacy; Settings for existing account/permission/safety
  controls; explicit OTP Log In versus Sign Up; required identity and skippable
  optional onboarding. Login does not silently create accounts.
- **Messaging:** Group chat and friend-only DMs, shared message UI, bounded latest
  50-message reads, retry deduplication, Realtime with polling fallback and generic
  notification payloads/routes.
- **History / Past Moves:** Project existing completed Picks and confirmed attendance
  into private/shared Past Moves with eligibility, attendance corrections, privacy
  and frozen winner rendering.
- **Stability / privacy:** Guard Groups behind required identity; reject stale auth
  and cross-account profile responses; clear private caches on access loss and
  navigation/background; scope polling/listener cleanup; preserve established
  usernames; align mock group deletion; cold-start Back fallback.

## Database Changes

Deploy migrations **before the matching API and client**. Earlier applied migrations
are unchanged. Apply the following in order using migration history, not manual replay:

| Migration | Purpose |
|---|---|
| 0023 | Group Ideas table, member-read RLS and authorized CRUD RPC |
| 0024 | Opt-in idea candidates, Both category and canonical Pick RPC wrappers |
| 0025 | Pending group invitations, atomic resolution and invitation notifications |
| 0026 | Unique username, favorites, metadata privacy and profile RPCs |
| 0027 | Atomic required identity and resumable optional setup offer |
| 0028 | Group messages, member/block RLS, deduplicated notifications and Realtime publication |
| 0029 | Friend-only direct conversations/messages, RLS, notifications and publication |
| 0030 | Privacy-aware Past Moves projection over existing Pick/outcome data |
| 0031 | Prevent clearing an established required username |

Review target migration history and dry-run before applying. Verify message tables
are in `supabase_realtime`; guarded migration blocks skip publication registration
if that publication does not exist. Preserve service-only writes/RPC grants and
existing notification wrapper delegation. See `docs/release-readiness.md` for the
full deployment sequence, configuration and recovery notes.

## Validation

Final local validation on baseline `03a5625` plus PR-preparation documentation:

- Lint and TypeScript: passed.
- Full Jest: **852 tests, 110 suites passed**.
- Full Deno API directory tests: **96 passed**.
- Edge Function index typecheck: passed.
- Standalone SQL: **134 assertions across 14 files passed**.
- Ordered migration replay through 0031: passed on disposable PostgreSQL 14.20,
  excluding 0007 (Supabase cron/net/Vault extensions unavailable).
- Android export: passed. This is a JS/assets export, not a signed native build.
- `git diff --check`: passed.

Environment limitations: no Docker-backed Supabase/pgTAP or configured Postgres 17
run locally. CI's database/API integration job must pass; these local results do
not assert current remote CI or hosted deployment status.

## TestFlight / Manual QA Required

**Real-device QA has not happened yet.** Team workflow is PR → teammate approval →
merge to main → TestFlight build/update → real-phone QA. Missing TestFlight QA alone
does not block opening this PR. Execute the 22-step smoke test in
`docs/release-readiness.md` on the post-merge build, especially:

- Real signup/returning login, OTP delivery, identity conflict and session restoration.
- Notifications and cold-start routes; Group Chat Realtime and DMs on two accounts.
- Membership removal, unfriend, block and privacy revocation while screens stay open.
- Explicit location/notification permission allow/deny and return from system Settings.
- Chat keyboard, nested scrolling, safe areas and native Back/navigation.
- Group Idea → opted-in Pick → swipe/rank/vote/winner → History/Past Moves.

Hosted setup must verify SMTP/templates, Realtime, APNs/FCM/EAS credentials, matching
client environment, server-only credentials and cron/Vault secrets. Do not use mock
mode to claim multi-user RLS, push or persistence verification.

## Known Limitations / Deferred

- Google/Apple/phone auth, contacts, birthday and photo uploads remain deferred.
- Reviewed published Terms/Privacy pages remain required for public release; internal
  Help/data information is not published legal content.
- Discover can use Google/public recommendations. Persistent Pick decks retain the
  existing owned/provider fixture flow; this PR does not add live-Google persistence.
- Chats expose latest 50 messages; older-history pagination and messaging extras
  are outside this PR.

## Reviewer Focus

1. Migration/RLS sequence and service-role RPC authorization: authenticated caller
   identity must be distinct from requested target IDs.
2. Pick opt-in/category/provenance checks and snapshot/history compatibility.
3. OTP login/signup distinction, required identity and session/account switching.
4. Messaging access after removal/unfriend/block, retry and notification uniqueness.
5. Profile/Past Moves privacy and stale-cache clearing across lifecycle transitions.

Reviewer checklist:

- [ ] PR CI lint/types/Jest/export/Edge checks are green.
- [ ] CI database migration, pgTAP/RLS and authenticated HTTP tests are green.
- [ ] Review 0023–0031 in order, including RPC grants, publication changes and
  notification type/wrapper dependencies; no historical migration rewrite.
- [ ] Optional local mock smoke: Log In as `demo@wtw.test`, code `123456`; create
  a group idea, opt into a group Pick, finish the normal deck and inspect History.
  Mock data is in-memory and uses one fixture identity.
- [ ] Acknowledge the provider/legal limitations and post-merge TestFlight plan.

Reviewers do not need to claim pre-approval TestFlight, hardware push, keyboard or
OS permission testing: the team's main-based build pipeline makes those post-merge
checks. Known failing code or CI still requires fixing before merge.
