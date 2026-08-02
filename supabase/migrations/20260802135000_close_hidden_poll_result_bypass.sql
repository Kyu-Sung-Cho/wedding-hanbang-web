-- `hide_results_until_voted` was previously enforced only by React. Both anon
-- and authenticated callers could bypass it by selecting the stored counters
-- from PostgREST directly. Keep non-result poll metadata readable under the
-- existing RLS policies, but make result counters server-only so the API can
-- release them only after a viewer votes or the poll closes.

REVOKE SELECT ON TABLE public.community_polls
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  post_id,
  question,
  allow_multiple,
  is_anonymous,
  hide_results_until_voted,
  closes_at,
  created_at
) ON TABLE public.community_polls TO anon, authenticated;
GRANT SELECT ON TABLE public.community_polls TO service_role;

REVOKE SELECT ON TABLE public.community_poll_options
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  poll_id,
  position,
  label,
  image_url,
  created_at
) ON TABLE public.community_poll_options TO anon, authenticated;
GRANT SELECT ON TABLE public.community_poll_options TO service_role;

DO $hidden_poll_result_postcondition$
BEGIN
  IF has_column_privilege('anon', 'public.community_polls', 'total_voters', 'SELECT')
     OR has_column_privilege('anon', 'public.community_polls', 'total_votes', 'SELECT')
     OR has_column_privilege('anon', 'public.community_poll_options', 'vote_count', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_polls', 'total_voters', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_polls', 'total_votes', 'SELECT')
     OR has_column_privilege('authenticated', 'public.community_poll_options', 'vote_count', 'SELECT') THEN
    RAISE EXCEPTION 'HIDDEN_POLL_RESULT_COUNTER_PRIVILEGE_REMAINS'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_column_privilege('anon', 'public.community_polls', 'question', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.community_poll_options', 'label', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.community_polls', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.community_poll_options', 'SELECT') THEN
    RAISE EXCEPTION 'HIDDEN_POLL_SAFE_READ_PRIVILEGE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$hidden_poll_result_postcondition$;

COMMENT ON COLUMN public.community_polls.total_voters IS
  'Server-only result counter. Public release must honor hide_results_until_voted and closes_at.';
COMMENT ON COLUMN public.community_polls.total_votes IS
  'Server-only result counter. Public release must honor hide_results_until_voted and closes_at.';
COMMENT ON COLUMN public.community_poll_options.vote_count IS
  'Server-only result counter. Public release must honor the parent poll visibility rule.';
