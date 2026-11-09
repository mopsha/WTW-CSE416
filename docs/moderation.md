# Moderating reports

People can report a person, a Pick, a group, or a single group or direct message. Reports are
stored in `public.reports` and no client can read them. App Store guideline 1.2 expects a way
to act on objectionable content within 24 hours, so someone on the team has to own this queue
and check it at least once a day. There are no alerts yet.

You can report a message from any group you're in or conversation you're part of, even after you
or the sender block each other or unfriend. Otherwise someone could send abuse and block the
recipient to make it unreportable. Outsiders can't report a message, and can't tell if it exists.
Someone removed from a group can no longer report that group's messages.

## Review the queue

In the Supabase dashboard for the project, open the SQL editor and run:

```sql
select * from private.report_queue;
```

Each row shows the reason, who reported it and who it is about. For a message report,
`message_body` is a copy of the message as it was when reported. Treat it as private.

## Act on a report

Choose what fits, then mark the report reviewed.

Remove a message (use the table matching `target_kind`):

```sql
delete from public.group_messages where id = '<target_id>';
delete from public.direct_messages where id = '<target_id>';
```

Remove an abusive person: delete the user under Authentication > Users. This deletes their
account and content as described in `docs/privacy-inventory.md`, and also deletes reports naming
them. They can sign up again with a different email.

Mark it reviewed:

```sql
update public.reports
set reviewed_at = now(), review_note = 'What you did and why'
where id = '<report id>';
```

Reporters aren't told the outcome, and the reported person isn't told who reported them.

## Profile-photo reports (#49)

Implemented but **uploads and photo reporting are disabled until explicit moderation readiness is approved**. This is not an approval of
retention, staffing, or new staff access. Before enabling photo uploads for release,
the team must assign the queue, approve evidence retention and local-copy handling,
review disclosures, and validate this workflow against real Supabase Storage.

Only an existing authorized project operator may configure
`private.photo_moderation_config.retention_seconds` using the SQL editor. It starts
NULL and `moderation_ready` starts false. Both a positive approved retention
interval and an explicit `moderation_ready=true` assertion are required for new
uploads, replacements and photo reports. Retention alone never enables them.
Readiness must attest approved staffing, audit/access controls, response ownership,
retention/disclosures and a working review/removal workflow. Nothing enables it
automatically; there is no production retention default. Existing photo reads,
owner removal, account cleanup and authorized operator actions remain available.
Changing this value affects new reports, not existing evidence deadlines. Setting
it back to NULL pauses new photo reports without deleting existing evidence.
Authenticated `/avatars/capabilities` exposes the actual upload/report readiness
(and disables uploads for a deletion-pending account). The account-scoped client
checks on focus/resume and polls every 15 seconds only while editor/report UI is
focused, refreshes when 15 seconds or less remain, expires capability state after 30 seconds,
and fails closed on errors, backgrounding and account change. Submission/finalization
always rechecks SQL readiness; UI state is never authorization. The fixed-search-path
`private.require_photo_moderation` helper uses narrowly scoped SECURITY DEFINER only
to acquire a shared configuration-row lock without granting service-role configuration
writes. Only project operators can change readiness. Mock capability state stays
disabled; its existing fixture store is not proof of production moderation security.

Users report a managed photo from the existing options menu on another person's
profile, group member/Pick participant menus, or existing chat options. These menus
resolve only photo identity, not a friends-only profile. The photo action appears
only for an authorized current image that has loaded natively, while report capability
is enabled; initials, loading, decode errors and revoked images do not qualify. It
captures the displayed revision; the server locks the owner's profile and verifies
current photo access and the exact revision. Self reports, guessed IDs, pending
requests, revoked relationships and either-direction blocks do not grant access.
Photo reports deliberately do not inherit historical message-report exceptions.
Live duplicate reports by the same reporter for the same revision return the existing
report without renewing its expiry or charging quota again. An expired report (including
a cleared evidence path) returns PHOTO_REPORT_EXPIRED/409: no new report or retention
period is created. The sheet explains that a new report was not submitted and directs
the user to support. New reporting cycles require a separate team-approved policy.

The existing private queue includes `photo_revision` and `photo_expires_at`.
Evidence stays in the same private bucket at its immutable original path. Replacing
or removing the current image does not erase unexpired evidence. There are no
mobile moderator roles, public evidence URLs, new admin HTTP routes, or client
report-table reads. Ordinary authenticated users cannot call the operator RPCs.

### Review and remove

