# Availability-first Picks (PR 2)

Branch: `josh/availability-first-picks`. Implementation is local and uncommitted. The feature is gated on the server; no remote migration, release, or deployment was performed.

## Architecture audit

The existing lifecycle is `draft → swiping → ranking → final_vote/completed`, with cancellation before completion. Ranking is a server operation; the existing closers may pass through ranking transactionally. Creation persists settings and the host participant; the canonical start builds and freezes the deck. Refresh can replace an ordinary deck with confirmation. Group creation copies current members; nongroup creation invites/joins afterward. Codes, links, host lobby locking, group invitations, and participant uniqueness already exist.

`pick_participants` is the invitation/access roster, with unique `(pick_id,user_id)`. Preferences and final ballots reference that roster and candidates. Private answers stay private. Canonical loaders feed heartbeat, close/ranking, final vote, and progress. RPCs recheck host/membership/state under row locks. Client table writes and service RPC invocation are denied by grants/RLS.

The ordinary swipe deadline is `picks.deadline_at`; final voting has a separate `vote_deadline_at`, with the existing 30-minute window. `dueToClose` uses percentage completion, not an absolute number of people. Deadline sweeps select only swiping/final_vote rows. Realtime watches Picks and participants; fallback polling is five seconds. New availability responses publish through the existing Picks row update, without a new subscription or polling loop.

Existing scheduling uses `plan_at`, post-result `pick_rsvps` (`going/maybe/not_going`), and `pick_outcomes` for actual attendance. `PlanTimeSheet` and `src/lib/plans.ts` provide native iOS/Android controls, device-local display, UTC serialization, calendar presets, cancellation and pending guards, and an existing 30-day horizon. No existing multiple-date-option table or Works availability poll was found. Hangs separately use `starts_at`, `expires_at` and `down/maybe/cant`, with canonical conversion/draft reuse.

Home/group summaries read authorized Picks, notifications link to the server-state entry route, and every Pick screen follows the existing routing helpers. Recent History/Past Moves rely on completed Picks and explicit outcomes, not RSVP/availability alone. Group removal historically preserves completed shared Picks; this implementation preserves that history while revoking active scheduled-Pick access. Existing blocking guards are host-based; the new cohort respects those guards.

## Chosen lifecycle and data model

Availability collection remains **draft**, distinguished by `proposed_at`. No enum value is added. Ordinary Picks keep null scheduling fields and their original behavior. This avoids exposing an unfamiliar swipe-ready state to existing clients and keeps the existing routing, cancellation, and sweeps intact.

New migration: `0041_availability_first_picks.sql` only. Historical migrations are unchanged.

- Picks gain proposed outing instant, time revision, cohort-lock timestamp, and deferred swipe-deadline minutes, with behavior-preserving defaults and a configuration constraint.
- `pick_availability` stores one revision-scoped `yes/maybe/cant` response per invitee.
- `pick_voting_cohort` stores the immutable decision-round cohort separately from invitees.
- `private.pick_availability_starts` stores an expiring candidate-generation claim and its intended cohort.
- An index supports pending scheduled Picks. Composite foreign keys cascade security revocations; explicit grants and RLS protect the new tables.

Public RPC wrappers preserve existing canonical implementations under private names, following the repository's existing migration pattern. Existing unscheduled RPC behavior remains, including non-host start errors. Only scheduled Picks use the new transition path.

## Creation and date/time behavior

Non-Hang creation adds **When** above Where: **Decide later** by default, or a proposed time. It reuses PlanTimeSheet with local draft confirmation/cancellation and an optional Decide later action. Category cards, Custom options, saved places, Group Ideas, location, filters, pool size and sticky footer remain.

