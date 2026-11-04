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

Only the existing **unmerged feature migration** `0033_profile_photos.sql` is
extended, respecting the repository's one-migration-per-PR convention. No released
main migration or #44/#48 migration was edited. Before merge, verify applied
migration history and reconcile its version with #44's 0033 and #48's 0034. If any
shared environment already applied this feature migration, use an additive team-
coordinated deployment migration rather than expecting this file to rerun.

## Phase B — proposed implementation, NOT authorized or implemented

Inspected #44 at `bea341a`: it already owns `reports`, `reported_user_id`, the
private moderation queue, service-only report creation, rate limits, review state,
and the moderation runbook. Reuse that infrastructure after integration; do not
create a parallel report system. #45 at `45d24e0` owns published disclosures.

Concrete proposal:

1. Add `profile_photo` to the existing report kind union/validation/SQL constraints.
   Report the displayed owner's ID and immutable photo revision. The verified
   reporter must be authorized for that revision; never trust a client object path.
2. In one server-only reporting transaction, lock the owner's profile and attach
   the current immutable object path/revision to the report, with reported_user_id
   set for #44's account-deletion cascade. A stale revision conflicts rather than
   accidentally reporting a newer image. This keeps evidence of the specific file.
3. Retain that referenced object privately. Replacement/removal cleanup and orphan
   queries must exclude report evidence. A report attaches only while the locked
   revision is current, so it cannot race a retired-object deletion decision.
   Reuse the immutable original rather than copying image pipelines or storing
   image bytes in report JSON. Add real replacement/report/sweep race tests.
4. Provide a service-only moderator tool using existing authorized operator
   credentials, existing private queue, and authenticated Storage download. No
   public URLs or mobile service credentials. Log report/action IDs, never bytes,
   paths or signed credentials. The runbook must cover private viewing and access.
5. Moderator removal locks the profile, verifies the reviewed revision, clears the
   reference and advances revision. Existing stale owner uploads then conflict.
   Removing an old reported revision must not silently remove a different new
   picture. Whether to suspend future uploads is a separate team decision;
   revision checks prevent stale restoration, not a deliberate new re-upload.
6. Account deletion removes owner-prefix evidence through Storage API before Auth
   deletion and cascades reports as #44 defines. Reporter deletion drops its report
   reference; unreferenced retired evidence becomes eligible for cleanup. Decide
   evidence retention after review and cleanup timing before implementing these
   rules. Do not invent a retention period or contradict existing deletion promises.
7. Extend #44's existing report/block sheet with a photo-specific action carrying
   the displayed revision. Reconcile its placement with #43 once that UI merges.

Required team approval: evidence audience/tool access, retention after review or
reporter deletion, moderation owner/response commitment, upload suspension policy,
and disclosure language. A separate report-after-block exception needs an explicit
policy and proof of eligibility; do not infer it from #44's historical DM policy.

## Disclosures and Phase C integration

`docs/privacy-inventory.md` now records uploaded JPEGs, audience, revisions,
cleanup/retry state and draft Photos or Videos label mapping. This is factual
inventory, not finalized legal text. In #45 remove "you can't upload photos", add
photo collection/purpose/audience/deletion and approved evidence retention, and
have the responsible team review the final policy and App Store Connect labels.
Do not claim moderation evidence exists before Phase B lands.

After #43 merges, keep a single authenticated loading/cache path: adapt its
SocialIdentity to the existing managed Avatar/hook via opt-in presentation props,
not a second Image network implementation. Preserve its approved size/colors.
ProfilePresentation and ConversationHeader must pass person ID + optional ref;
MessageThread must pass sender ID/ref for group senders; Friends/member rows must
pass IDs even with null refs. Keep group monograms unmanaged. Combine
OwnProfileDetails' redesign variants with photo busy guards and preview behavior.
Retain root account/background lifecycle and all redesign messaging fixes.
No #43 code was copied, merged, checked out or modified in this pass.

## Gates

Merge: resolve migration numbering/applied history; integrate approved #43 UI;
review Phase A and obtain green real SQL/Storage/HTTP/concurrency CI.
App Store release: approve and implement Phase B, publish accurate reviewed #45
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
- `supabase/migrations/0033_profile_photos.sql`
- `supabase/tests/profile_photos_test.sql`
- `tests/account.test.ts`
- `tests/api/avatars.test.mjs`
- `tests/components/AvatarPhotos.test.tsx`
- `tests/db/avatar_concurrency.py`
- `tests/lib/avatarCache.test.ts`
- `docs/profile-photos-review-plan.md`
