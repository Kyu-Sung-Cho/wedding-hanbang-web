BEGIN;

-- The web client binds a durable user row and the provider request with one
-- UUID. Older mobile clients do not write this metadata yet, so the key stays
-- optional during the mixed-client window and is strictly validated when set.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public.chat_messages IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.can_send_chat_to_linked_partner(
  p_couple_id uuid,
  p_partner_recipient_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.couples AS couple
     WHERE couple.id = p_couple_id
       AND couple.bride_id IS NOT NULL
       AND couple.groom_id IS NOT NULL
       AND couple.bride_id IS DISTINCT FROM couple.groom_id
       AND (
         (
           auth.uid() = couple.bride_id
           AND couple.groom_id::text = lower(p_partner_recipient_id)
         )
         OR (
           auth.uid() = couple.groom_id
           AND couple.bride_id::text = lower(p_partner_recipient_id)
         )
       )
  )
$$;

REVOKE ALL ON FUNCTION public.can_send_chat_to_linked_partner(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_send_chat_to_linked_partner(uuid, text)
  TO authenticated, service_role;

-- Compatibility and atomicity boundary for partner-directed user rows. Older
-- clients omit the recipient pin, so derive it while holding the same couple
-- row against roster updates. RLS evaluates the trigger-mutated NEW row.
CREATE OR REPLACE FUNCTION public.enforce_chat_partner_recipient()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_expected_recipient_id uuid;
BEGIN
  IF NEW.role IS DISTINCT FROM 'user'
     OR NEW.metadata IS NULL
     OR jsonb_typeof(NEW.metadata) IS DISTINCT FROM 'object'
     OR NEW.metadata ->> 'target' IS DISTINCT FROM 'partner' THEN
    RETURN NEW;
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = NEW.couple_id
    AND NEW.sender_id IN (couple.bride_id, couple.groom_id)
  FOR SHARE;

  IF NOT FOUND
     OR v_bride_id IS NULL
     OR v_groom_id IS NULL
     OR v_bride_id = v_groom_id THEN
    RAISE EXCEPTION 'CHAT_PARTNER_DELIVERY_NOT_ALLOWED'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.sender_id = v_bride_id AND NEW.sender_type = 'bride' THEN
    v_expected_recipient_id := v_groom_id;
  ELSIF NEW.sender_id = v_groom_id AND NEW.sender_type = 'groom' THEN
    v_expected_recipient_id := v_bride_id;
  ELSE
    RAISE EXCEPTION 'CHAT_PARTNER_DELIVERY_NOT_ALLOWED'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.metadata ? 'partner_recipient_id' THEN
    IF jsonb_typeof(NEW.metadata -> 'partner_recipient_id') IS DISTINCT FROM 'string'
       OR lower(NEW.metadata ->> 'partner_recipient_id')
         IS DISTINCT FROM v_expected_recipient_id::text THEN
      RAISE EXCEPTION 'CHAT_PARTNER_DELIVERY_NOT_ALLOWED'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    NEW.metadata := jsonb_set(
      NEW.metadata,
      '{partner_recipient_id}',
      to_jsonb(v_expected_recipient_id::text),
      true
    );
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.enforce_chat_partner_recipient() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_chat_partner_recipient()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_chat_partner_recipient
  ON public.chat_messages;
CREATE TRIGGER trg_enforce_chat_partner_recipient
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_chat_partner_recipient();

-- A complete sealed roster is immutable except for clearing a member, so only
-- that state proves the historical opposite recipient. Ambiguous rows stay
-- unpinned and the SELECT policy below exposes them to the sender only.
UPDATE public.chat_messages AS message
SET metadata = jsonb_set(
  message.metadata,
  '{partner_recipient_id}',
  to_jsonb((
    CASE
      WHEN message.sender_id = couple.bride_id
        AND message.sender_type = 'bride' THEN couple.groom_id
      ELSE couple.bride_id
    END
  )::text),
  true
)
FROM public.couples AS couple
WHERE message.couple_id = couple.id
  AND message.role = 'user'
  AND jsonb_typeof(message.metadata) = 'object'
  AND message.metadata ->> 'target' = 'partner'
  AND NOT message.metadata ? 'partner_recipient_id'
  AND couple.membership_sealed_at IS NOT NULL
  AND couple.bride_id IS NOT NULL
  AND couple.groom_id IS NOT NULL
  AND couple.bride_id IS DISTINCT FROM couple.groom_id
  AND (
    (
      message.sender_id = couple.bride_id
      AND message.sender_type = 'bride'
    )
    OR (
      message.sender_id = couple.groom_id
      AND message.sender_type = 'groom'
    )
  );

DROP POLICY IF EXISTS chat_select_with_privacy ON public.chat_messages;
CREATE POLICY chat_select_with_privacy ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    public.can_access_couple_visibility(couple_id, visibility)
    AND (
      metadata IS NULL
      OR metadata ->> 'target' IS DISTINCT FROM 'partner'
      OR sender_id = auth.uid()
      OR lower(metadata ->> 'partner_recipient_id') = auth.uid()::text
    )
  );

DO $chat_partner_recipient_boundary_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_record
    JOIN pg_catalog.pg_proc AS procedure_record
      ON procedure_record.oid = trigger_record.tgfoid
    WHERE trigger_record.tgrelid = 'public.chat_messages'::regclass
      AND trigger_record.tgname = 'trg_enforce_chat_partner_recipient'
      AND NOT trigger_record.tgisinternal
      AND trigger_record.tgenabled = 'O'
      AND procedure_record.prosecdef
      AND procedure_record.provolatile = 'v'
      AND procedure_record.prosrc LIKE '%FOR SHARE%'
  )
  OR has_function_privilege(
    'authenticated',
    'public.enforce_chat_partner_recipient()',
    'EXECUTE'
  )
  OR has_function_privilege(
    'service_role',
    'public.enforce_chat_partner_recipient()',
    'EXECUTE'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND policyname = 'chat_select_with_privacy'
      AND permissive = 'PERMISSIVE'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated'::name]
      AND qual LIKE '%partner_recipient_id%'
  ) THEN
    RAISE EXCEPTION 'CHAT_PARTNER_RECIPIENT_BOUNDARY_INVALID';
  END IF;
