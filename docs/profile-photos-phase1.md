# Managed profile photos: backend phase 1

This branch implements backend support only. It does not change avatar rendering,
profile editors, native dependencies, onboarding, or the pending design-overhaul branch.

## Database and Storage

`0035_profile_photos.sql` is the only new migration. It adds `avatar_path`,
`avatar_revision`, and `avatar_deletion_pending` to existing profiles, with no
new client grants. A unique path index supports safe orphan checks. Existing
`avatar_url` remains a legacy field, never a private URL or a signed credential.
Managed replacement/removal clears it so old builds show initials.

The migration creates/updates the private `profile-photos` bucket with a 1 MiB
limit and JPEG MIME restriction. Restrictive policies deny direct anon and
authenticated operations on this bucket and its objects, even if an unrelated
permissive policy would otherwise allow them. Other buckets are unaffected.
The service role bypasses RLS and must stay server-only.

Uploads use `<verified-owner-uuid>/<server-generated-uuid>.jpg`, never overwrite,
and never accept a user ID or path supplied by the client. Service-role uploads
do not imply an end-user `owner_id`; ownership is enforced by the API and RPCs.

Photo read eligibility is: existing owner, accepted friend, or current shared
group participant or participant in a shared active Pick (draft/swiping/ranking/final_vote). Either-direction blocking takes precedence. Pending
friendship alone does not qualify. Profile-page metadata permissions are unchanged.
Account-deletion-pending profiles cannot read or serve managed photos.

All photo RPCs and the private visibility helper are service-only and have an
empty search path. Protected reads check the graph and revision before and after
Storage download. Unauthorized, missing, removed, and stale photos return 404.
No public or signed read URL is issued.

## HTTP contract

- `POST /me/avatar?revision=N`: `Content-Type: image/jpeg`, binary body, verified
  bearer token. Returns `{ revision, avatarRef: { userId, revision } }`.
- `DELETE /me/avatar?revision=N`: verified bearer token; returns
  `{ revision, avatarRef: null }`.
- `GET /users/:id/avatar?revision=N`: verified bearer token; returns JPEG bytes,
  `Cache-Control: private, no-store`, `Vary: Authorization`, and `nosniff`.
  Errors are JSON and also have no-store caching.

Profile responses add optional `avatarRef`, and owner responses include
`avatarRevision` even without a photo. Friends and message histories add photo
references in one batched query per response, not per identity. Pending friend
rows do not expose photo references. Message sends remain independent of extra
post-commit metadata reads; the next history refresh carries current references.
Clients must not interpret an avatar reference as permission to bypass image auth.
Optional metadata lookup failures omit photo references and log a sanitized warning;
they do not turn successful onboarding/profile writes into errors or break existing
friend/message reads. The protected image endpoints still fail closed.

Actual streamed upload size is capped at 1 MiB, even without Content-Length.
The API accepts only static, square JPEGs up to 512 pixels per side. The client
must crop/resize before upload in phase 2. Server-side `jpeg-js@0.4.4` fully
decodes with strict decoding, a 0.263 MP resolution cap and a 16 MiB approximate
decoder allocation limit, then re-encodes only pixels at quality 85. EXIF,
comments and source metadata are discarded. This is one pure-JavaScript npm
dependency, with no WASM/native loader or separate image-processing service.

Twenty upload attempts per rolling 24 hours are enforced under a profile row
lock before decoding. The existing rate-limit-event cleanup retains the correct
window. All previously supported rate-limit actions remain supported.

## Failure, concurrency, and cleanup

An upload is validated and stored before a row-locked compare-and-swap updates
the reference. Stale revisions return 409. Storage/validation failures preserve
the previous reference. Remove clears the reference before physical cleanup.
Revision changes immediately invalidate older image requests.

The previous object is removed through Storage after a successful commit unless
an unexpired photo report pins that revision as private evidence. Phase B expiry
and operator review/removal are described in `moderation.md`.
Cleanup failure does not report a committed replacement as failed. An uncertain
commit reply never triggers deletion of a potentially active candidate: clients
must reload owner details to resolve that outcome instead of blindly overwriting.

The existing authenticated cron sweep removes at most 100 unreferenced objects
per claimed hourly batch, older than 24 hours (five-minute failure/crash backoff). Commit RPCs reject objects older than 15 minutes;
an object eligible for collection therefore cannot become active concurrently.
No production code deletes Storage metadata through SQL. The scheduled sweep
must be configured and monitored before accepting uploads in a deployment.

