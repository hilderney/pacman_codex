-- Upgrade existing installations after 001. Keep the same public RPC name and
-- payload fields, but remove the original 999-screen / 7-day game ceilings.
begin;
alter table public.scores drop constraint scores_best_score_check;
alter table public.scores drop constraint scores_level_reached_check;
alter table public.scores alter column best_score type bigint;
alter table public.scores alter column level_reached type bigint;
-- Representation bounds only: integers remain exact in the JavaScript client.
alter table public.scores add constraint scores_best_score_check check (best_score between 0 and 9007199254740991);
alter table public.scores add constraint scores_level_reached_check check (level_reached between 1 and 9007199254740991);

drop function public.submit_score(integer, integer, bigint, uuid);
create function public.submit_score(
  p_score bigint, p_level bigint, p_duration_ms bigint, p_run_id uuid
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_best bigint;
  v_speed numeric;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_score is null or p_level is null or p_duration_ms is null or p_run_id is null
     or p_level < 1 or p_level > 9007199254740991 or p_score < 10 or p_score > 9007199254740991
     or p_score % 10 <> 0 or p_score::numeric > 25000::numeric * p_level
     or p_duration_ms < 1000 or p_duration_ms > 9007199254740991 then
    raise exception 'Implausible score, level or active duration' using errcode = '22023';
  end if;
  v_speed := 1 + (p_level::numeric - 1) / 99;
  -- Conservative lower bound: previous screens were all slower than this one.
  -- Keeping the old constant points/second bound would reject legal fast runs.
  if p_duration_ms < greatest(1000::numeric, ceil(p_score::numeric / v_speed), ceil((p_level::numeric - 1) * 8000 / v_speed)) then
    raise exception 'Implausible score, level or active duration' using errcode = '22023';
  end if;
  if not exists(select 1 from public.profiles where user_id = v_uid) then
    raise exception 'Claim a nickname first' using errcode = '23503';
  end if;
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
  -- p_score is the peak BALANCE, never the gross sum collected before losses.
  insert into public.scores(user_id, best_score, level_reached, updated_at)
  values(v_uid, p_score, p_level, v_now)
  on conflict(user_id) do update set best_score = excluded.best_score,
    level_reached = excluded.level_reached, updated_at = excluded.updated_at
  where excluded.best_score > scores.best_score
     or (excluded.best_score = scores.best_score and excluded.level_reached > scores.level_reached);
  select best_score into v_best from public.scores where user_id = v_uid;
  return v_best;
end;
$$;
revoke all on function public.submit_score(bigint, bigint, bigint, uuid) from public, anon;
grant execute on function public.submit_score(bigint, bigint, bigint, uuid) to authenticated;
commit;
