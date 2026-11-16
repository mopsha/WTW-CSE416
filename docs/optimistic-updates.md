# Phase 4 — Optimistic updates and Undo

## Baseline and candidate audit

Branch `josh/optimistic-updates` began clean at `6f08275`, matching local
`origin/main` and the GitHub main ref verified with `git ls-remote`. Phases 1–3
and the Phase 3 review fixes are retained.

| Interaction                                                                          | Existing behavior                                                                                                     | Classification / decision                                                                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Discover bookmark and Discover detail save/remove                                    | Separate saved-ID reads and server-confirmed buttons; no optimistic state                                             | Safe with per-item ordering, shared ownership and reconciliation; implemented                                     |
| Profile favorites                                                                    | `favoriteCuisine` / `favoriteActivity` are profile metadata, not a saved-place collection; edited in the profile form | Retain server-confirmed form save; do not conflate these fields with saved places                                 |
| Swipe PlaceDetailsSheet                                                              | Photos/details/answer controls, no personal favorite mutation                                                         | No speculative save control added                                                                                 |
| Hang responses                                                                       | `respondHang` waits, then refreshes the feed; Down/Maybe/Can't, one global busy flag                                  | Safe only with eligibility, per-post serialization and authoritative counts; implemented                          |
| Pick plan RSVPs                                                                      | `useAction` waits for `rsvp`, then `getPlan`; Going/Maybe/Can't                                                       | Safe only on completed/decided plans with correct delta projection and reconciliation; implemented                |
| Group Ideas                                                                          | Shared create/edit/remove and inclusion settings; author/owner permissions; save followed by authoritative reload     | Defer optimistic shared edits/deletion: affects other participants and requires reliable shared ordering/rollback |
| Safety, account, relationship, membership, privacy, media and Pick lifecycle actions | Guarded server-confirmed operations                                                                                   | Remain server-confirmed                                                                                           |

Existing architecture uses `useAction` for duplicate suppression and errors,
`usePrivateRefresh` for focus/foreground polling and clearing, keyed account/entity
components, and generation guards for reads. `ActivityToast` is passive
(`pointerEvents="none"`) and carries Pick activity, not actionable personal Undo.
No existing saved-place or RSVP optimistic implementation was found.

## Implementation and ordering

`OptimisticChoice<T,S>` is a small mounted-owner/entity controller, not a global
application store. It tracks confirmed state, latest desired choice, pending and
uncertain status, intent version, read ordering stamp and lifecycle epoch. A single
write runs per entity. Further taps change the projection immediately and coalesce
into the latest desired value. The next write starts only after the previous write
and any required reconciliation. Returning to an already-confirmed value avoids an
unnecessary write. The only module-wide state is a scalar ordering clock, with no
account, entity, provider or private data.

`SavedChoices` owns one controller per place ID inside the keyed Discover feed.
The feed and its detail modal observe the same controllers. FlatList receives an
explicit external-store revision and immutable row projections so its PureComponent
and React Compiler caches cannot leave stale bookmark icons. No Google content is
persisted in this helper: only saved IDs and booleans are retained in memory.
The existing server uniqueness and authorization constraints are unchanged.

RSVP projection changes only the viewer's contribution: subtract the previous
response once, add the desired response once. A server snapshot already containing
that response is not adjusted again. A successful RSVP write is followed by an
owner-scoped `getPlan` or `getHang`; its complete counts replace the baseline.
Read-start stamps prevent an older post-write read from overwriting a newer
participant snapshot. Other participants' totals are never derived from our local
intent. An older acknowledgement cannot replace a newer desired response.

The Pick summary endpoint uses `completed` in the database and `decided` in the
existing mock domain, so both existing completed-state representations are accepted.
Canceled/uncompleted Pick plans are ineligible. Hang expiry and existing `pickId`
conversion block speculative responses. The backend still checks membership,
blocks, expiry, uniqueness and event state atomically. Pending/unconfirmed Down
counts cannot enable creation of a Pick; Pick creation and winner selection remain
server-confirmed. Other PlanBlock actions keep their Phase 1 guards.

## Failure, refresh and authorization

- A definitive 4xx rejection rolls back the failed latest intent to the current
  confirmed state and shows an accessible existing ErrorState/ErrorBanner. An old
  failure cannot roll back a newer intent. Users can tap again after rollback.
- Network errors, timeouts, 5xx errors and lifecycle conflicts (409) trigger an
  authoritative read rather than assuming rejection. If the read confirms the
  desired response, that becomes the baseline. Otherwise the reconciled state is
  displayed with feedback that the change was not saved.
- If reconciliation also fails, the item is marked uncertain, the speculative
  overlay and queued intent are removed, and further writes require a successful
  refresh. Feedback explicitly says the change could not be confirmed.
- 401/403/404 and structured permission failures clear protected projections and
  queued work. A saved-place denial clears the entire saved scope and Undo.
- Fresh participant snapshots while pending rebase the optimistic delta. Reads
  started before a newer intent/settlement cannot overwrite that baseline. A failed
  Hang poll retains its original snapshot stamp instead of advertising stale data
  as fresh authority.
- Pick and Hang retain their existing 30-second refresh cadence. Saved places use
  focus, foreground and the existing retry trigger without a new polling loop;
  `usePrivateRefresh(..., null)` opts out of its timer while retaining lifecycle
  handling. No subscriptions or Google provider calls were added.
- Existing Supabase Pick realtime subscribes to `picks` and `pick_participants`;
  there is no existing saved-place or RSVP-count realtime channel to extend. Existing
  realtime/navigation paths remain unchanged. Fresh authoritative snapshots, rather
  than raw socket count deltas, are the reconciliation input; tests exercise these
  arriving while writes are pending.
