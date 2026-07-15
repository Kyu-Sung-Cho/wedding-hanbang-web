-- CONTRACT PHASE: remove legacy privacy-bypassing policies and broad grants.
-- Apply only after the compatible web/mobile release has passed its canary and
-- rollback to the previous application version is no longer required.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regprocedure('public.redact_old_ai_interactions(interval)') IS NULL THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_REDACTION_FUNCTION_MISSING';
  END IF;

  IF NOT has_function_privilege(
       'anon',
       'public.redact_old_ai_interactions(interval)',
       'EXECUTE'
     )
     OR NOT has_table_privilege('authenticated', 'public.decision_nodes', 'UPDATE')
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'decision_nodes'
         AND policyname = 'decision_nodes_owner_all'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'chat_summaries'
         AND policyname = 'chat_summaries_select_couple'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'chat_messages'
         AND policyname = 'Allow AI message insert'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'chat_messages'
         AND policyname = 'chat_insert_couple'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'chat_messages'
         AND policyname = 'couple_members_can_insert_messages'
     ) THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_HARDENING_PRECONDITION_FAILED';
  END IF;
END;
$$;

-- Restore the visibility rule that the broad June policy rebuild accidentally
-- replaced with a couple-membership-only predicate.
DROP POLICY IF EXISTS chat_summaries_select_couple ON public.chat_summaries;
DROP POLICY IF EXISTS chat_summaries_select_with_privacy ON public.chat_summaries;
CREATE POLICY chat_summaries_select_with_privacy ON public.chat_summaries
  FOR SELECT TO authenticated
  USING (public.can_access_couple_visibility(couple_id, visibility));

-- A permissive FOR ALL policy is OR-combined with SELECT policies, so the old
-- decision_nodes_owner_all policy bypassed private visibility. Product writes
-- already use the server-side repository; clients receive read-only access.
DROP POLICY IF EXISTS decision_nodes_owner_all ON public.decision_nodes;
DROP POLICY IF EXISTS decision_nodes_select_with_privacy ON public.decision_nodes;
DROP POLICY IF EXISTS decision_nodes_member_insert ON public.decision_nodes;
DROP POLICY IF EXISTS decision_nodes_member_update ON public.decision_nodes;
DROP POLICY IF EXISTS decision_nodes_member_delete ON public.decision_nodes;

CREATE POLICY decision_nodes_select_with_privacy ON public.decision_nodes
  FOR SELECT TO authenticated
  USING (public.can_access_couple_visibility(couple_id, visibility));

-- The retention helper is destructive. Legacy explicit grants survived a
-- REVOKE FROM PUBLIC, and a negative interval moved the cutoff into the future.
CREATE OR REPLACE FUNCTION public.redact_old_ai_interactions(
  p_retention interval DEFAULT interval '90 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_retention IS NULL
     OR EXTRACT(YEAR FROM p_retention) <> 0
     OR EXTRACT(MONTH FROM p_retention) <> 0
     OR EXTRACT(DAY FROM p_retention) <> 90
     OR EXTRACT(HOUR FROM p_retention) <> 0
     OR EXTRACT(MINUTE FROM p_retention) <> 0
     OR EXTRACT(SECOND FROM p_retention) <> 0 THEN
    RAISE EXCEPTION 'retention interval must be exactly 90 days'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.ai_interactions_log
  SET
    user_input = CASE WHEN user_input IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    ai_output = CASE WHEN ai_output IS NULL THEN NULL ELSE '[redacted_after_retention]' END,
    tool_input = NULL,
    tool_output = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'retention_redacted_at', now(),
      'retention_policy', 'raw_payload_90d'
    )
  WHERE created_at < now() - interval '90 days'
    AND COALESCE(metadata->>'retention_policy', '') <> 'raw_payload_90d';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.redact_old_ai_interactions(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redact_old_ai_interactions(interval)
  TO service_role;

REVOKE ALL ON FUNCTION public.generate_invite_code()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invite_code()
  TO service_role;

-- Reduce old blanket grants. RLS remains the row-level enforcement layer.
REVOKE ALL PRIVILEGES ON TABLE public.ai_interactions_log FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.ai_interactions_log TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.amora_couple_profiles FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.amora_couple_profiles TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.chat_messages FROM anon, authenticated;
GRANT SELECT ON TABLE public.chat_messages TO authenticated;
GRANT INSERT (
  couple_id,
  sender_id,
  sender_type,
  role,
  content,
  metadata,
  stage_tag,
  visibility
) ON public.chat_messages TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.chat_messages TO service_role;

DROP POLICY IF EXISTS "Allow AI message insert" ON public.chat_messages;
DROP POLICY IF EXISTS chat_insert_couple ON public.chat_messages;
DROP POLICY IF EXISTS couple_members_can_insert_messages ON public.chat_messages;
DROP POLICY IF EXISTS couple_members_can_delete_messages ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_insert_own_user ON public.chat_messages;

-- Authenticated clients may persist only their own user-authored message. AI and
-- assistant rows, specialist fields and server metadata are service-role only.
CREATE POLICY chat_messages_insert_own_user ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND role = 'user'
    AND sender_type IN ('bride', 'groom')
    AND sender_role IS NULL
    AND specialist_type IS NULL
    AND (stage_tag IS NULL OR stage_tag IN (
      'planning_0',
      'preparation_1',
      'execution_2',
      'ceremony_3',
      'settlement_4'
    ))
    AND char_length(content) BETWEEN 1 AND 20000
    AND btrim(content) <> ''
    AND created_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
    AND EXISTS (
      SELECT 1
      FROM public.couples AS couple
      WHERE couple.id = chat_messages.couple_id
        AND (
          (sender_type = 'bride' AND couple.bride_id = auth.uid())
          OR (sender_type = 'groom' AND couple.groom_id = auth.uid())
        )
        AND (
          visibility = 'shared'
          OR (sender_type = 'bride' AND visibility = 'bride_private')
          OR (sender_type = 'groom' AND visibility = 'groom_private')
        )
    )
    AND (
      metadata IS NULL
      OR (
        jsonb_typeof(metadata) = 'object'
        AND metadata - ARRAY['target', 'imagePaths']::text[] = '{}'::jsonb
        AND (NOT metadata ? 'target' OR metadata->>'target' = 'partner')
        AND (
          NOT metadata ? 'imagePaths'
          OR (
            jsonb_typeof(metadata->'imagePaths') = 'array'
            AND jsonb_array_length(metadata->'imagePaths') <= 5
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(metadata->'imagePaths') AS image_path(value)
              WHERE jsonb_typeof(image_path.value) <> 'string'
                 OR char_length(image_path.value #>> '{}') NOT BETWEEN 1 AND 512
                 OR image_path.value #>> '{}' NOT LIKE chat_messages.couple_id::text || '/%'
                 OR image_path.value #>> '{}' LIKE '%..%'
            )
          )
        )
      )
    )
  );

