# Native interaction polish — Phase 3

## Baseline and scope

Branch `josh/native-interaction-polish` began clean at `697e6b6`, matching both
`origin/main` and GitHub's main ref verified with `git ls-remote`. Phase 1
(`f9566cd`), Phase 2 (`dbf1a33`), onboarding, Group Details, Discover Filters V2,
security hardening, Pick Results and branding are retained. No standalone original
UX audit document was found in the repository; the supplied Phase 3 audit items,
merged implementations and their regression tests were the audit inputs.

Expo SDK 57 and React Native 0.86 documentation were checked before edits.
No dependencies, backend contracts, provider requests, migrations, branding assets,
identifiers, auth providers or app configuration changed.

## Confirmed issues and fixes

| Finding                                                                                                                                  | Change                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google credit captions used 12pt hitSlop with only 8pt gaps, creating overlapping hit regions; long credits were not bounded             | Each link has a real platform minimum target, bounded wrapping width, distinct layout space and opacity feedback; no inflated hitSlop or truncation                                                             |
| Place Card photo-credit strings suppressed Google links                                                                                  | Show both photo credit and Google links in the same bounded credit area                                                                                                                                         |
| Place Details close and Place Card info affordances were 40pt                                                                            | Use the shared platform minimum: 44pt iOS, 48dp Android; shared controls also inherit the Android minimum                                                                                                       |
| Pick scheduling Save/Cancel scrolled away with content                                                                                   | Reuse existing Sheet footer; draft, validation, retry and duplicate-save rules remain unchanged                                                                                                                 |
| Host/member menus lacked an explicit header close, scroll bounds and modal focus isolation; their handles suggested unsupported dragging | Reuse Sheet, remove misleading handles, retain existing action labels and moderation rules; block dismissal while operations are pending                                                                        |
| Shared sheets did not automatically respect reduced motion or focus their headings                                                       | Shared live preference, heading focus on native show, modal isolation, accessibility escape, keyboard dismissal on drag; existing keyboard avoidance and safe areas retained                                    |
| Main stack forced vertical fades for ordinary pushes, unlike Group Details native navigation                                             | Use native default push transitions, with no animation under reduced motion; keep existing explicit Pick fades and swipe-flow gesture restriction                                                               |
| Modal transitions, reveal entrances and looping decorations were inconsistent under reduced motion                                       | Live OS preference hook; suppress modal/reveal motion and confetti, stop looping decorations, cancel decorative animations on cleanup; ActivityToast keeps its functional message duration                      |
| Button/card press feedback introduced movement; several controls had no feedback                                                         | Static opacity through shared controls and touched info, back/close, message menu and legal-link controls; no additional haptics                                                                                |
| Poppins digits were proportional and bundled faces had no tabular alternates                                                             | Native tabular styling only on countdown digits and the numeric progress count; labels, units and static badges retain their existing fonts                                                                     |
| OTP had both autofill hints, a 1×1 invisible native field, and fixed boxes wider than small screens                                      | One hint per platform, full-size transparent-text native input over decorative boxes, flexible box widths; JS sanitizes formatted paste before the six-digit limit, auto-submit and pending guard remain intact |

Font inspection read the bundled Poppins 400/500/600/700/800 TTF cmap, hmtx and
GSUB tables. For example, 400 Regular digit advances range from 320 to 635 units,
and none of those faces contains `tnum`. Adding `fontVariant` to Poppins alone
would not produce stable digits. The narrow native-font fallback is explicit in
`theme.ts`; final native font rendering remains device QA.

## Sheet and navigation boundaries

- Discover filters and Friends/group/profile sheets inherit shared motion, focus,
  keyboard and close behavior. Discover's existing draft-only Reset and sticky
  Apply footer are unchanged. Closing discards only the open filter draft.
- Pick time scheduling uses the shared footer, blocks close during save (including
  same-tick attempts through its existing ref guard), and retains the draft on error.
- Host/member/message-report menus use the shared scrollable sheet. They retain
  report reasons, displayed-photo revision checks, confirmations and server actions.
- Place Details keeps its existing pageSheet and action bar, gains native iOS swipe
  dismissal and reduced-motion transitions, and keeps explicit close/Android back.
  Its read-only content has no unsaved draft to guard.
