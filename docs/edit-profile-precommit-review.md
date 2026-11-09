# Unified Edit Profile and month/day birthday review

Verdict: **READY TO COMMIT**. No known blocking code findings remain. Native-device
QA and real Supabase integration are still required before release; the automated
checks below do not establish hosted or native-device readiness.

## Scope and preserved behavior

Reviewed the full tracked diff and untracked implementation/test files on
`josh/edit-profile-redesign`. The existing uncommitted unified editor is retained.
Profile and Settings lead to `/settings/profile`; the former name-only sheet and
nested details/privacy editor are absent from that workflow. Counts, favorites,
mutual groups and Past Moves stay available on their appropriate profile screens.

Name, username, favorites, birthday and privacy validate before writes. Details
save first, including birthday in the same SQL transaction; the existing display
name endpoint follows only if needed. Confirmed partial success is reported and
retry writes only the remaining name. Synchronous guards prevent duplicate and
overlapping photo/text submissions. Photos retain explicit preview/save/removal,
revision checks, account ownership, server capabilities and moderation readiness.
No photo flag, Storage policy, reporting rule or moderation setting was enabled.

Username case normalization, case-insensitive uniqueness, required-username
protection from 0031, and grandfathered handles are preserved. The new SQL wrapper
composes with the existing guarded updater instead of replacing it. Server errors
remain visible and drafts survive failures. Unsaved text and photo previews have
navigation protection; account-keyed forms and response guards prevent stale
account responses from populating another form.

## Birthday representation and security

`private.profile_birthdays` contains only `user_id`, `birth_month smallint`,
`birth_day smallint`, and `share_birthday boolean default false`. Database checks
require months 1–12 and valid days for each month, including February 29. There is
no birth year, date/timestamp column, derived age or calendar-year formatting
anchor. TypeScript and JSON use `birthday: {month, day}`; incomplete UI drafts fail
validation. Legacy complete-date and year-bearing requests are rejected rather
than silently accepted. Remaining legacy field-name references are rejection or
negative disclosure tests, not transport/storage fields.

RLS is enabled with no ordinary-user table policies. Anonymous/authenticated
roles have no table/helper access; trusted service-role access is explicit. New
helpers are SECURITY INVOKER with empty fixed `search_path`. Existing security
boundaries and function grants remain intact; mobile requests cannot select their
viewer/owner ID. Owner responses contain month/day and privacy preference; friend
responses include month/day only after opt-in, accepted friendship, no block in
either direction, and no pending deletion. Metadata sharing is independent. Search,
identity lookup, public profile sharing, groups and Pick projections never receive
birthday data. Auth-user deletion cascades through profiles to the private table.
No notification or scheduled reminder is implemented.

## Signup, migration and rollout

Birthday is optional for every account. Signup offers Skip birthday; identity is
saved with null and no birthday guard redirects on restart. Edit Profile's Remove
birthday clears the draft and sharing; Save deletes private storage atomically.
Setup and preferences remain editable without a birthday. Existing accounts are
unchanged and no date is invented. No birthday notifications are introduced.

The repository records the owner's earlier confirmation that 0038 is undeployed.
This revision amends 0038 on that basis, preserving 0001–0037. Live verification
was unavailable (GitHub network failure; no linked Supabase project). Cached
origin/main ends at 0037; cached pending branches use 0039/0040, with no second
0038 filename found. Reconfirm deployment status and live PR ordering before
rollout. If any copy is deployed, preserve it and use a forward-only correction.
No shared database was changed.

Update the Privacy Policy and App Store disclosures for recurring birthday
month/day collection, purpose, default-off friend sharing, access, retention,
edits/clearing, and deletion. Explicitly state no birth year or age is collected
and reminders are not available. There is no age verification or age restriction.

## Review findings resolved

| Severity | Location | Scenario | Smallest fix applied |
|---|---|---|---|
| Medium | `app/settings/profile.tsx:76` | Web unsaved-change protection used native Alert, which does not provide a working web confirmation | Use browser confirmation on web; retain native Alert on iOS/Android. Test keep/discard paths |
| Medium | `src/components/ProfilePhotoEditor.tsx:136` | A stale reconciliation read after an uncertain photo request could regress the displayed revision | Ignore missing/older revisions; retain error and preview. Add regression test |
| Medium | `src/hooks/useProfile.tsx:152`, `app/settings/profile.tsx:31` | Month/day objects with different JSON key order/reference could look unsaved or unconfirmed | Compare month/day structurally and normalize form order. Test name-only saves and confirmation mismatch |

