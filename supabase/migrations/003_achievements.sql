-- Run after 001 and 002. Catalog is data, while award rules are reviewed code.
begin;

create table public.achievement_definitions (
  slug text primary key check (slug ~ '^[a-z][a-z0-9_]{2,63}$'),
  family_key text not null, tier integer not null default 1,
  badge_key text not null, exclusive boolean not null default false,
  active boolean not null default true, sort_order integer not null unique
);
insert into public.achievement_definitions(slug,family_key,tier,badge_key,exclusive,sort_order) values
('ace_spirit','survival',1,'halo',false,1),
('noob','survival',1,'spark_broken',false,2),
('neon_maze_king','ranking',1,'crown',false,3),
('first_light','firsts',1,'prism',true,4),
('light_bringer','firsts',2,'beacon',true,5),
('neon_pioneer','firsts',1,'flag',true,6),
('spark_starter','spark',1,'spark',false,7),
('spark_keeper','spark',2,'spark',false,8),
('still_standing','survival',2,'shield',false,9),
('tunnel_loop','exploration',1,'portal',false,10),
('amazind_circuit','circuit',1,'circuit',false,11),
('perfect_circuit','circuit',2,'circuit',false,12),
('ominius_circuit','circuit',3,'circuit',false,13),
('phantom_quartet','phantom',4,'phantom',false,14),
('phantom_quintuplets','phantom',5,'phantom',false,15),
('phantom_sextuplets','phantom',6,'phantom',false,16),
('phantom_septuplets','phantom',7,'phantom',false,17),
('phantom_octuplets','phantom',8,'phantom',false,18);

create table public.player_achievements (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  slug text not null references public.achievement_definitions(slug),
  awarded_at timestamptz not null default clock_timestamp(),
  primary key(user_id,slug)
);
create table public.exclusive_holders (
  slug text primary key references public.achievement_definitions(slug),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  awarded_at timestamptz not null default clock_timestamp()
);
create table private.achievement_candidates (
  candidate_id bigint generated always as identity primary key,
  slug text not null references public.achievement_definitions(slug),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  qualified_at timestamptz not null default clock_timestamp(),
  unique(slug,user_id)
);
create table private.achievement_runs (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  run_id uuid not null, last_sequence bigint not null default 0,
  elapsed_ms bigint not null default 0, cleared bigint not null default 0,
  deaths bigint not null default 0, screen_deaths bigint not null default 0,
  peak bigint not null default 0, tunnel_count bigint not null default 0,
  power_id bigint not null default 0, power_started_ms bigint not null default 0,
  captures bigint not null default 0,
  ended boolean not null default false, primary key(user_id,run_id)
);
create table private.achievement_events (
  user_id uuid not null, run_id uuid not null, sequence bigint not null,
  kind text not null, payload jsonb not null, received_at timestamptz not null default clock_timestamp(),
  primary key(user_id,run_id,sequence),
  foreign key(user_id,run_id) references private.achievement_runs(user_id,run_id) on delete cascade
);
create table private.noob_runs (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  run_id uuid not null, primary key(user_id,run_id)
);
create table private.leaderboard_daily_leaders (
  day_utc date primary key, user_id uuid not null references public.profiles(user_id) on delete cascade,
  score bigint not null, captured_at timestamptz not null default clock_timestamp()
);

alter table public.achievement_definitions enable row level security;
alter table public.player_achievements enable row level security;
alter table public.exclusive_holders enable row level security;
alter table private.achievement_candidates enable row level security;
alter table private.achievement_runs enable row level security;
alter table private.achievement_events enable row level security;
alter table private.noob_runs enable row level security;
alter table private.leaderboard_daily_leaders enable row level security;
revoke all on public.achievement_definitions, public.player_achievements, public.exclusive_holders from public, anon, authenticated;
grant select on public.achievement_definitions, public.player_achievements, public.exclusive_holders to anon, authenticated;
create policy achievement_catalog_read on public.achievement_definitions for select to anon,authenticated using(active);
create policy achievement_awards_read on public.player_achievements for select to anon,authenticated using(true);
create policy achievement_exclusive_read on public.exclusive_holders for select to anon,authenticated using(true);
revoke all on private.achievement_candidates, private.achievement_runs, private.achievement_events,
  private.noob_runs, private.leaderboard_daily_leaders from public, anon, authenticated;

