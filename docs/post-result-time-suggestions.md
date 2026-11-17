# Post-result time suggestions (PR 3)

Completed scheduled Picks can show participant time suggestions below the existing plan. The native editor reuses PlanTimeSheet, with the current authoritative time, Cancel/Submit, timezone-aware future-time validation and an explanation that submission does not reschedule anything. Unscheduled Picks retain their existing controls. No pre-swipe stage, ranking, winner, availability cohort, attendance model, provider calls or dependencies change.

## Data and API

Migration 0046 adds `pick_time_suggestions`: Pick/proposer foreign keys, proposed timestamp, base schedule revision, status and creation time. Rows cascade with the Pick or proposer account. Status is pending, accepted, withdrawn or superseded; expired pending rows are presented as expired. One pending row per proposer is allowed. Another proposal supersedes that person's pending row. Same instant/revision submissions return the original row, even across authors; withdrawn/superseded rows are never resurrected. At most 100 rows per revision are accepted. The existing `suggestions` array remains compatible: all visible actionable pending rows for the current revision come first, followed by at most 50 visible historical rows. Each section orders by creation time descending, then ID ascending. History includes accepted, withdrawn, superseded and expired proposals. The two sets are disjoint, so no row is duplicated. Active proposals are never displaced by history; old history beyond the limit is not paginated. The pending set is bounded by both the existing 30-person roster cap/one-pending-per-proposer constraint and the 100-row current-revision mutation cap; the response is at most 150 rows even if the roster cap later increases. No new endpoint or UI flow is added.

Authenticated endpoints:

- GET `/picks/:id/time-suggestions` loads current time, revision, host permission and visible suggestions.
- POST `/picks/:id/time-suggestions` accepts `{planAt, revision}`.
- POST `/picks/:id/time-suggestions/:suggestionId/accept` or `/withdraw` accepts `{revision}`.

They use service-only `pick_time_suggestions_load`, `pick_time_suggest`, and `pick_time_suggestion_act` RPCs. Actor identity comes from authentication, never request JSON. Proposed times require an explicit timezone, must differ from the current time and be within the next 30 days. Only the proposer withdraws; only the current host accepts. RLS permits authorized reads and no direct authenticated writes. API projections expose display names rather than private profile fields.

## Atomicity and authorization

Mutations lock the Pick before the suggestion and compare the displayed schedule revision. Acceptance calls canonical `pick_set_plan_time` in the same transaction, preserving its five-change limit, resetting reminders and clearing final RSVPs. Winner, ranking, swipes, final votes, original availability and frozen cohort remain unchanged. A plan-time trigger increments the revision and supersedes pending suggestions, including direct host rescheduling. Retrying an accepted operation succeeds only while that accepted time/revision remains authoritative. A stale suggestion cannot overwrite a newer schedule.

Current roster, current group membership and host blocking are checked independently of completed-history access. Revocation triggers serialize group removal and host blocking with completed scheduled Pick writes and supersede affected pending proposals. Notifications recheck current authorization and revision after mutation. A removal that wins the lock prevents acceptance; an acceptance that wins commits before removal. Cancellation and deleted/unauthorized Picks reject mutations.

Historical group provenance needs conservative handling: existing hosted Picks with a group are marked group-required; new nongroup Picks have known nongroup provenance. Existing group-less history cannot prove whether its group was previously deleted, so its nullable provenance fails closed for this new suggestion feature. Existing host scheduling and revision-aware RSVP remain available there. A later group deletion never turns a known group Pick into a nongroup scheduling permission. Any backfill of ambiguous legacy provenance requires an independently verified source.

The 0046 backfill explicitly excludes hostless rows. Such Picks cannot use suggestion scheduling because authorization requires a current host; updating their provenance has no product benefit and conflicts with main's historical immutability guard. Their provenance remains unknown, and their rows (including version and timestamps), results, votes, RSVPs and attendance remain untouched. The hostless guard stays enabled throughout migration. No historical migration, host assignment or historical authorization rule changes.

## RSVP compatibility

Scheduled plan projections include `scheduleRevision`. PlanBlock captures the displayed revision when choosing an RSVP and sends it with the existing RSVP mutation. The four-argument RPC compares it under the Pick lock. A response racing acceptance either precedes the clearing transaction or is rejected as stale afterward. Updated API enforcement requires revisions on scheduled RSVP writes when the feature is enabled.

The legacy three-argument RPC remains usable for ordinary Picks and initially scheduled plans, but rejects scheduled plans after any reschedule. This persists when the feature flag is disabled, preventing old requests from silently reconfirming a changed time. **Older clients must update to RSVP again after scheduled rescheduling.** Deploy compatible clients before enabling suggestions; account for this compatibility restriction when deploying the migration itself. No independent RSVP store is added.

Older clients can still read current results, event times and RSVP counts after refreshing; additive suggestion/revision fields can be ignored. Their cached/offline view may remain stale until refresh. With the flag off, unversioned RSVP writes to initially scheduled plans and ordinary Picks retain their old behavior, but scheduled reschedules are always protected. With the flag on, the API requires versioned writes for all scheduled plans, including their initial time. Ordinary Picks remain unaffected. The server cannot safely infer which time an unversioned client saw, so accepting that write would weaken reconfirmation. A revision-capable client is therefore required for scheduled RSVP participation at rollout; this PR adds no blanket minimum-version gate. The legacy RPC returns an explicit “Update WTW and RSVP again” error after rescheduling; old client reconciliation may replace that with generic failure copy. There is no new automatic store link or forced-update prompt. Before migration deployment, release owners must distribute compatible TestFlight/production clients and establish the update communication/prompt policy for remaining older versions. Before enabling the flag, verify versioned RSVP adoption; flag-off alone does not prevent the migration's compatibility restriction after direct host rescheduling.

