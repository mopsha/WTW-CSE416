-- Local demo seed (Razin). Runs on `supabase db reset`. NOT a migration: never runs on hosted.
--
-- Creates one demo Pick in 'swiping' with 20 real Stony Brook-area food places and 3 bot
-- participants whose answers are pre-filled. Names, coordinates and answers mirror Mike's mock
-- fixtures (src/lib/mock/fixtures.ts) so mock mode and the local database rank the same way.
-- Places: verified open on current listings (Sep 2026); coordinates from OpenStreetMap
-- (Nominatim) by street address. Price levels are the team's estimates; ratings are left null
-- (real ratings/photos come from the Google Places provider later). Photos are stock placeholders.
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
-- 20 real food places near SBU. Demo Pick center: SBU Academic Mall (40.9126, -73.1234).
-- ---------------------------------------------------------------------------
create temporary table seed_places (
  n integer primary key,
  name text,
  address text,
  price_level integer,
  lat double precision,
  lng double precision
);

insert into seed_places values
  ( 1, 'Súp Vietnamese Phở & Grill',        '1113 N Country Rd, Stony Brook',         2, 40.9193847, -73.1297139),
  ( 2, 'DJ''s Clam Shack',                   '1007 N Country Rd, Stony Brook',         2, 40.9233111, -73.1265030),
  ( 3, 'Kung Fu Tea',                       '1009 Route 25A, Stony Brook',            1, 40.9225234, -73.1274348),
  ( 4, 'Sweet Mama''s',                      '121 Main St, Stony Brook',               2, 40.9174711, -73.1465460),
  ( 5, 'Crazy Beans',                       '97 Main St, Stony Brook',                2, 40.9170650, -73.1463017),
  ( 6, 'Schnitzels',                        '77 Main St, Stony Brook',                2, 40.9163002, -73.1463856),
  ( 7, 'LUCA',                              '93 Main St, Stony Brook',                3, 40.9173180, -73.1473340),
  ( 8, 'Brew Cheese',                       '127 Main St, Stony Brook',               2, 40.9177021, -73.1464392),
  ( 9, 'Robinson''s Tea Room',               '97 Main St, Stony Brook',                2, 40.9170650, -73.1463017),
  (10, 'Mirabelle Tavern (Three Village Inn)', '150 Main St, Stony Brook',            3, 40.9191835, -73.1482395),
  (11, 'Country House',                     '1175 N Country Rd, Stony Brook',         3, 40.9126723, -73.1421450),
  (12, 'Bliss',                             '766 Route 25A, East Setauket',           3, 40.9267281, -73.1181114),
  (13, 'Mario''s Italian Restaurant',        '212 Main St, East Setauket',             2, 40.9423169, -73.1039015),
  (14, 'Toast Coffeehouse',                 '650 Route 112, Port Jefferson Station',  2, 40.9271254, -73.0501623),
  (15, 'Tiger Lily Café',                   '156 E Main St, Port Jefferson',          1, 40.9466112, -73.0670743),
  (16, 'Salsa Salsa',                       '142 Main St, Port Jefferson',            1, 40.9455179, -73.0683675),
  (17, 'Prohibition Kitchen',               '115 Main St, Port Jefferson',            2, 40.9462443, -73.0687358),
  (18, 'Pasta Pasta',                       '234 E Main St, Port Jefferson',          3, 40.9455243, -73.0673115),
  (19, 'Ruvo',                              '105 Wynn Ln, Port Jefferson',            3, 40.9442612, -73.0681948),
  (20, 'Wave Seafood Kitchen (Danfords)',   '25 E Broadway, Port Jefferson',          3, 40.9477909, -73.0687261);

insert into public.places (id, name, category, lat, lng, raw)
select
  'seed-place-' || lpad(n::text, 2, '0'),
  name,
  'food',
  lat,
  lng,
  jsonb_build_object('source', 'seed.sql', 'address', address)
from seed_places;

