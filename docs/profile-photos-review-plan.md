# Profile-photo review: implemented follow-ups and approval plan

Started from clean `josh/profile-pictures` at `4a9f68e`, matching the current PR #49
head retrieved during this pass. No newer commits were present locally or on the PR.
The earlier Friends/editor freshness and CI fixture fixes are already in that commit.
No claim that the remaining Phase A findings were already fixed.

## Phase A — implementation

- Photos are independent of profile metadata sharing. Owner/accepted-friend/current
  shared-group visibility stays; Pick-only visibility ends at completed/canceled.
  Draft, swiping, ranking and final_vote are active per the actual lifecycle enum.
- Deletion intent stays durable. Failure before a successful freeze has no new
  destructive action. Once freeze succeeds (or its response is uncertain), there
  may be deleted files or an in-flight Auth deletion, so automatically clearing
  the flag is unsafe. The sweep now claims up to five pending accounts for retry,
  with five-minute leases. Storage failure never proceeds to Auth deletion;
  uncertain Auth results retry safely, including 404 after an earlier success.
  A permanent failure needs operator investigation; there is no unsafe "restore".
- Navigation revalidates metadata, but doesn't flush bytes. Focus, resume and local
  photo/block/unfriend events still recheck or invalidate through the same cache.
  Backgrounding and account changes clear bytes and reject stale in-flight results.
- Foreground metadata polling is 30 seconds rather than five (120 vs 720 interval
  requests/hour for one batch), plus focus/navigation events. Batches remain 100.
  A successful authorization/download grants a 60-second lease measured from request start. Transient network,
  429 and server errors do not instantly erase images; cache reads, render keys, and subsequent checks enforce expiry. Already rendered
  pixels require another JS render/check; request completion, retries and JS
  scheduling mean there is no hard post-revocation wall-clock bound. Explicit 401/403/404 or omitted
  identities in a successful resolver response invalidate without that grace.
  Polling pauses its work when backgrounded; local revocation is immediate.
- Server reads use existing atomic counter patterns: 600 downloads and 120 batched
  resolves per authenticated viewer per minute. These are separate from uploads
  and allow normal avatar grids. They are abuse bounds, not bandwidth guarantees.
- Orphan cleanup uses a persistent claim: one batch of at most 100 per hour;
  failed/crashed workers retry after five minutes. The original 24-hour orphan
  age and 15-minute finalization separation remain. Active objects are excluded.
- Photo-maintenance outcomes are returned/logged separately. Deadline/cache status
  is not overwritten by photo failure. Monitor `photo_maintenance.avatarCleanup`
  and deletion retry failures; a 200 overall sweep alone doesn't prove photo health.

The repository schedules the deadline sweep in migration 0007 and uses deployment
Vault values. Mike's updated #48 description reports the wtw-dev minute job as
active/returning 200. This pass did not independently query deployed cron/Vault.
DB claims throttle photo work regardless of caller cadence. Verify the new claim
RPCs, orphan deletion and retry progress on the actual deployed database.

The photo SQL is in the unapplied feature migration `0035_profile_photos.sql`.
Mike verified wtw-dev history and absence of photo objects before the rename;
no deployed migration was rewritten. PR #48 reserves 0034 and must precede 0035
unless the team coordinates numbering.

## Phase B — implemented, policy enablement pending

Reuses #44's reports table, shared 10/day report limiter, private queue, existing
operator trust boundary and report/block sheet. Revision-specific photo reports
require current read eligibility, reject self reports, and lock the owner profile.
Duplicate reporter/owner/revision submissions do not renew expiry or consume the
quota again. Normal message reporting remains unchanged.

Unexpired reports pin the immutable private original. Replacement/removal and
orphan cleanup exclude it. Service-only operator RPCs retrieve evidence and remove
only the reported current revision; removal advances the revision so stale uploads
fail. `scripts/moderate-profile-photo.mjs` uses existing operator credentials,
private 0600 local files and no signed URLs. Expiry denies historical evidence lookup; deletion intent denies both historical and
current-photo operator lookup. Current-photo review after expiry is revision-bound and does
not repin historical evidence. The existing Storage-before-Auth account adapter includes evidence.

`private.photo_moderation_config.retention_seconds` defaults NULL and
`moderation_ready` defaults false. Uploads and valid photo reports return 503 until an
authorized operator records the approved interval and explicitly confirms readiness.
No production retention period, moderator roster, alerting, access delegation,
local-copy policy, upload-suspension policy or final disclosure text is assumed.
Expired paths are released to the existing bounded orphan sweep; physical erasure
is not promised at the expiry instant. Report metadata follows #44 cascades.

See `moderation.md` for the concrete workflow and PR #45 file-level follow-ups.
Real Storage/HTTP, concurrency and native testing remain rollout gates. Nothing
was deployed or changed in a shared project during implementation.

## Disclosures and Phase C integration

`docs/privacy-inventory.md` now records uploaded JPEGs, audience, revisions,
cleanup/retry state and draft Photos or Videos label mapping. This is factual
inventory, not finalized legal text. In #45 remove "you can't upload photos", add
photo collection/purpose/audience/deletion and approved evidence retention, and
have the responsible team review the final policy and App Store Connect labels.
The implementation exists on this branch but is not deployed or policy-enabled.

