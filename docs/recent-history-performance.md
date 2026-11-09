# Recent History statement-timeout correction

CI confirmed PostgreSQL SQLSTATE 57014 (statement timeout), not an FK/schema-cache
resolution error: the full summary request was canceled after 8024 ms.

The old invoker RPC joins participants to Picks before limiting. Both tables'
RLS invoke private.is_pick_participant for each scanned row. On 1006 owned Picks,
the structural regression counts 2012 policy evaluations to return five rows.
This is avoidable work proportional to total history, repeated before the page
limit. Winner embedding itself is five indexed candidate lookups.

0040 changes ID selection, not the public response or permission model:
a private security-definer helper selects at most 100 IDs using an explicit
auth.uid() membership join. The public RPC remains security invoker and reads
only those IDs through Pick RLS. A correlated lateral point lookup prevents
the planner from moving a full RLS scan ahead of the bounded page. The existing
composite FK projection still rechecks candidate RLS. Returned Pick RLS is also
verified with an additional restrictive policy in a rollback-only SQL test.

No historical migration, timeout, table policy, table/schema grant, projection,
fixture count, candidate order, or client contract is changed.

## Local evidence

Disposable PostgreSQL 17.11 and actual PostgREST 16.5, with 1001 old canceled
Picks plus five completed Picks, random old IDs, a 1000-row REST cap, and an
eight-second authenticated request deadline. Auth/Storage/cron are stand-ins:
this is real PostgREST HTTP, but not the complete Supabase stack.

EXPLAIN (ANALYZE, BUFFERS) observations, milliseconds:

| Measurement | 0039 | With 0040 |
| --- | ---: | ---: |
| Base RPC, PostgREST plan execution | 9.376 | 0.699 |
| Exact winner projection, PostgREST plan execution | 9.330 | 0.693 |
| Full projection shared-buffer hits | 9133 | 124 |
| Public Pick RLS evaluations for a five-row page | 2012 across both scanned tables | 5 |
| Public Pick RLS evaluations for a 100-row page | proportional to full history | 100 |

Before: bitmap scans, 1006 membership loop iterations and a top-N sort before
LIMIT. After: one bounded ID selection, five picks_pkey point lookups with RLS,
then five pick_candidates_pkey winner lookups with RLS. The SQL body plan's
shared-buffer hits fell from 9110 to 548; its execution fell from 8.734 to
1.624 ms. Cold/warm plan timings differ; these are illustrative single-run
measurements, not CI hardware guarantees.

A negative-control replay without 0040 fails the new regression with exactly
2012 RLS calls. The patched replay passes six new assertions, including returned
row RLS, private-helper boundaries, outsider and missing-identity denial.

The real HTTP integration retains all >1000 fixtures and verifies Food,
Activities, Mixed, Custom, persisted tie-break winners, canceled pages, cursor
boundaries, outsiders and revoked participation. It now requires the first
winner-projection request to finish within four seconds, providing headroom
under the unchanged eight-second database deadline, and prints request timings.

The full Supabase CI rerun is still required. Local profiling does not reproduce
the original eight seconds or establish how much CI CPU, database configuration
or background contention amplified the old plan. Safe failure diagnostics remain
in place; no test-held lock or FK embedding problem was observed locally.
