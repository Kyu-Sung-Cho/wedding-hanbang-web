BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF to_regclass('auth.users') IS NULL
     OR to_regclass('public.couples') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.amora_privacy_context_epochs') IS NULL
     OR to_regprocedure('auth.role()') IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_PREREQUISITE_MISSING';
  END IF;
END
$preconditions$;

CREATE TABLE public.amora_preparation_topic_message_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL
    REFERENCES public.couples(id) ON DELETE CASCADE,
  topic_key text NOT NULL CHECK (topic_key IN (
    'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring', 'hanbok',
    'yedan', 'honeymoon', 'houseware', 'housing', 'invitation', 'snap',
    'shoes', 'bouquet', 'gift', 'mc', 'ham', 'pyebaek'
  )),
  message_id uuid NOT NULL
    REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  question_message_id uuid NOT NULL
    REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  audience text NOT NULL
    CHECK (audience IN ('couple_shared', 'owner_private')),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('saved', 'removed')),
  revision bigint NOT NULL
    CHECK (revision BETWEEN 1 AND 9007199254740991),
  last_request_id uuid NOT NULL,
  last_request_digest text NOT NULL
    CHECK (last_request_digest ~ '^[a-f0-9]{64}$'),
  saved_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT amora_preparation_topic_message_refs_identity_unique
    UNIQUE (couple_id, topic_key, message_id),
  CONSTRAINT amora_preparation_topic_message_refs_request_unique
    UNIQUE (couple_id, last_request_id),
  CONSTRAINT amora_preparation_topic_message_refs_audience_shape
    CHECK (
      (audience = 'couple_shared' AND owner_user_id IS NULL)
      OR (audience = 'owner_private' AND owner_user_id IS NOT NULL)
    ),
  CONSTRAINT amora_preparation_topic_message_refs_state_times
    CHECK (
      (state = 'saved' AND saved_at IS NOT NULL AND removed_at IS NULL)
      OR (state = 'removed' AND removed_at IS NOT NULL)
    )
);

ALTER TABLE public.amora_preparation_topic_message_refs OWNER TO postgres;
ALTER TABLE public.amora_preparation_topic_message_refs
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_preparation_topic_message_refs
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_preparation_topic_message_refs
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX amora_preparation_topic_message_refs_saved_recent_idx
  ON public.amora_preparation_topic_message_refs(
    couple_id, saved_at DESC, id DESC
  )
  WHERE state = 'saved';

