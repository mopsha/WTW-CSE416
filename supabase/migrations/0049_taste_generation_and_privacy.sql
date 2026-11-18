-- Forward fix for 0047. 0048 is reserved by the photo-limit PR.
-- UUIDs identify candidate incarnations even when start and refresh share one transaction.
-- No Pick/history backfill: old optional cache entries have no trustworthy generation.
alter table public.pick_candidates add column taste_generation uuid not null default gen_random_uuid();
-- Earlier shared previews of 0047 had a candidate FK and no timestamp column.
-- Normalize those variants as well as the current PR schema without rewriting 0047.
do $$ declare fk record; begin
 for fk in select conname from pg_catalog.pg_constraint
  where conrelid='private.pick_candidate_taste'::regclass and contype='f' loop
  execute format('alter table private.pick_candidate_taste drop constraint %I',fk.conname);
 end loop;
end $$;
delete from private.pick_candidate_taste;
alter table private.pick_candidate_taste add column if not exists candidate_created_at timestamptz;
alter table private.pick_candidate_taste add column candidate_generation uuid not null;
comment on column private.pick_candidate_taste.candidate_created_at is 'Legacy 0047 compatibility only; never used as identity.';

-- Legacy signals have hashed sources, without provider provenance. Reconstruct only
-- existing signals supported by current owned-source actions, using the independent
-- owned classification and canonical weight (never the legacy classification).
-- The WTW action timestamp is retained; reset/deleted signals are not recreated.
create temporary table wtw_0049_owned_learning as
with owned as materialized (
 select c.pick_id,c.place_id,c.snapshot->>'tasteType' as place_type
 from public.pick_candidates c where c.snapshot->>'provider' is distinct from 'google'
 and c.snapshot->>'tasteType' ~ '^[a-z_]{1,60}$'
), evidence as (
 select pr.user_id,private.taste_source('swipe',c.pick_id,c.place_id) as source,
  c.place_type,private.swipe_weight(pr.value) as weight
 from owned c join public.preferences pr on pr.pick_id=c.pick_id and pr.place_id=c.place_id
 union all
 select v.user_id,private.taste_source('vote',c.pick_id,null),c.place_type,1::real
 from owned c join public.final_votes v on v.pick_id=c.pick_id and v.place_id=c.place_id
 union all
 select pp.user_id,private.taste_source('winner',p.id,null),c.place_type,2::real
 from owned c join public.picks p on p.id=c.pick_id and p.winner_place_id=c.place_id
 join public.pick_participants pp on pp.pick_id=p.id
)
select t.user_id,t.source,e.place_type,e.weight from public.taste_signals t
 join evidence e on e.user_id=t.user_id and e.source=t.source;
delete from public.taste_signals t where not exists (
 select 1 from wtw_0049_owned_learning e where e.user_id=t.user_id and e.source=t.source);
update public.taste_signals t set place_type=e.place_type,weight=e.weight
 from wtw_0049_owned_learning e where e.user_id=t.user_id and e.source=t.source;
drop table wtw_0049_owned_learning;
update public.pick_candidates set snapshot=snapshot-'tasteType'
 where snapshot->>'provider'='google' and snapshot ? 'tasteType';

-- Earlier 0047 previews capped before the last decay. Keep the aggregate uncapped;
-- the deployed API applies its final cap only after fading to the evaluation time.
create or replace view public.learned_taste with (security_invoker=true) as
 select user_id,place_type,
  sum(weight*power(0.5,extract(epoch from latest-at)/(30*86400.0)))::real as score,
  latest as updated_at
 from (select *,max(at) over(partition by user_id,place_type) as latest from public.taste_signals) s
 group by user_id,place_type,latest;

-- Database enforcement also protects mixed-version API deployments and old snapshots.
create function private.strip_google_taste_type() returns trigger
language plpgsql set search_path='' as $$ begin
 if new.snapshot->>'provider'='google' then new.snapshot:=new.snapshot-'tasteType'; end if;
 return new;
end $$;
revoke all on function private.strip_google_taste_type() from public,anon,authenticated;
create trigger strip_google_taste_type before insert or update of snapshot on public.pick_candidates
 for each row execute function private.strip_google_taste_type();
create or replace function private.candidate_taste_type(p_pick_id uuid,p_place_id text) returns text
language sql stable security definer set search_path='' as $$
 select c.snapshot->>'tasteType' from public.pick_candidates c
 where c.pick_id=p_pick_id and c.place_id=p_place_id
 and c.snapshot->>'provider' is distinct from 'google'
$$;

