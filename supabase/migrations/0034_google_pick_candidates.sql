-- Live Google places in Picks. Google's terms allow storing place IDs, and coordinates for up to
-- 30 days, but not names, addresses or photos. A Google candidate's snapshot is
-- { placeId, name: null, category, lat, lng, provider: 'google' }; the API fetches the rest on
-- each read. See docs/google-picks.md.

-- Ranking reads coordinates from the snapshot, so they stay required until a Pick has finished.
alter table public.pick_candidates drop constraint pick_candidates_snapshot_coords;
alter table public.pick_candidates add constraint pick_candidates_snapshot_coords check (
  (jsonb_typeof(snapshot -> 'lat') = 'number' and jsonb_typeof(snapshot -> 'lng') = 'number')
  or (snapshot ->> 'provider' = 'google' and not snapshot ? 'lat' and not snapshot ? 'lng')
);

-- start/refresh copy each snapshot into places, whose columns are required. Nothing reads them
-- for Google rows, so keep the ID and category only, with no coordinates to expire here.
create function private.strip_google_place() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.raw ->> 'provider' = 'google' then
    new.name := new.id;
    new.lat := 0;
    new.lng := 0;
    new.source := 'google';
    new.raw := jsonb_build_object('provider', 'google', 'category', new.raw ->> 'category');
  end if;
  return new;
end $$;
revoke all on function private.strip_google_place() from public, anon, authenticated;
-- Named to run after mixed_pick_place_category, which reads raw's category.
create trigger strip_google_place before insert or update on public.places
  for each row execute function private.strip_google_place();

-- Daily from the sweep. Removes coordinates older than p_cutoff. A Pick still open by then can't
-- be ranked without them, so it's canceled first.
create function public.purge_google_coordinates(p_cutoff timestamptz) returns integer
language plpgsql set search_path = '' as $$
declare v_removed integer;
begin
  update public.picks p
  set state = 'canceled', cancel_reason = 'This Pick expired before it finished.'
  where p.state in ('swiping', 'ranking', 'final_vote')
    and exists (
      select 1 from public.pick_candidates c
      where c.pick_id = p.id and c.snapshot ->> 'provider' = 'google' and c.created_at < p_cutoff
    );
  update public.pick_candidates
  set snapshot = snapshot - 'lat' - 'lng'
  where snapshot ->> 'provider' = 'google' and snapshot ? 'lat' and created_at < p_cutoff;
  get diagnostics v_removed = row_count;
  return v_removed;
end $$;
revoke all on function public.purge_google_coordinates(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_google_coordinates(timestamptz) to service_role;