Unscheduled requests omit both new fields. Existing payload comparison tests still pass. Scheduled requests add `proposedAt` and `swipeDeadlineMinutes`, while sending `deadlineAt: null`. API and SQL both validate scheduling. Proposed timestamps require an explicit timezone, valid calendar/time components, a future instant, and the existing 30-day scheduling horizon. API storage is canonical ISO UTC; Postgres uses timestamptz. Display uses the device's local timezone. Native date/time controls retain existing daylight-saving behavior; explicit overlap offsets serialize to distinct instants in tests. No authoritative local-time strings or new timezone model is introduced.

A selected swipe duration must leave its full duration plus the existing 30-minute final vote before the outing, both at creation and when starting. If collection takes too long, the host gets an actionable time-update error. No-deadline remains supported; the lobby explicitly warns that the host must close swiping in time. An old invitation is not automatically canceled: the host can update its time or cancel it.

## Availability and host behavior

The existing lobby renders the availability invitation for a scheduled draft. It shows category/host/location-radius context, the outing time, safe participant names/avatars, counts and current confirmed response. Response controls use existing accessible Chips, with selected/disabled states and platform targets. Mutations remain server-confirmed. Pending writes lock controls; failures can reconcile through refresh. Account, Pick and revision ownership prevent late responses from changing a replacement editor/lobby.

The proposing host starts as Yes. The host can change their response before starting, including declining; they remain the host and can manage/cancel the round even when they are not a voter. Yes and Maybe are eligible; Can't and no response are not. Declining never removes group membership or invitation access.

The host can start once at least two currently authorized Yes/Maybe respondents exist, without waiting for every invitee. Copy explains that nonresponders/decliners will observe the eventual plan. The host can change the time before start. A changed instant increments the revision, deletes old responses and initializes the host as Yes for that revision. An unchanged instant is a no-op. Old in-flight revisions are rejected. After lock, initial availability and the agreed time cannot be edited.

## Atomic start, deadlines, and provider behavior

1. Claim RPC locks the Pick, verifies host/current group/block access, future outing time, remaining deadline budget, current revision and minimum eligible respondents.
2. One two-minute claim captures the cohort. Concurrent starts receive a conflict before generating a deck. Responses/time edits cannot cross that claim.
3. The existing pool builder runs once for the claim, retaining saves, Group Ideas, Custom, Both, Google retention/cache rules, attribution and existing rate limits.
4. Finish RPC rechecks claim/token/lease, stage/revision, membership, cohort equality and time budget under the Pick lock.
5. Cohort insertion, canonical deck initialization, transition to swiping, deadline initialization and `plan_at = proposed_at` commit in one transaction.
6. Failure leaves no partial cohort/swipe-ready Pick. Abort releases the claim. An abandoned claim expires; an old token cannot commit after replacement. A committed-start retry returns the existing deck count without rebuilding.

No place-provider request is made to collect availability or edit its time. The existing build happens at start. Open Now keeps its real-time meaning when generating the deck; the lobby explicitly disclaims future-hours guarantees. Legacy/ineligible swipe reads are gated before provider hydration. Refresh is unavailable for scheduled rounds, preserving already-submitted answers; ordinary refresh remains unchanged and available. The host menu hides the unavailable action for scheduled Picks.

The selected early-close threshold remains a percentage from 1–100, with the existing UI choices. Every such percentage is satisfiable for a cohort of at least two; no threshold is silently changed. Completion/ranking/final vote use cohort members, not invitation count. Existing ranking, tie rules, finalist persistence, vote window, winner selection and cancellation remain canonical.

## Authorization, RLS, and security revocation

Availability mutation APIs derive the actor from authentication, require a positive database-sized revision, validate enums/timestamps, and reject a supplied `userId`. Only invitees with current relevant group/host-block access can respond. Only the host can edit time or start. Every mutating RPC repeats those checks transactionally; disabled UI is not the security boundary.

Response/cohort tables permit authorized invitee reads and no authenticated writes. RPC execution is service-role only; private security-definer access helpers and revocation triggers have explicit authorization logic, empty search paths and restricted grants. The private claim table is not exposed. Candidate RLS hides a swipe deck from ineligible invitees before reveal. Preference/final-ballot triggers enforce locked-cohort eligibility even through direct service RPC calls. Canonical heartbeat/close/vote snapshots filter their participant IDs and ballots/preferences to that cohort. Progress authenticates against the invitation roster, then counts actual cohort IDs.

