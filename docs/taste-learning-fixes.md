# PR 75 taste-learning fixes

Work starts from Mike's `60743a8d69e20dccaf6f562077b81b92506227b1` on separate branch `codex/pr75-taste-learning-fixes`. Audited main is `23d062f72b30ed7d619a9959d49619e86a2402e4`. No commits, remote migrations or deployments are part of this task.

## Candidate identity and lifecycle

0047 used `candidate_created_at` to associate an optional score with a deck. PostgreSQL `now()` is transaction-scoped, so start and refresh in one transaction can create identical timestamps. If optional cleanup fails, a neutral replacement could inherit an obsolete score.

Forward migration 0049 gives each `pick_candidates` row a server-generated UUID `taste_generation`. Refresh's existing delete/insert creates new UUIDs even within the same transaction. The cache stores `candidate_generation`; close reads a score only when Pick ID, place ID and generation all match. Identity comes from authoritative candidate rows, never client input. The legacy timestamp column remains solely for compatibility with existing 0047 schemas and is never an identity check. No Pick-row backfill, new lifecycle stage or ranking algorithm is added.

Candidate cache rows still have no foreign keys. 0049 explicitly removes any FKs left by earlier 0047 previews and normalizes the earlier cache schema that lacked a timestamp column. It also restores the uncapped aggregate view for previews that still capped before decay. Legacy cached scores are discarded rather than trying to infer trustworthy generations from timestamps. Existing active Picks may therefore temporarily lack optional taste tiebreaks until refresh; normal ranking, winners, swipes and votes remain intact.

## Optional operations and cleanup

Score saving, lifecycle cleanup, optional close enrichment and deferred cleanup have local 200 ms lock timeouts. Each exception boundary contains only optional cache work. Canonical authorization, state validation and snapshot reads remain outside optional exception handling. SQL statement cancellation is not swallowed. `SKIP LOCKED` avoids row waits; the timeout also bounds conflicting table locks. No cascade can block core transitions through the cache.

The sweep deletes cache rows if the Pick is missing/finished/canceled, the candidate is missing, the UUID generation differs, or the current source is Google. It handles active Picks with No deadline, preserves current non-Google scores, skips locked rows, and retries on later sweeps. Cleanup is idempotent. The existing Google coordinate purge delegates optional work to this bounded helper; its canonical expiration/coordinate behavior is preserved. Public/API contracts, availability eligibility, frozen voting cohorts and post-result scheduling remain unchanged.

## Google behavior and legacy data

The API still uses live Google types in memory to order the current recommendation deck and enrich badges through existing bounded reads. It sends neither Google `tasteType` nor Google-derived numeric `tasteScore` to persistence. Database score saving independently ignores Google candidates; a before-write trigger strips Google `tasteType`, and the learning lookup refuses Google sources. These safeguards also cover older API instances during deployment.

Google-backed long-term swipe, vote and winner learning remains disabled. Google places no longer receive a persisted group-taste ranking tiebreak; their ordinary swipe/vote, distance and ID behavior remains. Non-Google learning and taste tiebreaks continue. No new provider request, runtime dependency, cache or content log is added. Existing attribution and live read fallback are unchanged. This conservative data-path change is not a legal compliance determination for every live Google use; any future persistent provider-derived learning requires a verified permission or independent source.

0049 clears all legacy optional candidate scores and removes stored Google `tasteType` immediately. Legacy `taste_signals` did not record source provenance. For existing signals whose source hash matches a current non-Google swipe, ballot or winner, the migration reconstructs the type and weight from that independent current owned evidence. It never trusts the legacy type merely because a hash still matches. The WTW action timestamp is retained, and previously reset/deleted signals are not recreated. Google and unverifiable historical signals are reset. This can remove formerly non-Google learning whose original Pick/candidate no longer exists; preserving it would require guessing its provenance. Explicit preferences, actual swipe/vote records and results are preserved. Rollout owners must review this one-time privacy reset.

