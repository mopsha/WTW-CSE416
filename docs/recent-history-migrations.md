# Recent History migration ordering

Migration inventory for the two pending PRs:

| Version | Migration | Source |
| --- | --- | --- |
| 0001–0037 | Existing migrations | Current origin/main |
| 0038 | 0038_profile_birthdays.sql | josh/edit-profile-redesign; reserved for birthdays |
| 0039 | 0039_recent_pick_summaries.sql | josh/recent-history-redesign |
| 0040 | 0040_recent_pick_summary_performance.sql | Forward-only performance correction |

Recent History was renumbered before commit to avoid a version collision. Its SQL
body is unchanged. The birthday migration is not copied into this branch: retain
it under 0038 when the PRs converge. Merge/deploy birthdays before Recent History
to preserve ascending hosted migration history. If 0039 is applied first, later
adding 0038 creates a backdated pending migration: the normal deployment command
may reject it. An operator must inspect the remote ledger and explicitly review
that situation; do not repair history or use include-all automatically. A clean
replay with both files always orders birthdays before Recent History.

The birthday migration changes profile setup, private birthday storage and
profile RPCs. Recent History adds the invoker-security my_pick_summaries RPC and
an index on Picks; it neither reads birthday data nor changes profile grants.
The two migrations are compatible and do not redefine each other's objects.

Deployment evidence: the birthday migration was previously confirmed undeployed
by the operator. Recent History was untracked and only applied to disposable
local test databases in this session. Neither migration was in fetched main.
No shared-project migration ledger was accessible from this unlinked checkout;
before production rollout, an authorized operator must verify remote history
and resolve any out-of-band application before applying pending migrations.
Never rename, replay, or repair an already-applied version automatically.

Validation includes a disposable PostgreSQL replay of main's migrations, the
birthday migration read from its remote branch, and 0039 in order. Auth, Storage
and cron are stand-ins in that test. It does not prove PostgREST schema-cache
behavior. Real Supabase SQL/HTTP integration remains required in CI. The HTTP
test shares the production RPC projection and has no numeric migration filename
dependency. Apply 0039 before releasing the client that calls my_pick_summaries.

## Statement-timeout correction

0040 leaves 0039 intact. It adds a private bounded-ID helper deriving identity
from auth.uid() and explicitly joining only that user's participant rows.
The public RPC remains SECURITY INVOKER and performs correlated primary-key
reads of the selected IDs through Pick RLS. Candidate embedding still uses
candidate RLS and the exact persisted composite winner FK. Neither table RLS,
blocking rules, search_path isolation nor the eight-second timeout is relaxed.

The helper returns only up to 100 authorized IDs, not profile/birthday fields or
candidate lists, and is outside the exposed REST schemas. It has a fixed owner,
empty search_path, no dynamic SQL and no user-ID input. Its caller grants follow
the existing private membership-helper pattern; no new schema or table grants
are added. See recent-history-performance.md for measurements and regressions.

Apply 0038 birthdays, then 0039, then 0040 in a combined clean replay. A hosted
database already on 0039 receives only 0040; do not edit or replay 0039.

## PR #56 review correction

PR #54 owns 0038 and must merge **and deploy** before PR #56's 0039/0040.
This correction changes none of these migration files or their version numbers.
The summary projection now includes the persisted winner ID and provider; it
continues to join through the same composite winner FK and participant RLS.
Live Google names are request-only API data, never written into snapshots or SQL.