PR #43/#44 main integration now uses one authenticated loading/cache path:
SocialIdentity delegates to Avatar's opt-in social presentation variant, preserving
its size, colors, labels, and initials. ConversationHeader, ProfilePresentation,
Friends and group-message senders forward person IDs and optional photo refs.
Group monograms remain unmanaged. OwnProfileDetails retains its redesign variant
and photo busy guards. Root account/background invalidation and the three chat
send/draft/header fixes remain intact. Phase B is implemented but requires explicit retention configuration, readiness confirmation, and team policy approval.

Mike confirmed through read-only wtw-dev queries that the photo migration had
never been applied and that no photo schema/bucket/policies/functions existed.
Only this unapplied feature migration was renamed to 0035. Main's deployed
0033_message_reports.sql is unchanged. PR #48 reserves 0034 and must land before
0035 is applied unless the team coordinates migration numbering. No placeholder
0034 was added and no shared database was changed.

## Gates

Merge: land or coordinate #48 migration 0034 before photo migration 0035;
review Phase A and obtain green real SQL/Storage/HTTP/concurrency CI.
App Store release: approve and configure Phase B, publish accurate reviewed #45
policy/labels, assign moderation ownership, verify deployed maintenance, and test
native selection/HEIC/permissions/private rendering/account switching. Passing
mocks, local Deno codecs or Android export is not proof of Storage enforcement.

## Validation in this pass

TypeScript, lint, 125 Jest suites / 934 tests, Deno typecheck and 101 Deno
app tests passed. Android export passed; diff and Python/JS syntax checks passed.
The SQL runner and real avatar HTTP test were attempted but cannot reach a usable
local Supabase stack here (CLI sandbox restrictions also affect local status).
The added SQL lifecycle/quota/claim assertions, PostgreSQL race claim, and real
Storage/HTTP assertions require Docker-backed CI; no mocked test proves them.
No packages, branch history, remote comments or deployment state were changed.

Exact files changed:

- `docs/privacy-inventory.md`
- `docs/profile-photos-phase1.md`
- `docs/profile-photos-phase2.md`
- `src/hooks/useAvatarSource.ts`
- `src/lib/avatarCache.ts`
- `src/lib/mock/userProfiles.ts`
- `supabase/functions/api/accountStore.ts`
- `supabase/functions/api/app.ts`
- `supabase/functions/api/avatarStore.ts`
- `supabase/functions/api/avatars_test.ts`
- `supabase/functions/api/index.ts`
- `supabase/migrations/0035_profile_photos.sql`
- `supabase/tests/profile_photos_test.sql`
- `tests/account.test.ts`
- `tests/api/avatars.test.mjs`
- `tests/components/AvatarPhotos.test.tsx`
- `tests/db/avatar_concurrency.py`
- `tests/lib/avatarCache.test.ts`
- `docs/profile-photos-review-plan.md`


## Targeted Phase B correctness follow-up

Live duplicate reports remain idempotent; expired/cleaned reports now return an
explicit PHOTO_REPORT_EXPIRED conflict after normal authorization, without quota
consumption or an invented new retention cycle. Moderator removal locks owner then
report, re-reads authoritative report data, uses wall-clock expiry, and requires
exactly one review update. Expiry only locks reports and does not reverse that order.
The operator CLI requires an explicit hosted/local mode, a separately approved
hosted project reference, and recognized modern or legacy service credentials
before any network request. Deterministic SQL tests force both report/retirement
orderings, concurrent duplicate accounting, and removal versus deletion/expiry/
replacement instead of relying on an uncontrolled race.

Finding 5 remains an approval gate: no established evidence-read audit mechanism
was found in source. Mike must approve a private audit sink, minimal report/action/
time/project/outcome events, verified operator identity, retention, staff access and
incident handling. Shared service keys and self-asserted operator names are not
accountable human identity. Platform audit coverage must be demonstrated, not
assumed. See moderation.md; no audit mechanism or final policy was invented here.


## Latest review at 38eb2af

Implemented explicit `moderation_ready` plus approved retention as SQL upload/report
gates, including finalize-time upload rechecks and authenticated short-lived client
capabilities. Reads, owner/account removal and authorized operator work stay available.
Existing group/Pick/chat safety menus derive the actual natively displayed photo
revision through the shared loader; no friends-only profile authorization is widened.
Generic name/profile complaints remain user reports, distinct from photo evidence.

Service-only current-photo verification/removal now works for the same reported
revision even when historical evidence has expired. It never returns a replacement
or revives expired evidence; CLI current viewing rechecks after download. Removal
resolves every eligible exact-revision report with preserved notes and a source/action
outcome, not invented operator attribution. Expiry uses a bounded SKIP LOCKED batch.

Mutual reporting reproduced PostgreSQL 40P01 in the former owner FOR UPDATE lock:
rate-limit event foreign keys needed KEY SHARE locks on the opposite reporter.
FOR NO KEY UPDATE removes that conflict while still excluding photo changes. The
regression uses actual PostgreSQL lock contention, not a speculative timing claim.

Deferred: post-block/group-removal report authorization needs a trustworthy bounded
server receipt and possibly retired-object grace retention. No such record exists;
client native-load markers are UI state, not server proof. No history/receipt policy
or TTL was invented. See moderation.md for receipt alternatives and the comparison
of restricted CLI versus Dashboard across both message and photo evidence. Mike
must approve the unified access/audit/retention/incident policy and receipt scope
before readiness is enabled or the feature ships.
