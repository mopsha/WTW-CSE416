# Final visual density polish

## Baseline and scope

`josh/visual-density-polish` began clean at `30ad2da`, matching local `origin/main`
and GitHub main verified with `git ls-remote`. All four UX phases and the converted
Hang eligibility correction are present. Expo SDK 57 / React Native 0.86 docs were
checked before layout edits.

This change touches six presentation files. Shared spacing/type/theme tokens,
buttons, safe-area components, skeleton layouts, navigation architecture, mutations,
queries, privacy/authorization guards, request ordering, provider settings and data
contracts are unchanged. No dependencies, assets, app configuration or backend
files changed.

## Before and after

| Area                    | Confirmed issue                                                                                            | Refinement                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home empty active Picks | Generic QuietEmpty uses a large icon and 32pt vertical padding per side below an existing primary CTA      | Local compact calendar/text row with small token padding, title and “Start one above or join with a code.” No duplicate CTA; active panels and skeletons unchanged  |
| Home order              | Group shortcuts appeared before social Hang planning                                                       | Hero/actions → active Picks or compact empty row → Who’s down / Make a hang plan → Your groups → Recent History                                                     |
| Recent History          | Completed and canceled titles had the same emphasis; category fallback appeared in both title and subtitle | Existing muted ListRow styling for canceled rows; omit subtitle category only when already supplied by the actual displayed title; status/date remain               |
| Friends Requests        | A 56pt row even when count is zero and no loading/error is shown                                           | Idle-only platform minimum target (44pt iOS / 48dp Android); pending/loading/error presentation and navigation retained                                             |
| Own-profile Past Moves  | Text-heavy empty card with 136pt minimum height and 32pt vertical padding                                  | Small existing icon, “Your memories start here.” and concise confirmed-attendance explanation; content-driven height, no minimum; body retains 14pt/21pt typography |
| Profile settings gap    | Additional 24pt top margin plus section padding and screen gap after Past Moves                            | Local 4pt top margin and reduced Past Moves section padding; shared Screen gap unchanged                                                                            |
| Discover header         | 12pt gaps between controls, with Sort occupying a separate row                                             | Local 8pt header gaps; Sort/Open Now/Filters share a compact wrapping toolbar with unchanged labels/actions                                                         |
| Discover coverage copy  | Longer explanation consumes extra header lines                                                             | “Search and sort cover a limited selection nearby.” Keeps both bounded coverage and nearby scope explicit                                                           |

Discover toolbar controls retain real minimum target height and width, bounded
maximum width, shrinkable text and natural multiline wrapping. Row wrapping provides
a fallback on small widths, larger text or longer active-filter labels. No ellipsis,
label abbreviation, fixed toolbar height or overlapping hitSlop was introduced.
The For You/Food/Activities category row, location/search, filter count/sheet,
Near campus sections and photo-card presentation remain intact.

History keeps its five-item limit, terminal-state selection, chronological and
microsecond tie ordering, fallback titles, existing live Google name resolution and
attribution. An actual resolved title is passed to the subtitle formatter so a
Google winner still retains its relevant Pick category. No provider requests were
added. Shared ListRow's existing muted token is used without lowering opacity.

Past Moves privacy, attendance semantics, populated cards, expansion and routing are
unchanged. The compact inviting state applies to the own-profile variant only;
other-profile empty/private explanations remain. The copy explicitly says confirmed
outings appear after answering “Did you go?” on a past Pick; completed Picks are not
presented as automatically becoming memories.

## States and regression review

- Empty/populated active Picks, hero, Start/Join, refresh and skeletons: existing
  tests retained; compact content and Home section order added.
- No/multiple groups and group Start/navigation: existing coverage retained.
- Active/converted Hangs, optimistic responses and counts: existing coverage retained;
  new host regression verifies an enabled Let’s Pick entry navigates with the same
  Hang ID and retains its existing draft ID. Existing mock Hang tests separately
  verify server draft reuse. No Hang eligibility or lifecycle code changed.
- Decided/canceled history: title emphasis, nonredundant type, status, date, row routes,
  full accessible names, See all, ordering and Google attribution tested.
- Requests: zero-count navigation, actual minimum geometry, pending counts, loading,
  errors and existing Friends/Groups/message/member actions covered.
- Past Moves: compact empty explanation, populated expansion and privacy revocation
  covered; existing Profile header/favorites/settings/account isolation retained.
- Discover: wrapping common toolbar, minimum targets, complete categories, Open Now,
  sort parameters, coverage limitation, active filters, empty results, loading and
  account changes covered. Existing optimistic favorite/Undo tests retained, as are
  attribution and skeleton tests.
- Long titles/names, large text and small widths were reviewed structurally: new
  empty-state copy can grow, toolbar wraps, labels shrink/wrap and no touch minimum
  was reduced. Existing accessible full names remain. Actual native geometry is not
  established by React renderer tests.

No global density reduction or redesign was attempted. The hero, active Pick cards,
Hang cards, group shortcuts, populated memories, profile identity header, card photos,
ratings/gradients/bookmarks and established font hierarchy remain unchanged. Further
card compression, new shared density abstractions and global typography changes were
intentionally deferred.

## Validation and native visual QA

Final validation passed:

- TypeScript: `npm run typecheck`.
- ESLint: `npm run lint`, no warnings.
- Focused Jest: 12 suites / 109 tests.
- Full Jest: 187 suites / 1,541 tests.
- Android export: `/tmp/wtw-density-android/`.
- iOS export: `/tmp/wtw-density-ios/`.
- Working-tree and staged `git diff --check`.
- No unresolved files or deleted regression tests. Backend tests were not needed:
  no backend files or contracts changed.

Ready for review, commit and push, with native visual QA still outstanding.

Native before/after screenshots could not be captured: `xcrun` exists but
`xcrun simctl list devices booted` reports that `simctl` is unavailable. No tooling
was installed and no native visual verification is claimed.

Remaining device QA: compare before/after Discover on small iOS/Android screens,
large Dynamic Type/font scaling and long sort/filter text; check one-row/wrapped
control states, tap boundaries and keyboard/safe areas. Inspect empty/populated Home,
converted host draft re-entry, several groups, zero/pending Requests, long profile/
restaurant/group names, private/empty/populated Past Moves, decided/canceled History,
and loading-to-content transitions. Confirm cards, attribution and Undo remain
reachable. Exports and Jest cannot replace these visual/device checks.

Nothing was committed, pushed, merged, rebased, release-built, submitted or deployed.

## Complete file inventory

- `app/(tabs)/discover.tsx`
- `app/(tabs)/index.tsx`
- `app/(tabs)/profile.tsx`
- `docs/visual-density-polish.md`
- `src/components/PastMoves.tsx`
- `src/components/friends/SocialRow.tsx`
- `src/lib/recentHistory.ts`
- `tests/components/Discover.test.tsx`
- `tests/components/OptimisticRsvp.test.tsx`
- `tests/components/PastMoves.test.tsx`
- `tests/components/PicksHome.test.tsx`
- `tests/components/RequestsDensity.test.tsx`
- `tests/lib/recentHistory.test.ts`