REVOKE ALL PRIVILEGES ON TABLE public.decision_nodes FROM anon, authenticated;
GRANT SELECT ON TABLE public.decision_nodes TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.decision_nodes TO service_role;

-- Fail the migration if its critical postconditions are not true.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.redact_old_ai_interactions(interval)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.redact_old_ai_interactions(interval)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.redact_old_ai_interactions(interval)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_REDACTION_ACL_INVALID';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.join_couple(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.create_couple_for_current_user(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.join_couple(text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_couple_for_current_user(text)', 'EXECUTE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = 'public.couples'::regclass
         AND tgname = 'trg_guard_new_couple_membership'
         AND tgenabled <> 'D'
     ) THEN
    RAISE EXCEPTION 'AMORA_MEMBERSHIP_RPC_CONTRACT_INVALID';
  END IF;

  IF has_table_privilege('anon', 'public.decision_nodes', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.decision_nodes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.chat_messages', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.couples', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.couple_profile_directory', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.my_profile_chat_state', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.chat_messages', 'couple_id', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.chat_messages', 'content', 'INSERT')
     OR has_column_privilege('authenticated', 'public.chat_messages', 'id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.chat_messages', 'created_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.chat_messages', 'sender_role', 'INSERT')
     OR has_column_privilege('authenticated', 'public.chat_messages', 'specialist_type', 'INSERT')
     OR to_regclass('public.amora_chat_request_claims') IS NULL
     OR has_table_privilege('authenticated', 'public.amora_chat_request_claims', 'SELECT')
     OR has_table_privilege('anon', 'public.amora_chat_request_claims', 'SELECT')
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_amora_chat_request(uuid,text,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_amora_chat_request(uuid,text,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_TABLE_ACL_INVALID';
  END IF;

  IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'decision_nodes'
        AND policyname = 'decision_nodes_owner_all'
    )
    OR EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'chat_summaries'
        AND policyname = 'chat_summaries_select_couple'
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
        AND policyname = 'profiles_select_related'
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'couples'
        AND policyname = 'couples_insert_own'
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'chat_messages'
        AND policyname = 'chat_messages_insert_own_user'
    )
    OR EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'chat_messages'
        AND policyname IN (
          'Allow AI message insert',
          'chat_insert_couple',
          'couple_members_can_insert_messages',
          'couple_members_can_delete_messages'
        )
    ) THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_LEGACY_POLICY_REMAINS';
  END IF;
END;
$$;

COMMENT ON VIEW public.couple_profile_directory IS
  'Safe couple-member directory. Deliberately excludes email, phone, consents, admin state, and care preferences.';

COMMENT ON VIEW public.my_profile_chat_state IS
  'Self-only chat reset timestamps. Never exposes one partner chat state to the other.';

COMMENT ON FUNCTION public.redact_old_ai_interactions(interval) IS
  'Service-role-only raw AI payload redaction. The only accepted retention window is 90 days.';
