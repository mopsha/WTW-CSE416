# Recent History migration ordering

Migration inventory for the two pending PRs:

| Version | Migration | Source |
| --- | --- | --- |
| 0001–0037 | Existing migrations | Current origin/main |
| 0038 | 0038_profile_birthdays.sql | josh/edit-profile-redesign; reserved for birthdays |
| 0039 | 0039_recent_pick_summaries.sql | josh/recent-history-redesign |

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