Active scheduled group-member removal and host blocking revoke Pick access and cascade the cohort, answers and ballots. Revocation bumps the existing version fence, so ranking retries use current inputs. Group deletion cancels unfinished scheduled Picks. Completed/canceled historical membership and actual attendance are not erased by later group changes. Can't/nonresponse never triggers these security removals. Final results remain available to authorized nonvoting invitees.

## UI, routes, results, and existing integrations

- Home and group summaries label scheduled drafts **Availability requested**.
- Existing entry/deep-link and per-screen guards route nonvoters to the observer lobby during swiping/ranking/final vote. The API/SQL still deny unauthorized mutations independently of navigation.
- Outing time appears in Pick headers throughout the decision and in the resulting plan. Countdown semantics remain the phase deadline.
- A nonvoting host retains manual close controls. Authorized observers see the completed winner normally.
- The committed proposed instant becomes the existing plan time at start. Results do not ask for that time again or permit replacing it with an unrelated default. Ordinary post-result scheduling and Pick again remain available. Pick again retains the existing unscheduled, no-deadline draft behavior rather than copying an expired proposal/cohort.
- Availability never writes final RSVP or attendance/outcome. Past Moves still requires actual attendance confirmation.
- Existing invitation notifications are reused. Start notifications target only the confirmed eligible cohort, excluding the acting host. Time-change push notifications are deferred; current views refresh through the existing Picks event and polling. No new notification event/system or reminder loop is introduced.
- Hangs keep their existing flow: no When row, no scheduling transfer and no duplicate availability gate. The server rejects scheduling fields on Hang conversion. `5793246`'s expiry-only RSVP eligibility, converted visibility, Let's Pick re-entry, canonical draft reuse and participant-set checks remain untouched and covered by existing regressions.
- Mock mode implements the same scheduling/cohort contract and demo bot responses; ordinary mock flows remain intact.

## Backward compatibility and staged rollout

Backend `ENABLE_AVAILABILITY_PICKS` defaults **off** and gates new scheduled creation. Capability discovery is authenticated at `GET /picks/capabilities`. Scheduled creation preflights it, so an older or disabled backend cannot silently ignore scheduling fields and create a normal Pick. Normal creation performs no additional request. Scheduled creation captures the form account for both capability discovery and the POST; an account switch between them rejects the POST rather than borrowing the replacement token.

New clients advertise `X-Client-Info: availability-v1`, using an already allowed CORS header. Older requests without scheduling retain their original contract. Legacy clients opening a scheduled Pick receive `409 UPDATE_REQUIRED` for detail/progress/start; they cannot accidentally begin the decision. The SQL legacy-start wrapper also rejects scheduled starts. No new state breaks old state switches, and old summary projections remain valid.

Mixed-version invitees must upgrade to interact with scheduled Picks. Feature enablement must follow backend migration/deployment and client distribution/QA; it is not safe to enable indiscriminately while invitees rely on older TestFlight builds. Turning creation off does not disable management of already-created scheduled Picks. No environment flag was enabled by this task.

### Future authorized release order

1. Run full CI, real Supabase migration/integration tests and multi-user native QA.
2. Apply migration 0041 to the intended environment, with scheduling still off.
3. Deploy the matching backend/RPC adapters with `ENABLE_AVAILABILITY_PICKS` off; smoke-test ordinary/Hang flows and capability response.
4. Distribute compatible clients; verify old-client errors are understandable and ordinary Picks remain functional.
5. Enable new creation for the tested rollout population; monitor conflicts/provider errors, invitations and completion.
6. To stop new scheduled creation, turn the flag off; preserve the additive schema and existing scheduled-round handling.

These are release instructions only; none was performed remotely.

## Tests and validation

