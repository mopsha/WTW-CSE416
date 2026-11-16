# New Pick creation redesign (PR 1)

## Scope and original flow audit

Branch: `josh/new-pick-redesign`, starting at `30ad2da`. Only the existing creation experience is redesigned. No availability stage, proposed outing time, pre-swipe RSVP, eligibility change, new lifecycle state, or backend work is included.

The original `app/pick/new.tsx` owned the entire form and built the request at submission. It showed category chips, conditional Custom option/template/mixing controls, location search and an inline map, participant context, then a collapsible More options card. The footer already stayed outside the ScrollView. More options contained saved places, Group Ideas, radius, price/Open Now, candidate count, swipe deadline, and early-close threshold. Category changes retained the other form values; Custom controls unmounted when leaving Custom. There was no persistent local form draft, autosave, or discard-confirmation flow.

Entry points audited: Home and Discover start `/pick/new`; groups use `newGroupPickRoute`; HangCard passes `hangId`/`hangActivity`; the finished-Pick entry can replace with `/pick/new`. Nongroup creation adds the creator and invites friends afterward in the existing lobby. There is no creation-screen friend selector to migrate. Group creation uses `createGroupPick(input, groupId)` and existing server membership rules. Home's code-join sheet, lobby QR/code/share/invite/lock controls, deep links, and auth guards remain untouched.

Hang conversion uses `hangPick(hangId, input)`, not the group/nongroup endpoints. Existing server adapters own authorization, eligible Down participants, draft reuse, and participant-set checks. The route defaults Hang creation to Activities and otherwise uses the same default location; it does not currently import Hang coordinates or scheduling. A participant goes to the returned lobby; a nonparticipant sees the existing “Pick created” completion. These behaviors are preserved.

Reviewed shared Screen, Button, IconButton, Chips, Sheet, theme, CustomPlanEditor, PlaceFilterControls, LocationSearch, both MapPicker implementations, motion preference, API adapters, shared validators, lifecycle candidate generation, Hang conversion, and existing tests. SDK 57 documentation and the Expo docs index were checked before implementation.

## Settings, defaults, and validation inventory

| Setting          | Existing default and supported UI values | Preserved rules                                                                                                                                        |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Category         | Food; Activities for a Hang              | `food`, `activities`, `both`, `custom`                                                                                                                 |
| Center           | SBU Academic Mall, `40.9126, -73.1234`   | Shared DEFAULT_CENTER; valid finite lat/lng; no automatic permission request                                                                           |
| Radius           | 2 mi                                     | 0.5–10 mi in 0.5-mi increments; `Math.round(mi * 1609.344)`; domain permits 200–50,000 m                                                               |
| Saved places     | false                                    | The acting host's eligible saved places inside the configured radius and filters; existing authorization/storage retained                              |
| Group Ideas      | false                                    | Only group entry without Hang; category matching and server membership checks retained; public-place filters do not filter coordinate-free Group Ideas |
| Maximum price    | -1 UI sentinel → null payload            | Any price, Free (0), $ (1), $$ (2), $$$ (3), $$$$ (4); existing maximum-price semantics                                                                |
| Open Now         | false                                    | Unknown hours excluded when on; unknown prices excluded when price filter on                                                                           |
| Number of places | 20                                       | Existing UI choices 10/15/20/25/30; domain 5–30 for ordinary Picks                                                                                     |
| Swipe deadline   | 60 min                                   | 30/60/180/1440 min or 0 → null; computed at each submit/retry tap; shared validation requires 5 min–7 days lead                                        |
| Close early      | 100%                                     | Existing UI choices 50/75/100%; domain integer 1–100%; server participant requirements unchanged                                                       |
| Custom options   | Two empty names                          | 2–20 options, trimmed names 1–60 characters, notes ≤200; existing optional coordinates and server clean-text filtering retained                        |
| Custom templates | None selected                            | Game night, Basketball, Cookout, Study session, House party, Movie night                                                                               |
| Custom mixing    | none                                     | Only my ideas, nearby Food, nearby Activities                                                                                                          |

Custom pool calculation is unchanged: 30 with applicable Group Ideas; otherwise option count when no mix/saves/Group Ideas; otherwise `max(20, option count)`. The ordinary candidate-count row remains hidden for Custom. Pure Custom hides irrelevant location/price controls; mixing or enabling saved places reveals them. Existing center/radius/filter values remain in the payload, including after category switches. No new location requirement or Google request is introduced.

Audit clarification: existing Custom validation permits repeated option **labels**. Candidate priority deduplicates existing place identities; typed options get distinct UUID identities. This PR preserves that behavior rather than adding an unrequested duplicate-name restriction. Invalid counts, names, notes, coordinates, domain values, Group Ideas context/slots, and pool capacity retain their existing validation.

## Redesigned layout and components