## Migration and deployment

0047 is not rewritten because absence from every shared preview could not be proved. 0049 is a forward migration compatible with the current 0047 schema and the earlier FK/no-timestamp preview schema. Main's successful wtw-dev deployment provides evidence for 0046, but direct remote-ledger access was unavailable. Do not infer other environments' applied versions from file names alone.

PR 71 reserves 0048. Validate real migration ledgers and land/deploy 0048 before 0049, or obtain an explicit migration-order plan; the normal deployment uses `supabase db push` without an out-of-order override. This branch intentionally does not copy another PR's migration or deploy around that gate. Local validation also uses an external 0048 snapshot to test the ordered compatibility chain.

## Regressions and validation

- `supabase/tests/taste_generation_test.sql`: same-transaction replacement under injected cleanup failure; UUID isolation; active No-deadline stale-row purge/idempotency; canonical authorization; Google classification/score rejection; Google swipe/vote/winner exclusion; non-Google learning.
- `tests/db/taste_concurrency.py`: existing four contention cases plus SHARE-table locks for close/refresh/purge; replacement-deck row locks and eventual purge preserving current scores; Pick/account deletion with locked scores and deferred cleanup.
- `tests/db/taste_upgrade.py` / `.sql`: builds the actual pre-0049 schema, seeds legacy owned/Google/unverifiable signals and cached scores, applies 0049, and verifies privacy cleanup, surviving owned learning, unchanged core data and grants. `--legacy-cache-schema` emulates the earlier FK/no-timestamp preview. `--parallel-migration /path/0048_discover_photo_limit.sql` tests ordered photo compatibility. The fixture rolls back after assertions.
- `tests/lifecycle.test.ts`: verifies Google taste can still choose the live recommendation while neither classification nor numerical score is persisted. Existing live-badge, decay, reset and lifecycle tests remain.

Run the upgrade tool only against an empty disposable local database with Supabase service schemas. For PostgreSQL-only validation, `--isolated-bootstrap` accepts a local auth/storage/service-stub harness and omits unavailable 0007 extension installations. That mode is not full Supabase integration.

Final validation results are recorded in the implementation report. Local PostgreSQL 17 uses real pgTAP with service stubs; Docker/full local Supabase is unavailable. CI on these uncommitted changes and full Supabase validation remain release gates. Android/iOS export checks do not replace native-device QA.

## Final local results

| Check | Result |
|---|---|
| TypeScript, clean-source TypeScript, ESLint | Passed |
| Focused Jest | 4 suites / 97 tests |
| Full Jest | 198 suites / 1,693 tests |
| Deno check / API tests | Passed / 158 executions |
| Branch and ordered 0048 compatibility chains | Each: 47 SQL files / 867 pgTAP assertions |
| Current/legacy 0047 upgrade fixtures | Each: 14 checks passed |
| Taste contention | Each chain: 10 two-connection cases plus 3 deferred-cleanup assertion groups |
| Availability / time-suggestion concurrency | Each chain: 16 / 17 scenarios passed |
| Android / iOS exports | Passed |
| Working-tree and staged diff checks | Passed |

Before/after: same-transaction replacement previously returned obsolete `0.9`, now returns `0`; an active orphan previously survived an unlocked purge, now is removed while current-generation scores remain; SHARE-table contention previously canceled close, now close/refresh/purge finish while the lock is still held. New and mixed-version Google payloads store neither classification nor numeric score, and Google swipe/vote/winner learning stays absent. The upgrade test proves legacy labels are replaced from independent owned evidence rather than trusted by hash alone.

Local Node is 23.11.0 (CI uses 22). PostgreSQL is isolated version 17 with real pgTAP; auth/storage/cron/network services are stubbed. Full Supabase/CI and native-device checks remain release gates. No remote deployment or migration was performed. The fixes are ready for Mike's code review, with migration ordering, real ledger verification and one-time learning-reset review required before rollout.