Use only an authorized operator workstation. Load the existing project URL and
service-role key through the team's secret-management process; do not put the key
in command arguments, issue comments, screenshots or browser URLs. Never add it to
an Expo environment or mobile bundle. The tool does not print keys, Storage paths,
signed URLs, bytes or server error bodies.

1. Read `private.report_queue` in the SQL editor and choose a photo report UUID.
2. For hosted operation set `WTW_MODERATION_MODE=hosted`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and **separately**
   `WTW_MODERATION_EXPECTED_PROJECT_REF` to the approved project reference obtained
   from the team's project inventory (not parsed from the supplied URL). The URL
   must be exactly that project's HTTPS API origin. No project ID is defaulted.
   Modern `sb_secret_` credentials use `apikey`; legacy JWT service-role keys also
   use bearer authorization. Other credential formats are rejected before I/O.
   JWT payload checks are input guards; Supabase still verifies authentication.

   Local testing requires `WTW_MODERATION_MODE=local`, no hosted expected reference,
   local-only credentials, and `http://127.0.0.1:54321` or `http://localhost:54321`.
   Hosted mode never implicitly accepts a loopback URL. Neither mode skips the
   confirmation requirement for removal.

   ```sh
   node scripts/moderate-profile-photo.mjs view <report-uuid> <new-private-file.jpg>
   ```

   The file must not exist; it is created with mode 0600. View it locally using a
   trusted viewer, not a public upload/share service. Follow the approved local-copy
   policy, including removing local files after review. Downloaded copies cannot be
   remotely erased by the app.
3. If the reported revision is still current and violates the approved policy:

   ```sh
   node scripts/moderate-profile-photo.mjs remove <report-uuid> --confirm
   ```

   The service-only RPC locks the owner profile, checks the reported revision/path,
   re-reads and locks the report after the owner lock, checks wall-clock expiry,
   clears the current reference and advances its revision, then resolves all eligible
   reports for that exact owner/revision/path. Existing notes and review dates are
   preserved; an action timestamp and source-report reference are appended. This is
   an operational outcome, not attribution to the reporter or proof of staff identity. A report about an older photo cannot remove a
   newer one. Stale owner uploads conflict. A deliberate new upload is still allowed;
   upload suspension or account sanctions remain team decisions.
4. For no-action or obsolete-photo reports, use the existing reviewed_at/review_note
   workflow. Reviewing a report does not extend or shorten its evidence deadline.

Moderation removal revokes server reads immediately; mounted clients discover it
through the existing cache lease, focus checks and polling. Already downloaded
pixels are not erased remotely. Do not promise instantaneous cross-device removal.

### Expiry, deletion and maintenance

Evidence lookup refuses expired reports and owners with deletion intent. The
existing claimed hourly sweep clears expired evidence paths, then deletes eligible
retired objects via Storage API. The 24-hour orphan-age guard, 100-object batch,
backlog and retry timing still apply: expiry is an access deadline, **not** a promise
of physical erasure at that exact instant. Active profile photos remain active after
evidence expiry. Metadata follows existing report cascades; this implementation
adds no general retention policy for all report records.

Owner account deletion must use the existing account adapter: freeze photo writes,
remove the complete owner prefix (including evidence) through Storage API, then
call Auth deletion. Do not use dashboard Auth deletion alone for a photo owner;
it bypasses that adapter's physical-cleanup sequence. Partial/uncertain failures
retain durable deletion intent and are retried. Owner or reporter deletion cascades
its reports; remaining objects without another live reference become sweep-eligible.
Never delete Storage metadata through SQL.

Monitor the existing sweep's photo-maintenance fields and logs, not HTTP 200 alone.
No new alert system or moderator staffing commitment is implemented here.

### Disclosure follow-up (PR #45)

Before release, update `site/privacy.html` to remove the no-photo-upload claim and
describe managed photos, their actual audience, private revision-specific evidence,
authorized operator access, configured expiry versus physical cleanup, and account
and reporter deletion effects. Review `site/terms.html` for the actual reporting and
removal process and `site/support.html` for an assigned moderation contact. Review
App Store Connect Photos or Videos/User Content collection, linkage, purpose, and
retention answers with the responsible team; this document does not finalize them.


### Lock order and evidence-access audit release gate

