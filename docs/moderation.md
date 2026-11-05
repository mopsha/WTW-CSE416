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

Implemented but **disabled until policy configuration**. This is not an approval of
retention, staffing, or new staff access. Before enabling photo uploads for release,
the team must assign the queue, approve evidence retention and local-copy handling,
review disclosures, and validate this workflow against real Supabase Storage.

Only an existing authorized project operator may configure
`private.photo_moderation_config.retention_seconds` using the SQL editor. It starts
NULL; photo reports fail closed with HTTP 503 until a positive, team-approved
number of seconds is recorded. There is deliberately no production default.
Changing this value affects new reports, not existing evidence deadlines. Setting
it back to NULL pauses new photo reports without deleting existing evidence.
Mock mode also returns 503 rather than pretending to preserve moderation evidence.

Users report a managed photo from the existing options menu on another person's
profile. The action appears only after authenticated photo loading succeeds. It
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
   clears the current reference and advances its revision, then marks exactly that report
   reviewed with the removal action. A report about an older photo cannot remove a
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

SQL operations that need both records lock the **owner profile first, report row
second**. Report creation locks the owner before attaching evidence. Moderator
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
