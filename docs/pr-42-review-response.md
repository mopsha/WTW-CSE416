# PR #42 review response

Initial investigation on `josh/group-ideas`; review baseline `8c42477`.
This table was prepared before corrective implementation. Status describes the finding,
not whether its proposed remedy is appropriate.

| # | Finding | Status | Severity | Evidence | Recommended fix | Team decision |
|---|---|---|---|---|---|---|
| 1 | Pending invitation survives removal | Confirmed | High | 0025 hides pending invites while a member but link join does not resolve them; 0012 removal deletes only membership; resolving pending invite inserts membership again. Accepted-invite retries already fail safely after removal. | Invalidate pending pair invitations atomically under the removal group lock; preserve explicit bearer-link joins. | Optional owner revocation UI/API needs agreement; removal invalidation does not. |
| 2 | No message reporting | Confirmed | High | `ReportKind`, `report_create`, and reports constraint only accept user/pick/group; message UI has no report action. User reporting cannot preserve message evidence. | Extend established reports with authorized message snapshots and restricted moderator review; specify retention and operator access first. | Yes: approve message evidence retention and moderator access model before implementation. No cosmetic button. |
| 3 | No send rate limiting | Confirmed | High | 0028/0029 send RPCs insert without `rate_take`; only friends/reports/invite creation use the existing limiter. Each fresh message can notify all recipients. | Shared per-sender DB limiter across group/DM sends, burst and sustained windows; retry lookup before quota; PT429→HTTP 429. | No; conservative operational limits can be documented. |
| 4 | Old TestFlight invitations | Partially confirmed | High | `/groups/:id/members` now returns invitation status instead of direct addition; old callers cannot accept pending requests. Old binary not available to run here. | Consent must stay required; coordinate client-first TestFlight rollout and migration/API deployment; keep legacy `added: 0` response. | Yes: deployment timing and old-build support. |
| 5 | Failed profile lookup sends returning user to identity setup | Confirmed | Medium | `useProfile` replaces identity with null on failure/4s timeout; root guard ignores `failed`. Welcome already shows retry, so it does not silently submit new identity, but route and heading imply missing identity. Retry does not re-enter loading. | Distinct loading/lookup-failed/incomplete/complete gate; retry screen outside onboarding, no failed-lookup redirect. | No. Do not infer completion from auth metadata. |
| 6 | Refresh changes IDs and loses votes | Partially confirmed | Medium | Group Idea UUIDs regenerate, but 0003 `pick_refresh` deliberately deletes ALL candidates and cascades ALL swipe preferences. `refreshPick` requires confirmation when answers exist; ranking is after swiping. Existing tests assert snapshot rebuild. | Preserve current reset contract pending decision. Stable IDs alone do not preserve votes; proposed new vote-preserving behavior needs explicit snapshot/version rules. | Yes: retain confirmed reset semantics or design a separate vote-preserving operation. |
| 7 | Chat crowds 50-row inbox | Confirmed | Medium | `notifyStore.list` sorts newest first and limits to 50; `listNotifications` has no cursor; marking read does not remove a row. 51 newer messages hide older Pick events. | Add backwards-compatible pagination to existing inbox, leaving notifications/push/dedup unchanged. | No for pagination; grouping/prioritization would need agreement. |
| 8 | Group access loss blocks Group Ideas Picks | Partially confirmed | Medium | 0024 correctly rejects removed host; group deletion sets group_id null and start returns GROUP_REQUIRED 409. Existing lobby offers host cancel, and historic Pick snapshots are participant-readable. Draft cannot be edited to disable ideas. | Keep fail-closed membership; existing cancel/recreate is safe recovery. Propose explicit host action to discard private ideas and continue with ordinary candidates. | Yes for changing draft settings/active deck automatically or adding conversion flow. |
| 9 | Polling takes row locks | Confirmed | Medium | group_chat list invokes `lock_group_as_member` FOR UPDATE; direct_chat list locks friendship and conversation; group_ideas list/get locks group (get also locks idea). | Single-statement authorized read branches without row locks; retain write locking, RLS, and service-only RPC grants. | No. |
| 10 | Multiple migrations violate guide | Confirmed | Process | CLAUDE.md requires one migration per PR; 0023–0031 are nine migrations. | Document dependency/split strategy and request explicit exception or team-approved follow-up split. Never rewrite applied history. | Yes. Corrective schema work uses an additional new migration as explicitly requested. |