-- Called only by trusted database functions. An advisory lock serializes the
-- first qualification for an exclusive title, even across different players.
create function private.award_achievement(p_user uuid,p_slug text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_exclusive boolean; v_inserted uuid;
begin
  select exclusive into v_exclusive from public.achievement_definitions where slug=p_slug and active;
  if v_exclusive is null then return false; end if;
  if v_exclusive then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_slug,73));
    insert into private.achievement_candidates(slug,user_id) values(p_slug,p_user) on conflict do nothing;
    insert into public.exclusive_holders(slug,user_id) values(p_slug,p_user)
      on conflict do nothing returning user_id into v_inserted;
    return v_inserted is not null;
  end if;
  insert into public.player_achievements(user_id,slug) values(p_user,p_slug)
    on conflict do nothing returning user_id into v_inserted;
  return v_inserted is not null;
end $$;
revoke all on function private.award_achievement(uuid,text) from public,anon,authenticated;

create function private.transfer_exclusive_title()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_next uuid;
begin
  select user_id into v_next from private.achievement_candidates
    where slug=old.slug and user_id<>old.user_id
    order by candidate_id limit 1;
  if v_next is not null then
    insert into public.exclusive_holders(slug,user_id) values(old.slug,v_next) on conflict do nothing;
  end if;
  return old;
end $$;
create trigger transfer_exclusive_after_delete after delete on public.exclusive_holders
  for each row execute function private.transfer_exclusive_title();

-- A batch is ordered by client sequence. Each event is accepted once; a gap
-- fails the transaction, so offline retries cannot silently skip milestones.
create function public.submit_achievement_events(p_events jsonb)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_item jsonb; v_run private.achievement_runs%rowtype;
  v_run_id uuid; v_seq bigint; v_kind text; v_level bigint; v_elapsed bigint;
  v_peak bigint; v_balance bigint; v_deaths bigint; v_cleared bigint;
  v_penalty bigint; v_power bigint; v_ghost integer; v_awards text[] := '{}';
  v_slug text; v_tier integer; v_new boolean;
