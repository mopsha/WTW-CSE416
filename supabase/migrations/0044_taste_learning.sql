-- Taste learning and taste-aware Picks (Alan). Spec: docs/taste-onboarding.md#pr-2.
--
-- 1. learned_taste: per user, per survey place type, a score WTW learns from real use:
--    swipes (Yes +1, Maybe +0.3, No -1), final votes (+1) and Pick winners (+2 for everyone in
--    the Pick). Scores halve every 30 days without new signals (same formula as
--    _shared/domain/groupTaste.ts decayedScore) and stay within -10..10. Explicit survey answers
--    always win over learned scores; that merge happens in the API (groupTaste.memberValue).
-- 2. private.pick_candidate_taste: the group's taste per candidate, written at start/refresh and
--    used only to break ranking ties. Kept out of pick_candidates, which participants can read:
--    in a two-person Pick a group score would reveal the other person's preferences.
-- The place type comes from the candidate snapshot's "tasteType", our own survey label (like
-- "category"), set by the API when it builds the deck.

create table public.learned_taste (
  user_id uuid not null references public.profiles (id) on delete cascade,
  place_type text not null check (place_type ~ '^[a-z_]{1,60}$'),
  score real not null check (score between -10 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, place_type)
);
comment on table public.learned_taste is
  'What WTW learned about one user''s taste. Private: read and reset only through the API.';
alter table public.learned_taste enable row level security;
revoke all on table public.learned_taste from anon, authenticated;
grant all on table public.learned_taste to service_role;

create table private.pick_candidate_taste (
  pick_id uuid not null,
  place_id text not null,
  taste_score real not null check (taste_score between -1 and 1),
  primary key (pick_id, place_id),
  foreign key (pick_id, place_id) references public.pick_candidates (pick_id, place_id)
    on delete cascade
);
revoke all on table private.pick_candidate_taste from public, anon, authenticated;
grant select, insert, update, delete on table private.pick_candidate_taste to service_role;

-- Adds a (decayed) signal. Runs inside the triggers below, as the table owner.
create function private.learn_taste(p_user_id uuid, p_type text, p_delta real) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_type is null or p_type !~ '^[a-z_]{1,60}$' or p_delta = 0 then
    return;
  end if;
  insert into public.learned_taste as t (user_id, place_type, score, updated_at)
  values (p_user_id, p_type, greatest(-10, least(10, p_delta)), now())
  on conflict (user_id, place_type) do update set
    score = greatest(-10, least(10,
      t.score * power(0.5, extract(epoch from now() - t.updated_at) / (30 * 86400.0))
      + excluded.score)),
    updated_at = now();
exception when foreign_key_violation then
  -- The profile was deleted concurrently. Learning is best effort: never fail the swipe,
  -- vote or close that triggered it.
  null;
end $$;

create function private.candidate_taste_type(p_pick_id uuid, p_place_id text) returns text
language sql stable security definer set search_path = '' as $$
  select c.snapshot ->> 'tasteType' from public.pick_candidates c
  where c.pick_id = p_pick_id and c.place_id = p_place_id
$$;

create function private.swipe_weight(p_value smallint) returns real
language sql immutable set search_path = '' as $$
  select (case p_value when 2 then 1.0 when 1 then 0.3 when 0 then -1.0 else 0 end)::real
$$;

-- Swipes: a changed answer replaces its earlier signal instead of adding to it.
create function private.learn_from_swipe() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_delta real := private.swipe_weight(new.value);
begin
  if tg_op = 'UPDATE' then
    if new.value = old.value then return new; end if;
    v_delta := v_delta - private.swipe_weight(old.value);
  end if;
  perform private.learn_taste(new.user_id,
    private.candidate_taste_type(new.pick_id, new.place_id), v_delta);
  return new;
end $$;
create trigger learn_from_swipe after insert or update of value on public.preferences
  for each row execute function private.learn_from_swipe();

-- Final votes: a changed ballot moves the signal to the new choice.
create function private.learn_from_vote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.place_id = old.place_id then return new; end if;
    perform private.learn_taste(old.user_id,
      private.candidate_taste_type(old.pick_id, old.place_id), -1);
  end if;
  perform private.learn_taste(new.user_id,
    private.candidate_taste_type(new.pick_id, new.place_id), 1);
  return new;
end $$;
create trigger learn_from_vote after insert or update of place_id on public.final_votes
  for each row execute function private.learn_from_vote();

-- Winners: everyone in the Pick went with it, once per Pick.
create function private.learn_from_winner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_type text := private.candidate_taste_type(new.id, new.winner_place_id);
begin
  if v_type is not null then
    -- Ordered, so two Picks sharing people that close together can't deadlock.
    perform private.learn_taste(pp.user_id, v_type, 2)
    from (select user_id from public.pick_participants
          where pick_id = new.id order by user_id) pp;
  end if;
  return new;
end $$;
create trigger learn_from_winner after update of winner_place_id on public.picks
  for each row
  when (new.winner_place_id is not null and new.winner_place_id is distinct from old.winner_place_id)
  execute function private.learn_from_winner();

