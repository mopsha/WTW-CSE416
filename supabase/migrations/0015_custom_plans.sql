-- Josh M4 Phase 2. Extend inputs/storage; canonical lifecycle and ranking RPCs stay intact.
alter table public.picks drop constraint picks_category_check;
alter table public.picks add constraint picks_category_check check (category in ('food', 'activities', 'custom'));
alter table public.places drop constraint places_category_check;
alter table public.places add constraint places_category_check check (category in ('food', 'activities', 'custom'));
alter table public.picks drop constraint picks_pool_size_check;
alter table public.picks add constraint picks_pool_size_check check (pool_size between 2 and 30 and (category = 'custom' or pool_size >= 5));
alter table public.picks
 add column include_saved boolean not null default false,
 add column custom_options jsonb not null default '[]' check (jsonb_typeof(custom_options) = 'array' and jsonb_array_length(custom_options) <= 20),
 add column mix_category text check (mix_category in ('food', 'activities'));
alter table public.places
 add column source text not null default 'mock' check (source in ('mock', 'google', 'custom')),
 add column created_by uuid references public.profiles(id) on delete cascade,
 add constraint custom_place_identity check (source <> 'custom' or
   (created_by is not null and id ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));

-- Canonical start/refresh already persist raw snapshots. Capture custom provenance
-- at that boundary without replacing their locks, participant checks or transitions.
create function private.custom_place_provenance() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.id like 'custom:%' then
   if new.raw->>'provider' is distinct from 'custom' then
     raise exception using errcode = 'PT400', message = 'Custom provenance required';
   end if;
   new.source := 'custom';
   new.created_by := (new.raw->>'createdBy')::uuid;
   if tg_op = 'UPDATE' and old.source = 'custom' and new.created_by is distinct from old.created_by then
     raise exception using errcode = 'PT403', message = 'Custom owner is immutable';
   end if;
 end if;
 return new;
end $$;
revoke all on function private.custom_place_provenance() from public, anon, authenticated;
create trigger custom_place_provenance before insert or update on public.places
 for each row execute function private.custom_place_provenance();

-- Candidate snapshots carry the same explicit source/creator metadata as places.
alter table public.pick_candidates
 add column source text not null default 'mock' check (source in ('mock', 'google', 'custom')),
 add column created_by uuid references public.profiles(id) on delete cascade,
 add constraint custom_candidate_creator check (source <> 'custom' or
  (created_by is not null and place_id ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
create function private.custom_candidate_provenance() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.place_id like 'custom:%' then
  if new.snapshot->>'provider' is distinct from 'custom' then
   raise exception using errcode = 'PT400', message = 'Custom provenance required';
  end if;
  new.source := 'custom'; new.created_by := (new.snapshot->>'createdBy')::uuid;
 end if;
 return new;
end $$;
revoke all on function private.custom_candidate_provenance() from public, anon, authenticated;
create trigger custom_candidate_provenance before insert or update on public.pick_candidates
 for each row execute function private.custom_candidate_provenance();

create function public.pick_create_options(p_host_id uuid, p_input jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_pick jsonb; v_options jsonb := coalesce(p_input->'customOptions', '[]'); v_option jsonb; v_prepared jsonb := '[]';
begin
 if jsonb_typeof(v_options) is distinct from 'array' or jsonb_array_length(v_options) > 20
   or ((p_input->>'category' = 'custom' or p_input ? 'customOptions') and jsonb_array_length(v_options) < 2) then
   raise exception using errcode = 'PT400', message = 'Expected 2 to 20 custom options';
 end if;
 for v_option in select value from jsonb_array_elements(v_options) loop
   if jsonb_typeof(v_option->'name') is distinct from 'string' or length(trim(v_option->>'name')) not between 1 and 60
     or (v_option ? 'note' and (jsonb_typeof(v_option->'note') is distinct from 'string' or length(v_option->>'note') > 200))
     or ((v_option ? 'lat') <> (v_option ? 'lng'))
     or (v_option ? 'lat' and (jsonb_typeof(v_option->'lat') <> 'number' or jsonb_typeof(v_option->'lng') <> 'number'
       or (v_option->>'lat')::double precision not between -90 and 90 or (v_option->>'lng')::double precision not between -180 and 180)) then
     raise exception using errcode = 'PT400', message = 'Invalid custom option';
   end if;
   v_prepared := v_prepared || jsonb_build_array(jsonb_build_object(
    'placeId', 'custom:' || gen_random_uuid()::text, 'name', trim(v_option->>'name'), 'note', v_option->>'note',
    'category', 'custom', 'provider', 'custom', 'source', 'custom', 'retention', 'persistable', 'createdBy', p_host_id,
    'lat', coalesce(v_option->'lat', p_input->'center'->'lat'), 'lng', coalesce(v_option->'lng', p_input->'center'->'lng'),
    'locationProvided', v_option ? 'lat'));
 end loop;
 if (p_input->>'poolSize')::integer < jsonb_array_length(v_options) then
   raise exception using errcode = 'PT400', message = 'Pool must fit typed options';
 end if;
 v_pick := public.pick_create_filtered(p_host_id, p_input->>'category',
   (p_input->'center'->>'lat')::double precision, (p_input->'center'->>'lng')::double precision,
   (p_input->>'radiusM')::integer, (p_input->>'poolSize')::integer,
   (p_input->>'deadlineAt')::timestamptz, (p_input->>'closeThreshold')::integer,
   (p_input->>'priceMax')::smallint, coalesce((p_input->>'openNow')::boolean, false));
 update public.picks set include_saved = coalesce((p_input->>'includeSaved')::boolean, false),
  custom_options = v_prepared, mix_category = p_input->>'mixCategory' where id = (v_pick->>'id')::uuid;
 return v_pick;
end $$;
create function public.pick_load_options(p_pick_id text, p_user_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_pick jsonb;
begin
 v_pick := public.pick_load_filtered(p_pick_id, p_user_id);
 if v_pick is null then return null; end if;
 return v_pick || (select jsonb_build_object('includeSaved', include_saved, 'customOptions', custom_options,
  'mixCategory', mix_category) from public.picks where id = (v_pick->>'id')::uuid);
end $$;
revoke all on function public.pick_create_options(uuid, jsonb), public.pick_load_options(text, uuid) from public, anon, authenticated;
grant execute on function public.pick_create_options(uuid, jsonb), public.pick_load_options(text, uuid) to service_role;

-- Reuse existing Pick membership to hydrate saved custom snapshots. Never allow a
-- guessed saved ID to expose another creator's private option through service_role.
create function public.saved_custom_candidates(p_host_id uuid) returns jsonb
language sql stable set search_path = '' as $$
 select coalesce(jsonb_agg(p.raw order by s.created_at, s.place_id), '[]'::jsonb)
 from public.saved_places s join public.places p on p.id = s.place_id
 where s.user_id = p_host_id and p.source = 'custom'
 and (p.created_by = p_host_id or exists (
  select 1 from public.pick_candidates c join public.pick_participants pp on pp.pick_id = c.pick_id
  where c.place_id = p.id and pp.user_id = p_host_id
 ));
$$;
revoke all on function public.saved_custom_candidates(uuid) from public, anon, authenticated;
grant execute on function public.saved_custom_candidates(uuid) to service_role;
