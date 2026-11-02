# M4 integration review — Josh

Reviewed `integ/m4` at `698ffac` on 2026-11-01. No branch change, PR merge,
push, rebase, approval, or separate date-options feature was performed.

## Provenance

The lists below are each integration merge's diff against its first parent,
including merge-resolution changes. Follow-up fixes are part of the review too:
`164abe1` (account test column grants), `49c9ac0` (group creation read failure,
private outgoing friend requests and migration 0018), and `1dd9beb` (inbox UI).

### PR #30: merge `338fcb8`, source tip `a3d0d68`

```text
app/(tabs)/index.tsx
app/groups/[id].tsx
app/groups/_layout.tsx
app/groups/index.tsx
app/pick/new.tsx
docs/api-integration.md
docs/design.md
package.json
src/lib/api.ts
src/lib/groups.ts
src/lib/mock/api.ts
src/lib/mock/groups.ts
src/lib/mock/queries.ts
src/lib/queries.ts
supabase/functions/_shared/api/groups.ts
supabase/functions/api/app.ts
supabase/functions/api/app_test.ts
supabase/functions/api/groupsStore.ts
supabase/functions/api/index.ts
supabase/migrations/0012_groups.sql
supabase/tests/groups_test.sql
tests/api/groups.test.mjs
tests/groupsStore.test.ts
tests/lib/mockGroups.test.ts
```

### PR #33: merge `50c4238`, source tip `4442ddc`

```text
app/(tabs)/friends.tsx
app/(tabs)/profile.tsx
app/pick/[id]/index.tsx
docs/api-integration.md
docs/bugs.md
package.json
src/lib/api.ts
src/lib/mock/api.ts
src/lib/mock/friends.ts
src/lib/push.ts
src/lib/queries.ts
src/lib/types.ts
supabase/functions/_shared/api/account.ts
supabase/functions/_shared/api/closing.ts
supabase/functions/_shared/api/friends.ts
supabase/functions/_shared/api/groups.ts
supabase/functions/_shared/api/hang.ts
supabase/functions/_shared/api/heartbeat.ts
supabase/functions/_shared/api/lifecycle.ts
supabase/functions/_shared/api/profile.ts
supabase/functions/_shared/api/progress.ts
supabase/functions/_shared/api/voting.ts
supabase/functions/api/accountStore.ts
supabase/functions/api/app.ts
supabase/functions/api/app_test.ts
supabase/functions/api/friendsStore.ts
supabase/functions/api/index.ts
supabase/functions/api/progressStore.ts
supabase/migrations/0017_account_deletion.sql
supabase/tests/account_deletion_test.sql
tests/account.test.ts
tests/api/account.test.mjs
tests/friends.test.ts
tests/lib/mockFriends.test.ts
tests/progress.test.ts
```

### PR #34: merge `8e0a1b1`, source tip `ef371d9`

```text
app/_layout.tsx
app/i/[token].tsx
app/pick/[id]/lobby.tsx
app/pick/[id]/waiting.tsx
docs/api-integration.md
package.json
src/components/HostMenu.tsx
src/components/MemberMenu.tsx
src/components/PickParts.tsx
src/lib/api.ts
src/lib/join.ts
src/lib/mock/api.ts
src/lib/mock/queries.ts
src/lib/mock/store.ts
src/lib/pendingInvite.ts
src/lib/queries.ts
supabase/functions/_shared/api/friendRequests.ts
supabase/functions/_shared/api/invites.ts
supabase/functions/_shared/api/join.ts
supabase/functions/_shared/api/safety.ts
supabase/functions/_shared/api/text.ts
supabase/functions/_shared/domain/inviteLink.ts
supabase/functions/_shared/domain/textFilter.ts
supabase/functions/api/app.ts
supabase/functions/api/app_test.ts
supabase/functions/api/friendRequestLimit.ts
supabase/functions/api/index.ts
supabase/functions/api/inviteStore.ts
supabase/functions/api/joinStore.ts
supabase/functions/api/rpcErrors.ts
supabase/functions/api/safetyStore.ts
supabase/migrations/0014_invites_safety.sql
supabase/tests/invites_safety_test.sql
supabase/tests/join_and_security_test.sql
tests/api/safety.test.mjs
tests/domain/textFilter.test.ts
tests/joinStore.test.ts
tests/lib/join.test.ts
tests/lib/mockInvites.test.ts
tests/lib/mockJoin.test.ts
tests/lib/pendingInvite.test.ts
tests/safety.test.ts
tests/safetyStores.test.ts
tests/text.test.ts
```

