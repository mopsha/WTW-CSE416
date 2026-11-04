# PR #43 review follow-ups

Starting point verified before edits: clean `josh/design-overhaul`, HEAD
`a016d4c`. No branch switch, merge, rebase, history rewrite, commit, push, or
deployment is part of this work. The profile-picture branch is untouched.

## Image privacy inventory

All ten current images were visually inspected, not classified by filename.
Every file below was introduced by the same commit:
`d0babcb79e9eec1eb568c4760a88ab741500508c`
(`Redesign WTW core screens and messaging UI`), which is reachable through the
reviewed merge `a016d4c`.

The inventory deliberately describes categories rather than transcribing email
addresses, account handles, private message contents, or third-party names.
Whether a particular account/person consented to redistribution cannot be
established from the screenshot. Apparent test data is not assumed fictional.
Embedded metadata was also inspected without reproducing its values: all ten
contain EXIF capture/modification date fields, and the PNGs also contain XMP date
fields. No GPS pointer was found in the inspected EXIF directories. Replacement
or redacted exports should strip metadata as well as cover private pixels; this
is not a claim that every possible application-specific metadata format is clear.

| Path                                           | Visible privacy/provenance finding                                                                                                                                                                                 | Recommendation                                                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/current/profile1.PNG`                    | High: personal email, full name, username, social counts and preferences.                                                                                                                                          | Remove/replace with a screenshot from a fictional test account using an `example.com` email. Redact all identity fields if retained.                                                                                     |
| `docs/current/messages.PNG`                    | High: peer identity/handle, private DM text, timing and sender initials.                                                                                                                                           | Replace with fictional participants and deliberately fabricated messages; removing only the handle is insufficient.                                                                                                      |
| `docs/design-references/whatsapp-friends.PNG`  | High: contact/group names, family/community relationships, message snippets, timestamps, unread counts, portraits and group photos. Bottom rows also contain partially visible content.                            | Prefer removing/replacing the entire image. A redaction must cover every row, photo, preview, account thumbnail and partially obscured bottom entry.                                                                     |
| `docs/design-references/instagram-profile.jpg` | High: personal account identifiers, portrait, private-account indicator, social counts, bio/affiliations and linked social identity.                                                                               | Replace with a fictional profile using an initials avatar. If retained, redact the portrait, both handle locations, name, bio, counts and identifying metadata.                                                          |
| `docs/design-references/partiful-profile.PNG`  | Personal name, birthday month, join/activity information; promotional panel includes third-party portraits of unverified provenance. Those portraits are not assumed to be the user's contacts.                    | Replace personal fields with fictional data and crop/replace the promotional portraits, or remove the image.                                                                                                             |
| `docs/current/friends.PNG`                     | Peer name and friendship date expose social context; no email or actual portrait visible.                                                                                                                          | Replace with a clearly fictional account/list.                                                                                                                                                                           |
| `docs/current/picks1.PNG`                      | Group name/member count, active Picks, unread indicator, partial invitation, and personal media activity in the status area. No email visible.                                                                     | Replace with mock group/Pick data and crop OS media activity.                                                                                                                                                            |
| `docs/current/picks2.PNG`                      | Invitation activity and exact scheduling timestamp, response state, Pick history and OS media activity. No direct account identifier visible in this image alone.                                                  | Replace with fictional plans/timestamps and crop OS activity.                                                                                                                                                            |
| `docs/current/profile2.PNG`                    | Preferences and empty history associated with the paired profile screenshot. No direct email/name/portrait visible in this crop.                                                                                   | Low direct identification risk alone, but use a fictional replacement with the paired profile.                                                                                                                           |
| `docs/current/discover.PNG`                    | No personal email, chat or account identity observed. Location/browsing context and third-party venue/event photography are visible; the event image includes people, with identity/consent/provenance unverified. | Retain only if appropriate provenance is established; a place-only/venue-only crop or permission-cleared fictional example avoids unnecessary people/location context. Preserve required attribution in any replacement. |

No image was edited/deleted here: this request calls for an inventory and
recommendations before separately coordinated cleanup. Their presence in the
current tree remains an unresolved privacy finding.

## Team-coordinated cleanup plan

1. Agree which originals must be removed and who owns the cleanup. Avoid copying
   the private originals into issue bodies, PR descriptions, screenshots, or new
   documentation while discussing the findings.
2. Prepare replacement screenshots using fictional mock accounts, synthetic chat
   text and non-personal avatars. Check the entire frame, OS overlays, cropped
   edges and image metadata. Use real third-party photos only with permission or
   established provenance appropriate to the intended distribution.
3. A normal follow-up change can remove/replace current-tree files, but does not
   erase their original blobs from `d0babcb` or descendant commits such as
   `a016d4c`. Do not describe a normal deletion as historical erasure.
4. Coordinate any separately authorized history/platform cleanup with the team
   and repository owners, including affected refs/clones and review artifacts.
   This inventory provides the paths and introducing commit; no rewrite,
   force-push or GitHub cache-purge operation was attempted.

## Targeted code corrections

- The composer stays editable during sends; unavailable chats still disable it.
  Duplicate-send locks, retry IDs and validation remain. Send success clears only
  the submitted draft; text typed while sending survives.
- Chat-only control/error insets and a header left inset restore horizontal
  breathing room without narrowing the scrollable conversation area.
- A missing/unverified DM peer produces a loading/unavailable header, without
  inventing a person/avatar or retaining private peer data across failed reads.
- Manual refresh tracks the actual chat/auxiliary promises independently of
  initial loading. The existing live hook now lets callers await their queued
  refresh; canceled scopes settle waiters without accepting stale responses.
- The decorative Picks word remains a single fitted line with up to 1.5x font
  scaling. The readable lead remains unrestricted, and the entire identity keeps
  its VoiceOver label. Native text metrics still need device verification.
- Active Pick Card taps and group Start Button taps rely on kit haptics once.
  History rows and custom RSVP Pressables retain their own single haptic because
  those controls do not receive one from the kit.
- Typography audit: named Poppins faces remain for brand text and kit controls;
  native social/chat body styles keep their intentional system weights. The
  paper button and compact segments now select the actual loaded semibold face
  rather than clearing `fontFamily` and synthesizing a weight over kit presets.
  No global palette, default primary-button appearance, or body font is changed.

## Deferred and device checks

SocialIdentity/Avatar consolidation and GroupInvitations' default variant remain
deferred as requested. No privacy-sensitive peer cache was added to conceal header
loading states. Existing blocking, authorization and background clearing remain.

Verify keyboard retention, typing a next draft while sending, multiline composer
height, drag dismissal and error/retry behavior on iOS and Android. Verify the
Picks hero at narrow device widths and maximum accessibility sizes, including
VoiceOver and orientation changes. Jest can assert layout/scale contracts but
does not prove native font fitting or physical keyboard focus.

## Validation and changed files

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Full Jest (`jest --runInBand`): 126 suites, 926 tests passed.
- Android export: passed, output outside the repository at
  `/tmp/wtw-pr43-review-android`.
- `git diff --check`: passed.
- Existing Expo Go remote-notification warnings appear during Jest; no test fails.
- No backend, migration, authentication, image asset or deferred component changes.

Production files:

- `app/(tabs)/index.tsx`
- `app/groups/[id].tsx`
- `app/messages/[id].tsx`
- `src/components/Button.tsx`
- `src/components/ConversationHeader.tsx`
- `src/components/GroupChat.tsx`
- `src/components/MessageThread.tsx`
- `src/components/TabUi.tsx`
- `src/components/picks/PicksHome.tsx`
- `src/components/theme.ts`
- `src/hooks/useLiveMessages.ts`

Regression tests:

- `tests/components/ConversationHeader.test.tsx`
- `tests/components/DirectChatHeaderState.test.tsx` (new)
- `tests/components/KitTypography.test.tsx` (new)
- `tests/components/MessageThread.test.tsx`
- `tests/components/PicksHome.test.tsx`
- `tests/components/groupAccessRefresh.test.tsx`
- `tests/hooks/useGroupChat.test.tsx`

Documentation: `docs/pr-43-review-followups.md` (new).