- Account/entity keys dispose old controllers. Blur/background clears protected
  projections and Undo, discards queued work and prevents late restoration. A sent
  request can still finish on the server; foreground revalidation waits for a
  previously sent same-scope mutation before reading. Unmount stops follow-up reads
  and queued writes. React Strict Mode effect replay revalidates rather than reviving
  a disposed draft. Backgrounding leaves the existing Hang composer draft intact;
  an account switch still unmounts it.

The ordinary client previously acquired whichever token was current when a request
was dispatched. The affected read/write methods now accept an optional expected
viewer. They check the session identity and capture that account's token; an old
queue cannot borrow a replacement account's token. Existing unscoped callers remain
compatible. This is client-side protection only: server paths, request bodies,
contracts, schemas and authorization are unchanged.

## Undo and feedback

Saved-place removal has one reusable, static, actionable banner. While pending it
says “Removing saved place…”; only after server confirmation does it say “Saved
place removed.” Undo is a labelled Button with existing minimum targets and a single
kit haptic. It runs through the same queue, so Undo during DELETE becomes a serialized
compensating POST (or coalesces if no compensation is needed). Restoration failures
roll back or reconcile just like the original mutation; they do not leave a fake
local success.

There is at most one banner. New actions replace it; tokens invalidate older callbacks.
Opening/closing details, changing filters/search/sort, losing focus, backgrounding,
unmounting, logout and account changes invalidate the old context. Failed or uncertain
removals do not advertise Undo. The action lasts at least six seconds and uses the OS
recommended accessibility timeout. Keyboard avoidance and bottom/side safe areas are
built in. Static presentation respects reduced motion and cannot cover attribution
or other actions as an overlay. No toast library or competing toast stack was added.

Favorite icons and RSVP selections stay visible while requests are pending; no
pending spinner replaces the new optimistic selection. Existing haptics remain in
UI controls rather than being duplicated in the controller.

## Regression coverage and validation

New deterministic deferred-promise tests cover rapid/coalesced choices, serial
compensation, immediate shared card/detail state, authoritative RSVP counts,
Maybe→Going/Down adjustments, no double-counting, old reads/acknowledgements,
participant snapshots while pending, failure rollback, ambiguous reconciliation,
uncertainty, lifecycle cancellation/deletion, permission loss, account switching,
unmount/background clearing, Strict Mode replay, Undo failures/replacement/expiry,
scoped API identity checks, accessible Undo and timer/animation boundaries.
Existing regression tests are retained; the same-choice RSVP assertion now checks
that an already-selected value sends no duplicate request.

Final validation passed:

- TypeScript: `npm run typecheck`.
- ESLint: `npm run lint`, no warnings.
- Focused Jest: 10 suites / 95 tests, including queue, saved choices, scoped API,
  RSVP, Undo, Discover, Pick Winner, Hang composer/invitation and polling cleanup.
- Full Jest: 186 suites / 1,533 tests.
- Android export: `/tmp/wtw-phase4-android/`.
- iOS export: `/tmp/wtw-phase4-ios/`.
- Working-tree and staged `git diff --check`.
- No unresolved files, conflict markers or deleted regression tests.
- No Deno/SQL/server API run was needed: server contracts, routes, migrations and
  backend code are unchanged. Client API ownership tests passed.

Ready for review, commit and push, with the native/slow-network QA below outstanding.

## Remaining QA and boundaries

Native-device and slow-network QA remains: actual VoiceOver/TalkBack announcements
and Undo reachability/timeouts, keyboard and safe-area positioning in the feed and
modal, rapid taps with real latency, airplane mode, lost acknowledgements, reconnect,
background/foreground, sign-out/account switching and a second participant/device
changing responses. Jest and platform exports do not establish real offline,
screen-reader, gesture or haptic behavior. No offline write queue or cross-screen
persistent mutation store is introduced. A server operation already sent before
unmount cannot be recalled; the next owner-scoped read revalidates its result.

Group-wide optimistic edits, reversible safety/privacy changes, RSVP Undo and a
new saved-place profile collection are intentionally deferred. Existing profile
favorites are a different domain, not an inconsistent saved-place view.
No dependencies, migrations, backend changes, provider calls, realtime subscriptions,
branding, identifiers or authentication-provider changes were introduced.
Nothing was committed, pushed, merged, rebased, release-built, submitted or deployed.

## Complete file inventory

- `app/(tabs)/discover.tsx`
- `app/pick/[id]/winner.tsx`
- `docs/optimistic-updates.md`
- `src/components/Chips.tsx`
- `src/components/HangCard.tsx`
- `src/components/PlanBlock.tsx`
- `src/components/UndoFeedback.tsx`
- `src/components/picks/HangInvitation.tsx`
- `src/hooks/useOptimisticChoice.ts`
- `src/hooks/usePrivateRefresh.ts`
- `src/hooks/useSavedChoices.ts`
- `src/lib/api.ts`
- `src/lib/optimisticChoice.ts`
- `src/lib/optimisticRsvp.ts`
- `src/lib/savedChoices.ts`
- `tests/components/Discover.test.tsx`
- `tests/components/OptimisticRsvp.test.tsx`
- `tests/components/PickWinner.test.tsx`
- `tests/components/UndoFeedback.test.tsx`
- `tests/components/planPollingCleanup.test.tsx`
- `tests/lib/optimisticAccountApi.test.ts`
- `tests/lib/optimisticChoice.test.ts`
- `tests/lib/savedChoices.test.ts`