-- All failures caught here concern the optional cache, never canonical authorization or
-- lifecycle validation. The local timeout handles table locks as well as row contention.
create or replace function private.save_candidate_taste(p_pick_id text,p_candidates jsonb) returns void
language plpgsql set search_path='' set lock_timeout='200ms' as $$ begin
 delete from private.pick_candidate_taste t
 where t.ctid in (select x.ctid from private.pick_candidate_taste x
  where x.pick_id=private.try_uuid(p_pick_id) for update skip locked);
 insert into private.pick_candidate_taste(pick_id,place_id,candidate_created_at,candidate_generation,taste_score)
 select c.pick_id,c.place_id,c.created_at,c.taste_generation,
  greatest(-1,least(1,(e->>'tasteScore')::numeric))::real
 from jsonb_array_elements(p_candidates) e join public.pick_candidates c
  on c.pick_id=private.try_uuid(p_pick_id) and c.place_id=e->>'placeId'
 where c.snapshot->>'provider' is distinct from 'google'
 and jsonb_typeof(e->'tasteScore')='number' and (e->>'tasteScore')::numeric<>0
 on conflict(pick_id,place_id) do update set candidate_created_at=excluded.candidate_created_at,
  candidate_generation=excluded.candidate_generation,taste_score=excluded.taste_score;
exception when others then null;
end $$;

create or replace function public.pick_load_for_close(p_pick_id text) returns jsonb
language plpgsql stable set search_path='' set lock_timeout='200ms' as $$
declare v jsonb; result jsonb; begin
 -- Canonical access/snapshot errors propagate. Only optional enrichment is isolated.
 v:=private.pick_load_for_close_before_taste(p_pick_id);
 if v is null then return null; end if;
 begin
  select jsonb_set(v,'{candidates}',coalesce(jsonb_agg(
   e||jsonb_build_object('tasteScore',coalesce(t.taste_score,0)) order by x.ord),'[]'::jsonb))
  into result
  from jsonb_array_elements(v->'candidates') with ordinality x(e,ord)
  left join public.pick_candidates c on c.pick_id=(v->>'id')::uuid and c.place_id=e->>'placeId'
  left join private.pick_candidate_taste t on t.pick_id=c.pick_id and t.place_id=c.place_id
   and t.candidate_generation=c.taste_generation
   and c.snapshot->>'provider' is distinct from 'google';
  return result;
 exception when others then return v;
 end;
end $$;

-- Covers missing Picks, finished/canceled Picks, removed candidates and replaced generations
-- (including active No-deadline Picks). A skipped locked row is eligible again next sweep.
create function private.purge_candidate_taste() returns void
language plpgsql security definer set search_path='' set lock_timeout='200ms' as $$ begin
 delete from private.pick_candidate_taste t where t.ctid in (
  select x.ctid from private.pick_candidate_taste x where not exists (
   select 1 from public.picks p join public.pick_candidates c on c.pick_id=p.id
   where p.id=x.pick_id and p.state in ('draft','swiping') and c.place_id=x.place_id
    and c.taste_generation=x.candidate_generation
    and c.snapshot->>'provider' is distinct from 'google'
  ) for update skip locked
 );
exception when others then null;
end $$;
revoke all on function private.purge_candidate_taste() from public,anon,authenticated;
grant execute on function private.purge_candidate_taste() to service_role;

create or replace function private.forget_candidate_taste() returns trigger
language plpgsql security definer set search_path='' set lock_timeout='200ms' as $$ begin
 delete from private.pick_candidate_taste t where t.ctid in (
  select x.ctid from private.pick_candidate_taste x where x.pick_id=new.id for update skip locked);
 return new;
exception when others then return new;
end $$;

-- Preserve canonical Google coordinate retention, with optional cache work in its own helper.
create or replace function public.purge_google_coordinates(p_cutoff timestamptz) returns integer
language plpgsql set search_path='' as $$ declare v_removed integer; begin
 update public.picks p set state='canceled',cancel_reason='This Pick expired before it finished.'
 where p.state in ('swiping','ranking','final_vote') and exists (
  select 1 from public.pick_candidates c where c.pick_id=p.id
   and c.snapshot->>'provider'='google' and c.created_at<p_cutoff);
 update public.pick_candidates set snapshot=snapshot-'lat'-'lng'-'tasteType'
 where snapshot->>'provider'='google' and snapshot ? 'lat' and created_at<p_cutoff;
 get diagnostics v_removed=row_count;
 perform private.purge_candidate_taste();
 return v_removed;
end $$;
