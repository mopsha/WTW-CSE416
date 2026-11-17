-- Security revocation must not strand an empty scheduled swipe round.
-- Use the existing canceled state; never synthesize a winner or final cohort.
create function private.cancel_empty_scheduled_round() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.picks;
begin
 select * into p from public.picks where id=old.pick_id for update;
 if not found or p.proposed_at is null or p.state<>'swiping' then return old; end if;
 if cardinality(private.availability_eligible_ids(p.id))=0 then
  update public.picks set state='canceled',
   cancel_reason='No eligible participants remain in this Pick.' where id=p.id;
 end if;
 return old;
end $$;
revoke all on function private.cancel_empty_scheduled_round() from public,anon,authenticated;
create trigger cancel_empty_scheduled_round after delete on public.pick_participants
 for each row execute function private.cancel_empty_scheduled_round();

-- Repair rounds stranded before this protection was installed, including No deadline.
-- Lock and recheck each Pick so a concurrent confirmed response cannot be lost.
do $$
declare p public.picks;
begin
 for p in select * from public.picks where proposed_at is not null and state='swiping' for update loop
  if cardinality(private.availability_eligible_ids(p.id))=0 then
   update public.picks set state='canceled',
    cancel_reason='No eligible participants remain in this Pick.' where id=p.id;
  end if;
 end loop;
end $$;