## Decisions proposed; disputed behavior remains unchanged

1. Reporting: approve `group_message`/`direct_message` report kinds; take a server-side immutable
   body/sender/conversation/group/message timestamp snapshot only when the reporter can currently
   read that message. Retain evidence after message/group deletion, restrict it to designated
   moderation operators through an audited server-side review path (never public RLS or a
   service key in the app). Decide retention duration, deletion exceptions, operator membership,
   audit retention, and incident ownership before shipping. Existing user/group reports remain
   available, but do not constitute message-specific evidence. No reporting feature added here.
2. Refresh: retain the current explicit reset-all-swipes operation. If the team instead wants
   vote preservation, approve a separate design defining unchanged vs edited idea snapshots,
   removed/reintroduced ideas, category changes, and candidate identities scoped to a Pick.
   Never reuse a globally shared custom place ID across Picks with different snapshots.
3. Group access loss: retain fail-closed start/refresh and existing host cancel/recreate path.
   Approve a separate explicit “Continue without Group Ideas” draft action if keeping the same
   draft is required. It must lock the Pick, authorize host/state, remove opt-in/provenance,
   and never read a former group's library. Active/historical snapshots remain under existing
   Pick participant access; do not retroactively erase them or bypass library membership.
4. Invitations: approve a separate owner “revoke invitation” action if needed. Removal
   invalidation is mandatory; bearer links remain reusable according to existing expiry rules,
   so removing somebody is not a permanent ban and does not revoke known join links.

## TestFlight deployment proposal

Keep invitation consent and the existing backward-compatible `added: 0` field; never claim
that pending invitees are members. Deploy schema before its API, and distribute the new
TestFlight client with incoming/outgoing invitations before enabling the new invitation flow
for testers. Verify accept/decline and link joins on two devices. Agree on the supported
minimum build and communicate an upgrade requirement to older testers; where old binaries
lack invitation UI they cannot accept pending invitations. An additive JSON field cannot
repair an installed binary's missing screens. Bearer-link joins remain a compatible explicit
consent path. Do not silently restore direct membership, auto-accept pending requests, or
ship a mandatory-upgrade system as an unreviewed feature. Rollback must preserve consent
and account for already-applied migrations. The old binary itself still needs device testing.

## Migration dependencies and team policy

- 0023: group library; depends on existing groups/membership locks (0012).
- 0024: idea candidates, mixed categories, lifecycle/Pick Again wrappers; depends on 0023,
  canonical lifecycle/custom option functions and 0020 Pick Again.
- 0025: invitation consent and notification wrapper; depends on groups, friendships,
  safety/blocks (0014) and notifications (0009).
- 0026: user profiles/privacy and username infrastructure; 0027 adds required identity setup.
- 0028: group chat depends on profiles/username, membership, blocks and 0025 notify wrapper.
- 0029: DMs depend on profiles/friendships/blocks and the 0028 notify wrapper chain.
- 0030: past moves depends on candidate snapshots/provenance and existing lifecycle/history.
- 0031: established-username guard depends on 0026/0027.

Safest practical choice is an explicit one-time exception for this already integrated PR,
including its corrective migration, with full migration replay and review. If the team requires
splitting, first inventory which migrations are already deployed. Preserve those immutable
files and IDs. On team-authorized branches, extract/review in dependency order: ideas+candidate
integration, invitations, profiles+identity, group chat, DMs, past moves, integration fixes.
Each slice needs its own compatible app/API/tests and predecessor base. Wrappers rename and
move earlier functions; independently cherry-picking migrations or squashing applied migrations
can break RPC chains, notification delivery and migration tracking. A one-migration rule may
require combining only genuinely unapplied changes on newly authorized task branches after
team agreement, not renumbering this branch. Do not split or rewrite history automatically.

## Final disposition