begin
  if v_user is null or not exists(select 1 from public.profiles where user_id=v_user) then
    raise exception 'Profile required' using errcode='28000';
  end if;
  if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 32 then
    raise exception 'Invalid event batch' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,72));
  if (select count(*) from private.achievement_events
      where user_id=v_user and received_at>clock_timestamp()-interval '1 minute')>=1000 then
    raise exception 'Achievement event rate exceeded' using errcode='P0001';
  end if;
  for v_item in select value from jsonb_array_elements(p_events) loop
    v_run_id := (v_item->>'runId')::uuid;
    v_seq := (v_item->>'sequence')::bigint;
    v_kind := v_item->>'kind';
    v_level := (v_item->>'level')::bigint;
    v_elapsed := (v_item->>'elapsedMs')::bigint;
    v_peak := (v_item->>'peak')::bigint;
    v_balance := (v_item->>'balance')::bigint;
    v_deaths := (v_item->>'deaths')::bigint;
    v_cleared := (v_item->>'cleared')::bigint;
    v_penalty := (v_item->>'penalty')::bigint;
    v_power := (v_item->>'powerId')::bigint;
    v_ghost := (v_item->>'ghostId')::integer;
    if v_run_id is null or v_seq is null or v_seq<1 or v_seq>9007199254740991
       or v_kind is null or v_kind not in ('clear','death','over','power','capture','tunnel','peak')
       or v_level is null or v_level<1 or v_level>9007199254740991
       or v_elapsed is null or v_elapsed<0 or v_elapsed>9007199254740991
       or v_peak is null or v_peak<0 or v_peak>9007199254740991
       or v_peak::numeric>25000::numeric*v_level
       or v_balance is null or v_balance<0 or v_balance>v_peak
       or v_deaths is null or v_deaths<0 or v_deaths>9007199254740991
       or v_cleared is null or v_cleared<0 or v_cleared>9007199254740991
       or v_penalty is null or v_penalty<0 or v_penalty>9007199254740991
       or v_power is null or v_power<0 or v_power>9007199254740991 then
      raise exception 'Invalid achievement event' using errcode='22023';
    end if;
    insert into private.achievement_runs(user_id,run_id) values(v_user,v_run_id) on conflict do nothing;
    select * into v_run from private.achievement_runs where user_id=v_user and run_id=v_run_id for update;
    if v_seq<=v_run.last_sequence then
      if exists(select 1 from private.achievement_events where user_id=v_user and run_id=v_run_id and sequence=v_seq and payload=v_item) then continue; end if;
      raise exception 'Conflicting event sequence' using errcode='22023';
    end if;
    if v_run.ended or v_seq<>v_run.last_sequence+1 or v_elapsed<v_run.elapsed_ms
       or v_peak<v_run.peak or v_cleared<v_run.cleared or v_deaths<v_run.deaths
       or v_power<v_run.power_id or v_level<>v_cleared+1
       and not (v_kind='clear' and v_level=v_cleared)
       or (v_kind<>'clear' and v_cleared<>v_run.cleared)
       or (v_kind='clear' and v_cleared<>v_run.cleared+1)
       or (v_kind<>'death' and v_deaths<>v_run.deaths)
       or (v_kind='death' and v_deaths<>v_run.deaths+1) then
      raise exception 'Out-of-order achievement event' using errcode='22023';
    end if;
    if v_kind='power' then
      if v_power<>v_run.power_id+1 then raise exception 'Invalid power window' using errcode='22023'; end if;
      v_run.captures:=0; v_run.power_started_ms:=v_elapsed;
    elsif v_power<>v_run.power_id then
      raise exception 'Invalid power window' using errcode='22023';
    end if;
    if v_kind='capture' then
      if v_power=0 or v_ghost not between 0 and 3 or v_elapsed>v_run.power_started_ms+14000 then
        raise exception 'Invalid capture' using errcode='22023'; end if;
      v_run.captures:=v_run.captures+1;
      for v_slug,v_tier in select slug,tier from public.achievement_definitions where family_key='phantom' and tier<=v_run.captures and active loop
        if private.award_achievement(v_user,v_slug) then v_awards:=array_append(v_awards,v_slug); end if;
      end loop;
    elsif v_kind='death' then
      if v_penalty>v_peak or v_balance+v_penalty>v_peak
         or v_penalty>least(9007199254740991::numeric,10::numeric*power(2::numeric,least(v_deaths-1,50))) then
        raise exception 'Invalid penalty' using errcode='22023'; end if;
      v_run.screen_deaths:=v_run.screen_deaths+1;
      if v_penalty>100000 and private.award_achievement(v_user,'still_standing') then v_awards:=array_append(v_awards,'still_standing'); end if;
    elsif v_kind='clear' then
      -- An offline batch may arrive at once, but its active-play clock still
      -- needs a conservative floor for every completed screen.
      if v_elapsed < v_cleared * 8000 then
        raise exception 'Implausible clear duration' using errcode='22023'; end if;
      if v_run.screen_deaths=0 and private.award_achievement(v_user,'ace_spirit') then v_awards:=array_append(v_awards,'ace_spirit'); end if;
      v_run.screen_deaths:=0;
      if v_run.deaths=0 then
        if v_cleared>=25 and private.award_achievement(v_user,'amazind_circuit') then v_awards:=array_append(v_awards,'amazind_circuit'); end if;
        if v_cleared>=50 and private.award_achievement(v_user,'first_light') then v_awards:=array_append(v_awards,'first_light'); end if;
        if v_cleared>=100 and private.award_achievement(v_user,'perfect_circuit') then v_awards:=array_append(v_awards,'perfect_circuit'); end if;
        if v_cleared>=250 and private.award_achievement(v_user,'ominius_circuit') then v_awards:=array_append(v_awards,'ominius_circuit'); end if;
        if v_cleared>=500 and private.award_achievement(v_user,'light_bringer') then v_awards:=array_append(v_awards,'light_bringer'); end if;
      end if;
      if v_cleared>=50 and private.award_achievement(v_user,'neon_pioneer') then v_awards:=array_append(v_awards,'neon_pioneer'); end if;
    elsif v_kind='tunnel' then
      v_run.tunnel_count:=v_run.tunnel_count+1;
      if v_run.tunnel_count>=101 and private.award_achievement(v_user,'tunnel_loop') then v_awards:=array_append(v_awards,'tunnel_loop'); end if;
    elsif v_kind='over' then
      if v_balance<>0 or v_deaths=0 then raise exception 'Invalid game over' using errcode='22023'; end if;
      v_run.ended:=true;
      if v_run.cleared=0 then
        insert into private.noob_runs(user_id,run_id) values(v_user,v_run_id) on conflict do nothing;
        if (select count(*) from private.noob_runs where user_id=v_user)>=3
           and private.award_achievement(v_user,'noob') then v_awards:=array_append(v_awards,'noob'); end if;
      end if;
    end if;
    if v_peak>=1000 and v_deaths=0 and private.award_achievement(v_user,'spark_starter') then v_awards:=array_append(v_awards,'spark_starter'); end if;
    if v_peak>=100000 and private.award_achievement(v_user,'spark_keeper') then v_awards:=array_append(v_awards,'spark_keeper'); end if;
    update private.achievement_runs set last_sequence=v_seq,elapsed_ms=v_elapsed,cleared=v_cleared,
      deaths=v_deaths,screen_deaths=v_run.screen_deaths,peak=v_peak,tunnel_count=v_run.tunnel_count,
      power_id=v_power,power_started_ms=v_run.power_started_ms,captures=v_run.captures,ended=v_run.ended
      where user_id=v_user and run_id=v_run_id;
    insert into private.achievement_events(user_id,run_id,sequence,kind,payload) values(v_user,v_run_id,v_seq,v_kind,v_item);
  end loop;
  return v_awards;
