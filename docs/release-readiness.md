# Group Ideas release candidate: QA and deployment

Reviewed on `josh/group-ideas`, baseline `3f2262b`. This is a test plan, not a
record of successful hosted/device testing. Record tester, build SHA, platform,
environment, date, actual result and evidence beside each executed case.

## Assessment and findings

No new blocker/high code defect was reproduced in this pass. Automated coverage
does not establish hosted readiness. Do not call this deployed or device-verified
until the unchecked gates below pass.

| Severity | Evidence / release impact | Disposition |
|---|---|---|
| Blocker for hosted feature deployment | API expects RPCs through 0031; older hosted schema cannot serve this build | Apply ordered migrations before API/client rollout; verify hosted history |
| High, conditional on promising live Google Pick decks | `api/index.ts` uses `MockProvider` for persistent Pick pools; configured Google pool is Discover-only | Existing documented retention boundary; fixture demo is valid, live Google Pick launch is not |
| High for public release | Published Terms/Privacy remain unavailable (`docs/decisions.md`, signup UI) | Publish/review actual content outside this task; internal data information is not a legal policy |
| Medium | Privacy inventory stopped before 0023–0031 | Updated inventory in this pass |
| Medium, verification gate | Hosted SMTP, Realtime, native push credentials and OS lifecycle behavior cannot be established by unit tests/export | Execute external configuration and two-device cases below |

No new migration or application behavior change is required by this review.
Historical migrations are not repeatable scripts: use migration history, not manual
re-execution of `ALTER FUNCTION ... RENAME` statements.

## Manual QA matrix

Setup: use a disposable environment and accounts A (owner), B (friend), C
(non-friend/non-member). Establish A–B accepted friendship. Use separate real
sessions for A/B; mock mode is a single fixture identity and cannot prove cross-user
RLS, SMTP, push, or persistence. “2 users” can use isolated sessions; “2 devices”
means physical iOS/Android development/preview builds for push/lifecycle checks.
Never delete production accounts or alter production clocks for test setup.