- Compact existing header, back navigation, and group/Hang context.
- “What are we doing?” category cards with existing Ionicons, coral selection border/check, and radio semantics. Two columns normally; one on narrow screens or large accessibility text. Labels wrap.
- Plan Details groups Where (committed label and radius, disclosure) and Who's joining (informational, without a chevron).
- Pick Settings groups direct saved/Group Ideas switches with current-value disclosures for filters, candidate count, swipe deadline, and early closing. Group Ideas keeps its matching/public-filter explanation.
- Existing coral **Create Pick** / flame footer remains outside the main ScrollView and within Screen's safe-area/keyboard handling.
- No More options container or persistent inline map. No nonfunctional When row.

New `NewPickControls.tsx` is creation-specific presentation, not a generic modal framework. Domain values and request assembly remain in the route. Shared kit defaults and component contracts are unchanged.

## Editors and draft semantics

`NewPickLocationEditor.tsx` uses RN's full-screen Modal with existing Screen, LocationSearch, MapPicker, Slider, Button, and motion preference. The map is outside ScrollView gestures. Portrait search and radius controls scroll independently; landscape places scrollable controls alongside the map. Expand/collapse remains available, with map height bounded to leave room for controls. The existing map implementation, pin coordinates, radius circle, provider attribution/legal UI, and web fallback are unchanged; no attribution-hiding props or covering overlays were added.

Opening mounts a draft from the latest committed center, label, and radius. Search, device location, map pin, and radius modify only that draft. **Use this location** commits all three values together. Cancel, Android hardware back, and accessibility escape discard the draft. Full-screen presentation has no backdrop or enabled swipe-to-dismiss gesture. Closing unmounts draft state; reopening starts from committed values. No decorative drag handle is present.

An explicit map selection replaces the local LocationSearch instance, invalidating old query/device-position callbacks and clearing superseded suggestions. Shared LocationSearch now invalidates its existing generation on cleanup, typing, selection, and device-location intent. Both search success/failure and device-location success/failure/finalization check the generation. Its 300-ms debounce and existing providers/messages remain. Mount/open/reopen does not request location permission; only **Use my location** does. Map choices do not replay an old search. Requests already sent cannot be canceled by these provider APIs, but their results cannot apply to a closed or replaced editor.

Place filters use the existing controls inside shared Sheet with a local price/Open Now draft. Apply filters commits; close/backdrop/hardware back/escape cancels through Sheet's existing close handling. Reopen resets from committed values. Candidate count, deadline, and early-close sheets are single-selection lists: tapping a choice commits and closes immediately. Merely dismissing changes nothing.

Editors are local only and perform no backend mutation. While creating, category cards, switches, and setting rows are disabled and editor opening is guarded by the synchronous submission lock. Custom callbacks also respect the lock. The existing request is server-confirmed; success navigation, failure display, retry, and relative-deadline timing are preserved.

Form ownership is keyed by account ID, group ID, and Hang ID. Switching context destroys private form/editor drafts and invalidates old form callbacks. An unmounted form ignores late mutation completion and does not navigate. No auth API or root routing policy changed.

## Accessibility and responsive behavior

Existing tokens, Poppins, MIN_TARGET, and kit controls are used. Category/choice rows expose radio selected states. Settings expose button labels plus value summaries; informational Who has no false button affordance. Native switches retain labels/states and creation-only wrappers reserve target space with vertical hit slop. Text values wrap; long group/location names are not ellipsized. Switch rows stack at narrow widths or large font scales.

Shared Sheet retains accessible headings, OS reduced-motion transitions, safe area, keyboard avoidance, scrolling, hardware-back/escape/backdrop handling, and dismissal guards. The location editor focuses its heading on show (DOM focus on web), uses the existing motion preference, and keeps confirmation outside scrolling content. Native focus return after modal dismissal still needs VoiceOver/TalkBack device QA.

The existing Fabric-safe error measurement/focus behavior was retained: a native component ref, never a numeric handle; one reveal per attempt; no replay after resizing; stale measurement callbacks ignored; one accessible validation alert; web anchor focus; fallback announcement when measurement fails. Errors formerly hidden in More options now appear by their grouped settings.

## Hang and prior-phase compatibility

No Hang eligibility code changed. `5793246`'s expiry-only `canRsvpHang` behavior remains: conversion does not hide a Hang or prevent RSVP before expiry. Existing host Let's Pick re-entry, canonical draft reuse, participant-set checks, and cancellation/expiry/authorization handling remain in their existing components/server adapters. The new screen still consumes an existing returned draft ID through the same lobby route, including nonparticipant completion.

No favorites, Undo, optimistic RSVP/count rollback/reconciliation, feed, shared navigation, or account-isolation implementation was changed. Existing regression suites remain included in full Jest. There are no optimistic Pick creations.

## Mandatory before/after payload comparison

`NewPickPayloads.test.tsx` runs the same UI-selection scenarios against the original route saved outside the repository and the redesigned route. Frozen time, mocked default center, complete payload equality, endpoint choice, argument order, and one mutation per scenario are asserted. This is not merely an assertion against a newly extracted payload builder.

