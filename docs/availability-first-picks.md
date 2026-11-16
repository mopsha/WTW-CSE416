# Immediate swiping with availability gating (PR 2)

Branch: `josh/availability-first-picks`. Revised directly, without a new branch. No commit, push, merge, remote migration, deployment, or feature enablement was performed.

## Architecture audit and product flow

The previous draft → collect availability → host Start flow made every participant wait on a second host action. Scheduled creation now uses the existing server creation, candidate builder, initialization claim and canonical start writer to enter `swiping` immediately. The host starts as Yes and can swipe immediately. Each invitee independently confirms Yes/Maybe to enter the same swipe experience. Can't follows without voting. Final voting, ranking, ties, winners and results use the existing lifecycle.

Before editing, remote main was checked read-only: `5eca913a1a4a728c1490a414d2ff385dc85e94ca`, matching local `origin/main`. It includes PR 1 creation and density polish. Existing participant tables, Group Ideas provenance, saved places, Custom options, provider retention, notifications, account scopes, service-only RPCs, RLS and revocation protections were retained. No competing Pick model or lifecycle state was added.

## New Pick and invitation

The optional When editor remains: Decide later creates an ordinary unscheduled draft with its existing host start; Set a time creates an immediately initialized scheduled round. Grouped settings, location editor, categories, Custom, filters, candidate count, sticky footer, duplicate-submit protection and timezone conversion remain intact. Proposed outing time and swipe deadline are separate fields.

Invitees see the actual proposed instant, available category/option context, group name when applicable, and an accessible local choice: I'm in / Maybe / Can't. No provider request is added to populate this screen. The primary action is disabled until a choice; it persists through the authenticated server, refreshes, then routes confirmed Yes/Maybe directly to swiping or the current lifecycle screen. Can't stays in a read-only following view and can change before participating. Recoverable failures keep the selected choice. Pending actions prevent duplicates; account/Pick/revision keys and scoped requests prevent replacement-account effects. Authorization failures clear protected content through existing hooks.

The exact temporary explanation is: **“Time not ideal? The group can revisit the time after deciding.”** Existing scheduling supports host rescheduling after results, but has no participant-created time-suggestion/date-option model. Such suggestions are deferred to PR 3; there is no nonfunctional suggestion button or promise that participants can submit suggestions now.

## Initialization and recovery

Creation persists a draft, claims a two-minute initialization lease under the Pick lock, builds through the existing pool builder, and atomically commits canonical candidates, `swiping`, `plan_at = proposed_at`, and the deadline. Scheduled initialization permits a host alone; ordinary Picks retain the two-person start requirement. There is no second host Start action and no final cohort lock at initialization. Notifications invite the authorized roster after successful initialization, rather than announcing a future start.

Invalid/empty candidate initialization rolls back. Provider failures release the lease and the creation endpoint attempts canonical draft cancellation; cancellation failure leaves a recoverable draft, never an uninitialized swipe-ready round. An ambiguous finish reloads an already committed round instead of canceling it. Concurrent initialization claims cannot build duplicate decks; committed retries reuse the deck. Existing scheduled drafts from the previous experimental flow should be canceled/recreated; this revision does not bulk-generate decks for legacy drafts.

## Eligibility and response changes

Invitation roster, availability, current eligible IDs, started status, completed swipes and frozen final cohort are distinct. Yes and Maybe are equally eligible while retaining their distinct labels; Can't and no response have no swipe or final-vote authority. They retain authorized invitation/results access and group membership. Late Yes/Maybe joins are accepted while swiping remains open and before the deadline.

Before a first swipe, responses may change freely. The first accepted preference marks `started_at` atomically under the Pick lock. Thereafter Yes ↔ Maybe is allowed without losing answers; a change to Can't receives a clear 409 explaining that the voting response is kept and attendance can be updated after results. The UI removes that decline option after participation. This is a deliberately frozen eligibility-bearing response, not a hidden attendance withdrawal. No submitted preferences are silently discarded. Membership revocation and blocking override participation locks and remove unauthorized ballots/cohort entries through retained triggers.