| Flow / setup | Exact actions | Expected result and edge cases | Required |
|---|---|---|---|
| New signup, unused email | Select Sign Up; send code; enter wrong/expired then valid code; save name + unique username | Errors recover; only signup may create account; normalized username persists; required identity precedes app | 1 device + email |
| Returning / unknown email login | Log In with existing email, then unused email | Existing account enters app; unknown login never creates account; provider may return generic anti-enumeration failure | 1 device + email |
| Username conflict / legacy identity | Claim B's username; choose another; log in with legacy missing identity | Conflict keeps form/input; no partial identity write; legacy user completes required fields only | 2 users |
| Optional onboarding / restart | Skip favorites/permissions or all setup; repeat signup and restart during identity/optional steps | Required identity resumes; optional setup never gates Picks; returning completed users skip it | 1 device |
| Permission consent | Open onboarding/Settings without tapping permission; explicitly allow or deny each; retry after permanent denial | Opening does not prompt; denial permits app use; system Settings guidance works; no contacts prompt | 1 physical device per OS |
| Session / logout | Authenticate; force close/relaunch; background/foreground; logout while network is unavailable then recover | Stored session restores without wrong-account flash; errors visible; successful logout removes authenticated screens and push registration best-effort | 1 device |
| Profile / privacy | B opens A from Friends; A edits favorites and toggles sharing off/on while B stays open | Name/@username/avatar work; private counts/favorites/mutual groups/Past Moves disappear; shared groups only; owner retains own metadata | 2 users |
| Unfriend / re-friend / block | Open profile/DM; unfriend, re-friend, block, unblock; attempt old URLs throughout | Access denied while unauthorized; unblock alone does not restore friendship; accepted re-friend permits existing conversation reuse | 2 users |
| Group create / bearer join | A creates group; B explicitly accepts group invite link; retry link; try invalid/expired link | Explicit link acceptance can join immediately; direct requests below remain pending; errors do not expose arbitrary group data | 2 users |
| Direct invite / accept / duplicate | A invites B twice; B opens Friends requests and accepts twice | One pending request, no early membership; atomic accept adds B once; retry succeeds without duplicate membership/notification | 2 users |
| Direct invite / decline / authorization | Invite C after becoming friends; C declines twice; A/B attempt resolving C's invite | Decline adds nobody; same decision retry safe; another user's resolution rejected; resolved invite cannot re-add removed member | 2–3 users |
| Full group | Seed 25 current members; invite/accept an additional recipient; test pending invite when last slot fills | Clear conflict, never 26 members; pending invitation is not reserved capacity | 2 users + fixture |
| Leave / removal / deletion | B opens Ideas/chat; B leaves or A removes B; revisit old URLs; A deletes group | Server denies immediately; focused cache clears on next recheck (5 seconds), blur/background clears; deleted group unavailable; historical Pick rules preserved | 2 users |
| Idea CRUD / permissions | A creates Food and Activity ideas with description/location; B reads; author edits; owner deletes other's idea; C requests URL | Members read/create; creator edits; creator/owner delete; outsider denied; invalid/oversized text rejected | 2–3 users |
| Coordinate-free idea | Create idea with location text only; include in Pick | Text is not geocoded or treated as real coordinates; deck/ranking/rendering still work | 1–2 users |
| Legacy Pick / ideas OFF | Create food Pick with Include Group Ideas off; run swipe/rank/vote/winner | Existing provider/custom behavior unchanged; no library ideas inserted | 2 users |
| Ideas ON / category combinations | Create group Picks for Food, Activities, Both; enable ideas; start with public fixtures available | Matching ideas + public recommendations appear without duplicates; correct categories; no invented distances for ideas | 2 users |
| Frozen deck / history / Pick Again | After starting, edit/delete source idea; finish Pick; reopen History; tap Pick Again twice | Frozen candidate remains readable; normal vote/winner; one reusable draft; filters/opt-in preserved subject to current group membership | 2 users |
| Group chat send / retry | Send from A; receive on B; disconnect after send, retry same text; send empty/oversized text | Latest 50 bounded; one logical retry message/notification; validation shown; no duplicate rows | 2 users; 2 devices for live/push |
| Group chat lifecycle / blocking | Background B, send from A, resume; remove B while open; block sender in shared group | Revalidation catches removal; revoked data clears; blocked sender's content/notifications filtered; remaining group membership follows existing rules | 2 devices |
| DM friend-only / reuse | Open Message from friend profile; exchange; retry; unfriend/block while open; re-friend and reopen | Non-friends cannot open/read/send; latest 50; stale content cleared; same pair reuses conversation/history when eligible again | 2 users |
| Notification navigation | Tap group/DM/Pick/invite notifications foreground, background, cold start and signed out; delete target before tap | Correct authorized route after identity setup; denied/deleted target shows useful error/Back; stale payload never bypasses access; no message text leaked in push | 2 physical devices |
| Did you go / eligibility | Finish timed and untimed Picks; before/after eligibility answer yes, correct to no, then yes | Timed: plan time +1h; untimed: decision +3h; no early Past Move; user's own yes required; correction removes/restores one entry | 2 users + aged fixtures |
| Past Moves winner / privacy | Finish Group Idea and public-fixture winners; confirm attendance; inspect own/friend/group views; toggle privacy/remove membership/delete group | Frozen winner renders; no duplicate entries; friend needs sharing + shared Pick; group labels only for current viewer memberships; restricted Google display omitted | 2 users |
| Settings edit / permissions | Edit display name/@username/favorites; blank/taken username; toggle privacy; inspect notifications/location; open system Settings and return | Validation retained; established username cannot clear; actual OS status refreshes; no fake push mute/contacts/password control | 1 physical device per OS |
| Blocked users / deletion | Block and unblock from Settings; delete disposable account with confirmation; reopen cached links and prior session | Cancel safe; successful deletion signs out; owned groups/content cascade; other members' retained history follows deletion contract; no private access remains | 2 users |
| Empty / offline / revoked | Empty groups/Ideas/history/chat; go offline and retry; delete target from second session | Useful empty/loading/error/retry states; private reads fail closed; no endless spinner or enabled send to unavailable conversation | 1–2 devices |
| Native layout / back / performance | Keyboard open in both chats; multiline text; scroll nested history; rotate where supported; Android hardware Back; iOS gesture/header Back; repeat navigation 10 times | Composer reachable, safe areas clear, scroll usable; no trapped cold-start route; no duplicate listeners/messages; background polling pauses | Physical Android + iOS |