END
$chat_partner_recipient_boundary_check$;

DROP POLICY IF EXISTS chat_messages_insert_own_user ON public.chat_messages;

CREATE POLICY chat_messages_insert_own_user ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND role = 'user'
    AND sender_type IN ('bride', 'groom')
    AND sender_role IS NULL
    AND specialist_type IS NULL
    AND (
      stage_tag IS NULL
      OR stage_tag IN (
        'planning_0', 'preparation_1', 'execution_2',
        'ceremony_3', 'settlement_4'
      )
    )
    AND char_length(content) BETWEEN 1 AND 20000
    AND btrim(content) <> ''
    AND created_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
    AND (
      (
        sender_type = 'bride'
        AND public.can_access_couple_visibility(couple_id, 'bride_private')
      )
      OR (
        sender_type = 'groom'
        AND public.can_access_couple_visibility(couple_id, 'groom_private')
      )
    )
    AND public.can_access_couple_visibility(couple_id, visibility)
    AND (
      metadata IS NULL
      OR metadata ->> 'target' IS DISTINCT FROM 'partner'
      OR (
        metadata ? 'partner_recipient_id'
        AND jsonb_typeof(metadata -> 'partner_recipient_id') = 'string'
        AND public.can_send_chat_to_linked_partner(
          couple_id,
          metadata ->> 'partner_recipient_id'
        )
      )
    )
    AND (
      metadata IS NULL
      OR (
        jsonb_typeof(metadata) = 'object'
        AND metadata - ARRAY[
          'target', 'imagePaths', 'confirmed_amora_action_id',
          'client_request_id', 'partner_recipient_id'
        ]::text[] = '{}'::jsonb
        AND (
          (
            metadata ? 'confirmed_amora_action_id'
            AND visibility = 'shared'
            AND (
              NOT metadata ? 'target'
              OR metadata ->> 'target' <> 'partner'
            )
            AND jsonb_typeof(
              metadata -> 'confirmed_amora_action_id'
            ) = 'string'
            AND COALESCE(
              metadata ->> 'confirmed_amora_action_id',
              ''
            ) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
          OR (
            NOT metadata ? 'confirmed_amora_action_id'
            AND (
              NOT metadata ? 'target'
              OR metadata ->> 'target' = 'partner'
            )
          )
        )
        AND (
          NOT metadata ? 'imagePaths'
          OR (
            jsonb_typeof(metadata -> 'imagePaths') = 'array'
            AND jsonb_array_length(metadata -> 'imagePaths') <= 5
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(metadata -> 'imagePaths')
                AS image_path(value)
              WHERE jsonb_typeof(image_path.value) <> 'string'
                 OR char_length(image_path.value #>> '{}') NOT BETWEEN 1 AND 512
                 OR image_path.value #>> '{}'
                   NOT LIKE chat_messages.couple_id::text || '/%'
                 OR image_path.value #>> '{}' LIKE '%..%'
            )
          )
        )
        AND (
          NOT metadata ? 'client_request_id'
          OR (
            jsonb_typeof(metadata -> 'client_request_id') = 'string'
            AND COALESCE(metadata ->> 'client_request_id', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            )
          )
        )
        AND (
          (
            metadata ->> 'target' = 'partner'
            AND visibility = 'shared'
            AND metadata ? 'partner_recipient_id'
            AND jsonb_typeof(metadata -> 'partner_recipient_id') = 'string'
            AND COALESCE(metadata ->> 'partner_recipient_id', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
          OR (
            metadata ->> 'target' IS DISTINCT FROM 'partner'
            AND NOT metadata ? 'partner_recipient_id'
          )
        )
      )
  );

DO $chat_client_request_id_policy_check$
BEGIN
  IF (
    SELECT count(*)
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'chat_messages'
       AND cmd IN ('ALL', 'INSERT')
       AND roles && ARRAY['public'::name, 'authenticated'::name]
  ) <> 1
  OR NOT EXISTS (
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
       AND with_check LIKE '%can_send_chat_to_linked_partner%'
  ) THEN
    RAISE EXCEPTION 'CHAT_USER_CLIENT_REQUEST_ID_POLICY_INVALID';
  END IF;
END
$chat_client_request_id_policy_check$;

DO $chat_client_request_id_index_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index AS index_record
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_record.indexrelid
      JOIN pg_catalog.pg_namespace AS index_namespace
        ON index_namespace.oid = index_relation.relnamespace
     WHERE index_namespace.nspname = 'public'
       AND index_relation.relname = 'chat_messages_client_request_id_unique'
       AND index_record.indrelid = 'public.chat_messages'::regclass
       AND index_record.indisunique
       AND index_record.indisvalid
       AND index_record.indisready
       AND index_record.indnkeyatts = 2
       AND pg_catalog.pg_get_indexdef(index_record.indexrelid)
         LIKE '%couple_id%client_request_id%'
       AND pg_catalog.pg_get_expr(
         index_record.indpred,
         index_record.indrelid
       ) LIKE '%client_request_id%IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'CHAT_USER_CLIENT_REQUEST_ID_INDEX_INVALID';
  END IF;
END
$chat_client_request_id_index_check$;

COMMIT;
