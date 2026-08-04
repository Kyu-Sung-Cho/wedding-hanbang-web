BEGIN;

-- Apply only after every supported web/mobile client sends both AI-directed
-- and partner-directed user messages through the authenticated server ingest
-- endpoint. After this boundary, authenticated clients can read chat rows but
-- only service_role may create them.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public.chat_messages IN SHARE ROW EXCLUSIVE MODE;

-- PostgreSQL ORs permissive policies. Refuse a drifted database instead of
-- silently leaving any second authenticated INSERT policy in place. A rerun
-- after this migration has zero such policies and is intentionally accepted.
DO $amora_server_ingest_precondition$
DECLARE
  v_insert_policy_count integer;
BEGIN
  SELECT count(*)
    INTO v_insert_policy_count
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'chat_messages'
     AND cmd IN ('ALL', 'INSERT')
     AND roles && ARRAY['public'::name, 'authenticated'::name];

  IF v_insert_policy_count > 1
     OR (
       v_insert_policy_count = 1
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'chat_messages'
            AND policyname = 'chat_messages_insert_own_user'
            AND permissive = 'PERMISSIVE'
            AND cmd = 'INSERT'
            AND roles = ARRAY['authenticated'::name]
            AND qual IS NULL
            AND with_check IS NOT NULL
            AND with_check LIKE '%client_request_id%'
       )
     ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_AI_INGEST_PRECONDITION_INVALID';
  END IF;
END
$amora_server_ingest_precondition$;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Remove both table-level and column-level grants. The preceding delivery
-- migration grants authenticated INSERT and an earlier version of this fence
-- granted an explicit column list, so both forms must be revoked.
REVOKE ALL PRIVILEGES ON TABLE public.chat_messages FROM anon, authenticated;
REVOKE INSERT (
  couple_id, sender_id, sender_type, role, content, metadata, stage_tag,
  visibility
) ON public.chat_messages FROM authenticated;
GRANT SELECT ON TABLE public.chat_messages TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.chat_messages TO service_role;

DROP POLICY IF EXISTS chat_messages_insert_own_user ON public.chat_messages;

DO $amora_server_ingest_boundary_check$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'chat_messages'
       AND cmd IN ('ALL', 'INSERT')
       AND roles && ARRAY['public'::name, 'anon'::name, 'authenticated'::name]
  )
  OR pg_catalog.has_table_privilege(
    'authenticated', 'public.chat_messages', 'INSERT'
  )
  OR pg_catalog.has_any_column_privilege(
    'authenticated', 'public.chat_messages', 'INSERT'
  )
  OR pg_catalog.has_table_privilege(
    'anon', 'public.chat_messages', 'INSERT'
  )
  OR pg_catalog.has_any_column_privilege(
    'anon', 'public.chat_messages', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'AMORA_SHARED_AI_INGEST_BOUNDARY_INVALID';
  END IF;
END
$amora_server_ingest_boundary_check$;

COMMIT;
