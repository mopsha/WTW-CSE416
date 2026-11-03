-- Explicit per-Pick opt-in. Old Picks retain the exact provider/custom behavior.
alter table public.picks add column include_group_ideas boolean not null default false;
alter table public.picks drop constraint picks_category_check;
alter table public.picks add constraint picks_category_check check (category in ('food','activities','both','custom'));

-- Canonical start/refresh writes the Pick category into places. A mixed Pick still
-- persists each actual food/activity category, never an invented provider category.
create function private.mixed_pick_place_category() returns trigger
language plpgsql set search_path='' as $$ begin
 if new.category='both' then
  if new.raw->>'category' not in ('food','activities') or new.raw->>'category' is null then
   raise exception using errcode='PT400',message='Mixed candidate category required';
  end if;
  new.category:=new.raw->>'category';
 end if;
 return new;
end $$;
revoke all on function private.mixed_pick_place_category() from public,anon,authenticated;
create trigger mixed_pick_place_category before insert or update on public.places
 for each row execute function private.mixed_pick_place_category();


-- Wrap the canonical functions, preserving their quota, state and notification semantics.
alter function public.pick_create_options(uuid,jsonb) rename to pick_create_options_before_ideas;
alter function public.pick_create_options_before_ideas(uuid,jsonb) set schema private;
create function public.pick_create_options(p_host_id uuid,p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare r jsonb; g uuid;
begin
 if p_input ? 'includeGroupIdeas' and jsonb_typeof(p_input->'includeGroupIdeas') is distinct from 'boolean' then
  raise exception using errcode='PT400',message='includeGroupIdeas must be boolean';
 end if;
 if coalesce((p_input->>'includeGroupIdeas')::boolean,false) then
  g:=private.try_uuid(p_input->>'groupId');
  if g is null then raise exception using errcode='PT400',message='Group Ideas require a group'; end if;
  perform private.lock_group_as_member(g,p_host_id);
  if jsonb_typeof(p_input->'customOptions')='array' and (p_input->>'poolSize')::integer<=jsonb_array_length(p_input->'customOptions') then
   raise exception using errcode='PT400',message='Leave a slot for Group Ideas';
  end if;
 end if;
 r:=private.pick_create_options_before_ideas(p_host_id,p_input);
 if g is not null then
  update public.picks set include_group_ideas=true,group_id=g where id=(r->>'id')::uuid;
 end if;
 return r;
end $$;

alter function public.pick_load_options(text,uuid) rename to pick_load_options_before_ideas;
alter function public.pick_load_options_before_ideas(text,uuid) set schema private;
create function public.pick_load_options(p_pick_id text,p_user_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb;
begin
 r:=private.pick_load_options_before_ideas(p_pick_id,p_user_id);
 if r is null then return null; end if;
 return r||(select jsonb_build_object('includeGroupIdeas',include_group_ideas,'groupId',group_id)
  from public.picks where id=(r->>'id')::uuid);
end $$;

-- At the commit boundary recheck membership under the group lock (same pick->group
-- lock order as pick_add_group). The Edge Function resolved ideas before this call.
-- Idea content itself is a snapshot: later library edits/deletions need no FK or join.
create function private.check_group_idea_deck(p_pick_id text,p_user_id uuid,p_candidates jsonb)
returns void language plpgsql set search_path='' as $$
declare p public.picks; c jsonb;
begin
 select * into p from public.picks where id=private.try_uuid(p_pick_id) for update;
 if not found then return; end if;
 if p.host_id is distinct from p_user_id then raise exception using errcode='PT403',message='Host only'; end if;
 if p.include_group_ideas then
  if p.group_id is null then raise exception using errcode='PT409',message='Pick no longer has a group'; end if;
  perform private.lock_group_as_member(p.group_id,p_user_id);
 end if;
 if jsonb_typeof(p_candidates) is distinct from 'array' then raise exception using errcode='PT400',message='Candidates must be an array'; end if;
 for c in select value->'snapshot' from jsonb_array_elements(p_candidates) loop
  if c->>'origin'='group_idea' then
   if not p.include_group_ideas or c->>'groupId' is distinct from p.group_id::text
    or not exists(select 1 from public.group_ideas i where i.id=private.try_uuid(c->>'groupIdeaId') and i.group_id=p.group_id
     and (case when i.category='activity' then 'activities' else 'food' end)=c->>'category'
     and i.created_by::text=c->>'createdBy')
    or c->>'provider' is distinct from 'custom'
    or c->>'source' is distinct from 'custom' or c->'locationProvided' is distinct from 'false'::jsonb
    or (p.category in ('food','activities') and c->>'category' is distinct from p.category)
    or (p.category='custom' and p.mix_category is not null and c->>'category' is distinct from p.mix_category) then
    raise exception using errcode='PT400',message='Invalid Group Idea provenance or category';
   end if;
  end if;
 end loop;
end $$;

alter function public.pick_start(text,uuid,jsonb) rename to pick_start_before_ideas;
alter function public.pick_start_before_ideas(text,uuid,jsonb) set schema private;
create function public.pick_start(p_pick_id text,p_user_id uuid,p_candidates jsonb) returns void
language plpgsql set search_path='' as $$ begin
 perform private.check_group_idea_deck(p_pick_id,p_user_id,p_candidates);
 perform private.pick_start_before_ideas(p_pick_id,p_user_id,p_candidates);
end $$;
alter function public.pick_refresh(text,uuid,jsonb) rename to pick_refresh_before_ideas;
alter function public.pick_refresh_before_ideas(text,uuid,jsonb) set schema private;
create function public.pick_refresh(p_pick_id text,p_user_id uuid,p_candidates jsonb) returns void
language plpgsql set search_path='' as $$ begin
 perform private.check_group_idea_deck(p_pick_id,p_user_id,p_candidates);
 perform private.pick_refresh_before_ideas(p_pick_id,p_user_id,p_candidates);
end $$;

-- Keep canonical group membership, filters, legacy option copying and draft reuse.
alter function public.pick_again(text,uuid) rename to pick_again_before_ideas;
alter function public.pick_again_before_ideas(text,uuid) set schema private;
create function public.pick_again(p_pick_id text,p_user_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare r jsonb; p public.picks; existing uuid;
begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 select id into existing from public.picks where again_of=p.id and state='draft' limit 1;
 r:=private.pick_again_before_ideas(p_pick_id,p_user_id);
 -- A repeated tap must not overwrite an already-created draft's settings.
 if existing is null then
  update public.picks set include_group_ideas=p.include_group_ideas and group_id is not null
   where id=(r->>'id')::uuid;
 end if;
 return r;
end $$;

revoke all on function public.pick_create_options(uuid,jsonb),public.pick_load_options(text,uuid),
 public.pick_start(text,uuid,jsonb),public.pick_refresh(text,uuid,jsonb),public.pick_again(text,uuid)
 from public,anon,authenticated;
grant execute on function public.pick_create_options(uuid,jsonb),public.pick_load_options(text,uuid),
 public.pick_start(text,uuid,jsonb),public.pick_refresh(text,uuid,jsonb),public.pick_again(text,uuid) to service_role;
revoke all on function private.check_group_idea_deck(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.check_group_idea_deck(text,uuid,jsonb) to service_role;
