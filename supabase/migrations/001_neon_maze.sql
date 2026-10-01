-- Apply once using the Supabase SQL Editor or `supabase db push`.
-- Only public profiles and the SINGLE BEST score are readable by the client.
begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null unique check (nickname ~ '^[A-Za-z0-9_]{3,12}$')
);
create unique index profiles_nickname_case_insensitive on public.profiles (lower(nickname));

create table public.scores (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  best_score integer not null check (best_score between 0 and 24975000),
  level_reached integer not null check (level_reached between 1 and 999),
  updated_at timestamptz not null default now()
);
create index scores_leaderboard on public.scores (best_score desc, updated_at asc, user_id asc);

alter table public.profiles enable row level security;
alter table public.scores enable row level security;
revoke all on public.profiles, public.scores from anon, authenticated;
grant select on public.profiles, public.scores to anon, authenticated;
create policy profiles_read on public.profiles for select to anon, authenticated using (true);
create policy scores_read on public.scores for select to anon, authenticated using (true);
-- No INSERT/UPDATE/DELETE policies or grants. All mutations go through RPCs.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.score_submissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  submitted_at timestamptz not null default clock_timestamp(),
  primary key (user_id, run_id)
);
create index score_submissions_rate on private.score_submissions (user_id, submitted_at desc);
alter table private.score_submissions enable row level security;
revoke all on private.score_submissions from public, anon, authenticated;

-- Profile registration is a separate narrow RPC: a user can claim one name.
create or replace function public.claim_nickname(p_nickname text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(p_nickname);
  v_existing text;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if v_name is null or v_name !~ '^[A-Za-z0-9_]{3,12}$' then
    raise exception 'Invalid nickname' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  select nickname into v_existing from public.profiles where user_id = v_uid;
  if v_existing is not null then
    if v_existing = v_name then return v_existing; end if;
    raise exception 'Nickname already claimed' using errcode = '22023';
  end if;
  insert into public.profiles(user_id, nickname) values(v_uid, v_name);
  return v_name;
end;
$$;
revoke all on function public.claim_nickname(text) from public, anon;
grant execute on function public.claim_nickname(text) to authenticated;

-- Bounds intentionally exceed the maximum legal points per maze:
-- <868 sparks *10 +4 energy *50 +4*(200+400+800+1600) +2 fruits*1000.
-- Offline clients cannot provide a trusted clock or replay: this is plausibility
-- validation and abuse throttling, NOT authoritative anti-cheat (see README).
create or replace function public.submit_score(
  p_score integer, p_level integer, p_duration_ms bigint, p_run_id uuid
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_best integer;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_score is null or p_level is null or p_duration_ms is null or p_run_id is null
     or p_level < 1 or p_level > 999 or p_score < 10 or p_score % 10 <> 0
     or p_score::bigint > 25000::bigint * p_level
     or p_duration_ms < greatest(1000::bigint, p_score::bigint, (p_level::bigint - 1) * 8000)
     or p_duration_ms > 604800000 then
    raise exception 'Implausible score, level or active duration' using errcode = '22023';
  end if;
  if not exists(select 1 from public.profiles where user_id = v_uid) then
    raise exception 'Claim a nickname first' using errcode = '23503';
  end if;
  -- Serializes concurrent submissions from all tabs/devices of this player.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 1));
  if exists(select 1 from private.score_submissions where user_id = v_uid and run_id = p_run_id) then
    select best_score into v_best from public.scores where user_id = v_uid;
    return v_best;
  end if;
  if (select count(*) from private.score_submissions where user_id = v_uid and submitted_at > v_now - interval '1 minute') >= 5 then
    raise exception 'Submission rate exceeded; retry later' using errcode = 'P0001';
  end if;
  delete from private.score_submissions where user_id = v_uid and submitted_at < v_now - interval '30 days';
  insert into private.score_submissions(user_id, run_id, submitted_at) values(v_uid, p_run_id, v_now);
  insert into public.scores(user_id, best_score, level_reached, updated_at)
  values(v_uid, p_score, p_level, v_now)
  on conflict(user_id) do update set
    best_score = excluded.best_score, level_reached = excluded.level_reached, updated_at = excluded.updated_at
  where excluded.best_score > scores.best_score
     or (excluded.best_score = scores.best_score and excluded.level_reached > scores.level_reached);
  select best_score into v_best from public.scores where user_id = v_uid;
  return v_best;
end;
$$;
revoke all on function public.submit_score(integer, integer, bigint, uuid) from public, anon;
grant execute on function public.submit_score(integer, integer, bigint, uuid) to authenticated;

commit;
