-- Quarantine untrusted legacy vendor messages from user-facing reads and make
-- a server-proven customer message the only authority for a vendor reply.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.is_approved_vendor_owner(p_vendor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.vendors AS vendor
      WHERE vendor.id = p_vendor_id
        AND vendor.owner_id = auth.uid()
        AND vendor.status = 'approved'
    );
$function$;

ALTER FUNCTION public.is_approved_vendor_owner(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_approved_vendor_owner(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_approved_vendor_owner(uuid)
  TO authenticated;

-- Historical policy names vary across deployed projects. Remove every SELECT
-- policy, then install one exact authenticated read rule.
DO $drop_vendor_message_select_policies$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT policy.polname
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.vendor_messages'::regclass
      AND policy.polcmd = 'r'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.vendor_messages',
      existing_policy.polname
    );
  END LOOP;
END;
$drop_vendor_message_select_policies$;

ALTER TABLE public.vendor_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_messages_select
  ON public.vendor_messages
  FOR SELECT
  TO authenticated
  USING (
    server_provenance_version = 1
    AND (
      customer_id = auth.uid()
      OR public.is_approved_vendor_owner(vendor_id)
    )
  );

COMMENT ON FUNCTION public.is_approved_vendor_owner(uuid) IS
  'Self-only approved vendor ownership predicate for sensitive child-table RLS.';

CREATE OR REPLACE FUNCTION public.send_vendor_message_service_v1(
  p_actor_id uuid,
  p_vendor_id uuid,
  p_customer_id uuid,
  p_content text
)
RETURNS SETOF public.vendor_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_vendor_owner_id uuid;
  v_vendor_status text;
  v_sender_type text;
  v_resolved_customer_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'vendor_message_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL
     OR p_vendor_id IS NULL
     OR p_content IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_content)) NOT BETWEEN 1 AND 2000
     OR pg_catalog.octet_length(p_content) > 8000 THEN
    RAISE EXCEPTION 'invalid_vendor_message_input'
      USING ERRCODE = '22023';
  END IF;

  SELECT vendor.owner_id, vendor.status
    INTO v_vendor_owner_id, v_vendor_status
  FROM public.vendors AS vendor
  WHERE vendor.id = p_vendor_id
  FOR SHARE;

  IF NOT FOUND
     OR v_vendor_status IS DISTINCT FROM 'approved'
     OR v_vendor_owner_id IS NULL THEN
    RAISE EXCEPTION 'vendor_message_vendor_unavailable'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_vendor_owner_id = p_actor_id THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'vendor_message_customer_required'
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.vendor_messages AS existing_message
      WHERE existing_message.vendor_id = p_vendor_id
        AND existing_message.customer_id = p_customer_id
        AND existing_message.sender_type = 'customer'
        AND existing_message.server_provenance_version = 1
    ) THEN
      RAISE EXCEPTION 'vendor_message_relationship_required'
        USING ERRCODE = '42501';
    END IF;

    v_sender_type := 'vendor';
    v_resolved_customer_id := p_customer_id;
  ELSE
    IF p_customer_id IS NOT NULL THEN
      RAISE EXCEPTION 'vendor_message_customer_override_forbidden'
        USING ERRCODE = '42501';
    END IF;

    v_sender_type := 'customer';
    v_resolved_customer_id := p_actor_id;
  END IF;

  RETURN QUERY
  INSERT INTO public.vendor_messages (
    vendor_id,
    customer_id,
    sender_type,
    content,
    is_read,
    booking_id,
    server_provenance_version
  ) VALUES (
    p_vendor_id,
    v_resolved_customer_id,
    v_sender_type,
    p_content,
    false,
    NULL,
    1
  )
  RETURNING *;
END;
$function$;