| # | Result | Action taken |
|---|---|---|
| 1 | Confirmed; fixed | Owner removal locks group, resolves pending pair invitations as declined, marks their notices read, then deletes membership atomically. Mock removal follows consent semantics. |
| 2 | Confirmed; decision required | Existing user/group reports still work. Message-specific evidence and moderator review are not implemented; proposed decision above. |
| 3 | Confirmed; fixed | New DB trigger uses existing private event table and advisory-lock pattern. One sender budget across group/DM: 10 per 10 seconds, 60 per minute, 500 per hour. Existing IDs retry without quota; conflicting IDs still return 409. PT429 maps to HTTP 429 in both adapters. Existing notification uniqueness still prevents retry pushes. |
| 4 | Partially confirmed; rollout decision required | Existing `added: 0` compatibility retained; no automatic membership restored. Missing old-client invitation UI remains unavoidable without an upgrade or explicit bearer-link join. |
| 5 | Confirmed; fixed | Lookup failure has its own root retry screen, without mounting guarded navigation or assuming incomplete identity. Retry enters loading and is tagged by attempt; account-switch/late results cannot populate the wrong user's identity. Successful incomplete profiles still require setup; successful complete profiles enter the app. |
| 6 | Partially confirmed; proposed cause disproved | SQL regression reuses identical candidate IDs and snapshots and still clears all swipes. This is the documented confirmed-refresh contract, not a UUID-induced vote loss. ID generation, ranking, immutable historical snapshots and Pick Again are unchanged pending product decision. |
| 7 | Confirmed; fixed | Existing GET /notifications accepts an optional `before` cursor and adds `nextCursor`. Stable timestamp/ID ordering preserves microseconds. Inbox loads older rows with retry; mock API follows pagination. Read state, notifier insertion, deduplication, push and page-scoped unread-count meaning are preserved. |
| 8 | Partially confirmed; recovery proposal documented | Removed host gets 404; deleted group yields GROUP_REQUIRED 409. This prevents unauthorized library reads. Existing host Cancel + create-new-Pick is available; the stronger “permanently unusable” claim is not reproduced. Optional same-draft conversion needs agreement. Existing participant access to frozen active/historical snapshots is preserved. |
| 9 | Confirmed; fixed | Group chat list, DM list, Group Ideas list/get use single-statement authorized reads. Original locks on sends, open/create, edits, removal and lifecycle commit remain. RLS and server-only RPC grants preserved. |
| 10 | Confirmed; team decision required | No branches/history/old migrations rewritten. Added the explicitly requested forward corrective migration 0032; exception or split approval remains outstanding. |

No finding was dismissed wholesale. The ID-regeneration explanation of lost votes and the
claim of no draft recovery were not reproduced as stated; their underlying observations
(changed IDs, denied start/refresh) are real. The old TestFlight binary was not available
for an installed-client reproduction.

## Regressions and evidence

- Before 0032, `pr42_review_test.sql` fails with **Old pending invite re-added removed member**
  after exercising real `invite_create` / `invite_accept`, not just directly inserting a member.
  After 0032 all eight assertions pass, including fresh invitations, bearer rejoin, burst/minute/
  hourly caps, retries at cap, conflicts, independent senders, quota recovery, notification
  deduplication and denied reads after access revocation.
- `tests/db/pr42_concurrency.py` uses actual independent PostgreSQL connections. Original
  polling functions fail its 700ms statement timeout while waiting on a group FOR UPDATE.
  Corrected polling succeeds despite held group/friendship/conversation locks. Twenty concurrent
  sends across transports admit exactly ten; twenty simultaneous retries of a successful ID at
  the cap all succeed without increasing quota. CI now invokes this after the SQL suite.
- `group_idea_candidates_test.sql` adds an identical-ID/snapshot refresh regression inside a
  rolled-back savepoint; all preferences reset, and original historical ranking/vote checks
  still run. Existing 55-message paging fixtures explicitly age quota events to represent
  historical paced sends rather than an abusive burst.
- Jest covers profile error/timeout/retry/account switching; root navigation's failed/loading/
  complete/incomplete states; pending-invite resurrection in mocks; HTTP 429 adapters; inbox
  overflow with 51 newer messages, timestamp ties/precision, invalid cursors, and adapter
  filtering by verified user.
- Deno route tests cover 429 propagation with no notifier call on rejected sends, and the
  additive inbox response. Existing feature/authorization/mock tests remain passing.

## Validation results

