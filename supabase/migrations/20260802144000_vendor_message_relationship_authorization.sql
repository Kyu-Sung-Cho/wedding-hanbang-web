-- Bind vendor-message creation to a real actor and an allowed customer/vendor
-- relationship. The API uses service_role, so RLS cannot protect this write;
-- the only INSERT path is now this atomic, service-only function.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $vendor_message_authorization_preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
  ) THEN
    RAISE EXCEPTION 'VENDOR_MESSAGE_AUTHORIZATION_SERVICE_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT string_agg(
    format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('vendors', 'id'),
    ('vendors', 'owner_id'),
    ('vendors', 'status'),
    ('vendor_bookings', 'id'),
    ('vendor_bookings', 'vendor_id'),
    ('vendor_bookings', 'couple_id'),
    ('vendor_bookings', 'status'),
    ('vendor_messages', 'id'),
    ('vendor_messages', 'vendor_id'),
    ('vendor_messages', 'customer_id'),
    ('vendor_messages', 'sender_type'),
    ('vendor_messages', 'content'),
    ('vendor_messages', 'is_read'),
    ('vendor_messages', 'booking_id'),
    ('vendor_messages', 'created_at')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'VENDOR_MESSAGE_AUTHORIZATION_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure('public.is_current_couple_member(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'VENDOR_MESSAGE_AUTHORIZATION_COUPLE_HELPER_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$vendor_message_authorization_preflight$;

-- NULL means legacy/untrusted provenance. Do not backfill: the former RLS
-- allowed a vendor owner to forge both customer_id and sender_type, so no
-- historical row can prove that a customer initiated the conversation.
ALTER TABLE public.vendor_messages
  ADD COLUMN IF NOT EXISTS server_provenance_version smallint;

DO $vendor_message_provenance_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = 'public.vendor_messages'::regclass
      AND constraint_record.conname = 'vendor_messages_server_provenance_version_check'
  ) THEN
    ALTER TABLE public.vendor_messages
      ADD CONSTRAINT vendor_messages_server_provenance_version_check
      CHECK (
        server_provenance_version IS NULL
        OR server_provenance_version = 1
      ) NOT VALID;
  END IF;
END;
$vendor_message_provenance_constraint$;

ALTER TABLE public.vendor_messages
  VALIDATE CONSTRAINT vendor_messages_server_provenance_version_check;

COMMENT ON COLUMN public.vendor_messages.server_provenance_version IS
  'Non-identifying server write provenance. NULL marks legacy/untrusted rows; send_vendor_message_service_v1 writes version 1.';

CREATE OR REPLACE FUNCTION public.send_vendor_message_service_v1(
  p_actor_id uuid,
  p_vendor_id uuid,
  p_customer_id uuid,
  p_content text
)
RETURNS SETOF public.vendor_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_vendor_owner_id uuid;
  v_vendor_status text;
  v_sender_type text;
  v_resolved_customer_id uuid;
  v_relationship_booking_id uuid;
  v_has_existing_thread boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'vendor_message_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL
     OR p_vendor_id IS NULL
     OR p_content IS NULL
     OR char_length(btrim(p_content)) NOT BETWEEN 1 AND 2000
     OR octet_length(p_content) > 8000 THEN
    RAISE EXCEPTION 'invalid_vendor_message_input'
      USING ERRCODE = '22023';
  END IF;

  -- Hold the vendor row stable until the message is inserted so approval or
  -- ownership cannot change between authorization and persistence.
  SELECT vendor.owner_id, vendor.status
    INTO v_vendor_owner_id, v_vendor_status
  FROM public.vendors AS vendor
  WHERE vendor.id = p_vendor_id
  FOR SHARE;

  -- An approved row without an owner is not an operable messaging endpoint.
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

    v_sender_type := 'vendor';
    v_resolved_customer_id := p_customer_id;

    SELECT EXISTS (
      SELECT 1
      FROM public.vendor_messages AS existing_message
      WHERE existing_message.vendor_id = p_vendor_id
        AND existing_message.customer_id = p_customer_id
        AND existing_message.sender_type = 'customer'
        AND existing_message.server_provenance_version = 1
    )
    INTO v_has_existing_thread;

    IF NOT v_has_existing_thread THEN
      SELECT booking.id
        INTO v_relationship_booking_id
      FROM public.vendor_bookings AS booking
      WHERE booking.vendor_id = p_vendor_id
        AND booking.status IS DISTINCT FROM 'cancelled'
        AND public.is_current_couple_member(
          p_customer_id,
          booking.couple_id
        )
      ORDER BY booking.id
      LIMIT 1;

      IF v_relationship_booking_id IS NULL THEN
        RAISE EXCEPTION 'vendor_message_relationship_required'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    -- Customers never choose the customer UUID. It is always the authenticated
    -- actor supplied by the server boundary.
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
    v_relationship_booking_id,
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

-- Remove both table- and column-level INSERT paths. SECURITY DEFINER executes
-- as postgres, while service_role can no longer bypass the relationship gate
-- with a direct PostgREST table write.
REVOKE INSERT ON TABLE public.vendor_messages
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE UPDATE ON TABLE public.vendor_messages
  FROM PUBLIC, anon, authenticated, service_role;

DO $revoke_vendor_message_write_columns$
DECLARE
  all_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'vendor_messages';

  EXECUTE format(
    'REVOKE INSERT (%s) ON TABLE public.vendor_messages FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
  EXECUTE format(
    'REVOKE UPDATE (%s) ON TABLE public.vendor_messages FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
END;
$revoke_vendor_message_write_columns$;

-- Read acknowledgement is the sole remaining direct update and cannot alter
-- identity or provenance columns.
GRANT UPDATE (is_read) ON TABLE public.vendor_messages TO service_role;

DO $vendor_message_authorization_postcondition$
BEGIN
  IF has_table_privilege('service_role', 'public.vendor_messages', 'INSERT')
     OR has_any_column_privilege(
       'service_role',
       'public.vendor_messages',
       'INSERT'
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
       'customer_id',
       'UPDATE'
     )
     OR has_column_privilege(
       'service_role',
       'public.vendor_messages',
       'sender_type',
       'UPDATE'
     )
     OR NOT has_column_privilege(
       'service_role',
       'public.vendor_messages',
       'is_read',
       'UPDATE'
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
     ) THEN
    RAISE EXCEPTION 'VENDOR_MESSAGE_AUTHORIZATION_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END;
$vendor_message_authorization_postcondition$;

COMMENT ON FUNCTION public.send_vendor_message_service_v1(uuid, uuid, uuid, text) IS
  'Service-only vendor-message insert. Derives sender identity, requires an approved owned vendor, and prevents vendor-first contact without an existing thread or non-cancelled booking with a current couple member.';

COMMIT;
