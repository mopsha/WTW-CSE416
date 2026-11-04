# Profile photos: client integration

Implemented on `josh/profile-pictures` against current main, without importing or
merging the design-overhaul branch. Phase 1's private bucket, migration 0033,
authorization, atomic revisions, account-deletion guard and cleanup remain in place.
There is no second migration or parallel profile store.

## User flow

Open **Profile details & privacy** from Profile, or the existing Edit Profile
settings page. **Change photo** opens the native image library with one-image,
square editing. No camera or microphone feature is added. The system image picker
does not require broad library permission up front; permission errors expose a
Settings action rather than repeatedly requesting access.

ImageManipulator decodes the selected/cropped asset so normalization uses its
actual oriented dimensions, crops any remaining non-square edge and resizes to
at most 512 square pixels. It encodes JPEG at quality 0.82 and validates the
actual bytes against the backend's 1 MiB limit. Native decoding handles HEIC when
the device supports it; unsupported/corrupt images produce a recoverable error.
Native contexts and image references are released after processing.

The editor shows a circular preview before upload. **Save photo** is independent
of **Save profile details**. Cancelling the preview changes nothing on the server.
**Remove photo** clears the managed reference and restores initials. The previous
persisted profile remains on upload failure; the preview can be retried or cancelled.
Conflicts/uncertain replies reload the current revision, without automatically
overwriting it. That reconciliation is time-bounded so offline errors cannot lock
the editor indefinitely. A commit whose network reply was lost may have succeeded;
the reloaded server state is authoritative.

Synchronous submission guards reject repeated taps. Metadata/photo saves are
interlocked. Unmount/account-change guards discard stale picker/upload results.
Photo changes merge with the latest profile metadata instead of restoring older
username/preferences fields from an upload's closure.

## Dependencies and native configuration

- `expo-image-picker`: installed 57.0.20 (`~57.0.20`).
- `expo-image-manipulator`: installed 57.0.21 (`~57.0.21`).
- `expo-image-loader` is their shared Expo dependency.
- `app.json` includes the photo-library purpose description and disables camera
  and microphone permissions in the image-picker plugin.

Expo resolves the versions for SDK 57. Introspection confirms the iOS photo
description, no camera/microphone descriptions, and Android camera/audio removal
entries. No native platform directory was created or edited. A new development
or TestFlight binary is needed; an OTA alone cannot install these native modules.

The picker/manipulator may create temporary files in the app's private native
cache. These are local selected images, not a persistent cache of downloaded
private server photos. Preview bytes are not stored in AsyncStorage or public URLs.

## Authenticated rendering and memory cache

`Avatar` retains its initials, sizes and legacy URI interface. Managed person
avatars use `useAvatarSource`; group monograms and onboarding's name preview
do not subscribe to photo loading. Failed image decoding also restores initials.

The photo client fetches binary JPEGs with the current bearer token and no-store
caching, checks response type/size, then supplies an in-memory data URI to React
Native Image. The endpoint is never passed to an unauthenticated Image loader.
Tokens never enter URLs, image sources or logs. Photo requests have a ten-second
deadline, abort support, and at most one explicit session-refresh retry on 401.
Other authorization errors do not trigger refresh loops.

The shared LRU holds at most 32 images and 8 MiB of encoded characters. Reuse
expires after 15 seconds without reauthorization. Mounted Image consumers retain
their current source as rendering state; their lifetime is distinct from the LRU.
Nothing downloads to a public disk cache or persists remote photo bytes in app
storage. Already delivered/decoded pixels cannot be remotely erased.

Cache state is scoped to the user and account email (mock accounts intentionally
share one user ID). Account changes and sign-out clear sources, pending downloads
and revisions; token refresh within the same account does not flush photos.
Navigation/background transitions clear cached bytes. Only focused consumers
register identities; blurred consumers hide their sources and unsubscribe.
Generation and abort checks discard late results even if a transport ignores abort.

Known photo references download directly. Existing person-only projections pass
`userId`; their refs resolve together rather than triggering profile requests per
row. One coordinator rechecks the focused identities every five seconds, in batches
of up to 100. Failed revalidation hides photos. A local block, unfriend, replace or
remove invalidates the relevant source immediately. Changes made on another device
are observed through polling, not an invented real-time photo subscription.
Unavailable downloads can retry after a 15-second backoff once the batch check
confirms access, without requiring the user to navigate away and back.

`POST /avatars/resolve` is the only additional backend endpoint in this phase.
It validates/deduplicates at most 100 UUIDs, derives the viewer from verified auth,
returns no-store reference metadata, and reuses Phase 1's service-only `avatar_refs`
RPC. Its authorization is exactly the existing photo visibility rule. No paths,
signed URLs, or private profile metadata are returned.

## Mock mode

Photo data/revisions live in the existing `mockUserProfiles` map and its existing
per-email account snapshots. Upload/replace/remove, conflicts, private reads,
batch resolution, friend/message projections and account deletion use that state.
Owner/friend/group/Pick visibility and the existing mock block graph are checked.
Mock mode resets with the process, like the rest of its data; it is not production
persistence. Mock image transport checks are not a substitute for backend decoding
or real Storage RLS and file-deletion tests.

## Design-overhaul reconciliation

After the team approves and merges that branch, reconcile these specific seams:

