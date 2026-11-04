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