## Client isolation and refresh

The existing `/picks/capabilities` response advertises `timeSuggestions: true` only when `ENABLE_TIME_SUGGESTIONS=true`; the default is off. The existing availability flag remains independent. Missing/older capabilities hide the new control. The results component additionally requires server plan eligibility. Requests use existing viewer-scoped API conventions. A Pick/viewer-keyed component, mounted/request generations and private refresh cleanup reject delayed responses after navigation, backgrounding or account changes. Foreground/focus refresh and 30-second polling reconcile current proposals; an authoritative plan/revision change closes an old editor. Synchronous write guards prevent duplicate taps. Server versioning remains authoritative for every mutation.

## Notifications

New proposals notify only the authorized host using generic `time_suggested` copy. Acceptance reuses `plan_time_set`, with reconfirmation text and authorized participant recipients. Payloads contain IDs and a reconfirmation marker, without proposed dates or names. A unique recipient/event index deduplicates retries; current status/revision checks suppress delayed obsolete events. Existing notification wrappers for groups and direct messages are preserved. Opening a notification reconciles current server state. Delivery is best effort and cannot roll back scheduling; process failure between commit and notification can lose a notice, as with the existing pipeline. No durable outbox is introduced.

## Migration and rollout

The audited main tip was `9aeeafc9f7e6584b16d2a1cfbe1547521ebe8a4c`. Parallel PRs reserve 0044 (taste learning, PR 75) and 0045 (photo limits, PR 71); this change uses 0046 and modifies no historical migration. Both the current branch chain and a compatibility chain containing those parallel migration snapshots were tested in disposable PostgreSQL databases. Those snapshots are not incorporated into this branch and are not endorsements of those PRs. Recheck actual merged upstream migrations and ordering before deployment; do not ship 0046 ahead of reserved migrations without migration-order review.

Release sequence: review migration compatibility and old-client RSVP policy; distribute compatible clients and establish older-client update communication; deploy the database and API with the flag off; pass hosted Supabase integration and native-device QA and verify versioned RSVP adoption; enable the flag through a separately approved rollout. Turning off the API flag hides/rejects suggestions, preserves stored history, and retains stale-RSVP protection. No remote migration or deployment was performed here.

## Validation and remaining gates

Local validation passed TypeScript, clean-source TypeScript, ESLint, focused Jest and full Jest (197 suites / 1,676 tests), Deno check and tests (158 executions), Android/iOS exports and whitespace checks. PostgreSQL ran the entire branch migration chain and a parallel-migration compatibility chain: each passed 45 SQL files / 818 assertions. New two-connection tests passed 17 scenarios on each chain; the existing 16 availability concurrency scenarios also passed. Tests cover deduplication, competing accepts, withdraw/accept, direct rescheduling, stale RSVP, cancellation, real group removal and host blocking, RLS and result/history preservation.

The historical upgrade regression lives in `tests/db/time_suggestions_upgrade.py` and its SQL fixture. It requires an empty disposable local database with Supabase service schemas, constructs every repository migration before 0046, optionally adds the reserved 0044/0045 snapshots, and then applies the actual 0046 after supported auth-account deletion has produced a completed hostless grouped Pick. Assertions compare historical records before/after, including nonempty surviving swipes, votes, RSVP and attendance; they verify hosted group backfill, ambiguous legacy provenance, new nongroup defaults, results readability and retained hostless mutation denial. The fixture and migration roll back together. Both supported chains passed.

Example (full Supabase service schemas must already exist in the empty local database):

```sh
python3 tests/db/time_suggestions_upgrade.py --dsn '<empty disposable local database DSN>'
# Compatibility chain: add --parallel-migration /path/0044_taste_learning.sql
# and --parallel-migration /path/0045_discover_photo_limit.sql.
```

For isolated PostgreSQL only, `--isolated-bootstrap` accepts a local auth/storage/service-stub harness and omits 0007's unavailable extension installations. This mode is explicitly not a hosted Supabase substitute. The runner refuses a database that already has `public.picks` or a nonlocal DSN.

`time_suggestions_listing_test.sql` covers the exact older-pending/50-newer regression, history overflow, deterministic order, deduplication, owner withdrawal, host acceptance, no-pending history, all pending proposals at the real roster cap, outsider/blocked reads, RLS and cancellation. Component tests cover an older returned proposal's accept action, a synthetic 51-pending/50-history response, and delayed listing replacement across accounts. Existing concurrency tests retain both acceptance/withdrawal orderings, stale RSVP and revocation checks. No production participant cap or authorization is bypassed for these tests.

Local PostgreSQL 14 uses real pgTAP with minimal auth/storage/cron/network stubs. Docker/full Supabase was unavailable; this does not exercise hosted PostgREST schema resolution, actual push delivery or live Auth/Edge integration. Local Node was 23 rather than CI's 22. CI and a real Supabase environment remain release gates.

Native QA: test iOS and Android date/time picker dismissal, screen reader labels/focus, small screens and large text, DST/timezone changes, background/foreground refresh, two-account switching, concurrent host/participant devices, stale offline submissions, notification taps and RSVP reconfirmation. Exports validate bundling, not native interaction.