| Validation | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test -- --ci --runInBand` | PASS: 114 suites, 864 tests |
| `deno check --config supabase/functions/api/deno.json supabase/functions/api/index.ts` | PASS (cached local Deno 2.9.6 binary) |
| `deno test --config supabase/functions/api/deno.json supabase/functions/api/app_test.ts` | PASS: 87 tests |
| Ordered local migration replay | PASS for 0001–0032 except 0007, in isolated PostgreSQL 14 with minimal Supabase auth/role bootstrap. 0032 applied after the pre-fix reproduction. This is not a full Supabase replay. |
| Full SQL suite attempted | 15 of 28 files PASS, including all Group Ideas/invitations/chat/DM and new regressions. 13 blocked at CREATE EXTENSION pgtap: local extension files unavailable; no assertion failures in runnable files. No pgTAP stubs substituted. |
| Migration 0007 | BLOCKED: pg_cron unavailable; this migration also requires pg_net and Vault, so full Supabase migration replay remains required. |
| Two-connection concurrency regressions | PASS; original functions fail as expected; corrected functions and concurrent retries pass. |
| Docker-backed Supabase/API tests | NOT RUN: Docker executable unavailable. Hosted CI must run db reset, pgTAP/RLS and authenticated HTTP tests. Supabase CLI status also hit a sandbox telemetry-file write restriction; no hosted service accessed. |
| `CI=1 expo export --platform android` | PASS; output `/private/tmp/pr42-android-final` |
| `git diff --check` | PASS |

Temporary test database work used a dedicated local PostgreSQL cluster, not project or hosted
data. No commits, pushes, merges, rebases, branches or additional PRs were created.
Expo SDK 57 docs and Router authentication guidance were read before UI changes:
[versioned reference](https://docs.expo.dev/versions/v57.0.0/),
[documentation index](https://docs.expo.dev/llms.txt),
[authentication](https://docs.expo.dev/router/advanced/authentication/).

## Remaining deployment limitations and readiness

Apply 0032 before the corrected API; otherwise send quotas and lock-free reads are absent.
Deploy the API before the pagination client; the new client tolerates a missing `nextCursor`
from an older API. Old clients ignore the additive field but still cannot load older inbox pages
or accept direct invitations without their new screens. Operational quota thresholds are
explicit above and can be tuned in a later forward migration if real usage warrants it.

The correction cannot reconstruct historical removal events that were never recorded. If the
bug was exercised before deployment, owners should review known removed users and repeat the
owner removal operation for those pairs to invalidate lingering requests. Do not bulk-decline
all legitimate pending invitations without team agreement. Removal is not a ban; bearer links
retain their existing policy. No offline identity cache was introduced: a cold-start user whose
identity cannot be confirmed stays at retry rather than bypassing required setup.

PR #42 is ready for another focused review of these corrections and the proposed decisions.
It is **not merge/release ready**: message-reporting scope and moderator operations, TestFlight
rollout, the migration-policy exception/split, and full Docker/Supabase validation remain open.
Refresh policy and optional same-draft recovery must be explicitly accepted as existing behavior
or scheduled as separately approved changes; they were not silently changed here.

## Exact files changed

- `.github/workflows/ci.yml`
- `app/_layout.tsx`
- `app/inbox.tsx`
- `docs/pr-42-review-response.md`
- `src/hooks/useProfile.tsx`
- `src/lib/api.ts`
- `src/lib/mock/api.ts`
- `src/lib/mock/groups.ts`
- `supabase/functions/_shared/api/notify.ts`
- `supabase/functions/api/app.ts`
- `supabase/functions/api/app_test.ts`
- `supabase/functions/api/directChatStore.ts`
- `supabase/functions/api/directChat_test.ts`
- `supabase/functions/api/groupChatStore.ts`
- `supabase/functions/api/groupChat_test.ts`
- `supabase/functions/api/notifyStore.ts`
- `supabase/migrations/0032_pr42_review_fixes.sql`
- `supabase/tests/direct_messages_test.sql`
- `supabase/tests/group_chat_test.sql`
- `supabase/tests/group_idea_candidates_test.sql`
- `supabase/tests/pr42_review_test.sql`
- `tests/auth/rootIdentityGuard.test.tsx`
- `tests/chatRateLimitStores.test.ts`
- `tests/db/pr42_concurrency.py`
- `tests/hooks/profileLookupFailure.test.tsx`
- `tests/lib/mockGroupInvitations.test.ts`
- `tests/notificationPaginationStore.test.ts`
- `tests/notify.test.ts`