New deterministic coverage:

- Domain/API: legacy categories and payloads, valid/invalid/past/calendar-invalid times, canonical offsets/DST overlap, deferred/No deadline, response enum/actor/revision, host changes, old-client gating, server-confirmed start, generation failure/abort, duplicate start, response counts, cohort completion and observer routes.
- Creation UI: Decide later, Set a time, cancellation/reset and Hang restriction; original 14 payload comparisons retained.
- Availability lobby: counts/confirmed selection, pending state, account/revision-scoped calls, deferred completion after unmount and host/observer controls.
- Client/mock flow: capability preflight, account token isolation, invitee retention, Yes/Maybe locking, deadlines, final winner time and no attendance side effect.
- Deno/Hono: authenticated capabilities, disabled/legacy creation, response identity validation, canonical time edit, legacy read/start denial and simultaneous starts. Imported into existing CI's `app_test.ts` entry point.
- SQL/RLS: actual grants, roster privacy, direct RPC/ballot rejection, candidate RLS, revision invalidation, minimum cohort, claim contention, failed finish rollback, locked responses, No deadline, group/host-block revocation, stale-time cancellation, plan-time persistence, and cohort snapshot counts.
- `tests/db/availability_concurrency.py`: real two-connection row-lock barriers test duplicate start, time-vs-response, start-vs-response, start-vs-time, response-vs-start, cancel-vs-response and revoke-vs-response. No sleeps decide the ordering. Use only a disposable local database via `--dsn`.

Final validation results:

| Check                                      | Result                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| TypeScript                                 | Pass locally and in the tracked-files-only CI copy without generated Expo types                      |
| ESLint                                     | Pass, no warnings                                                                                    |
| Focused Jest                               | 9 suites / 115 tests pass                                                                            |
| Full Jest (`npm test -- --ci --runInBand`) | 193 suites / 1,607 tests pass                                                                        |
| Deno check                                 | Pass for API index and its dependencies                                                              |
| Full Deno/API directory                    | 150 test executions pass; availability tests are also imported by CI's existing app-test entry point |
| Fresh migration order / seed               | All 41 source migrations validate in the isolated harness described below                            |
| SQL/RLS                                    | All 42 test files pass, 724 assertions                                                               |
| Real transaction races                     | All seven pass using the tracked local concurrency script                                            |
| Android / iOS exports                      | Pass; bundles under `/tmp/wtw-availability-android` and `/tmp/wtw-availability-ios`                  |
| Working-tree / staged diff checks          | Pass; index remains empty                                                                            |
| Scope checks                               | 44 expected files; no dependency/lockfile, Expo config, identifier or branding changes               |

Logs/bundles remain outside the repository under `/tmp/wtw-availability-*`. Exports validate bundles; they are not native release builds.

Local database validation used a fresh PostgreSQL 14.20 server with real pgTAP 1.3 SQL and all repository migrations/seed. Supabase auth/storage fixture schemas were supplied locally. The unavailable cron/net/vault extension installation statements in 0007 were replaced in the temporary harness by inert infrastructure stubs; no source migration was edited. pgTAP SQL was preloaded, so temporary test copies omitted only its extension-install statement. Assertions, constraints, grants, RLS and RPC bodies were real. A second fresh database validated final migration order independently of the development database.

Docker/Supabase runtime containers are unavailable. These tests do **not** replace CI's full Supabase Auth, Storage, PostgREST, cron and authenticated integration stack. That release check remains required. No remote Supabase connection was used.

Clean-checkout TypeScript excludes ignored `expo-env.d.ts`/`.expo` augmentations, following the prior CI finding. It uses the installed lockfile dependency tree. Local Node 23.11 differs from CI Node 22, which is not installed. React Native 0.86.3 and TypeScript 6.0.3 match the lockfile; dependency/config files remain unchanged. Deno is 2.9.6.

## Native and multi-user QA still required

`simctl` is unavailable and adb is not installed; no screenshots or native interaction claims are made from exports/Jest.