Account deletion first durably marks photo deletion pending and advances the
revision, rejecting in-flight finalization and new photo writes. It removes up
to ten batches of 100 objects through Storage, then calls Auth deletion. Storage
failure stops Auth deletion; retrying DELETE /me resumes cleanup. A failed
account deletion leaves photos disabled. The sweep automatically retries up to five due
accounts per run using five-minute claims; DELETE /me can also be retried. It never
unfreezes an uncertain or partially destructive deletion.
An already-running upload may finish after the prefix scan, but cannot commit;
the bounded orphan sweep removes any such inaccessible residual object later.

## Phase 2 client requirements

Native React Native Image supports request headers, but native/web caching and
token refresh must not be delegated to an opaque long-lived Image URL. Prefer
authenticated fetch using WTW's current session token, check status, then render
a memory-only data URI through the existing Avatar/Image presenters. This also
works for browser previews without requiring an HTML image to attach bearer
headers. Do not put tokens in query strings or persistent photo caches.

Deduplicate visible image requests; key memory state by viewer, target and
revision. Clear/discard requests and decoded sources on account switch, sign-out,
local blocking, and access invalidation. Revalidate on focus using existing
private-refresh conventions. Retry authorization only through existing session
refresh behavior, never an infinite 401 loop. Remote revocation prevents future
authorized downloads; already delivered pixels/screenshots cannot be revoked.

No device-level rendering, cache, picker, or account-switch behavior is claimed
as verified by this backend phase. Native iOS/Android and web checks are required
when rendering is implemented. No Expo dependency was installed in this phase.

## Release and validation

Apply migration/bucket/policies first, then deploy the API, then release the
phase-2 app. Keep additive contracts and legacy fields for old TestFlight builds.
Older apps continue to show initials for managed photos. Audit any existing
legacy public URLs separately; this migration cannot revoke an external image.
Rollback must retain photo authorization and account-deletion cleanup. Do not
roll the API back to a version that deletes accounts without cleaning Storage.

CI discovers SQL tests through `supabase test db`, imports photo Deno tests from
`app_test.ts`, runs real photo concurrency checks after migration reset, and
includes `tests/api/avatars.test.mjs` in the explicit HTTP test list. The JPEG
fixture is a generated 1-pixel image, not user content.

The HTTP suite requires the actual local Supabase/Auth/Storage/Edge stack. Mock
adapter tests and PostgreSQL stand-in Storage tables do not prove Storage HTTP
security or physical file cleanup. Those real-stack checks must pass before
release. The standalone SQL and two-connection tests supplement that validation.

References checked for this implementation:

- https://supabase.com/docs/guides/functions/dependencies
- https://github.com/jpeg-js/jpeg-js
- https://supabase.com/docs/guides/storage/security/ownership
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://reactnative.dev/docs/0.86/image
- https://docs.expo.dev/versions/v57.0.0/

## Changed-file manifest

| Directory                         | Files                                                                                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/`              | `ci.yml`                                                                                                                                                                                                                                           |
| Repository root                   | `package.json`                                                                                                                                                                                                                                     |
| `supabase/migrations/`            | `0035_profile_photos.sql`                                                                                                                                                                                                                          |
| `supabase/functions/_shared/api/` | `avatars.ts`, `directChat.ts`, `friends.ts`, `messages.ts`, `userProfiles.ts`                                                                                                                                                                      |
| `supabase/functions/api/`         | `accountStore.ts`, `app.ts`, `app_test.ts`, `avatarImage.ts`, `avatarMetadata.ts`, `avatarStore.ts`, `avatars_test.ts`, `deno.json`, `deno.lock`, `directChatStore.ts`, `friendsStore.ts`, `groupChatStore.ts`, `index.ts`, `userProfilesStore.ts` |
| `supabase/tests/`                 | `profile_photos_test.sql`                                                                                                                                                                                                                          |
| `tests/`                          | `account.test.ts`, `avatarMetadata.test.ts`, `avatars.test.ts`, `userProfiles.test.ts`                                                                                                                                                             |
| `tests/api/`                      | `avatar-fixture.jpg`, `avatars.test.mjs`                                                                                                                                                                                                           |
| `tests/db/`                       | `avatar_concurrency.py`                                                                                                                                                                                                                            |
| `docs/`                           | `profile-photos-phase1.md`                                                                                                                                                                                                                         |

Review follow-ups and release gates: [profile-photos-review-plan.md](profile-photos-review-plan.md).