ALTER FUNCTION public.send_vendor_message_service_v1(uuid, uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_vendor_message_service_v1(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_vendor_message_service_v1(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_vendor_messages_read_service_v1(
  p_actor_id uuid,
  p_vendor_id uuid,
  p_customer_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_vendor_owner_id uuid;
  v_vendor_status text;
  v_marked_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'vendor_message_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL OR p_vendor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_vendor_message_mark_read_input'
      USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NULL THEN
    UPDATE public.vendor_messages AS message
    SET is_read = true
    WHERE message.vendor_id = p_vendor_id
      AND message.customer_id = p_actor_id
      AND message.sender_type = 'vendor'
      AND message.server_provenance_version = 1
      AND message.is_read = false;
  ELSE
    SELECT vendor.owner_id, vendor.status
      INTO v_vendor_owner_id, v_vendor_status
    FROM public.vendors AS vendor
    WHERE vendor.id = p_vendor_id
    FOR SHARE;

    IF NOT FOUND
       OR v_vendor_status IS DISTINCT FROM 'approved'
       OR v_vendor_owner_id IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'vendor_message_mark_read_forbidden'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.vendor_messages AS message
    SET is_read = true
    WHERE message.vendor_id = p_vendor_id
      AND message.customer_id = p_customer_id
      AND message.sender_type = 'customer'
      AND message.server_provenance_version = 1
      AND message.is_read = false;
  END IF;

  GET DIAGNOSTICS v_marked_count = ROW_COUNT;
  RETURN v_marked_count;
END;
$function$;

ALTER FUNCTION public.mark_vendor_messages_read_service_v1(uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_vendor_messages_read_service_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_vendor_messages_read_service_v1(uuid, uuid, uuid)
  TO service_role;

-- The service client may acknowledge messages only through the function above.
-- Remove table- and column-level UPDATE grants so no service code can bypass
-- the actor, approval, direction, or provenance predicates.
REVOKE UPDATE ON TABLE public.vendor_messages FROM service_role;

DO $revoke_vendor_message_service_update_columns$
DECLARE
  all_columns text;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I', column_name),
    ', ' ORDER BY ordinal_position
  )
    INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'vendor_messages';

  EXECUTE pg_catalog.format(
    'REVOKE UPDATE (%s) ON TABLE public.vendor_messages FROM service_role',
    all_columns
  );
END;
$revoke_vendor_message_service_update_columns$;

DO $vendor_message_trusted_thread_postcondition$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = 'public.vendor_messages'::regclass
         AND relation.relrowsecurity
     )
     OR (
       SELECT count(*)
       FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = 'public.vendor_messages'::regclass
         AND policy.polcmd = 'r'
     ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = 'public.vendor_messages'::regclass
         AND policy.polcmd = 'r'
         AND policy.polname = 'vendor_messages_select'
         AND cardinality(policy.polroles) = 1
         AND policy.polroles[1] = (
           SELECT role.oid
           FROM pg_catalog.pg_roles AS role
           WHERE role.rolname = 'authenticated'
         )
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.is_approved_vendor_owner(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.is_approved_vendor_owner(uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.is_approved_vendor_owner(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.send_vendor_message_service_v1(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.send_vendor_message_service_v1(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.send_vendor_message_service_v1(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR has_any_column_privilege(
       'service_role',
       'public.vendor_messages',
       'INSERT'
     )
     OR has_table_privilege(
       'service_role',
       'public.vendor_messages',
       'UPDATE'
     )
     OR has_any_column_privilege(
       'service_role',
       'public.vendor_messages',
       'UPDATE'
     )
     OR has_column_privilege(
       'service_role',
       'public.vendor_messages',
       'server_provenance_version',
       'UPDATE'
     )
     OR has_column_privilege(
       'service_role',
       'public.vendor_messages',
       'is_read',
       'UPDATE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function_record
       JOIN pg_catalog.pg_roles AS function_owner
         ON function_owner.oid = function_record.proowner
       WHERE function_record.oid IN (
         'public.is_approved_vendor_owner(uuid)'::regprocedure,
         'public.send_vendor_message_service_v1(uuid,uuid,uuid,text)'::regprocedure,
         'public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)'::regprocedure
       )
         AND (
           NOT function_record.prosecdef
           OR function_owner.rolname <> 'postgres'
           OR NOT COALESCE(
             'search_path=""' = ANY(function_record.proconfig),
             false
           )
         )
     ) THEN
    RAISE EXCEPTION 'VENDOR_MESSAGE_TRUSTED_THREAD_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END;
$vendor_message_trusted_thread_postcondition$;

COMMENT ON FUNCTION public.send_vendor_message_service_v1(uuid, uuid, uuid, text) IS
  'Service-only vendor-message insert. Customers may start with an approved vendor; vendors may reply only after a version-1 customer-authored message in that exact thread.';

COMMENT ON FUNCTION public.mark_vendor_messages_read_service_v1(uuid, uuid, uuid) IS
  'Service-only read acknowledgement. Customers acknowledge vendor-authored rows in their own thread; approved owners acknowledge customer-authored rows while the vendor row is locked.';

COMMIT;