-- start/refresh: keep every existing check, then store the deck's taste scores.
create function private.save_candidate_taste(p_pick_id text, p_candidates jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  insert into private.pick_candidate_taste (pick_id, place_id, taste_score)
  -- numeric first: a huge JSON number would overflow real before the clamp.
  select private.try_uuid(p_pick_id), e ->> 'placeId',
         greatest(-1, least(1, (e ->> 'tasteScore')::numeric))::real
  from jsonb_array_elements(p_candidates) e
  where jsonb_typeof(e -> 'tasteScore') = 'number' and (e ->> 'tasteScore')::numeric <> 0
  on conflict (pick_id, place_id) do update set taste_score = excluded.taste_score;
end $$;

alter function public.pick_start(text, uuid, jsonb) rename to pick_start_before_taste;
alter function public.pick_start_before_taste(text, uuid, jsonb) set schema private;
create function public.pick_start(p_pick_id text, p_user_id uuid, p_candidates jsonb) returns void
language plpgsql set search_path = '' as $$ begin
  perform private.pick_start_before_taste(p_pick_id, p_user_id, p_candidates);
  perform private.save_candidate_taste(p_pick_id, p_candidates);
end $$;

-- Scheduled Picks (0041/0042) start through pick_availability_finish, which bypasses pick_start.
alter function public.pick_availability_finish(text, uuid, uuid, jsonb)
  rename to pick_availability_finish_before_taste;
alter function public.pick_availability_finish_before_taste(text, uuid, uuid, jsonb)
  set schema private;
create function public.pick_availability_finish(p_pick_id text, p_user_id uuid, p_token uuid,
  p_candidates jsonb) returns void
language plpgsql set search_path = '' as $$ begin
  perform private.pick_availability_finish_before_taste(p_pick_id, p_user_id, p_token, p_candidates);
  perform private.save_candidate_taste(p_pick_id, p_candidates);
end $$;

-- Refresh drops the old deck and its swipes (a cascade, which fires no trigger). Take those
-- swipes' signals back first, so re-swiping the new deck doesn't count them twice. If the inner
-- refresh then rejects the request, the whole call rolls back, reversal included.
create function private.unlearn_pick_swipes(p_pick_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.learn_taste(pr.user_id,
    private.candidate_taste_type(pr.pick_id, pr.place_id), -private.swipe_weight(pr.value))
  from (select user_id, pick_id, place_id, value from public.preferences
        where pick_id = private.try_uuid(p_pick_id) order by user_id, place_id) pr;
end $$;

-- Refresh replaces pick_candidates, which cascades the old taste rows away first.
alter function public.pick_refresh(text, uuid, jsonb) rename to pick_refresh_before_taste;
alter function public.pick_refresh_before_taste(text, uuid, jsonb) set schema private;
create function public.pick_refresh(p_pick_id text, p_user_id uuid, p_candidates jsonb) returns void
language plpgsql set search_path = '' as $$ begin
  perform private.unlearn_pick_swipes(p_pick_id);
  perform private.pick_refresh_before_taste(p_pick_id, p_user_id, p_candidates);
  perform private.save_candidate_taste(p_pick_id, p_candidates);
end $$;

-- Closing ranks in the API; give it each candidate's taste for the tiebreak.
alter function public.pick_load_for_close(text) rename to pick_load_for_close_before_taste;
alter function public.pick_load_for_close_before_taste(text) set schema private;
create function public.pick_load_for_close(p_pick_id text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v jsonb := private.pick_load_for_close_before_taste(p_pick_id);
begin
  if v is null then return null; end if;
  return jsonb_set(v, '{candidates}', coalesce((
    select jsonb_agg(e || jsonb_build_object('tasteScore', coalesce(t.taste_score, 0))
                     order by x.ord)
    from jsonb_array_elements(v -> 'candidates') with ordinality as x(e, ord)
    left join private.pick_candidate_taste t
      on t.pick_id = (v ->> 'id')::uuid and t.place_id = e ->> 'placeId'
  ), '[]'::jsonb));
end $$;

-- Group scores only matter until the Pick is ranked; remove them as soon as it leaves swiping,
-- so they never outlive the Pick's active phase (or a participant's account).
create function private.forget_candidate_taste() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.pick_candidate_taste where pick_id = new.id;
  return new;
end $$;
create trigger forget_candidate_taste after update of state on public.picks
  for each row when (new.state not in ('draft', 'swiping') and old.state in ('draft', 'swiping'))
  execute function private.forget_candidate_taste();

revoke all on function
  private.learn_taste(uuid, text, real), private.unlearn_pick_swipes(text),
  private.forget_candidate_taste(), private.candidate_taste_type(uuid, text),
  private.swipe_weight(smallint), private.learn_from_swipe(), private.learn_from_vote(),
  private.learn_from_winner(), private.save_candidate_taste(text, jsonb),
  private.pick_start_before_taste(text, uuid, jsonb),
  private.pick_availability_finish_before_taste(text, uuid, uuid, jsonb),
  private.pick_refresh_before_taste(text, uuid, jsonb),
  private.pick_load_for_close_before_taste(text)
  from public, anon, authenticated;
grant execute on function private.save_candidate_taste(text, jsonb),
  private.unlearn_pick_swipes(text) to service_role;
revoke all on function public.pick_start(text, uuid, jsonb), public.pick_refresh(text, uuid, jsonb),
  public.pick_load_for_close(text), public.pick_availability_finish(text, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.pick_start(text, uuid, jsonb), public.pick_refresh(text, uuid, jsonb),
  public.pick_load_for_close(text), public.pick_availability_finish(text, uuid, uuid, jsonb)
  to service_role;