end $$;
revoke all on function public.submit_achievement_events(jsonb) from public,anon;
grant execute on function public.submit_achievement_events(jsonb) to authenticated;

create function public.my_achievement_candidates()
returns table(slug text, queue_position bigint) language sql security definer set search_path = '' as $$
  select ranked.slug,ranked.queue_position from (
    select c.slug,c.user_id,
      row_number() over(partition by c.slug order by c.candidate_id)::bigint as queue_position
    from private.achievement_candidates c
  ) ranked where ranked.user_id=auth.uid();
$$;
revoke all on function public.my_achievement_candidates() from public,anon;
grant execute on function public.my_achievement_candidates() to authenticated;

-- Run daily at 23:59 UTC from a trusted database cron job. Missing days stay
-- missing; they never count towards a 30-day streak.
create function private.capture_daily_leader(p_day date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_score bigint;
begin
  if p_day is null or p_day>(clock_timestamp() at time zone 'UTC')::date then
    raise exception 'Invalid snapshot day' using errcode='22023';
  end if;
  select user_id,best_score into v_user,v_score from public.scores
    order by best_score desc,updated_at asc,user_id asc limit 1;
  if v_user is null then return; end if;
  insert into private.leaderboard_daily_leaders(day_utc,user_id,score) values(p_day,v_user,v_score) on conflict do nothing;
  if (select count(*) from private.leaderboard_daily_leaders
      where day_utc between p_day-29 and p_day and user_id=v_user)=30 then
    perform private.award_achievement(v_user,'neon_maze_king');
  end if;
end $$;
revoke all on function private.capture_daily_leader(date) from public,anon,authenticated;

commit;