Use aged database fixtures in a disposable environment for time eligibility; do not
wait three hours during a smoke test or change device time as a substitute for DB time.
After access revokes, the server rejects the next request immediately; previously
received content cannot be recalled. Visible private screens recheck every 5s;
plan summary refresh retains its existing 30s cadence.

## Migration deployment checklist (0023–0031)

- [ ] Confirm target project reference, backup/PITR policy, supported Postgres version
  (repo local target is 17), and migration history through 0022. Compare remote/local
  versions with `supabase migration list --linked`. Resolve drift before deployment.
- [ ] Confirm earlier prerequisites: profiles/auth trigger, private helpers, groups,
  friendship/blocking functions, canonical Pick RPCs, notification tables/RPC and
  service-role grants. 0007 also needs pg_cron, pg_net and Supabase Vault.
- [ ] Review `supabase db push --linked --dry-run` against the intended project;
  apply pending migrations once with `supabase db push --linked` after backup review.
  Do not reset a hosted database or replay applied migration files manually.

| Order | Migration | Deployment verification |
|---|---|---|
| 0023 | `group_ideas` | Members-only SELECT RLS; API-only writes; creator/owner mutation rules; group/account cascades |
| 0024 | `group_idea_candidates` | Opt-in defaults false; Both category accepted; canonical RPC wrappers/private renamed originals exist; historical snapshots untouched |
| 0025 | `group_invitations` | One pending invite per group/invitee; old add-members RPC now requests consent; notification wrapper retains prior types |
| 0026 | `user_profiles` | Existing nullable usernames accepted; case-normalized unique index; metadata private by default; no new client metadata column grants |
| 0027 | `auth_identity_setup` | Existing users default optional offer false, future rows true; atomic identity RPC/service-only grants |
| 0028 | `group_chat` | Message RLS/member/block checks; retry key unique; notification FK/unique index/type check; publication contains group_messages |
| 0029 | `direct_messages` | Pair unique; accepted-friend/block RLS; service-only mutations; notification wrapper still delegates groups/invites/Picks; publication contains direct_messages |
| 0030 | `past_moves` | Attended-user index; API-only projection; no copied feed table; eligibility/privacy/shared-Pick restrictions |
| 0031 | `integration_identity_guard` | Wrapper delegates existing update; established username cannot clear; legacy null remains usable |

- [ ] If `supabase_realtime` was absent when 0028/0029 ran, their guarded publication
  blocks skipped registration. Inspect `pg_publication_tables` and have the deployment
  owner enable the two message tables after configuring Realtime. Preserve existing
  picks/pick_participants publication; do not publish preferences/final votes.
- [ ] Inspect `pg_policies`, function grants and notification constraints on hosted
  schema. Test with A/B/C JWTs, not just service role; direct SQL client writes must fail.
- [ ] Run SQL suite on staging and the authenticated API integration suite. Recheck
  pending invitations, one message notification per recipient/message, and old Pick
  notification types after the wrapper chain is installed.
- [ ] Deploy matching `api` Edge Function after schema; config keeps `verify_jwt=false`
  because the function validates user JWTs and cron secret itself. Verify public health,
  unauthenticated mutation rejection, then authenticated create/read/write requests.