Use one host and four invitees: one Yes, one Maybe, one Can't and one nonresponder. Create a future timed Pick, discover its invitation through Home/group/code/link, confirm counts and named statuses, change time and verify reconfirmation/stale-response rejection, then start. Host/Yes/Maybe can swipe and vote; Can't/nonresponse remain observers. Confirm completion denominator excludes observers, winner/time persist, and only actual attendance creates a Past Move. Repeat with a declined host and with group membership/blocking revoked during the round. Test old-client upgrade handling, ordinary unscheduled creation/scheduling, and converted Hang RSVP/re-entry.

On iOS/Android verify date/time cancellation and DST/local display, large text/long names, screen-reader selected states/live counts, keyboard/safe areas, map controls, header density, pending/dismissal behavior, reduced motion and final time display. Test slow provider failure, duplicate starts, ambiguous network retries, app background/foreground and account changes on real devices.

## Known limitations and PR 3 deferrals

- Time-change push events are deferred; existing live refresh/reconciliation remains.
- An abandoned provider claim requires up to two minutes before retry. A replaced token cannot commit; a very slow provider result can be discarded.
- No-deadline cannot guarantee a decision before the outing; copy makes the host's responsibility explicit.
- Initial availability is frozen after start; post-result attendance remains a separate mutable feature.
- Multiple times, suggestions, polls, calendar sync, automatic recommendations and Hang scheduling transfer are intentionally deferred.
- Real Supabase stack and native multi-user QA remain release gates; the feature flag stays off by default.

## Complete file inventory

- `app/pick/[id]/index.tsx`
- `app/pick/[id]/lobby.tsx`
- `app/pick/[id]/results.tsx`
- `app/pick/[id]/swipe.tsx`
- `app/pick/[id]/vote.tsx`
- `app/pick/[id]/waiting.tsx`
- `app/pick/[id]/winner.tsx`
- `app/pick/new.tsx`
- `docs/availability-first-picks.md`
- `src/components/AvailabilityLobby.tsx`
- `src/components/GroupConversationScreen.tsx`
- `src/components/HostMenu.tsx`
- `src/components/PickParts.tsx`
- `src/components/PlanBlock.tsx`
- `src/components/PlanTimeSheet.tsx`
- `src/components/picks/PicksHome.tsx`
- `src/hooks/usePickRoute.ts`
- `src/lib/api.ts`
- `src/lib/mock/api.ts`
- `src/lib/mock/store.ts`
- `src/lib/pickRoute.ts`
- `src/lib/queries.ts`
- `src/lib/types.ts`
- `supabase/functions/_shared/api/availability.ts`
- `supabase/functions/_shared/api/hang.ts`
- `supabase/functions/_shared/api/lifecycle.ts`
- `supabase/functions/_shared/api/progress.ts`
- `supabase/functions/_shared/domain/availability.ts`
- `supabase/functions/_shared/domain/createPick.ts`
- `supabase/functions/_shared/queries/pickSummaries.json`
- `supabase/functions/api/app.ts`
- `supabase/functions/api/app_test.ts`
- `supabase/functions/api/availabilityStore.ts`
- `supabase/functions/api/availability_test.ts`
- `supabase/functions/api/index.ts`
- `supabase/functions/api/lifecycleStore.ts`
- `supabase/functions/api/progressStore.ts`
- `supabase/migrations/0041_availability_first_picks.sql`
- `supabase/tests/availability_first_test.sql`
- `tests/availability.test.ts`
- `tests/components/AvailabilityLobby.test.tsx`
- `tests/components/NewPick.test.tsx`
- `tests/db/availability_concurrency.py`
- `tests/lib/availabilityFlow.test.ts`

## Readiness

Ready to commit and push for review: implementation and the available automated checks pass. Native multi-user QA and CI’s full Supabase integration stack remain required before feature enablement or release. No commit, push, merge, rebase, remote migration, backend deployment, native release build or submission was performed.
