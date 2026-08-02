-- Remove client execution from dormant legacy gamification definers.
--
-- community_weekly_leaderboard bypasses caller RLS and exposes stable user IDs
-- plus activity totals. No current web or mobile client calls it. The rank
-- function is a trigger implementation and likewise has no direct-call use.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.community_weekly_leaderboard(integer)') IS NULL THEN
    RAISE EXCEPTION 'GAMIFICATION_DEFINER_FENCE_LEADERBOARD_MISSING'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.community_recalc_rank()') IS NULL THEN
    RAISE EXCEPTION 'GAMIFICATION_DEFINER_FENCE_RANK_TRIGGER_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

REVOKE ALL ON FUNCTION public.community_weekly_leaderboard(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_weekly_leaderboard(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.community_recalc_rank()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_recalc_rank()
  TO service_role;

DO $postflight$
DECLARE
  target_role text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::text[]
  LOOP
    IF has_function_privilege(
         target_role,
         'public.community_weekly_leaderboard(integer)',
         'EXECUTE'
       ) OR has_function_privilege(
         target_role,
         'public.community_recalc_rank()',
         'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'GAMIFICATION_DEFINER_FENCE_CLIENT_EXECUTE_REMAINS: %', target_role
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
    'service_role',
    'public.community_weekly_leaderboard(integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'GAMIFICATION_DEFINER_FENCE_SERVICE_EXECUTE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$postflight$;

COMMIT;
