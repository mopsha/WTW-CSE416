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
| Poppins digits were proportional and bundled faces had no tabular alternates                                                             | Native tabular font style only on live countdown/count/badge text, keeping sizes, colors and scaling; other typography stays Poppins                                                                            |
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