## Review and fixes

- #30: group owner/member authorization, friend checks, caps, service-only RPCs,
  membership/profile RLS, creation compensation, client reads/screens and mocks.
  Mock group additions/invites incorrectly used fixed fixture friendships. They now
  use the existing mock friendship store, reflecting acceptance, removal and blocks.
- #33: verified-token DELETE /me, Auth admin adapter, error sanitization, cascade
  trigger permissions, solo/shared Picks, nullable hosts/read-only history, custom
  creator erasure, group/token cleanup and client sign-out. No account-deletion
  implementation change was necessary. A rollback-only PostgreSQL smoke check
  exercised shared custom Picks, solo deletion, owned groups and cancellation inbox.
- #34: invite randomness, expiry/revocation/use caps, generic rejection/join limits,
  host/member authorization, lobby lock, bidirectional blocks, private reports,
  friend-request enumeration protection, text filtering and notification integration.
  Confirmed full-Pick guard rejected even duplicate membership inserts before
  ON CONFLICT; 0019 skips the cap for existing members. The Groups adapter now maps
  `pick_full` to 409 PICK_FULL rather than 500. Mock invitations enforce the cap too.
- Integration/history: Pick again copied historical group members and dropped
  filters/custom options. Migration 0019 preserves M4 settings and custom snapshot
  identities and uses canonical pick_add_group for current group membership.
  Mocks match. Existing historical membership, swipe/rank/vote engines stay intact.

Repeat semantics: a surviving group supplies its current members, with the existing
block guard. If the host has left that group, the new draft contains only the host
and has no group label. If the group was deleted (FK set null), ordinary repeat
semantics apply. Existing host-only, finished-state and duplicate-draft gates remain.
Migration 0019 replaces functions while retaining their existing service-only grants.
It does not add tables or date/time polling.

## Validation

- Lint and app TypeScript: passed.
- Jest: 70 suites / 664 tests passed, including six additional cases.
- Deno API tests: 68 passed; Deno index typecheck passed.
- Android export: passed (temporary output outside the repository).
- Applied all migrations except cron/Vault/net-dependent 0007 to an isolated local
  PostgreSQL database with a minimal Auth bootstrap. This is not a Supabase deployment.
- Standalone SQL: pick_again_integration (4), custom_plans_hang (9), and
  saved_places_limits (9): all 22 assertions passed, including real RLS/cap/lifecycle
  checks. Additional rollback-only account/block/invite/notification smoke passed.
- Full HTTP suite attempted: all five entry tests stopped because the local Supabase
  stack was unavailable. Docker is absent. pgTAP is absent, so the remaining SQL
  suites (groups, account deletion, safety, etc.) could not run here. CI's full
  Supabase job must pass on these changes before approval.

## Remaining acceptance risks

- Shared hang visibility/responses and hang-to-Pick creation remain intentionally
  unavailable (503); group hang creation is also disabled. This is an existing,
  documented partial feature, not a tested two-down-user flow. Either cut it for M4
  explicitly or finish its shared authorization/atomic creation integration separately.
- Invite acceptance after sign-in/name/onboarding, group link destination, actual
  deep links on both platforms, push delivery/taps, and deleted-session behavior need
  device/Supabase checks. Group invite acceptance currently lands on Friends rather
  than opening the existing group screen; it succeeds in the backend.
- Mock group links, invite expiry/use caps, report quotas and account-data deletion
  do not fully simulate Supabase; do not use mock UI success as security evidence.
- Existing requirements-status gaps remain: Google Pick persistence/provider setup,
  Discover per-user quota, missing invite/revoke/group-history UI, and RSVP sweep
  prompt timing. No broad redesign or separate scheduling feature was added.

Recommendation: do not give an unconditional approval of #35 yet. Review this diff,
require green full Supabase CI and device checks for the reviewed flows, and agree
on the documented M4 cuts/partial features.