SQL operations that need both records lock the **owner profile first, report rows
second**. Photo reporting uses FOR NO KEY UPDATE for the owner: this serializes
replacement/deletion but is compatible with the reporter-profile KEY SHARE locks
needed by rate-limit/report foreign keys. The former FOR UPDATE lock reproduced
40P01 under concurrent mutual reports in disposable PostgreSQL. Forced regression
tests cover both participants. Moderator changes still take an owner FOR UPDATE lock,
then lock matching report rows by ID. Expiry takes only a bounded report batch with
SKIP LOCKED and never subsequently locks owners, avoiding a reverse acquisition
cycle with multi-report resolution. Report creation locks the owner before attaching evidence. Moderator
removal does only a nonauthoritative owner-ID lookup first, then obtains those
locks and revalidates the report. Evidence expiry locks only report rows and never
then acquires an owner lock. Account cleanup freezes the owner in a separate
transaction before Storage/Auth cleanup; report cascades do not acquire other
owners' profile locks. Deleted/expired reports fail removal without modifying the
photo, and transaction-start timestamps cannot extend the evidence deadline.

Source inspection found no established evidence-access audit system to reuse.
The existing reviewed_at/review_note fields document an action, but not an
accountable operator, and evidence reads write no application audit event.
Supabase platform audit coverage has not been verified. Do not treat the CLI's
success messages or a shared service key as an access audit.

**Before operator access is enabled, Mike must approve and verify:**
- A private append-only audit sink (or proven platform equivalent), its access,
  retention, export and incident-response owner.
- Events identifying the approved project, report UUID, view/removal action,
  timestamp, outcome and a verified accountable operator ID. No photo bytes,
  Storage paths, signed URLs, bearer tokens or raw API keys belong in this record.
- A trusted operator identity mechanism: named staff access with identity-bound
  authorization/audit, or a controlled identity-aware runner/broker. A CLI-supplied
  name or a shared service key alone cannot prove who acted.
- Evidence-download/local-copy handling and retention. Audit records and retained
  evidence may require different policies; neither duration is selected here.

No new audit schema, staff roster, credential delegation, or audit-retention rule
was implemented in this correction pass. This remains a release/access prerequisite,
not a claim that platform logging already meets it. Keep photo reporting disabled
until approved retention exists, and do not ship uploads/moderator operations until
all moderation release gates (including this audit decision) are satisfied.


### Reviewing a still-current photo after historical evidence expires

Historical `view` still refuses expired evidence. Expired public report submissions
still return PHOTO_REPORT_EXPIRED; no retention period is renewed. Authorized
operators can instead use:

```sh
node scripts/moderate-profile-photo.mjs view-current <report-uuid> <new-private-file.jpg>
node scripts/moderate-profile-photo.mjs remove-current <report-uuid> --confirm
```

These use service-only current-photo RPCs. They require the reported revision to
still be the owner's current photo; they never show a newer replacement using an
old report, restore an expired evidence path, or grant ordinary users access.
Current viewing verifies the snapshot again after Storage download before writing
the private file. Current removal binds the verified revision/path under the owner
and report locks, resolves all matching reports, and preserves prior notes. Account
deletion intent still denies review/removal. Raw Storage objects are never deleted
through SQL. Existing orphan/account cleanup performs physical deletion; already
received operator copies remain subject to the approved handling policy.

### Post-block / group-removal reporting: policy decision, not enabled

The server currently retains no trustworthy per-viewer, per-revision authorization
receipt. Client image/display/cache state is untrusted and short-lived; minute
counters and service-role Storage logs cannot establish a verified viewer/revision
right. Current SQL eligibility is therefore still required. A block or loss of all
current group/Pick/friend eligibility can prevent a new photo report even if the
person previously saw it. We did not remove `can_view_avatar` or create a permanent
viewing-history table.

Mike must approve a bounded receipt design before this exception is implemented:
- Mint an unforgeable, viewer-bound photo-report-only receipt after a verified
  authorized photo read/recheck. Bind owner, immutable revision, issue/expiry time
  and nonce; do not put a Storage path or historical bytes in a client token.
- Choose a short explicit window, storage/abuse limits and replay/idempotency rules.
  A receipt must never authorize GET/photo/profile access or outlive account deletion.
- Decide whether reporting works only while the original object remains available,
  or whether a bounded retired-file grace period is permitted. The latter changes
  retention for viewed-but-unreported photos and needs explicit disclosure/approval.
- Expire/cascade receipts and any approved grace holds; preserve Storage-before-Auth
  deletion and do not retain photos indefinitely or serve historical bytes to reporters.

The actual #44 contract permits direct-message reports after block/unfriend, and
group-message reports after blocking while still a member. It denies reporting by
removed group members. Supporting post-removal photo receipts extends that contract;
this pass does not rewrite deployed message-report policy.

### One sensitive-evidence policy: CLI versus Dashboard (Mike decision)