- Hang's existing native pageSheet swipe behavior and saving guard are retained;
  the main modal and its selection sheets now follow live OS motion changes.
- Transparent shared sheets retain explicit close/backdrop/hardware-back dismissal;
  native pageSheet drag APIs do not apply to these transparent overlays. No fake
  drag behavior or gesture dependency was added.
- Own-profile navigation, tabs, pending invites, profile deep links, identity/auth
  guards, group membership handling, chat drafts/viewport, polling, account isolation
  and critical Pick gestures are unchanged. Predictive-back configuration is unchanged.
- Native modal focus return is left to the OS; entry focus is explicit in shared
  sheets. Verify return order on actual devices, including nested Hang selections.

## Validation

- TypeScript: passed.
- ESLint: passed, no warnings.
- Focused Jest: 20 suites / 154 tests passed.
- Full Jest: 179 suites / 1,477 tests passed.
- Android export: passed, `/tmp/wtw-phase3-export-android/`.
- iOS export: passed, `/tmp/wtw-phase3-export-ios/`.
- Working-tree and staged `git diff --check`: passed.
- Existing test files retained; no files deleted. Regression coverage includes
  sheet cancellation and pending-save guards, sticky footer, link safety and
  attribution preservation, target style constraints, single tap haptic, disabled
  semantics, tabular count accessibility, live motion preference races/cleanup,
  OTP paste/autofill/duplicate/recovery behavior, onboarding, Group Details,
  account isolation and Phase 2 loading protections.
- No Deno/API/SQL run was needed: backend code and contracts are unchanged.
- Existing Expo Go push-notification notices in Jest are unrelated to these changes.

Tests assert JS behavior and configuration, not native layout measurements,
autofill delivery, screen-reader traversal or swipe recognition.

## Native-device QA and deferred work

Check iOS and Android with VoiceOver/TalkBack: modal heading entry and focus return,
large text, small screens and landscape, keyboard avoidance and footer reachability,
long photo/Google credits, and the OTP native input's focus, paste menu and autofill
on real email clients/keyboards. Test reduced motion at launch and while running,
ordinary back/swipe navigation and Android hardware back, Place Details swipe close,
and Hang save/dismiss protection. Confirm countdown alignment with the system fonts.
Exports do not substitute for device tests.

Continuous corners are intentionally deferred as optional visual polish; no circle
avatar masks or radius tokens changed. Broader sheet gesture migrations, predictive
back changes, animation dependencies, global typography changes, optimistic updates
and Undo toasts are outside this change. No new own-profile/deep-link routes were
introduced because no confirmed navigation defect required them.

Implementation is ready to commit and push after review, with native QA outstanding.
Nothing was committed, pushed, merged, rebased, built as a release, submitted or deployed.

## Files changed

- `app/(tabs)/discover.tsx`
- `app/_layout.tsx`
- `app/groups/_layout.tsx`
- `app/intro.tsx`
- `app/pick/[id]/lobby.tsx`
- `app/pick/[id]/results.tsx`
- `app/pick/[id]/vote.tsx`
- `app/pick/[id]/waiting.tsx`
- `app/sign-in.tsx`
- `src/components/ActivityToast.tsx`
- `src/components/Button.tsx`
- `src/components/Card.tsx`
- `src/components/Confetti.tsx`
- `src/components/GoogleCredit.tsx`
- `src/components/HangCard.tsx`
- `src/components/HangPlanComposer.tsx`
- `src/components/HostMenu.tsx`
- `src/components/MemberMenu.tsx`
- `src/components/MessageThread.tsx`
- `src/components/PickParts.tsx`
- `src/components/PlaceCard.tsx`
- `src/components/PlaceDetailsSheet.tsx`
- `src/components/PlanBlock.tsx`
- `src/components/PlanTimeSheet.tsx`
- `src/components/ProgressBar.tsx`
- `src/components/ResultCards.tsx`
- `src/components/Screen.tsx`
- `src/components/TabUi.tsx`
- `src/components/picks/HangInvitation.tsx`
- `src/components/theme.ts`
- `src/hooks/useMotionPreference.ts`
- `tests/auth/introCarousel.test.tsx`
- `tests/auth/reviewSignIn.test.tsx`
- `tests/components/GoogleCredit.test.tsx`
- `tests/components/HangPlanComposer.test.tsx`
- `tests/components/NativeInteraction.test.tsx`
- `tests/components/PlanTimeSheet.test.tsx`
- `tests/hooks/useMotionPreference.test.tsx`
- `docs/native-interaction-polish.md`