## Completion, deadlines and final cohort

The completion denominator is current authorized Yes/Maybe users **plus unanswered invitations**, counted once each. Can't is excluded. Ranking and final voting use authorized eligible Yes/Maybe users only. Can't and unanswered invitees do not count as finished. At the default 100% threshold, automatic completion waits while invitations remain unanswered, even if every current eligible user finished. It also keeps a host-only default round open so friends can be invited after creation. Once at least two invitees exist and all have responded or lost access, existing completion calculations apply to the eligible respondents. Declines do not block that calculation.

Explicit thresholds below 100% compare completed eligible users against eligible users plus unanswered invitations; they may close before every invitation is answered when that percentage is met. This retains Mike’s 8edfff8 correction and avoids premature host-only closure. An authorized host can manually close without waiting. A reached deadline also permits canonical closure with unanswered invitations. No deadline stores null and remains manually closable. Revocation that leaves zero eligible respondents immediately cancels the scheduled swiping round under its row lock, including No deadline rounds. It never generates a winner or opens final voting. These rules are explained in the host participation view.

The finished-swiping screen reflects the response window and links back to participation/invites, including after the host finishes their own deck.

The final cohort freezes **at swipe closure**, atomically with canonical ranking/final-vote application. It consists of currently authorized Yes/Maybe respondents, including those with partial or no swipes, matching ordinary manual/deadline closure participation. Completion is not an additional final-vote requirement. Late responses cannot expand the locked cohort. Existing ranking, missing-answer handling, finalist selection, tie rules, vote deadlines, winner persistence and cancellation stay canonical.

## Server enforcement and races

Authenticated APIs derive the actor, validate response/revision and reject actor spoofing. SQL independently enforces current invitation/group/block access, stage, deadline, confirmed response, first-swipe response lock and final cohort. Response/cohort tables have no authenticated writes; mutation RPCs remain service-only. Candidate RLS hides decks from ineligible invitees. Preference and final-ballot triggers protect direct service RPC paths as well as the HTTP routes. Snapshot and progress filters use eligible IDs before closure and frozen authorized IDs afterward; observer authorization still uses the roster. Ordinary Pick permissions are unchanged.

All relevant mutations serialize on the Pick row. Responses/preferences bump its version. Closure checks the expected version, freezes IDs, then passes the resulting version into the existing canonical close writer in the same transaction. Failed ranking rolls back the freeze. Snapshot conflicts retry from fresh state. Deterministic two-connection tests cover close↔Yes ordering, deadline versus Maybe, first swipe↔Can't ordering, concurrent manual/automatic close, cancellation, revocation and duplicate initialization. UI tests cover deferred confirmation, failed/unmounted responses and closure reconciliation. Existing account-switch, mutation-ordering and privacy tests remain.

## Time and results

The original proposal is fixed throughout the decision. The old proposed-time endpoint now rejects active edits; revision checks remain for stale availability submissions. Results show the original proposal separately from the authoritative plan time. Existing host-only post-result scheduling is restored. Changing the authoritative time clears scheduled-Pick final RSVPs so participants must reconfirm; it does not overwrite the original proposal, restart voting, alter the winner, or create/delete actual attendance outcomes. Availability, final plan RSVP and post-event attendance remain separate. Past Moves still require actual attendance confirmation.

## Migration inventory and compatibility

Historical main migrations 0001–0040 are untouched. Branch-specific `0041_availability_first_picks.sql` is preserved; additive **`0042_immediate_availability.sql`** implements this revision. Although 0041 is unique to the unmerged branch and previous notes said undeployed, application to every shared environment could not be independently verified. The brief explicitly requires additive history when uncertain. Apply 0041, 0042, then **0043_empty_scheduled_rounds.sql** after main’s migrations. 0043 is additive; 0041/0042 and Mike’s fixes remain unchanged. 0042 backfills started status from preferences, unlocks only previously swiping scheduled cohorts for dynamic participation, and retains already finalized cohorts. Existing ordinary records have null proposed time and preserve their behavior.