| Concern | Restricted CLI | Dashboard/SQL workflow |
| --- | --- | --- |
| Credentials | Privileged key in a controlled operator process; never mobile/browser bundles; broad power remains | Named dashboard sign-in can avoid copying a service key, but permitted SQL/Storage privileges may still be broad |
| Accountable identity | A shared key is not human identity; use an approved named runner/broker and audit linkage | Verify actual organization roles, MFA and which named-user actions are logged; do not assume each data/evidence read is audited |
| Destination mistakes | Independent expected-project verification, explicit local mode and destructive confirmation | Require an independent project check; project switching and arbitrary SQL can still target the wrong environment |
| Retention/revision guards | Use the case-scoped evidence/current RPCs and post-download recheck | Raw bucket browsing or direct SQL can bypass the guarded workflow; require approved RPC-based procedures |
| Practicality | Existing photo tool supports protected viewing/removal and private downloads | Existing message queue is convenient for text; photo review still needs controlled retrieval and local-copy handling |

Recommendation: keep the restricted photo CLI and existing Dashboard queue; place
both message and photo evidence under one approved operator/access/audit/incident
policy before enabling readiness. Do not declare Dashboard automatically safer or
remove the CLI. Prefer accountable named access or an identity-aware operator runner
rather than distributing a shared service key. Neither a self-entered operator name
nor generic service-role logs prove who reviewed evidence. Verify platform coverage
and plan availability instead of assuming it. Supabase documents role capabilities
at https://supabase.com/docs/guides/platform/access-control.

Message snapshots currently follow #44's report/account cascades with no general
approved retention interval; photo evidence has an explicit per-report expiry.
Unifying handling does not silently impose either rule on the other. Mike must
choose approved staff access, audit event fields/sink/retention, content-specific
retention/local-copy rules, incident ownership, response commitments, receipt/grace
policy and #45 disclosure updates. No roster, identity mechanism or policy period
was invented, and no operator permissions or shared-project settings were changed.


### Generic complaints versus revision-specific photo evidence

The existing #44 `report_create(..., 'user', ...)` contract permits a generic report
against another existing profile even after either-direction blocking or group
removal. The shared member/profile/DM-header menu now separates “Report user”
(names, behavior and other concerns) from “Report profile picture.” The generic
name reason is “Offensive name”; it never describes itself as a photo report.
“Report user” remains usable when photo reporting is disabled or the image is
inaccessible.
It never pins photo bytes, records a photo revision, restores image access, or
asserts that moderators can recover what was previously displayed. A former viewer
still needs an available user-menu entry point (for example a still-open sheet);
this change does not add historical user discovery after a row disappears.

Revision-specific reports retain current photo authorization and readiness checks.
The receipt/grace policy above remains necessary if the team wants to preserve
specific photo evidence after loss of access; generic complaints do not solve that.

### Why both moderator removal entry points remain

`avatar_moderation_remove(report_id)` permits removal only while the report's
historical evidence is unexpired and matches the current revision/path.
`avatar_moderation_remove_current(report_id, revision, path)` instead binds the
operator's freshly verified current-photo snapshot, allowing an expired report to
identify that same still-current revision. It never restores expired evidence.
Dropping either validation would silently change an existing CLI operation's
security contract. Both already delegate to `private.remove_reported_photo`, which
owns the shared owner/report locks, revision advancement, exact-report resolution,
and note-preserving outcomes. Keep the two small public wrappers and existing CLI
commands; no additional mutation pipeline is needed.

### Profile-photo reporting operational inputs

Mike approved a 30-day evidence interval (2592000 seconds), with Mike assigned
to review reports daily. App Review notes aim to handle reports within 24 hours.
These are operational inputs, not an automatic enablement or new staff grant.
An already-authorized operator must still verify access/audit controls, disclosures,
real Storage review/removal and coverage for that response target before setting
readiness. This change configures no database setting and enables no feature.

The picture action is shown only for an actually displayed, authorized current
revision and fresh reporting capabilities. It sends POST /reports with
kind=profile_photo, targetId and photoRevision; the API routes to
avatar_report_create. Revision changes require a new explicit selection.
avatar_moderation_current and avatar_moderation_remove_current accept these
reports and retain the existing evidence, compare-and-swap and audit rules.
When blocking removes photo authorization, only generic user reporting remains
available; no new private photo evidence is acquired. Existing generic reports
are not relabeled or assigned invented revision evidence.

The new member-photo SQL regression uses a rolled-back 30-day fixture and
synthetic Storage metadata. That fixture does not configure shared or hosted
retention/readiness. The HTTP regression uses the existing local-only test setup
and verifies group-member reports reach current-photo review and removal audit.