- [ ] Release matching client only after backend smoke passes. If migration succeeds
  but function deploy fails, leave schema applied and fix forward/redeploy; do not
  drop new tables as an improvised rollback. Reconcile exact SHA with CI deployment.

## External configuration and verification

| Dependency / where | Why / verification |
|---|---|
| EAS environment (development/preview/production) | Matching `EXPO_PUBLIC_SUPABASE_URL`, anon key; `EXPO_PUBLIC_USE_MOCK=0`, failure rate 0 for real tests. Public vars are bundled. Verify build talks to intended project; never print credentials |
| Hosted Edge secrets | Supabase service-role credential server-only; `CRON_SECRET` matched to Vault. Verify unauthorized/authorized calls without logging token values |
| Hosted Auth Email/SMTP | Enable email/signup/confirmation, deliver both confirmation and magic-link templates containing `{{ .Token }}`; 6-digit OTP. Verify new/returning email on real inbox, expired code and rate limit. Local SMTP inbox is not hosted delivery; default email quotas can block demo |
| Auth URL configuration | Set real site URL and only intended redirect allowlist. Current code enters OTP, not OAuth/magic-link callback. Verify actual deployed web/native link behavior; do not enable providers to make UI look complete |
| Supabase Realtime | Enable project service/publication for both chat tables and existing Pick tables; test authorized INSERT reception and unauthorized clients; polling fallback must still work |
| EAS/Expo/APNs/FCM credentials | Project ID already in app.json is not proof credentials work. Configure push for bundle/package `edu.stonybrook.wtw`; use signed dev/preview builds; verify token registration, delivery, routing and logout removal on both OSes. If enhanced Expo push security is enabled, sender auth must be configured/verified before claiming push works |
| Native permission configuration | Existing location/notification plugins and iOS explanation; rebuild after native config changes. Verify prompts only on tap, denied/restricted states and Settings return; Expo Go/export cannot establish native delivery |
| Google Cloud + Edge provider config | Discover uses `PLACES_PROVIDER=google`, server `GOOGLE_PLACES_API_KEY`, `GOOGLE_DAILY_CALL_CAP` (default 100). Enable required Places APIs, restrictions and billing alerts/budget. Verify successful request and over-cap notice/fallback; app cap is not an account-wide dollar budget. Never put Google key in EAS `EXPO_PUBLIC_*` |
| Deadline/reminder/cache sweep | Configure Vault `wtw_sweep_url` to HTTPS `/functions/v1/api/internal/sweep` and `wtw_cron_secret`, matching Edge secret. Verify cron job, HTTP response and cleanup/reminder behavior in staging; unconfigured Vault intentionally makes no outbound calls |
| CI deployment environment `wtw-dev` | GitHub environment secrets SUPABASE_ACCESS_TOKEN/DB_PASSWORD and project-ref variable; protected environment/review as appropriate. Check actual validate/integration/deploy runs; this local pass does not assert remote CI status |
| Published legal/data disclosure | Publish reviewed Terms/Privacy before public release; reconcile privacy labels with updated inventory. Internal Help/data information is not legal publication |

## Automated validation record

Run lint, tsc, full Jest, full Deno directory tests, Edge index typecheck, SQL tests,
migration replay, Android export and diff check for the final SHA. See the accompanying
review report for actual counts. Standalone PostgreSQL validates SQL/RPC logic but
does not replace Supabase Postgres 17, Auth, Realtime, pgTAP or HTTP integration tests.
The disposable replay excludes 0007 because its Supabase extensions are unavailable.

This pass: lint and TypeScript passed; Jest 852 tests / 110 suites passed; full
Deno directory 96 tests passed; Edge index typecheck passed; Android export passed;
14 standalone SQL files / 134 assertions passed. Ordered replay through 0031
passed on disposable PostgreSQL 14.20, excluding 0007. No Docker executable or
pgTAP extension was available; the configured Supabase Postgres 17 environment and
authenticated HTTP integration job still require CI/staging verification.