`ENABLE_AVAILABILITY_PICKS` still defaults off. Capability discovery requires `availabilityFirst: true` and `availabilityMode: 'immediate'`; the client uses the existing `X-Client-Info` header with `availability-v2`. This prevents a v2 client silently creating the old waiting flow or an unscheduled Pick against an older backend. Older clients cannot bypass scheduled read/start/swipe/vote restrictions by ignoring the UI. Scheduled creation must remain disabled until compatible clients are available; do not assume simultaneous TestFlight upgrades. Ordinary Picks do not gain capability requests.

Hang-derived Picks remain unscheduled under this feature: no unnecessary availability reconfirmation. Existing conversion, draft reuse, participant checks, category/location prefill, cancellation/expiry and host re-entry are retained. Converted Hang feed visibility and RSVP-until-expiry behavior from 5793246 remain covered by existing regression suites.

## Validation and release gates

Validation was run with local Node 23.11.0 (Node 22 was unavailable), Expo 57.0.25, React Native 0.86.3 and TypeScript 6.0.3. Installed versions match package-lock; no dependency/lockfile changes. A separate git-archive source copy overlaid with this revision excludes ignored `.expo` and `expo-env.d.ts`, using the lockfile-matching installed dependencies. This is clean-source TypeScript validation, not a fresh Node-22 `npm ci` run.

Validation completed for the final lifecycle revision:

- Local TypeScript, clean-source TypeScript without `.expo`/`expo-env.d.ts`, and ESLint passed.
- Focused Jest: 4 suites / 73 tests; full Jest: 193 suites / 1,623 tests passed.
- Deno entrypoint check and all 152 API test executions passed.
- Fresh isolated PostgreSQL migration application; all 43 SQL files / 750 assertions passed.
- All 16 deterministic two-connection scenarios passed, retaining the original nine plus concurrent last declines and both orderings of removal versus manual/deadline closure and Yes responses.
- A separate pre-0043 stranded-round reproduction remained swiping before migration and was repaired to canceled by 0043.
- Android and iOS exports passed; outputs `/tmp/wtw-final72-android` and `/tmp/wtw-final72-ios`.
- Working-tree and staged diff checks passed; nothing staged by this revision.

Logs and SQL assertion details are outside the repository under `/tmp/wtw-final72-*`. Local migrations were applied from scratch to disposable PostgreSQL 14 with actual pgTAP. All SQL/RLS tests run there; the harness supplies Auth/Storage schema and inert cron/net/vault stubs, omitting only unavailable extension installation in temporary copies. Repository migrations are not patched for the harness.

**Release gates:** Docker is unavailable, so the full Supabase-container/Edge Function integration environment cannot run locally. Isolated PostgreSQL is not equivalent to Supabase Auth, PostgREST, Storage protection, realtime, or actual scheduled jobs. CI's full integration job must pass, including Node-22 clean install, before approval. Native simulator/device tools are unavailable; test VoiceOver/TalkBack, compact layouts, real invitation notifications/deep links, offline/retry, account switching, background deadline transitions, response/close races and post-result reconfirmation on iOS and Android. Exports verify bundling, not native interaction.

## Rollout order and readiness

1. Review the migration and product rules, especially first-swipe response locking and default completion waits.
2. Pass Node-22 CI and full local Supabase integration, including ordinary/Hang regression and scheduler tests.
3. Apply 0041, 0042, then 0043 through the approved release process; deploy matching backend with creation **off**.
4. Verify ordinary/Hang behavior, capability response, RPC grants, RLS and historical data handling.
5. Distribute compatible clients and complete native QA.
6. Only after separate approval, enable staged scheduled creation and monitor failures/closure.

