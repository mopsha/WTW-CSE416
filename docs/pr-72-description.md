# Immediate swiping with availability gating

## Summary

Scheduled Picks begin swiping immediately after server-authoritative candidate initialization. The host starts as Yes; invitees can independently join after server-confirmed Yes or Maybe. Can't participants can follow read-only and see authorized results. There is no separate availability waiting stage or second host Start Swiping action. Decide later preserves ordinary unscheduled Picks.

## Lifecycle and eligibility

- Keep the optional When editor, existing candidate generation, Group Ideas, saved places, Custom options, navigation, authorization and account isolation.
- Yes/Maybe permits swipes only after server confirmation. Before the first swipe, availability may change freely; afterward Yes↔Maybe remains allowed and Can't is rejected without discarding answers. Attendance remains separate.
- Completion counts finished eligible users against Yes/Maybe plus unanswered invitations, with Can't excluded. Default completion waits for unanswered invitations; explicit thresholds, host manual closure and deadlines retain their documented paths.
- Freeze the final voting cohort atomically when swiping closes. Ranking/final voting use authorized Yes/Maybe respondents, including partial swipers, following existing manual/deadline semantics. Late responses cannot expand the frozen cohort.
- If membership/security revocation leaves a scheduled swipe round with zero eligible users, immediately cancel under the Pick lock. No winner or empty final vote is created. No deadline rounds also recover; existing stranded rounds are repaired by migration.
- Preserve converted Hang visibility, RSVP until expiry, Let's Pick draft reuse and unscheduled Hang-derived Pick behavior.

## Scheduling and results

The proposed time stays fixed throughout the active decision, including swiping. The winner and original proposal persist into results. Host rescheduling is supported after results and clears final plan RSVPs for reconfirmation without changing the winner or actual attendance outcomes. Participant-created time suggestions remain deferred; invitation copy truthfully says the group can revisit the time after deciding.

## Migrations and rollout

Apply 0041 → 0042 → 0043 after the existing main migrations. Historical migrations and the early-close, last-decline and SQL-fixture fixes remain intact. Server-only mutation RPCs, restrictive RLS, revision/version checks and transactional security revocation remain enforced.

Feature creation remains disabled through `ENABLE_AVAILABILITY_PICKS` until release gates pass and rollout is separately approved. Updated clients require the `availability-v2` capability and immediate-flow backend; older clients cannot bypass eligibility checks.

## Validation

- Local and clean-source TypeScript; ESLint.
- Focused Jest: 73 tests; full Jest: 193 suites / 1,623 tests.
- Deno check and 152 API test executions.
- Fresh isolated PostgreSQL migrations; 43 SQL files / 750 assertions.
- Sixteen deterministic concurrency scenarios, including removal/closure/Yes ordering; separate old-data migration repair check.
- Android and iOS exports; working-tree/staged diff checks.

SQL testing used an isolated PostgreSQL/pgTAP harness with Auth/Storage stubs, not full Supabase integration. Node 22 CI with a clean dependency install, the full Supabase-container/Edge Function integration job, and native multi-user/accessibility/offline/deep-link QA remain required gates. Local validation used Node 23.11.0.

Implementation details, complete retained PR inventory, recovery policy and rollout order: [docs/availability-first-picks.md](availability-first-picks.md).
