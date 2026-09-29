-- Local demo seed (Razin). Runs on `supabase db reset`. NOT a migration: never runs on hosted.
--
-- Creates one demo Pick in 'swiping' with 20 PLACEHOLDER candidates and 3 bot participants
-- whose answers are pre-filled. Names, coordinates and answers mirror Mike's mock fixtures
-- (src/lib/mock/fixtures.ts) so mock mode and the local database rank the same way.
-- The places are FICTIONAL PLACEHOLDERS, not the team's approved Stony Brook list.
--
-- Join the demo Pick after signing in once in the app (so your profile exists):
--   select private.seed_add_participant(
--     (select id from auth.users where email = 'you@example.com'));
-- Pass `true` as a second argument to also make yourself the host (so you can rank).

-- ---------------------------------------------------------------------------
-- Bot users: no password, .invalid emails, so nobody can sign in as them.
-- The on_auth_user_created trigger creates their profiles.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', b.id, 'authenticated', 'authenticated', b.email, now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', b.name), now(), now(),
  '', '', '', ''
from (values
  ('b0700000-0000-4000-8000-000000000001'::uuid, 'bot-ava@wtw.invalid', 'Ava (bot)'),
  ('b0700000-0000-4000-8000-000000000002'::uuid, 'bot-ben@wtw.invalid', 'Ben (bot)'),
  ('b0700000-0000-4000-8000-000000000003'::uuid, 'bot-cam@wtw.invalid', 'Cam (bot)')
) as b(id, email, name);

-- ---------------------------------------------------------------------------
-- 20 PLACEHOLDER places around the SBU Academic Mall (40.9126, -73.1234).
-- ---------------------------------------------------------------------------
create temporary table seed_places (
  n integer primary key,
  name text,
  price_level integer,
  rating numeric,
  d_lat double precision,
  d_lng double precision
);

insert into seed_places values
  ( 1, 'Seawolf Noodle Bar',       1, 4.4,  0.002,  0.001),
  ( 2, 'Harbor Taqueria',          1, 4.6,  0.011, -0.004),
  ( 3, 'Setauket Slice',           1, 4.2,  0.018,  0.006),
  ( 4, 'Old Field Oyster House',   3, 4.7,  0.031, -0.012),
  ( 5, 'Nicolls Road Diner',       2, 4.0, -0.006,  0.009),
  ( 6, 'Port Jeff Ramen Co.',      2, 4.5,  0.038,  0.021),
  ( 7, 'Stony Brook Sushi Lab',    3, 4.3,  0.004, -0.008),
  ( 8, 'Three Village Thai',       2, 4.6,  0.014,  0.014),
  ( 9, 'Mill Pond Bakery',         1, 4.8,  0.009, -0.019),
  (10, 'Long Island Smokehouse',   2, 4.1, -0.021,  0.017),
  (11, 'Campus Falafel Cart',      1, 4.5,  0.001,  0.002),
  (12, 'Brookhaven Burger Joint',  2, 3.9, -0.013, -0.006),
  (13, 'Wading River Wood-Fired',  3, 4.4,  0.027,  0.030),
  (14, 'Sound Beach Poke',         2, 4.2,  0.022, -0.027),
  (15, 'Route 25A Dumplings',      1, 4.7,  0.016,  0.003),
  (16, 'Centereach Curry House',   2, 4.3, -0.024,  0.004),
  (17, 'Belle Terre Bistro',       4, 4.6,  0.041,  0.015),
  (18, 'Shoreline Creperie',       2, 4.0,  0.035, -0.020),
  (19, 'Lake Grove Korean BBQ',    3, 4.5, -0.030, -0.015),
  (20, 'Night Owl Bagels',         1, 4.1,  0.006,  0.012);

insert into public.places (id, name, category, lat, lng, raw)
select
  'placeholder-place-' || lpad(n::text, 2, '0'),
  name || ' (PLACEHOLDER)',
  'food',
  40.9126 + d_lat,
  -73.1234 + d_lng,
  jsonb_build_object('placeholder', true, 'source', 'seed.sql')
from seed_places;

-- ---------------------------------------------------------------------------
-- Demo Pick, hosted by Ava (bot), already swiping.
-- ---------------------------------------------------------------------------
insert into public.picks (id, host_id, state, category, center_lat, center_lng, radius_m, close_threshold)
values (
  'de000000-0000-4000-8000-000000000001',
  'b0700000-0000-4000-8000-000000000001',
  'swiping', 'food', 40.9126, -73.1234, 6000, 100
);

insert into public.pick_participants (pick_id, user_id)
select 'de000000-0000-4000-8000-000000000001', id
from (values
  ('b0700000-0000-4000-8000-000000000001'::uuid),
  ('b0700000-0000-4000-8000-000000000002'::uuid),
  ('b0700000-0000-4000-8000-000000000003'::uuid)
) as b(id);

insert into public.pick_candidates (pick_id, place_id, snapshot)
select
  'de000000-0000-4000-8000-000000000001',
  p.id,
  jsonb_build_object(
    'name', p.name,
    'photoUrl', 'https://picsum.photos/seed/wtw-' || lpad(s.n::text, 2, '0') || '/800/600',
    'priceLevel', s.price_level,
    'rating', s.rating,
    'lat', p.lat,
    'lng', p.lng
  )
from seed_places s
join public.places p on p.id = 'placeholder-place-' || lpad(s.n::text, 2, '0');

drop table seed_places;

-- Bots' answers (0 = No, 1 = Maybe, 2 = Yes), index i = place i. Same as Mike's
-- OTHER_PARTICIPANT_ANSWERS. Bots have "finished" swiping.
insert into public.preferences (pick_id, place_id, user_id, value)
select
  'de000000-0000-4000-8000-000000000001',
  'placeholder-place-' || lpad(a.i::text, 2, '0'),
  b.id,
  a.value::smallint
from (values
  ('b0700000-0000-4000-8000-000000000001'::uuid, array[2,2,1,0,1,2,0,2,2,1,2,0,1,1,2,1,0,1,2,1]),
  ('b0700000-0000-4000-8000-000000000002'::uuid, array[1,2,2,1,0,2,1,2,1,0,2,1,1,0,2,2,0,1,1,2]),
  ('b0700000-0000-4000-8000-000000000003'::uuid, array[2,1,1,0,1,2,2,1,2,1,1,0,2,1,2,1,1,0,1,1])
) as b(id, answers)
cross join lateral unnest(b.answers) with ordinality as a(value, i);

update public.pick_participants set finished_at = now()
where pick_id = 'de000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Dev helper: add a real (signed-in-once) user to the demo Pick. Local only;
-- executable by postgres / service_role, never by app clients.
-- ---------------------------------------------------------------------------
create function private.seed_add_participant(p_user_id uuid, p_make_host boolean default false)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_pick uuid := 'de000000-0000-4000-8000-000000000001';
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No profile for user %. Sign in once in the app first.', p_user_id;
  end if;
  insert into public.pick_participants (pick_id, user_id)
  values (v_pick, p_user_id)
  on conflict (pick_id, user_id) do nothing;
  if p_make_host then
    update public.picks set host_id = p_user_id where id = v_pick;
  end if;
  return v_pick;
end;
$$;

revoke all on function private.seed_add_participant(uuid, boolean) from public, anon, authenticated;
grant execute on function private.seed_add_participant(uuid, boolean) to service_role;