Ready to commit and push **for review** after the validation below; not release-ready until the listed gates pass. No commit/push or remote action was performed.

## Complete PR file inventory versus main

This includes retained original PR 2 files and this revision's additions; it is not limited to the current uncommitted diff.

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
- `supabase/functions/_shared/api/closing.ts`
- `supabase/functions/_shared/api/groups.ts`
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
- `supabase/migrations/0042_immediate_availability.sql`
- `supabase/tests/availability_first_test.sql`
- `tests/availability.test.ts`
- `tests/closing.test.ts`
- `tests/components/AvailabilityLobby.test.tsx`
- `tests/components/NewPick.test.tsx`
- `tests/db/availability_concurrency.py`
- `tests/lib/availabilityFlow.test.ts`

## Final empty-round lifecycle correction

Root cause: the last-eligible decline guard only governs response mutations. A legitimate group removal, block, Pick roster removal or account deletion could still remove the last eligible voter. Both application closure and SQL freeze then refused to rank an empty cohort, leaving an active round past its deadline.

Chosen recovery: **immediate cancellation on participant deletion while a scheduled Pick is swiping and no authorized Yes/Maybe users remain**. Waiting for a deadline leaves No deadline rounds stranded, so the trigger is safer and requires no new public endpoint or state. It locks the parent Pick, checks the current authorized eligible IDs after deletion, and persists the existing `canceled` state and `cancel_reason`. Terminal or unscheduled Picks are untouched. Historical results and existing cancellation reasons are preserved. The migration locks and repairs pre-existing empty scheduled swipe rounds as well.

Authorization is unchanged: clients cannot write the participant table; removal still requires the existing authorized server operation. The trigger is security-definer with an empty search path and no public/anon/authenticated execution grant. It does not make an unauthorized caller able to cancel a Pick. Response, closure and removal serialize on the same Pick lock, and roster changes bump its version. Revocation-first cancels and rejects late Yes/closure; confirmed-Yes-first can preserve a legitimate remaining voter. Closure-first retains the canonical final-vote result and its existing revocation/deadline rules rather than retroactively canceling finalized ranking. Cancellation discovered during an application close retry now returns a safe no-op instead of a fabricated final-vote result or winner notification. Ordinary already-canceled host-close behavior remains unchanged.

The exact regression SQL covers host Yes → friend Yes → host Can't → canonical group removal → canceled state retained after the deadline, with no winner, final cohort, or ballots. It also covers direct removal with No deadline, blocking, surviving eligible users, ordinary Picks, completed history, repeated removal, preserved cancellation reason and late-response rejection. Fresh migrations and a separate backfill check cover already-stranded data.

Downstream effects reuse existing cancellation paths: canceled Picks leave the active Home set and appear as canceled history; lifecycle routing shows the canceled view, never results. Its wording is neutral for automatic cancellations. Deadline, reminder and plan jobs use existing state filters and no longer select the canceled swipe round. Canonical background cancellations do not emit host-cancel push notifications; this follows existing group-revocation and expired-coordinate cancellation behavior. No winner/vote notification is sent by the racing closer. Account, Hang conversion, and ordinary Pick semantics stay intact.

Final revision files: `0043_empty_scheduled_rounds.sql`, `closing.ts`, mock `store.ts`, canceled Pick `index.tsx`, `empty_scheduled_rounds_test.sql`, `closing.test.ts`, `availability_concurrency.py`, this report, and `docs/pr-72-description.md`. These extend the retained complete inventory above.

The corrected, ready-to-paste PR description is in [pr-72-description.md](pr-72-description.md). It has not been posted to GitHub. The confirmed lifecycle merge blocker is fixed locally and ready for review/approval subject to green CI and the documented Supabase/native release gates. Feature creation remains off; no remote operation was performed.