Original source: `git show 30ad2da:app/pick/new.tsx` (saved to `/tmp/wtw-new-pick-before.tsx`). Original run:

```sh
WTW_BASELINE=/tmp/wtw-new-pick-before.tsx npx jest tests/components/NewPickPayloads.test.tsx --runInBand --modulePaths "$PWD/node_modules"
```

Redesigned run:

```sh
npx jest tests/components/NewPickPayloads.test.tsx --runInBand
```

Both runs pass all 14 scenarios: default Food, Activities, Food + Activities, Custom, group, nongroup, Hang, saves, Group Ideas, changed location/radius, price plus Open Now, changed deadline, No deadline, early-close threshold. Equivalent selections produce identical complete existing API payloads. No intentional request differences.

## Branch independence and file inventory

Inspected `HEAD...josh/visual-density-polish` without merging or cherry-picking. Its changed paths cover Home, Discover, Profile, PastMoves, Friends SocialRow, recentHistory, their tests, and documentation. None overlaps this implementation. Shared Sheet, Screen, Button, theme, MapPicker, CustomPlanEditor, and PlaceFilterControls were not modified.

Changed/new files:

1. `app/pick/new.tsx` — presentation, editor ownership, context/unmount guards; request assembly unchanged.
2. `src/components/NewPickControls.tsx` — creation-only category cards, grouped rows/switches, choice lists.
3. `src/components/NewPickLocationEditor.tsx` — local full-screen location/radius draft editor.
4. `src/components/LocationSearch.tsx` — narrowly necessary asynchronous ordering/unmount protection; public props and provider calls unchanged.
5. `tests/components/NewPick.test.tsx` — update structural drivers while retaining validation/measurement regressions; editor, payload, Custom, pending/retry, Hang, account/unmount, responsive and motion coverage.
6. `tests/components/NewPickLocationSearch.test.tsx` — debounce, permission denial/failure recovery, search selection/order, pin replacement, typing, unmount/late response, provider volume.
7. `tests/components/NewPickPayloads.test.tsx` — original/redesigned 14-case complete payload comparison.
8. `docs/new-pick-redesign.md` — audit, implementation, validation, limitations.

## Validation and remaining QA

Final checks:

| Check                                                                                                 | Result                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| TypeScript (`npm run typecheck`)                                                                      | Pass                                                          |
| ESLint (`npm run lint`)                                                                               | Pass, no warnings                                             |
| Focused Jest (creation UI/payload/search, create/Custom domain and mock flows, Hang, optimistic RSVP) | 10 suites, 103 tests pass                                     |
| Full Jest (`npx jest --runInBand`)                                                                    | 188 suites, 1,555 tests pass                                  |
| Before/after payload run                                                                              | 14/14 scenarios pass on each route                            |
| Android Expo export                                                                                   | Pass; `/tmp/wtw-new-pick-android`                             |
| iOS Expo export                                                                                       | Pass; `/tmp/wtw-new-pick-ios`                                 |
| Working-tree `git diff --check`                                                                       | Pass                                                          |
| Staged `git diff --cached --check`                                                                    | Pass; index remains empty                                     |
| Scope inventory                                                                                       | Eight expected files; no package/config/backend/asset changes |

Logs and exported bundles are outside the repository under `/tmp/wtw-new-pick-*`. Export is bundle validation, not a release/native build. Existing notification-module warnings in full Jest do not cause failures.

Native tooling check: `xcrun simctl list devices booted` fails because simctl is unavailable; `adb` is not installed. No native tooling was installed and no screenshots were fabricated. Automated component rendering and exports do not establish native visual correctness.

Remaining device QA: default/Activities/Custom layouts; each editor; long names and largest accessibility text; small phones and landscape; location permission recovery; map/search keyboard and gestures; attribution visibility; pin/radius expansion; sticky footer and bottom inset; VoiceOver/TalkBack focus entry/return and switch target behavior; reduced-motion modal transitions. Also smoke-test normal/group creation, Hang re-entry and nonparticipant completion on native.

No dependencies, Expo settings, branding, identifiers, schemas, migrations, backend files/contracts, authorization, provider implementations, or lifecycle semantics changed. Deno/SQL tests are not required for unchanged backend code; existing Jest backend/domain/mock regressions are included.

Deferred: availability-first Picks, suggested outing times, scheduling polls, and any new duplicate-name policy. Existing `PlanTimeSheet`, `src/lib/plans.ts`, native datetime-picker integration, HangPlanComposer, and post-result plan-time API remain untouched and may inform PR 2 after a separate contract review. Current post-result scheduling remains available.

## Readiness

Ready to commit and push for review, with the native-device QA above still outstanding. No known automated-validation blocker or intentional payload difference remains. Nothing has been staged, committed, pushed, merged, cherry-picked, rebased, deployed, submitted, or release-built. No new native dependency or native configuration change requires a new development build for this UI work.