CREATE FUNCTION public.is_amora_preparation_topic_message_safe_content_v1(
  p_value text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $function$
DECLARE
  v_position integer;
  v_code_point integer;
BEGIN
  FOR v_position IN 1..char_length(p_value) LOOP
    v_code_point := ascii(substr(p_value, v_position, 1));
    IF v_code_point BETWEEN 0 AND 9
       OR v_code_point BETWEEN 11 AND 31
       OR v_code_point BETWEEN 127 AND 159
       OR v_code_point IN (
         173, 1564, 1757, 1807, 6158, 65279, 65529, 65530, 65531,
         69821, 69837, 917505
       )
       OR v_code_point BETWEEN 1536 AND 1541
       OR v_code_point BETWEEN 2192 AND 2193
       OR v_code_point = 2274
       OR v_code_point BETWEEN 8203 AND 8207
       OR v_code_point BETWEEN 8232 AND 8238
       OR v_code_point BETWEEN 8288 AND 8292
       OR v_code_point BETWEEN 8294 AND 8303
       OR v_code_point BETWEEN 78896 AND 78911
       OR v_code_point BETWEEN 113824 AND 113827
       OR v_code_point BETWEEN 119155 AND 119162
       OR v_code_point BETWEEN 917536 AND 917631 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END
$function$;

ALTER FUNCTION public.is_amora_preparation_topic_message_safe_content_v1(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.is_amora_preparation_topic_message_safe_content_v1(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.amora_preparation_topic_message_excerpt_v1(
  p_value text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $function$
DECLARE
  v_position integer;
  v_code_point integer;
  v_character text;
  v_excerpt text := '';
  v_pending_space boolean := false;
BEGIN
  FOR v_position IN 1..char_length(p_value) LOOP
    v_character := substr(p_value, v_position, 1);
    v_code_point := ascii(v_character);
    IF v_code_point IN (
      9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287,
      12288, 65279
    ) OR v_code_point BETWEEN 8192 AND 8202 THEN
      IF v_excerpt <> '' THEN
        v_pending_space := true;
      END IF;
      CONTINUE;
    END IF;
    IF v_pending_space THEN
      v_excerpt := v_excerpt || ' ';
      v_pending_space := false;
    END IF;
    v_excerpt := v_excerpt || v_character;
  END LOOP;
  RETURN btrim(left(v_excerpt, 320));
END
$function$;

ALTER FUNCTION public.amora_preparation_topic_message_excerpt_v1(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_preparation_topic_message_excerpt_v1(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.amora_preparation_topic_message_ref_context_v1(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_for_write boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_snapshot_bride_id uuid;
  v_snapshot_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_profile_couple_id uuid;
  v_actor_role text;
  v_privacy_epoch bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1
     OR p_for_write IS NULL THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Discover the roster without a row lock, then acquire every relevant
  -- profile lock in one deterministic order. Canonical membership mutations
  -- lock profiles before the couple, so taking the couple first here would
  -- permit a profile -> couple / couple -> profile deadlock.
  SELECT couple.bride_id, couple.groom_id
    INTO v_snapshot_bride_id, v_snapshot_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM profile.id
  FROM public.profiles AS profile
  WHERE profile.id = ANY(
    array_remove(ARRAY[
      p_actor_user_id,
      v_snapshot_bride_id,
      v_snapshot_groom_id
    ]::uuid[], NULL)
  )
  ORDER BY profile.id
  FOR SHARE;

  -- Re-read under the couple lock. If a membership mutation committed while
  -- the unlocked snapshot was being acquired, fail closed and let the caller
  -- refresh its privacy epoch instead of locking a newly discovered profile
  -- after the couple.
  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_bride_id IS DISTINCT FROM v_snapshot_bride_id
     OR v_groom_id IS DISTINCT FROM v_snapshot_groom_id THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  -- The actor row is part of the deterministic profile set above, so this is
  -- a stable revalidation read and intentionally takes no post-couple lock.
  SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_user_id;
  IF NOT FOUND
     OR v_profile_couple_id IS DISTINCT FROM p_couple_id
     OR v_actor_role NOT IN ('bride', 'groom')
     OR NOT (
       (v_actor_role = 'bride' AND v_bride_id = p_actor_user_id)
       OR (v_actor_role = 'groom' AND v_groom_id = p_actor_user_id)
     ) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_for_write THEN
    SELECT privacy.epoch
      INTO v_privacy_epoch
    FROM public.amora_privacy_context_epochs AS privacy
    WHERE privacy.couple_id = p_couple_id
    FOR UPDATE;
  ELSE
    SELECT privacy.epoch
      INTO v_privacy_epoch
    FROM public.amora_privacy_context_epochs AS privacy
    WHERE privacy.couple_id = p_couple_id
    FOR SHARE;
  END IF;
  IF NOT FOUND
     OR v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'actorRole', v_actor_role,
    'privateVisibility', v_actor_role || '_private',
    'brideUserId', v_bride_id,
    'groomUserId', v_groom_id
  );
END
$function$;

ALTER FUNCTION public.amora_preparation_topic_message_ref_context_v1(
  uuid, uuid, bigint, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.amora_preparation_topic_message_ref_context_v1(
    uuid, uuid, bigint, boolean
  ) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.amora_preparation_topic_message_source_v1(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_message_id uuid,
  p_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_source record;
  v_question record;
  v_question_id uuid;
  v_question_profile_role text;
  v_question_profile_couple_id uuid;
  v_audience text;
  v_digest text;
BEGIN
  IF p_couple_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_message_id IS NULL
     OR p_context IS NULL
     OR jsonb_typeof(p_context) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT message.id,
         message.couple_id,
         message.sender_id,
         message.sender_type,
         message.role,
         message.content,
         message.metadata,
         message.visibility,
         message.created_at
    INTO v_source
  FROM public.chat_messages AS message
  WHERE message.id = p_message_id
  FOR SHARE;

  IF NOT FOUND
     OR v_source.couple_id IS DISTINCT FROM p_couple_id
     OR v_source.sender_id IS NOT NULL
     OR v_source.sender_type IS DISTINCT FROM 'ai'
     OR v_source.role IS DISTINCT FROM 'assistant'
     OR v_source.visibility NOT IN (
       'shared', p_context ->> 'privateVisibility'
     )
     OR v_source.content IS NULL
     OR char_length(btrim(v_source.content)) NOT BETWEEN 1 AND 20000
     OR char_length(
       public.amora_preparation_topic_message_excerpt_v1(v_source.content)
     ) < 1
     OR public.is_amora_preparation_topic_message_safe_content_v1(
       v_source.content
     ) IS DISTINCT FROM true
     OR v_source.created_at > clock_timestamp()
     OR jsonb_typeof(v_source.metadata) IS DISTINCT FROM 'object'
     OR v_source.metadata ->> 'question_scope' IS NULL
     OR v_source.metadata ->> 'question_scope' NOT IN (
       'W0_wedding_core', 'W1_wedding_adjacent'
     )
     OR COALESCE(
       v_source.metadata ->> 'in_reply_to_user_message_id', ''
     ) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_source.metadata ? 'pinned_safety_card'
     OR v_source.metadata ? 'mediation'
     OR v_source.metadata ? 'response_origin'
     OR (
       v_source.metadata ? 'target'
       AND v_source.metadata -> 'target' IS DISTINCT FROM 'null'::jsonb
       AND (
         jsonb_typeof(v_source.metadata -> 'target') IS DISTINCT FROM 'string'
         OR v_source.metadata ->> 'target' IS DISTINCT FROM 'ai'
       )
     )
     OR lower(COALESCE(v_source.metadata ->> 'kind', '')) = 'mediation'
     OR lower(COALESCE(v_source.metadata ->> 'request_kind', '')) = 'mediation'
     OR lower(COALESCE(v_source.metadata ->> 'requestKind', '')) = 'mediation'
     OR v_source.metadata ->> 'persistence_status' IN (
       'ephemeral_local_only',
       'local_recovery_only',
       'unconfirmed_ephemeral_fallback'
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(v_source.metadata) AS metadata_key(key)
       WHERE left(metadata_key.key, 7) = 'safety_'
          OR left(metadata_key.key, 14) = 'raw_disclosure'
          OR left(metadata_key.key, 10) = 'mediation_'
     ) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_question_id :=
    (v_source.metadata ->> 'in_reply_to_user_message_id')::uuid;
  SELECT message.id,
         message.couple_id,
         message.sender_id,
         message.sender_type,
         message.role,
         message.content,
         message.metadata,
         message.visibility,
         message.created_at
    INTO v_question
  FROM public.chat_messages AS message
  WHERE message.id = v_question_id
  FOR SHARE;

  IF NOT FOUND
     OR v_question.couple_id IS DISTINCT FROM p_couple_id
     OR v_question.sender_id IS NULL
     OR v_question.sender_type NOT IN ('bride', 'groom')
     OR v_question.role IS DISTINCT FROM 'user'
     OR v_question.visibility IS DISTINCT FROM v_source.visibility
     OR v_question.content IS NULL
     OR char_length(btrim(v_question.content)) NOT BETWEEN 1 AND 20000
     OR char_length(
       public.amora_preparation_topic_message_excerpt_v1(v_question.content)
     ) < 1
     OR public.is_amora_preparation_topic_message_safe_content_v1(
       v_question.content
     ) IS DISTINCT FROM true
     OR v_question.created_at > v_source.created_at
     OR jsonb_typeof(v_question.metadata) IS DISTINCT FROM 'object'
     OR (
       v_question.metadata ? 'target'
       AND v_question.metadata -> 'target' IS DISTINCT FROM 'null'::jsonb
       AND (
         jsonb_typeof(v_question.metadata -> 'target') IS DISTINCT FROM 'string'
         OR v_question.metadata ->> 'target' IS DISTINCT FROM 'ai'
       )
     )
     OR NOT (
       (
         v_question.sender_type = 'bride'
         AND v_question.sender_id =
           NULLIF(p_context ->> 'brideUserId', '')::uuid
       )
       OR (
         v_question.sender_type = 'groom'
         AND v_question.sender_id =
           NULLIF(p_context ->> 'groomUserId', '')::uuid
       )
     )
     OR (
       v_source.visibility <> 'shared'
       AND v_question.sender_id IS DISTINCT FROM p_actor_user_id
     ) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT profile.couple_id, profile.role
    INTO v_question_profile_couple_id, v_question_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = v_question.sender_id
  FOR SHARE;
  IF NOT FOUND
     OR v_question_profile_couple_id IS DISTINCT FROM p_couple_id
     OR v_question_profile_role IS DISTINCT FROM v_question.sender_type THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_audience := CASE v_source.visibility
    WHEN 'shared' THEN 'couple_shared'
    ELSE 'owner_private'
  END;
  v_digest := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'version', 1,
        'coupleId', v_source.couple_id,
        'messageId', v_source.id,
        'senderId', v_source.sender_id,
        'senderType', v_source.sender_type,
        'role', v_source.role,
        'visibility', v_source.visibility,
        'content', v_source.content,
        'createdAt', v_source.created_at,
        'questionScope', v_source.metadata ->> 'question_scope',
        'questionMessageId', v_question.id,
        'questionSenderId', v_question.sender_id,
        'questionSenderType', v_question.sender_type,
        'questionRole', v_question.role,
        'questionVisibility', v_question.visibility,
        'questionContent', v_question.content,
        'questionCreatedAt', v_question.created_at
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  RETURN jsonb_build_object(
    'messageId', v_source.id,
    'audience', v_audience,
    'sourceDigest', v_digest,
    'sourceContent', v_source.content,
    'sourceCreatedAt', v_source.created_at,
    'questionMessageId', v_question.id,
    'questionContent', v_question.content,
    'questionCreatedAt', v_question.created_at,
    'questionSenderType', v_question.sender_type,
    'lane', CASE v_source.visibility
      WHEN 'shared' THEN 'shared'
      ELSE 'private'
    END
  );
END
$function$;

ALTER FUNCTION public.amora_preparation_topic_message_source_v1(
  uuid, uuid, uuid, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_preparation_topic_message_source_v1(
  uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.set_amora_preparation_topic_message_ref_v1(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_topic_key text,
  p_message_id uuid,
  p_desired_state text,
  p_expected_revision bigint,
  p_request_id uuid,
  p_expected_privacy_epoch bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_context jsonb;
  v_source jsonb;
  v_ref public.amora_preparation_topic_message_refs%ROWTYPE;
  v_conflicting_ref_id uuid;
  v_request_digest text;
  v_expected_owner_id uuid;
  v_now timestamptz;
  v_reused boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_topic_key IS NULL
     OR p_topic_key NOT IN (
       'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring', 'hanbok',
       'yedan', 'honeymoon', 'houseware', 'housing', 'invitation', 'snap',
       'shoes', 'bouquet', 'gift', 'mc', 'ham', 'pyebaek'
     )
     OR p_message_id IS NULL
     OR p_desired_state IS NULL
     OR p_desired_state NOT IN ('saved', 'removed')
     OR p_expected_revision IS NULL
     OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991
     OR p_request_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1 THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_context := public.amora_preparation_topic_message_ref_context_v1(
    p_couple_id,
    p_actor_user_id,
    p_expected_privacy_epoch,
    true
  );
  -- The privacy row already serializes mutations within a couple. Keep an
  -- exact identity lock as an explicit convergence boundary if that broader
  -- privacy lock is narrowed in a later migration.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_couple_id::text || ':' || p_topic_key || ':' || p_message_id::text,
    0
  ));
  v_source := public.amora_preparation_topic_message_source_v1(
    p_couple_id,
    p_actor_user_id,
    p_message_id,
    v_context
  );
  v_expected_owner_id := CASE v_source ->> 'audience'
    WHEN 'owner_private' THEN p_actor_user_id
    ELSE NULL
  END;
  v_request_digest := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'version', 1,
        'coupleId', p_couple_id,
        'actorUserId', p_actor_user_id,
        'topicKey', p_topic_key,
        'messageId', p_message_id,
        'desiredState', p_desired_state,
        'expectedRevision', p_expected_revision,
        'expectedPrivacyEpoch', p_expected_privacy_epoch
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  SELECT * INTO v_ref
  FROM public.amora_preparation_topic_message_refs AS ref
  WHERE ref.couple_id = p_couple_id
    AND ref.topic_key = p_topic_key
    AND ref.message_id = p_message_id
  FOR UPDATE;

  SELECT ref.id
    INTO v_conflicting_ref_id
  FROM public.amora_preparation_topic_message_refs AS ref
  WHERE ref.couple_id = p_couple_id
    AND ref.last_request_id = p_request_id
    AND ref.id IS DISTINCT FROM v_ref.id
  LIMIT 1
  FOR UPDATE;
  IF v_conflicting_ref_id IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  IF v_ref.id IS NOT NULL THEN
    IF v_ref.audience IS DISTINCT FROM v_source ->> 'audience'
       OR v_ref.owner_user_id IS DISTINCT FROM v_expected_owner_id
       OR v_ref.question_message_id IS DISTINCT FROM
         (v_source ->> 'questionMessageId')::uuid
       OR v_ref.source_digest IS DISTINCT FROM v_source ->> 'sourceDigest' THEN
      RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_STALE'
        USING ERRCODE = '40001';
    END IF;

    IF v_ref.last_request_id = p_request_id THEN
      IF v_ref.last_request_digest IS DISTINCT FROM v_request_digest THEN
        RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_CONFLICT'
          USING ERRCODE = '40001';
      END IF;
      v_reused := true;
    ELSIF v_ref.revision IS DISTINCT FROM p_expected_revision THEN
      RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_REVISION_STALE'
        USING ERRCODE = '40001';
    ELSIF v_ref.state IS NOT DISTINCT FROM p_desired_state THEN
      v_reused := true;
      UPDATE public.amora_preparation_topic_message_refs AS ref
      SET last_request_id = p_request_id,
          last_request_digest = v_request_digest,
          updated_at = clock_timestamp()
      WHERE ref.id = v_ref.id
      RETURNING * INTO v_ref;
    ELSE
      IF v_ref.revision >= 9007199254740991 THEN
        RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_REVISION_STALE'
          USING ERRCODE = '40001';
      END IF;
      v_now := clock_timestamp();
      UPDATE public.amora_preparation_topic_message_refs AS ref
      SET state = p_desired_state,
          revision = ref.revision + 1,
          last_request_id = p_request_id,
          last_request_digest = v_request_digest,
          saved_at = CASE p_desired_state
            WHEN 'saved' THEN v_now
            ELSE ref.saved_at
          END,
          removed_at = CASE p_desired_state
            WHEN 'removed' THEN v_now
            ELSE NULL
          END,
          updated_at = v_now
      WHERE ref.id = v_ref.id
      RETURNING * INTO v_ref;
    END IF;
  ELSE
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_REVISION_STALE'
        USING ERRCODE = '40001';
    END IF;
    v_now := clock_timestamp();
    INSERT INTO public.amora_preparation_topic_message_refs(
      couple_id,
      topic_key,
      message_id,
      question_message_id,
      audience,
      owner_user_id,
      source_digest,
      state,
      revision,
      last_request_id,
      last_request_digest,
      saved_at,
      removed_at,
      created_at,
      updated_at
    ) VALUES (
      p_couple_id,
      p_topic_key,
      p_message_id,
      (v_source ->> 'questionMessageId')::uuid,
      v_source ->> 'audience',
      v_expected_owner_id,
      v_source ->> 'sourceDigest',
      p_desired_state,
      1,
      p_request_id,
      v_request_digest,
      CASE p_desired_state WHEN 'saved' THEN v_now ELSE NULL END,
      CASE p_desired_state WHEN 'removed' THEN v_now ELSE NULL END,
      v_now,
      v_now
    )
    RETURNING * INTO v_ref;
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'state', 'ready',
    'recipientUserId', p_actor_user_id,
    'coupleId', p_couple_id,
    'reused', v_reused,
    'reference', jsonb_build_object(
      'topicKey', v_ref.topic_key,
      'messageId', v_ref.message_id,
      'refId', CASE WHEN v_ref.state = 'saved' THEN v_ref.id ELSE NULL END,
      'audience', v_ref.audience,
      'savedState', v_ref.state,
      'revision', v_ref.revision
    )
  );
END
$function$;

ALTER FUNCTION public.set_amora_preparation_topic_message_ref_v1(
  uuid, uuid, text, uuid, text, bigint, uuid, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_amora_preparation_topic_message_ref_v1(
  uuid, uuid, text, uuid, text, bigint, uuid, bigint
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_amora_preparation_topic_message_ref_v1(
  uuid, uuid, text, uuid, text, bigint, uuid, bigint
) TO service_role;

CREATE FUNCTION public.get_amora_preparation_topic_message_ref_state_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_topic_key text,
  p_message_id uuid,
  p_expected_privacy_epoch bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_context jsonb;
  v_source jsonb;
  v_ref public.amora_preparation_topic_message_refs%ROWTYPE;
  v_expected_owner_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_topic_key IS NULL
     OR p_topic_key NOT IN (
       'meeting', 'venue', 'studio', 'dress', 'makeup', 'ring', 'hanbok',
       'yedan', 'honeymoon', 'houseware', 'housing', 'invitation', 'snap',
       'shoes', 'bouquet', 'gift', 'mc', 'ham', 'pyebaek'
     )
     OR p_message_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1 THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_context := public.amora_preparation_topic_message_ref_context_v1(
    p_couple_id,
    p_recipient_user_id,
    p_expected_privacy_epoch,
    false
  );
  v_source := public.amora_preparation_topic_message_source_v1(
    p_couple_id,
    p_recipient_user_id,
    p_message_id,
    v_context
  );
  v_expected_owner_id := CASE v_source ->> 'audience'
    WHEN 'owner_private' THEN p_recipient_user_id
    ELSE NULL
  END;

  SELECT * INTO v_ref
  FROM public.amora_preparation_topic_message_refs AS ref
  WHERE ref.couple_id = p_couple_id
    AND ref.topic_key = p_topic_key
    AND ref.message_id = p_message_id
  FOR SHARE;
  IF FOUND AND (
    v_ref.audience IS DISTINCT FROM v_source ->> 'audience'
    OR v_ref.owner_user_id IS DISTINCT FROM v_expected_owner_id
    OR v_ref.question_message_id IS DISTINCT FROM
      (v_source ->> 'questionMessageId')::uuid
    OR v_ref.source_digest IS DISTINCT FROM v_source ->> 'sourceDigest'
  ) THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'state', 'ready',
    'recipientUserId', p_recipient_user_id,
    'coupleId', p_couple_id,
    'reference', jsonb_build_object(
      'topicKey', p_topic_key,
      'messageId', p_message_id,
      'refId', CASE WHEN v_ref.state = 'saved' THEN v_ref.id ELSE NULL END,
      'audience', v_source ->> 'audience',
      'savedState', CASE WHEN v_ref.id IS NULL THEN 'removed' ELSE v_ref.state END,
      'revision', CASE WHEN v_ref.id IS NULL THEN 0 ELSE v_ref.revision END
    )
  );
END
$function$;

ALTER FUNCTION public.get_amora_preparation_topic_message_ref_state_v1(
  uuid, uuid, text, uuid, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_amora_preparation_topic_message_ref_state_v1(
  uuid, uuid, text, uuid, bigint
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_amora_preparation_topic_message_ref_state_v1(
  uuid, uuid, text, uuid, bigint
) TO service_role;

CREATE FUNCTION public.list_amora_preparation_topic_message_refs_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_context jsonb;
  v_ref public.amora_preparation_topic_message_refs%ROWTYPE;
  v_locked_ref public.amora_preparation_topic_message_refs%ROWTYPE;
  v_source jsonb;
  v_references jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_partial boolean := false;
  v_expected_owner_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_context := public.amora_preparation_topic_message_ref_context_v1(
    p_couple_id,
    p_recipient_user_id,
    p_expected_privacy_epoch,
    false
  );

  FOR v_ref IN
    SELECT ref.*
    FROM public.amora_preparation_topic_message_refs AS ref
    WHERE ref.couple_id = p_couple_id
      AND ref.state = 'saved'
      AND (
        (ref.audience = 'couple_shared' AND ref.owner_user_id IS NULL)
        OR (
          ref.audience = 'owner_private'
          AND ref.owner_user_id = p_recipient_user_id
        )
      )
    ORDER BY ref.saved_at DESC, ref.id DESC
    LIMIT p_limit + 1
  LOOP
    IF v_count >= p_limit THEN
      v_partial := true;
      EXIT;
    END IF;
    BEGIN
      v_source := public.amora_preparation_topic_message_source_v1(
        p_couple_id,
        p_recipient_user_id,
        v_ref.message_id,
        v_context
      );
    EXCEPTION WHEN no_data_found THEN
      v_partial := true;
      CONTINUE;
    END;
    SELECT * INTO v_locked_ref
    FROM public.amora_preparation_topic_message_refs AS ref
    WHERE ref.id = v_ref.id
      AND ref.couple_id = p_couple_id
      AND ref.state = 'saved'
      AND (
        (ref.audience = 'couple_shared' AND ref.owner_user_id IS NULL)
        OR (
          ref.audience = 'owner_private'
          AND ref.owner_user_id = p_recipient_user_id
        )
      )
    FOR SHARE;
    IF NOT FOUND THEN
      v_partial := true;
      CONTINUE;
    END IF;
    v_ref := v_locked_ref;
    v_expected_owner_id := CASE v_source ->> 'audience'
      WHEN 'owner_private' THEN p_recipient_user_id
      ELSE NULL
    END;
    IF v_ref.audience IS DISTINCT FROM v_source ->> 'audience'
       OR v_ref.owner_user_id IS DISTINCT FROM v_expected_owner_id
       OR v_ref.question_message_id IS DISTINCT FROM
         (v_source ->> 'questionMessageId')::uuid
       OR v_ref.source_digest IS DISTINCT FROM v_source ->> 'sourceDigest' THEN
      v_partial := true;
      CONTINUE;
    END IF;

    v_references := v_references || jsonb_build_array(jsonb_build_object(
      'refId', v_ref.id,
      'topicKey', v_ref.topic_key,
      'messageId', v_ref.message_id,
      'audience', v_ref.audience,
      'revision', v_ref.revision,
      'savedAt', v_ref.saved_at,
      'sourceCreatedAt', v_source -> 'sourceCreatedAt',
      'excerpt', public.amora_preparation_topic_message_excerpt_v1(
        v_source ->> 'sourceContent'
      ),
      'canRemove', true,
      'canOpenOriginal', true
    ));
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'version', 1,
    'state', 'ready',
    'recipientUserId', p_recipient_user_id,
    'coupleId', p_couple_id,
    'references', v_references,
    'partial', v_partial
  );
END
$function$;

ALTER FUNCTION public.list_amora_preparation_topic_message_refs_v1(
  uuid, uuid, bigint, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_amora_preparation_topic_message_refs_v1(
  uuid, uuid, bigint, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_amora_preparation_topic_message_refs_v1(
  uuid, uuid, bigint, integer
) TO service_role;

CREATE FUNCTION public.resolve_amora_preparation_topic_message_ref_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_ref_id uuid,
  p_expected_privacy_epoch bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_context jsonb;
  v_ref public.amora_preparation_topic_message_refs%ROWTYPE;
  v_source jsonb;
  v_expected_owner_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_ref_id IS NULL
     OR p_expected_privacy_epoch IS NULL
     OR p_expected_privacy_epoch < 1 THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_context := public.amora_preparation_topic_message_ref_context_v1(
    p_couple_id,
    p_recipient_user_id,
    p_expected_privacy_epoch,
    false
  );
  SELECT * INTO v_ref
  FROM public.amora_preparation_topic_message_refs AS ref
  WHERE ref.id = p_ref_id
    AND ref.couple_id = p_couple_id
    AND ref.state = 'saved'
    AND (
      (ref.audience = 'couple_shared' AND ref.owner_user_id IS NULL)
      OR (
        ref.audience = 'owner_private'
        AND ref.owner_user_id = p_recipient_user_id
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_source := public.amora_preparation_topic_message_source_v1(
    p_couple_id,
    p_recipient_user_id,
    v_ref.message_id,
    v_context
  );
  SELECT * INTO v_ref
  FROM public.amora_preparation_topic_message_refs AS ref
  WHERE ref.id = p_ref_id
    AND ref.couple_id = p_couple_id
    AND ref.state = 'saved'
    AND (
      (ref.audience = 'couple_shared' AND ref.owner_user_id IS NULL)
      OR (
        ref.audience = 'owner_private'
        AND ref.owner_user_id = p_recipient_user_id
      )
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  v_expected_owner_id := CASE v_source ->> 'audience'
    WHEN 'owner_private' THEN p_recipient_user_id
    ELSE NULL
  END;
  IF v_ref.audience IS DISTINCT FROM v_source ->> 'audience'
     OR v_ref.owner_user_id IS DISTINCT FROM v_expected_owner_id
     OR v_ref.question_message_id IS DISTINCT FROM
       (v_source ->> 'questionMessageId')::uuid
     OR v_ref.source_digest IS DISTINCT FROM v_source ->> 'sourceDigest' THEN
    RAISE EXCEPTION 'AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'state', 'ready',
    'recipientUserId', p_recipient_user_id,
    'coupleId', p_couple_id,
    'reference', jsonb_build_object(
      'refId', v_ref.id,
      'topicKey', v_ref.topic_key,
      'messageId', v_ref.message_id,
      'audience', v_ref.audience,
      'revision', v_ref.revision,
      'savedAt', v_ref.saved_at
    ),
    'target', jsonb_build_object(
      'messageId', v_ref.message_id,
      'lane', v_source ->> 'lane',
      'content', v_source ->> 'sourceContent',
      'createdAt', v_source -> 'sourceCreatedAt'
    ),
    'question', jsonb_build_object(
      'messageId', v_source -> 'questionMessageId',
      'lane', v_source ->> 'lane',
      'senderType', v_source ->> 'questionSenderType',
      'content', v_source ->> 'questionContent',
      'createdAt', v_source -> 'questionCreatedAt'
    )
  );
END
$function$;

ALTER FUNCTION public.resolve_amora_preparation_topic_message_ref_v1(
  uuid, uuid, uuid, bigint
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_amora_preparation_topic_message_ref_v1(
  uuid, uuid, uuid, bigint
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_amora_preparation_topic_message_ref_v1(
  uuid, uuid, uuid, bigint
) TO service_role;

COMMENT ON TABLE public.amora_preparation_topic_message_refs IS
  'Explicit topic-to-chat references only. Source/question text remains canonical in chat_messages and is never copied here.';

COMMIT;