| File                                                             | Required integration                                                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/(tabs)/profile.tsx`                                         | Keep the approved redesigned composition; retain account-safe detail loading and photo state updates.                                                                          |
| `src/components/OwnProfileDetails.tsx`                           | Insert the reusable `ProfilePhotoEditor` into the redesigned editor; retain the busy/close guards.                                                                             |
| `src/components/profile/ProfilePresentation.tsx`                 | Pass `avatarRef` and `userId` into its existing Avatar. This file is only on the pending branch and was not created here.                                                      |
| `app/(tabs)/friends.tsx`                                         | Preserve approved social rows and pass real identity/photo fields.                                                                                                             |
| `src/components/friends/SocialRow.tsx`                           | Its `SocialIdentity` uses its own Image presentation. Reuse `useAvatarSource` there, with the same fallback/error handling; keep approved sizes and colors. Not modified here. |
| `src/components/ConversationHeader.tsx`, `app/messages/[id].tsx` | Carry peer refs/IDs through the redesigned header's SocialIdentity. The shared header does not exist on this branch.                                                           |
| `src/components/MessageThread.tsx`                               | Carry sender refs/IDs into redesigned group sender identities; preserve its conversation/composer layout.                                                                      |
| `app/groups/[id].tsx`                                            | Retain person-avatar props in member/friend rows without changing group identities.                                                                                            |
| `src/components/Avatar.tsx`, `src/components/PickParts.tsx`      | Retain the opt-in managed source interface and real participant IDs; do not replace Picks' deliberate group identities.                                                        |
| `app/_layout.tsx`, `app/settings/profile.tsx`                    | Retain cache lifecycle initialization and account-safe editor updates.                                                                                                         |

`GroupChat` does not require a new photo architecture: its existing message data
already reaches MessageThread. Adapt the redesign's relevant Profile/Friends/
SocialIdentity/ConversationHeader/MessageThread tests after reconciliation.

## Verification and release gates

Automated tests cover cancellation/permission failures, JPEG normalization,
byte limits, preview/save/remove, offline and conflict recovery, duplicate taps,
private request headers, token refresh, bounded cache reuse, batch visibility,
revision invalidation, account switching/sign-out, stale downloads and mock data.
Existing Profile/Friends/messaging/privacy regressions remain part of full Jest.
Deno and real-stack HTTP tests also cover the batch resolver's verified viewer,
ID limit and unauthorized/pending access.

Docker/Podman and the real local Supabase Storage/HTTP stack remain unavailable.
Passing mocks or the earlier isolated PostgreSQL tests does not prove Storage
security, actual file deletion, Edge-container behavior, or deployment readiness.
Run migrated PostgreSQL 17/pgTAP, HTTP/Storage, cleanup and concurrency checks in
the actual local stack/CI before release. Ensure the existing maintenance cron is
configured before enabling uploads in a deployed backend.

On physical iOS/Android, verify HEIC/rotation, native crop bounds, denied/limited
photo access, library cancellation, long/offline uploads, background/resume,
account changes, VoiceOver/Dynamic Type and low-memory image behavior. The browser
picker lacks native interactive cropping; normalization still produces a square.
No device-level privacy/cache guarantee is claimed from Jest or Android export.

Final local checks: TypeScript, lint, 123 Jest suites / 921 tests, 99 Deno tests,
Deno typechecking, Android export and diff checks passed. The online Expo
compatibility check accepts both new photo modules but exits nonzero for seven
pre-existing patch recommendations: expo, expo-linking, expo-location,
expo-notifications, expo-router, expo-splash-screen and jest-expo. Those unrelated
versions were not upgraded. The local SDK 57 dependency-map check passes.
The HTTP command was attempted: all seven tests stop at local-stack setup, so
none of their real Storage assertions is counted as passing.

## Phase 2 changed files

Phase 1's separate manifest is in `profile-photos-phase1.md`; those uncommitted
changes were preserved. The following files were added or extended for phase 2:

| Directory                         | Files                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Root                              | `app.json`, `package.json`, `package-lock.json`                                                                                             |
| `app/`                            | `_layout.tsx`, `(tabs)/profile.tsx`, `(tabs)/friends.tsx`, `settings/profile.tsx`, `users/[id].tsx`, `messages/[id].tsx`, `groups/[id].tsx` |
| `src/components/`                 | `Avatar.tsx`, `OwnProfileDetails.tsx`, `ProfilePhotoEditor.tsx`, `MessageThread.tsx`, `PickParts.tsx`                                       |
| `src/hooks/`                      | `useAvatarSource.ts`                                                                                                                        |
| `src/lib/`                        | `api.ts`, `auth.ts`, `avatarCache.ts`, `photoBytes.ts`, `photoEvents.ts`, `pickProfilePhoto.ts`                                             |
| `src/lib/mock/`                   | `api.ts`, `userProfiles.ts`, `directChat.ts`, `groupChat.ts`                                                                                |
| `supabase/functions/_shared/api/` | `avatars.ts`                                                                                                                                |
| `supabase/functions/api/`         | `app.ts`, `avatarStore.ts`, `avatars_test.ts`                                                                                               |
| `tests/components/`               | `AvatarPhotos.test.tsx`, `ProfilePhotoEditor.test.tsx`                                                                                      |
| `tests/lib/`                      | `avatarCache.test.ts`, `photoApi.test.ts`, `pickProfilePhoto.test.ts`, `mockAvatars.test.ts`                                                |
| `tests/api/`                      | `avatars.test.mjs`                                                                                                                          |
| `docs/`                           | `profile-photos-phase2.md`                                                                                                                  |