Configuration references: [Supabase CLI database push](https://supabase.com/docs/reference/cli/supabase-db-push),
[Realtime publication setup](https://supabase.com/docs/guides/realtime/postgres-changes),
and [Expo SDK 57 notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/).

## Release readiness checklist

Completed automatically:
- [x] Inspect migration 0023–0031 dependency, RLS and notification wrapper sequence.
- [x] Review auth guards, private cache cleanup, messaging bounds/retry IDs and lifecycle cleanup.
- [x] Add executable manual QA, deployment and external configuration checklists.
- [x] Update privacy inventory for the recent data model.

Must test manually:
- [ ] Execute matrix on real A/B/C sessions; record evidence, not only screenshots of mock mode.
- [ ] Complete smoke test below on Android and iOS; verify keyboard/back/safe areas.
- [ ] Verify two-device notification cold starts and live access revocation.

Requires hosted/external configuration:
- [ ] Apply schema/API in order, run hosted RLS/API tests and inspect CI integration results.
- [ ] Verify SMTP/OTP, Realtime, push credentials, sweep secrets and EAS environment.
- [ ] Publish legal pages and reconcile store privacy disclosures before public launch.

Intentionally deferred:
- [x] No Google/Apple/phone auth, contacts, birthdays, uploads or new social features.
- [x] No ranking/retention rewrite or live Google persistent Pick-deck integration.
- [x] No chat pagination, reactions, read receipts or typing indicators.

## Post-merge TestFlight smoke test (22 steps)

Use two real accounts/devices plus seeded eligible historical Picks; allow roughly
20–30 minutes excluding build, delivery delays and fixture preparation.

1. Install correct preview/development build; confirm backend/environment and health.
2. Sign Up A using an unused email; reject wrong OTP, then authenticate correctly.
3. Save display name + unique username; verify conflict handling with a reserved name.
4. Skip optional onboarding; verify no unsolicited permission prompts and app entry.
5. Log In B; verify returning-user entry. Try unknown-email Log In without creating account.
6. Send/accept A–B friendship request through current Friends UI.
7. Open B's profile; set B's favorites/sharing; verify A sees permitted metadata.
8. A creates a group and directly invites B twice; confirm B is not yet a member.
9. B accepts from Friends requests; confirm exactly one membership and group access.
10. Send a separate disposable invitation and decline it; confirm no membership.
11. Add Food and Activity Group Ideas, one with location text but no coordinates; edit one.
12. Create a Pick with ideas OFF; confirm legacy deck has no Group Ideas.
13. Create a Both Pick with ideas ON; confirm mixed public-fixture/idea deck and categories.
14. Edit/delete the library idea after start; confirm frozen candidate is still readable.
15. Both users complete normal swipes/rank/final vote where required; verify winner.
16. Open History, then Pick Again twice; verify reusable draft/settings.
17. Exchange group chat messages; background/resume B; retry after network interruption.
18. Open DM from friend profile; exchange messages; tap group/DM notification from cold start.
19. Toggle sharing off, then unfriend/block while B's profile/DM is open; verify data/access revoke.
20. Unblock and re-friend; verify conversation reuse. Remove B from group; verify Ideas/chat deny.
21. On aged completed fixtures, answer Did you go yes/no/yes; verify Past Moves appearance/correction/privacy.
22. Check Settings edits/permissions/blocked list, restart session, logout; delete a disposable account with confirmation and verify revoked access.

Team workflow: PR → teammate approval → merge to main → TestFlight build/update →
real-phone QA. Missing TestFlight testing does not block opening this PR in the
absence of a known code blocker. Review code/migrations and require current CI
database/API checks before merging; execute the smoke test on the resulting
TestFlight build after merge. Hosted configuration and legal publication remain
gates for public release. Fixture-based demos must state provider limitations.