No unresolved blocking finding with a reproduction is known. Deployment access and
native-device coverage are validation limits, not evidence of hosted correctness.

## Validation evidence

- TypeScript (`npm run typecheck`), ESLint (`npm run lint`) and `git diff --check`: passed.
- Focused birthday/signup/editor/privacy Jest: 66 tests passed; focused editor/photo regression run: 37 tests passed.
- Full Jest (`npm test -- --ci --runInBand`): 1,263 tests, 155 suites passed.
- Deno backend entry-point typecheck and app/avatar/people/birthday tests: 127 passed.
- `python3 tests/db/birthdays.py`: migrations 0001–0038 applied to isolated PostgreSQL; upgrade compatibility plus seven suites passed (birthday, auth setup, integration identity guard, three username suites, photo readiness). Birthday SQL has eleven assertion groups including raw storage constraints, no date/year column, grants, block/unfriend, atomic rollback and deletion.
- Android and iOS Expo exports: passed. Build output is outside the repository in `/private/tmp/wtw-monthday-export`.
- Birthday parser/selector tests also pass with UTC+14 and US Pacific process time zones. Birthday code uses no Date/time-zone conversion.

Jest and Deno HTTP tests mock native modules and/or persistence stores. The SQL
harness runs real PostgreSQL constraints, functions, roles and grants, with minimal
Auth/Storage/cron stand-ins; it does not run GoTrue, PostgREST, Supabase Storage or
pgTAP. Real Supabase integration was unavailable: this checkout is unlinked,
Docker is not available on PATH, and CLI status/history attempts failed on the
sandboxed telemetry write. No hosted credentials, migrations or settings changed.

## Native QA before release

Check smaller iPhones and Android devices with keyboard and large Dynamic Type;
month radio choices/day input and VoiceOver/TalkBack focus; invalid day correction;
OTP/interrupted setup and account switching; dirty-form back gestures and discard;
partial network failure/retry; photo permissions, capability-disabled behavior,
preview/save/removal and revision conflicts. On real Supabase, verify fresh and
legacy accounts, raw grants/RLS, authorized vs blocked/removed friendships,
private responses and account deletion. Keep production photo readiness unchanged.

## Files reviewed

- `.github/workflows/ci.yml`
- `app/(tabs)/profile.tsx`
- `app/_layout.tsx`
- `app/p/[id].tsx`
- `app/settings/profile.tsx`
- `app/welcome.tsx`
- `docs/api-integration.md`
- `docs/edit-profile-precommit-review.md`
- `docs/privacy-inventory.md`
- `src/components/BirthdayField.tsx`
- `src/components/ProfilePhotoEditor.tsx`
- `src/components/Screen.tsx`
- `src/components/UserProfileMetadata.tsx`
- `src/hooks/useProfile.tsx`
- `src/lib/api.ts`
- `src/lib/mock/api.ts`
- `src/lib/mock/auth.ts`
- `src/lib/mock/store.ts`
- `src/lib/mock/userProfiles.ts`
- `supabase/functions/_shared/api/birthdays.ts`
- `supabase/functions/_shared/api/profile.ts`
- `supabase/functions/_shared/api/userProfiles.ts`
- `supabase/functions/api/app.ts`
- `supabase/functions/api/birthdays_test.ts`
- `supabase/functions/api/profileStore.ts`
- `supabase/migrations/0038_profile_birthdays.sql`
- `supabase/tests/auth_identity_setup_test.sql`
- `supabase/tests/birthdays_test.sql`
- `tests/auth/identityScreen.test.tsx`
- `tests/birthdays.test.ts`
- `tests/components/BirthdayField.test.tsx`
- `tests/components/EditProfile.test.tsx`
- `tests/components/Profile.test.tsx`
- `tests/components/ProfilePhotoEditor.test.tsx`
- `tests/components/SharedProfile.test.tsx`
- `tests/components/rootIdentityGuard.test.tsx`
- `tests/db/birthdays.py`
- `tests/hooks/profileAccountSwitch.test.tsx`
- `tests/lib/mockAuthOnboarding.test.ts`
- `tests/lib/mockUserProfiles.test.ts`
- `tests/profileStore.test.ts`