-- Demo branch: cuisine label + an openly licensed Wikimedia Commons photo of that cuisine
-- (not of the venue) per place. Credits: docs/demo-photo-credits.md.
create temporary table seed_photos (n integer primary key, cuisine text, photo_url text);
insert into seed_photos values
  (1, 'Vietnamese', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/99/Ph%E1%BB%9F_b%C3%B2%2C_C%E1%BA%A7u_Gi%E1%BA%A5y%2C_H%C3%A0_N%E1%BB%99i.jpg/960px-Ph%E1%BB%9F_b%C3%B2%2C_C%E1%BA%A7u_Gi%E1%BA%A5y%2C_H%C3%A0_N%E1%BB%99i.jpg'),
  (2, 'Seafood shack', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/60/Lobster_Roll_at_the_Lobster_Claw%2C_Bar_Harbor.jpg/960px-Lobster_Roll_at_the_Lobster_Claw%2C_Bar_Harbor.jpg'),
  (3, 'Bubble tea', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/40/Thai_Iced_Bubble_Tea_-_Sonoma_Pho_-_Stierch_-_2019.jpg/960px-Thai_Iced_Bubble_Tea_-_Sonoma_Pho_-_Stierch_-_2019.jpg'),
  (4, 'Diner & brunch', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/43/NY_breakfast_02.jpg/960px-NY_breakfast_02.jpg'),
  (5, 'Café & brunch', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/Cappuccino_with_latte_art_on_Coffee_Right_in_Brno%2C_Brno-City_District.jpg/960px-Cappuccino_with_latte_art_on_Coffee_Right_in_Brno%2C_Brno-City_District.jpg'),
  (6, 'German gastropub', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b9/Wiener_Schnitzel_at_restaurant_West_Side_Story.jpg/960px-Wiener_Schnitzel_at_restaurant_West_Side_Story.jpg'),
  (7, 'Modern Italian', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/65/Pork_tagliatelle_pasta_dish_at_restaurant_in_Rome%2C_Italy.jpg/960px-Pork_tagliatelle_pasta_dish_at_restaurant_in_Rome%2C_Italy.jpg'),
  (8, 'Cheese & sandwiches', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d3/Grilled_cheese_sandwich_with_roasted_tomato_soup.jpg/960px-Grilled_cheese_sandwich_with_roasted_tomato_soup.jpg'),
  (9, 'Tea room', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/Devonshire_tea.jpg/960px-Devonshire_tea.jpg'),
  (10, 'French bistro', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a3/Steak_frites_at_The_Bar_at_MacArthur_Place_in_Sonoma_-_Sarah_Stierch.jpg/960px-Steak_frites_at_The_Bar_at_MacArthur_Place_in_Sonoma_-_Sarah_Stierch.jpg'),
  (11, 'Classic American', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1b/Roasted_Chicken_Dinner_Plate%2C_Broccoli%2C_Demi_Glace.jpg/960px-Roasted_Chicken_Dinner_Plate%2C_Broccoli%2C_Demi_Glace.jpg'),
  (12, 'New American', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ae/Risotto_de_gambas%2C_restaurant_Danieli_%28Vienne%2C_Autriche%29.jpg/960px-Risotto_de_gambas%2C_restaurant_Danieli_%28Vienne%2C_Autriche%29.jpg'),
  (13, 'Italian', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d4/Margherita_Originale.JPG/960px-Margherita_Originale.JPG'),
  (14, 'Brunch & coffee', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6c/Avocado_toast_with_sesame_seeds.jpg/960px-Avocado_toast_with_sesame_seeds.jpg'),
  (15, 'Healthy café', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/80/A%C3%A7a%C3%AD_na_tigela_-_Acai_bowl.jpg/960px-A%C3%A7a%C3%AD_na_tigela_-_Acai_bowl.jpg'),
  (16, 'Mexican', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4e/Tacos_on_a_plate.jpg/960px-Tacos_on_a_plate.jpg'),
  (17, 'Gastropub', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5a/Cheeseburger_with_fries_-_Massachusetts.jpg/960px-Cheeseburger_with_fries_-_Massachusetts.jpg'),
  (18, 'Italian', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/93/Spaghetti_alla_Carbonara.jpg/960px-Spaghetti_alla_Carbonara.jpg'),
  (19, 'Italian', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/47/Pasta%2C_Syburg.jpg/960px-Pasta%2C_Syburg.jpg'),
  (20, 'Seafood', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d7/Cousins_Maine_Lobster_-_SF_Bay_Area_-_June_2023_-_Sarah_Stierch_03.jpg/960px-Cousins_Maine_Lobster_-_SF_Bay_Area_-_June_2023_-_Sarah_Stierch_03.jpg');

-- ---------------------------------------------------------------------------
-- Demo Pick, hosted by Ava (bot), already swiping.
-- ---------------------------------------------------------------------------
insert into public.picks (id, host_id, state, category, center_lat, center_lng, radius_m, close_threshold)
values (
  'de000000-0000-4000-8000-000000000001',
  'b0700000-0000-4000-8000-000000000001',
  'swiping', 'food', 40.9126, -73.1234, 8000, 100
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
    'photoUrl', ph.photo_url,
    'cuisine', ph.cuisine,
    'address', s.address,
    'priceLevel', s.price_level,
    'rating', null,
    'lat', p.lat,
    'lng', p.lng
  )
from seed_places s
join public.places p on p.id = 'seed-place-' || lpad(s.n::text, 2, '0')
join seed_photos ph on ph.n = s.n;

drop table seed_places;
drop table seed_photos;

-- Bots' answers (0 = No, 1 = Maybe, 2 = Yes), index i = place i. Same as Mike's
-- OTHER_PARTICIPANT_ANSWERS. Bots have "finished" swiping.
insert into public.preferences (pick_id, place_id, user_id, value)
select
  'de000000-0000-4000-8000-000000000001',
  'seed-place-' || lpad(a.i::text, 2, '0'),
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