## Phase 3 review corrections — November 15, 2026

The initial `useState(true)` motion default was incorrect for mount-time entrance
configuration: the async OS read could update state but could not replay an entering
animation or the initial native modal transition. The hook now seeds state from
Reanimated's synchronous `useReducedMotion()` snapshot. Its existing fresh OS read,
live change listener, stale-read guard and unmount cleanup remain. A failed read
retains the synchronous value. No delay, remount or navigation workaround was added.

Reviewed every consumer: root navigation; Groups navigation; Pick lobby, results,
vote and waiting screens; Discover details; shared Sheet (including already-visible
PlanTimeSheet and report/block menus); PlaceDetailsSheet; HangCard; HangPlanComposer;
ActivityToast; Confetti; and PickParts' LiveDot and FlameOrb. Enabled Reduce Motion
suppresses decorative motion immediately; disabled Reduce Motion permits the first
entrance immediately. Existing cancellation and dismissal guards are unchanged.

Normal Pick subtitles and Pills now inherit Poppins. Only explicitly opted-in
countdown digits get a native tabular span; units and vote/progress prose retain
Poppins, as do deadline-expired messages. Opt-ins cover lobby countdown Pills and
waiting/vote/swipe countdown subtitles. RSVP summary and Hang count overrides were
removed. Section badges retain Poppins semibold without the ineffective numeric
spread or synthetic font weight. The genuinely changing numeric-only ProgressBar
counter retains native tabular digits and its existing size and bold hierarchy.

New `MotionEntrances.test.tsx` holds the async OS query pending for both preference
values and checks first-mount hook output, already-visible Sheet animationType,
ActivityToast spring/timing calls, animation cancellation and timer cleanup.
`CountdownTypography.test.tsx` checks ordinary subtitles/Pills, static badges,
countdown digit spans and inherited hierarchy. Hook tests retain live-change,
stale-read and cleanup coverage. Jest now uses the installed Reanimated/Worklets
mocks because importing the synchronous native hook otherwise loads native Worklets
in JS-only tests; the focused tests provide explicit true/false preferences.

These are automated configuration tests, not native animation playback tests.
Native QA still needs first opening of results/vote/lobby/waiting, toast entrances,
already-visible scheduling/moderation sheets, navigation, system-setting changes,
countdown wrapping/baselines and accessibility scaling on iOS and Android. All other
Phase 3 sheet, touch, attribution, OTP, draft and authorization behavior is retained.

Follow-up validation: TypeScript and ESLint passed with no warnings; focused motion,
sheet, toast, typography and OTP tests passed (9 suites / 36 tests); full Jest passed
(181 suites / 1,487 tests); Android and iOS exports passed at `/tmp/wtw-review-android/`
and `/tmp/wtw-review-ios/`; working-tree and staged diff checks passed. One concurrent
focused run encountered a transient disk-space reporter error; its standalone rerun
passed. No native playback verification was performed.

Files changed for the review follow-up:

- `app/pick/[id]/lobby.tsx`
- `app/pick/[id]/swipe.tsx`
- `app/pick/[id]/vote.tsx`
- `app/pick/[id]/waiting.tsx`
- `docs/native-interaction-polish.md`
- `src/components/PickParts.tsx`
- `src/components/PlanBlock.tsx`
- `src/components/TabUi.tsx`
- `src/components/picks/HangInvitation.tsx`
- `src/hooks/useMotionPreference.ts`
- `tests/components/CountdownTypography.test.tsx`
- `tests/components/MotionEntrances.test.tsx`
- `tests/components/VoteReliability.test.tsx`
- `tests/hooks/useMotionPreference.test.tsx`
- `tests/setup.ts`
