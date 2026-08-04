BEGIN;

-- RELEASE CANDIDATE ONLY. The singleton starts disabled so merely applying
-- this additive schema cannot change the current chat or Storage runtime.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $precondition$
BEGIN
  IF pg_catalog.to_regclass('public.couples') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.chat_messages') IS NULL
     OR pg_catalog.to_regclass('public.account_deletion_jobs') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'chat_messages'
          AND column_name = 'metadata' AND data_type = 'jsonb'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'chat_messages'
          AND column_name = 'sender_id' AND data_type = 'uuid'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'account_deletion_jobs'
          AND column_name = 'user_id' AND data_type = 'uuid'
     ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SESSION_PRECONDITION_INVALID';
  END IF;
END;
$precondition$;

CREATE TABLE IF NOT EXISTS public.chat_attachment_runtime_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL DEFAULT 'disabled'
    CHECK (mode IN ('disabled', 'shadow', 'enforced')),
  storage_write_contract text NOT NULL DEFAULT 'legacy_mutable'
    CHECK (storage_write_contract IN ('legacy_mutable', 'signed_only')),
  storage_contract_evidence_sha256 text,
  storage_contract_activated_at timestamptz,
  CONSTRAINT chat_attachment_runtime_storage_contract
    CHECK (
      (
        storage_write_contract = 'legacy_mutable'
        AND storage_contract_evidence_sha256 IS NULL
        AND storage_contract_activated_at IS NULL
      )
      OR (
        storage_write_contract = 'signed_only'
        AND storage_contract_evidence_sha256 ~ '^[0-9a-f]{64}$'
        AND storage_contract_activated_at IS NOT NULL
      )
    ),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.chat_attachment_runtime_state(singleton, mode)
VALUES (true, 'disabled')
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.chat_attachment_runtime_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_attachment_runtime_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_attachment_runtime_state
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.chat_attachment_runtime_state TO service_role;
GRANT UPDATE (mode, updated_at)
  ON TABLE public.chat_attachment_runtime_state TO service_role;

CREATE OR REPLACE FUNCTION public.guard_chat_attachment_storage_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $guard_storage_contract$
BEGIN
  IF OLD.storage_write_contract = 'signed_only'
     AND (
       NEW.storage_write_contract IS DISTINCT FROM OLD.storage_write_contract
       OR NEW.storage_contract_evidence_sha256
         IS DISTINCT FROM OLD.storage_contract_evidence_sha256
       OR NEW.storage_contract_activated_at
         IS DISTINCT FROM OLD.storage_contract_activated_at
     ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_STORAGE_CONTRACT_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$guard_storage_contract$;

DROP TRIGGER IF EXISTS chat_attachment_storage_contract_guard
  ON public.chat_attachment_runtime_state;
CREATE TRIGGER chat_attachment_storage_contract_guard
BEFORE UPDATE OF storage_write_contract, storage_contract_evidence_sha256,
  storage_contract_activated_at
ON public.chat_attachment_runtime_state
FOR EACH ROW EXECUTE FUNCTION public.guard_chat_attachment_storage_contract();

-- One row exists before any signed upload token is issued. Identity columns
-- deliberately do not cascade with Auth/couple deletion: the external object
-- must be absence-checked before its durable cleanup inventory is anonymized.
CREATE TABLE IF NOT EXISTS public.chat_attachment_upload_sessions (
  id uuid PRIMARY KEY,
  couple_id uuid NOT NULL,
  user_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  attachment_index smallint NOT NULL,
  final_bucket text NOT NULL DEFAULT 'chat-image',
  final_path text NOT NULL UNIQUE,
  declared_mime_type text NOT NULL,
  declared_size bigint NOT NULL,
  binding_hmac text NOT NULL,
  binding_key_version smallint NOT NULL,
  token_generation integer NOT NULL DEFAULT 0,
  token_reservation_id uuid,
  token_reserved_at timestamptz,
  token_signing_deadline timestamptz,
  token_not_after timestamptz,
  token_confirmed_at timestamptz,
  token_observed_not_after timestamptz,
  status text NOT NULL DEFAULT 'issued',
  verification_claim_token uuid,
  verification_started_at timestamptz,
  verification_attempts integer NOT NULL DEFAULT 0,
  actual_size bigint,
  actual_mime_type text,
  verified_at timestamptz,
  attached_message_id uuid,
  attached_at timestamptz,
  detached_at timestamptz,
  cleanup_claim_token uuid,
  cleanup_started_at timestamptz,
  rejection_code text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  final_deleted_at timestamptz,
  CONSTRAINT chat_attachment_upload_sessions_identity_unique
    UNIQUE (user_id, client_request_id, attachment_index),
  CONSTRAINT chat_attachment_upload_sessions_index
    CHECK (attachment_index BETWEEN 0 AND 4),
  CONSTRAINT chat_attachment_upload_sessions_bucket
    CHECK (final_bucket = 'chat-image'),
  CONSTRAINT chat_attachment_upload_sessions_mime
    CHECK (declared_mime_type IN (
      'image/jpeg', 'image/png', 'image/gif', 'image/webp'
    )),
  CONSTRAINT chat_attachment_upload_sessions_size
    CHECK (declared_size > 0 AND declared_size <= 10 * 1024 * 1024),
  CONSTRAINT chat_attachment_upload_sessions_binding_hmac
    CHECK (binding_hmac ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chat_attachment_upload_sessions_binding_key_version
    CHECK (binding_key_version BETWEEN 1 AND 32767),
  CONSTRAINT chat_attachment_upload_sessions_token_reservation
    CHECK (
      (
        token_generation = 0
        AND token_reservation_id IS NULL
        AND token_reserved_at IS NULL
        AND token_signing_deadline IS NULL
        AND token_not_after IS NULL
        AND token_confirmed_at IS NULL
        AND token_observed_not_after IS NULL
      )
      OR (
        token_generation > 0
        AND token_reservation_id IS NOT NULL
        AND token_reserved_at IS NOT NULL
        AND token_signing_deadline > token_reserved_at
        AND token_not_after = token_signing_deadline + interval '2 hours'
        AND (
          (
            token_confirmed_at IS NULL
            AND token_observed_not_after IS NULL
          )
          OR (
            token_confirmed_at IS NOT NULL
            AND token_observed_not_after > token_confirmed_at
            AND token_observed_not_after <= token_not_after
          )
        )
      )
    ),
  CONSTRAINT chat_attachment_upload_sessions_path
    CHECK (
      final_path = lower(couple_id::text) || '/' || lower(user_id::text) || '/'
        || split_part(final_path, '/', 3)
      AND final_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$'
      AND split_part(final_path, '.', 2) = CASE declared_mime_type
        WHEN 'image/jpeg' THEN 'jpg'
        WHEN 'image/png' THEN 'png'
        WHEN 'image/gif' THEN 'gif'
        WHEN 'image/webp' THEN 'webp'
        ELSE 'invalid'
      END
    ),
  CONSTRAINT chat_attachment_upload_sessions_status
    CHECK (status IN (
      'issued', 'verifying', 'verified', 'attached',
      'rejected', 'expired', 'deleted'
    )),
  CONSTRAINT chat_attachment_upload_sessions_verification_claim
    CHECK (
      (status = 'verifying'
        AND verification_claim_token IS NOT NULL
        AND verification_started_at IS NOT NULL)
      OR (status <> 'verifying'
        AND verification_claim_token IS NULL
        AND verification_started_at IS NULL)
    ),
  CONSTRAINT chat_attachment_upload_sessions_verified_state
    CHECK (
      status NOT IN ('verified', 'attached')
      OR (
        verified_at IS NOT NULL
        AND actual_size = declared_size
        AND actual_mime_type = declared_mime_type
        AND final_deleted_at IS NULL
      )
    ),
  CONSTRAINT chat_attachment_upload_sessions_attachment_state
    CHECK (
      (status = 'attached'
        AND attached_message_id IS NOT NULL
        AND attached_at IS NOT NULL)
      OR (status <> 'attached'
        AND attached_message_id IS NULL
        AND attached_at IS NULL)
    ),
  CONSTRAINT chat_attachment_upload_sessions_cleanup_claim
    CHECK (
      (cleanup_claim_token IS NULL AND cleanup_started_at IS NULL)
      OR (
        cleanup_claim_token IS NOT NULL
        AND cleanup_started_at IS NOT NULL
        AND attached_message_id IS NULL
        AND final_deleted_at IS NULL
      )
    ),
  CONSTRAINT chat_attachment_upload_sessions_deleted_state
    CHECK (
      (status = 'deleted' AND final_deleted_at IS NOT NULL)
      OR (status <> 'deleted' AND final_deleted_at IS NULL)
    ),
  CONSTRAINT chat_attachment_upload_sessions_attempts
    CHECK (verification_attempts >= 0 AND token_generation >= 0),
  CONSTRAINT chat_attachment_upload_sessions_rejection_code
    CHECK (rejection_code IS NULL OR rejection_code ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT chat_attachment_upload_sessions_expiry
    CHECK (
      expires_at > created_at
      AND expires_at <= created_at + interval '2 hours 5 minutes'
    )
);

CREATE INDEX IF NOT EXISTS chat_attachment_upload_sessions_cleanup_idx
  ON public.chat_attachment_upload_sessions(status, updated_at, expires_at)
  WHERE attached_message_id IS NULL AND final_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_attachment_upload_sessions_message_idx
  ON public.chat_attachment_upload_sessions(attached_message_id)
  WHERE attached_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_attachment_upload_sessions_owner_idx
  ON public.chat_attachment_upload_sessions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS chat_attachment_upload_sessions_token_reservation_idx
  ON public.chat_attachment_upload_sessions(token_reservation_id)
  WHERE token_reservation_id IS NOT NULL;

ALTER TABLE public.chat_attachment_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_attachment_upload_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_attachment_upload_sessions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.chat_attachment_upload_sessions TO service_role;

CREATE TABLE IF NOT EXISTS public.chat_attachment_cleanup_receipts (
  session_id uuid PRIMARY KEY,
  cleanup_claim_token uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome = 'deleted'),
  object_absence_confirmed boolean NOT NULL CHECK (object_absence_confirmed),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.chat_attachment_cleanup_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_attachment_cleanup_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_attachment_cleanup_receipts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.chat_attachment_cleanup_receipts
  TO service_role;

CREATE OR REPLACE FUNCTION public.begin_chat_attachment_upload_sessions(
  p_couple_id uuid,
  p_user_id uuid,
  p_client_request_id uuid,
  p_items jsonb
)
RETURNS SETOF public.chat_attachment_upload_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $begin_sessions$
DECLARE
  v_mode text;
  v_item jsonb;
  v_session_id uuid;
  v_attachment_index smallint;
  v_media_type text;
  v_byte_length bigint;
  v_binding_hmac text;
  v_binding_key_version smallint;
  v_path text;
  v_total_bytes bigint := 0;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
  v_seen_indices smallint[] := ARRAY[]::smallint[];
  v_seen_paths text[] := ARRAY[]::text[];
  v_existing public.chat_attachment_upload_sessions%ROWTYPE;
  v_existing_count integer;
  v_key_count integer;
BEGIN
  IF p_couple_id IS NULL
     OR p_user_id IS NULL
     OR p_client_request_id IS NULL
     OR p_items IS NULL
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) < 1
     OR jsonb_array_length(p_items) > 5 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_BATCH_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT state.mode
    INTO v_mode
    FROM public.chat_attachment_runtime_state AS state
   WHERE state.singleton
   FOR SHARE;
  IF v_mode IS DISTINCT FROM 'shadow' AND v_mode IS DISTINCT FROM 'enforced' THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_UPLOAD_DISABLED' USING ERRCODE = '55000';
  END IF;

  -- This is the same per-owner transaction lock used by account-deletion
  -- intake, so either the durable upload inventory commits first or deletion
  -- intake wins and this batch is rejected before any token can be signed.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
      FROM public.account_deletion_jobs AS job
     WHERE job.user_id = p_user_id
       AND job.status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.couples AS couple
      JOIN public.profiles AS profile
        ON profile.id = p_user_id
       AND profile.couple_id = couple.id
     WHERE couple.id = p_couple_id
       AND (
         (profile.role = 'bride' AND couple.bride_id = p_user_id)
         OR (profile.role = 'groom' AND couple.groom_id = p_user_id)
       )
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_existing_count
    FROM public.chat_attachment_upload_sessions AS session
   WHERE session.user_id = p_user_id
     AND session.client_request_id = p_client_request_id;
  IF v_existing_count > 0
     AND v_existing_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_IDEMPOTENCY_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_ITEM_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(v_item);
    IF v_key_count <> 7
       OR NOT v_item ?& ARRAY[
         'sessionId', 'attachmentIndex', 'mediaType',
         'byteLength', 'bindingHmac', 'bindingKeyVersion', 'path'
       ] THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_ITEM_INVALID' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_item -> 'sessionId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'attachmentIndex') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item -> 'mediaType') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'byteLength') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item -> 'bindingHmac') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'bindingKeyVersion') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item -> 'path') IS DISTINCT FROM 'string'
       OR (v_item ->> 'sessionId') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR (v_item ->> 'attachmentIndex') !~ '^[0-4]$'
       OR (v_item ->> 'bindingKeyVersion') !~ '^[1-9][0-9]{0,4}$'
       OR (v_item ->> 'bindingKeyVersion')::numeric > 32767
       OR (v_item ->> 'byteLength') !~ '^[1-9][0-9]{0,7}$' THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_ITEM_INVALID' USING ERRCODE = '22023';
    END IF;

    v_session_id := lower(v_item ->> 'sessionId')::uuid;
    v_attachment_index := (v_item ->> 'attachmentIndex')::smallint;
    v_media_type := v_item ->> 'mediaType';
    v_byte_length := (v_item ->> 'byteLength')::bigint;
    v_binding_hmac := v_item ->> 'bindingHmac';
    v_binding_key_version := (v_item ->> 'bindingKeyVersion')::smallint;
    v_path := v_item ->> 'path';

    IF v_media_type NOT IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp')
       OR v_byte_length > 10 * 1024 * 1024
       OR v_binding_hmac !~ '^[0-9a-f]{64}$'
       OR v_binding_key_version < 1
       OR v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$'
       OR split_part(v_path, '/', 1) <> lower(p_couple_id::text)
       OR split_part(v_path, '/', 2) <> lower(p_user_id::text)
       OR split_part(v_path, '.', 2) <> (CASE v_media_type
         WHEN 'image/jpeg' THEN 'jpg'
         WHEN 'image/png' THEN 'png'
         WHEN 'image/gif' THEN 'gif'
         WHEN 'image/webp' THEN 'webp'
         ELSE 'invalid'
       END)
       OR v_session_id = ANY(v_seen_ids)
       OR v_attachment_index = ANY(v_seen_indices)
       OR v_path = ANY(v_seen_paths) THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_ITEM_INVALID' USING ERRCODE = '22023';
    END IF;

    v_total_bytes := v_total_bytes + v_byte_length;
    IF v_total_bytes > 10 * 1024 * 1024 THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_BATCH_TOO_LARGE' USING ERRCODE = '22023';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_session_id);
    v_seen_indices := array_append(v_seen_indices, v_attachment_index);
    v_seen_paths := array_append(v_seen_paths, v_path);

    IF EXISTS (
      SELECT 1
        FROM public.chat_messages AS message
       WHERE jsonb_typeof(message.metadata -> 'imagePaths') = 'array'
         AND (message.metadata -> 'imagePaths') @> jsonb_build_array(v_path)
    ) THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_PATH_ALREADY_REFERENCED'
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.chat_attachment_upload_sessions(
      id, couple_id, user_id, client_request_id, attachment_index,
      final_bucket, final_path, declared_mime_type, declared_size,
      binding_hmac, binding_key_version, status, expires_at
    ) VALUES (
      v_session_id, p_couple_id, p_user_id, p_client_request_id,
      v_attachment_index, 'chat-image', v_path, v_media_type,
      v_byte_length, v_binding_hmac, v_binding_key_version, 'issued',
      clock_timestamp() + interval '2 hours'
    )
    ON CONFLICT (user_id, client_request_id, attachment_index) DO NOTHING;
  END LOOP;

  IF (
    SELECT count(*)
      FROM public.chat_attachment_upload_sessions AS session
     WHERE session.user_id = p_user_id
       AND session.client_request_id = p_client_request_id
  ) <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_IDEMPOTENCY_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_existing
      FROM public.chat_attachment_upload_sessions AS session
     WHERE session.user_id = p_user_id
       AND session.client_request_id = p_client_request_id
       AND session.attachment_index = (v_item ->> 'attachmentIndex')::smallint
     FOR UPDATE;
    IF NOT FOUND
       OR v_existing.id <> lower(v_item ->> 'sessionId')::uuid
       OR v_existing.couple_id <> p_couple_id
       OR v_existing.final_path <> v_item ->> 'path'
       OR v_existing.declared_mime_type <> v_item ->> 'mediaType'
       OR v_existing.declared_size <> (v_item ->> 'byteLength')::bigint
       OR v_existing.binding_hmac <> v_item ->> 'bindingHmac'
       OR v_existing.binding_key_version <>
         (v_item ->> 'bindingKeyVersion')::smallint
       OR v_existing.status IN ('rejected', 'expired', 'deleted')
       OR v_existing.final_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT session.*
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS item(value, ordinal)
    JOIN public.chat_attachment_upload_sessions AS session
      ON session.user_id = p_user_id
     AND session.client_request_id = p_client_request_id
     AND session.attachment_index = (item.value ->> 'attachmentIndex')::smallint
   ORDER BY item.ordinal;
END;
$begin_sessions$;

REVOKE ALL ON FUNCTION public.begin_chat_attachment_upload_sessions(
  uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_chat_attachment_upload_sessions(
  uuid, uuid, uuid, jsonb
) TO service_role;

-- Reserve a bounded signing generation before calling the external Storage
-- signer. Supabase signed-upload tokens have a fixed two-hour TTL; the
-- caller must start signing before token_signing_deadline. The stored
-- token_not_after is therefore the latest possible expiry for this generation.
CREATE OR REPLACE FUNCTION public.reserve_chat_attachment_upload_token(
  p_session_id uuid,
  p_user_id uuid,
  p_reservation_id uuid,
  p_token_ttl_seconds integer
)
RETURNS SETOF public.chat_attachment_upload_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $reserve_token$
DECLARE
  v_session public.chat_attachment_upload_sessions%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_session_id IS NULL
     OR p_user_id IS NULL
     OR p_reservation_id IS NULL
     OR p_token_ttl_seconds IS DISTINCT FROM 7200 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_RESERVATION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.chat_attachment_runtime_state AS state
   WHERE state.singleton
     AND state.mode IN ('shadow', 'enforced')
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_UPLOAD_DISABLED'
      USING ERRCODE = '55000';
  END IF;

  -- Account deletion intake takes this same owner lock. Keep the lock order
  -- owner fence -> deletion state -> upload-session row in every lifecycle RPC.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );
  IF EXISTS (
    SELECT 1
      FROM public.account_deletion_jobs AS job
     WHERE job.user_id = p_user_id
       AND job.status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_session
    FROM public.chat_attachment_upload_sessions AS session
   WHERE session.id = p_session_id
     AND session.user_id = p_user_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_session.status <> 'issued'
     OR v_session.cleanup_claim_token IS NOT NULL
     OR v_session.final_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_NOT_SIGNABLE'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.couples AS couple
      JOIN public.profiles AS profile
        ON profile.id = p_user_id
       AND profile.couple_id = couple.id
     WHERE couple.id = v_session.couple_id
       AND (
         (profile.role = 'bride' AND couple.bride_id = p_user_id)
         OR (profile.role = 'groom' AND couple.groom_id = p_user_id)
       )
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  v_now := clock_timestamp();
  IF v_session.expires_at <= v_now THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_NOT_SIGNABLE'
      USING ERRCODE = '55000';
  END IF;
  IF v_session.token_reservation_id = p_reservation_id THEN
    IF v_session.token_signing_deadline <= v_now THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_RESERVATION_EXPIRED'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEXT v_session;
    RETURN;
  END IF;
  IF v_session.token_reservation_id IS NOT NULL
     AND v_session.token_signing_deadline > v_now THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_RESERVATION_ACTIVE'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.chat_attachment_upload_sessions
     SET token_generation = token_generation + 1,
         token_reservation_id = p_reservation_id,
         token_reserved_at = v_now,
         token_signing_deadline = v_now + interval '2 minutes',
         token_not_after = v_now + interval '2 hours 2 minutes',
         token_confirmed_at = NULL,
         token_observed_not_after = NULL,
         updated_at = v_now
   WHERE id = v_session.id
   RETURNING * INTO v_session;
  RETURN NEXT v_session;
END;
$reserve_token$;

REVOKE ALL ON FUNCTION public.reserve_chat_attachment_upload_token(
  uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_chat_attachment_upload_token(
  uuid, uuid, uuid, integer
) TO service_role;

-- The external signer response is not safe to expose until this RPC confirms
-- it still belongs to the current generation and its observed expiry is under
-- the pre-reserved upper bound. A response received after the signing deadline
-- must be discarded by the caller and cannot be confirmed here.
CREATE OR REPLACE FUNCTION public.confirm_chat_attachment_upload_token(
  p_session_id uuid,
  p_user_id uuid,
  p_reservation_id uuid,
  p_token_generation integer,
  p_observed_not_after timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $confirm_token$
DECLARE
  v_session public.chat_attachment_upload_sessions%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_session_id IS NULL
     OR p_user_id IS NULL
     OR p_reservation_id IS NULL
     OR p_token_generation IS NULL
     OR p_token_generation < 1
     OR p_observed_not_after IS NULL THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_CONFIRMATION_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.chat_attachment_runtime_state AS state
   WHERE state.singleton
     AND state.mode IN ('shadow', 'enforced')
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_UPLOAD_DISABLED'
      USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );
  IF EXISTS (
    SELECT 1
      FROM public.account_deletion_jobs AS job
     WHERE job.user_id = p_user_id
       AND job.status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_session
    FROM public.chat_attachment_upload_sessions AS session
   WHERE session.id = p_session_id
     AND session.user_id = p_user_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_session.status <> 'issued'
     OR v_session.cleanup_claim_token IS NOT NULL
     OR v_session.final_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_NOT_CONFIRMABLE'
      USING ERRCODE = '55000';
  END IF;
  IF v_session.token_reservation_id <> p_reservation_id
     OR v_session.token_generation <> p_token_generation THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_CONFIRMATION_STALE'
      USING ERRCODE = '55000';
  END IF;

  v_now := clock_timestamp();
  IF v_now > v_session.token_signing_deadline
     OR p_observed_not_after <= v_now
     OR p_observed_not_after > v_session.token_not_after THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_CONFIRMATION_OUT_OF_BOUNDS'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.chat_attachment_upload_sessions
     SET token_confirmed_at = v_now,
         token_observed_not_after = GREATEST(
           coalesce(token_observed_not_after, p_observed_not_after),
           p_observed_not_after
         ),
         updated_at = v_now
   WHERE id = v_session.id;
  RETURN true;
END;
$confirm_token$;

REVOKE ALL ON FUNCTION public.confirm_chat_attachment_upload_token(
  uuid, uuid, uuid, integer, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_chat_attachment_upload_token(
  uuid, uuid, uuid, integer, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_chat_attachment_upload_session(
  p_session_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_stale_before timestamptz
)
RETURNS SETOF public.chat_attachment_upload_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $claim_verification$
DECLARE
  v_session public.chat_attachment_upload_sessions%ROWTYPE;
BEGIN
  IF p_session_id IS NULL
     OR p_user_id IS NULL
     OR p_claim_token IS NULL
     OR p_stale_before IS NULL THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_VERIFICATION_CLAIM_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );
  IF EXISTS (
    SELECT 1
      FROM public.account_deletion_jobs AS job
     WHERE job.user_id = p_user_id
       AND job.status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_session
    FROM public.chat_attachment_upload_sessions AS session
   WHERE session.id = p_session_id
     AND session.user_id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_session.token_generation = 0
     OR v_session.token_not_after IS NULL THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_NOT_RESERVED'
      USING ERRCODE = '55000';
  END IF;
  IF v_session.token_confirmed_at IS NULL
     OR v_session.token_observed_not_after IS NULL THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_TOKEN_NOT_CONFIRMED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.couples AS couple
      JOIN public.profiles AS profile
        ON profile.id = p_user_id
       AND profile.couple_id = couple.id
     WHERE couple.id = v_session.couple_id
       AND (
         (profile.role = 'bride' AND couple.bride_id = p_user_id)
         OR (profile.role = 'groom' AND couple.groom_id = p_user_id)
       )
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  IF v_session.status = 'issued'
     AND v_session.token_not_after <= clock_timestamp() THEN
    UPDATE public.chat_attachment_upload_sessions
       SET status = 'expired',
           rejection_code = 'signed_token_expired',
           updated_at = clock_timestamp()
     WHERE id = v_session.id
     RETURNING * INTO v_session;
    RETURN NEXT v_session;
    RETURN;
  END IF;

  IF v_session.status = 'issued'
     OR (
       v_session.status = 'verifying'
       AND (
         v_session.verification_claim_token = p_claim_token
         OR v_session.verification_started_at <= LEAST(
           p_stale_before,
           clock_timestamp() - interval '2 minutes'
         )
       )
     ) THEN
    UPDATE public.chat_attachment_upload_sessions
       SET status = 'verifying',
           verification_claim_token = p_claim_token,
           verification_started_at = clock_timestamp(),
           verification_attempts = verification_attempts + 1,
           updated_at = clock_timestamp()
     WHERE id = v_session.id
     RETURNING * INTO v_session;
  END IF;

  RETURN NEXT v_session;
END;
$claim_verification$;

CREATE OR REPLACE FUNCTION public.finalize_chat_attachment_upload_verification(
  p_session_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_actual_size bigint,
  p_actual_mime_type text,
  p_computed_binding_hmac text,
  p_valid boolean,
  p_rejection_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $finalize_verification$
DECLARE
  v_session public.chat_attachment_upload_sessions%ROWTYPE;
  v_binding_matches boolean;
BEGIN
  IF p_session_id IS NULL
     OR p_user_id IS NULL
     OR p_claim_token IS NULL
     OR p_actual_size IS NULL
     OR p_actual_size < 1
     OR p_actual_mime_type IS NULL
     OR p_computed_binding_hmac IS NULL
     OR p_computed_binding_hmac !~ '^[0-9a-f]{64}$'
     OR p_valid IS NULL
     OR (p_valid AND p_rejection_code IS NOT NULL)
     OR (
       NOT p_valid
       AND (
         p_rejection_code IS NULL
         OR p_rejection_code NOT IN (
           'binding_mismatch', 'signature_mismatch',
           'decode_invalid', 'storage_object_invalid'
         )
       )
     ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_VERIFICATION_RESULT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );
  IF EXISTS (
    SELECT 1
      FROM public.account_deletion_jobs AS job
     WHERE job.user_id = p_user_id
       AND job.status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_session
    FROM public.chat_attachment_upload_sessions AS session
   WHERE session.id = p_session_id
     AND session.user_id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_binding_matches := p_actual_size = v_session.declared_size
    AND p_actual_mime_type = v_session.declared_mime_type
    AND p_computed_binding_hmac = v_session.binding_hmac;

  IF v_session.status = 'verified' THEN
    RETURN v_binding_matches
      AND v_session.actual_size = p_actual_size
      AND v_session.actual_mime_type = p_actual_mime_type;
  END IF;
  IF v_session.status <> 'verifying'
     OR v_session.verification_claim_token <> p_claim_token THEN
    RETURN false;
  END IF;

  IF p_valid AND v_binding_matches THEN
    UPDATE public.chat_attachment_upload_sessions
       SET status = 'verified',
           verification_claim_token = NULL,
           verification_started_at = NULL,
           actual_size = p_actual_size,
           actual_mime_type = p_actual_mime_type,
           verified_at = coalesce(verified_at, clock_timestamp()),
           rejection_code = NULL,
           updated_at = clock_timestamp()
     WHERE id = v_session.id;
    RETURN true;
  END IF;

  UPDATE public.chat_attachment_upload_sessions
     SET status = 'rejected',
         verification_claim_token = NULL,
         verification_started_at = NULL,
         actual_size = p_actual_size,
         actual_mime_type = p_actual_mime_type,
         rejection_code = CASE
           WHEN NOT v_binding_matches THEN 'binding_mismatch'
           ELSE p_rejection_code
         END,
         updated_at = clock_timestamp()
   WHERE id = v_session.id;
  RETURN false;
END;
$finalize_verification$;

REVOKE ALL ON FUNCTION public.claim_chat_attachment_upload_session(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_chat_attachment_upload_verification(
  uuid, uuid, uuid, bigint, text, text, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_attachment_upload_session(
  uuid, uuid, uuid, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_chat_attachment_upload_verification(
  uuid, uuid, uuid, bigint, text, text, boolean, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.bind_chat_attachment_uploads_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $bind_message$
DECLARE
  v_mode text;
  v_paths text[];
  v_path text;
  v_path_count integer;
  v_matched_count integer;
  v_request_id uuid;
  v_session public.chat_attachment_upload_sessions%ROWTYPE;
BEGIN
  IF NEW.role IS DISTINCT FROM 'user' THEN
    RETURN NEW;
  END IF;

  SELECT state.mode INTO v_mode
    FROM public.chat_attachment_runtime_state AS state
   WHERE state.singleton;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_RUNTIME_STATE_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.metadata IS NULL
     OR jsonb_typeof(NEW.metadata) IS DISTINCT FROM 'object'
     OR NOT NEW.metadata ? 'imagePaths' THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.metadata -> 'imagePaths') IS DISTINCT FROM 'array' THEN
    IF v_mode = 'enforced' THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_SESSION_REQUIRED'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT coalesce(array_agg(path.value ORDER BY path.ordinal), ARRAY[]::text[])
    INTO v_paths
    FROM jsonb_array_elements_text(NEW.metadata -> 'imagePaths')
      WITH ORDINALITY AS path(value, ordinal);
  v_path_count := cardinality(v_paths);
  IF v_path_count = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id IS NULL THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_MESSAGE_IDENTITY_INVALID'
      USING ERRCODE = '23514';
  END IF;

  -- Serialize the very first session lookup with begin-session and deletion
  -- intake. Otherwise a shadow-mode INSERT and init can both miss the other's
  -- uncommitted row and create a permanently unbound reference.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.sender_id::text, 0)
  );
  IF EXISTS (
    SELECT 1
      FROM public.account_deletion_jobs AS job
     WHERE job.user_id = NEW.sender_id
       AND job.status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_ACCOUNT_DELETION_PENDING'
      USING ERRCODE = '55000';
  END IF;

  -- Disabled mode only permits paths that have never entered the durable
  -- lifecycle. If any session path is present, every mode keeps the same
  -- attach-vs-cleanup fence so rollback cannot create a dangling reference.
  SELECT count(*) INTO v_matched_count
    FROM public.chat_attachment_upload_sessions AS session
   WHERE session.final_path = ANY(v_paths);
  IF v_matched_count = 0 THEN
    IF v_mode = 'enforced' THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_SESSION_REQUIRED'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.couple_id IS NULL
     OR jsonb_typeof(NEW.metadata -> 'client_request_id')
       IS DISTINCT FROM 'string'
     OR (NEW.metadata ->> 'client_request_id') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_MESSAGE_IDENTITY_INVALID'
      USING ERRCODE = '23514';
  END IF;
  v_request_id := lower(NEW.metadata ->> 'client_request_id')::uuid;
  IF v_path_count > 5
     OR (SELECT count(DISTINCT candidate) FROM unnest(v_paths) AS candidate)
       <> v_path_count THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_MESSAGE_PATHS_INVALID'
      USING ERRCODE = '23514';
  END IF;
  IF v_matched_count <> v_path_count THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SESSION_SET_INCOMPLETE'
      USING ERRCODE = '23514';
  END IF;
  -- Lock in UUID order so attachment and cleanup cannot win different rows or
  -- deadlock when one message carries more than one image.
  PERFORM 1
    FROM public.chat_attachment_upload_sessions AS session
   WHERE session.final_path = ANY(v_paths)
   ORDER BY session.id
   FOR UPDATE;
  SELECT count(*) INTO v_matched_count
    FROM public.chat_attachment_upload_sessions AS session
   WHERE session.final_path = ANY(v_paths);
  IF v_matched_count <> v_path_count THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SESSION_SET_INCOMPLETE'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.couples AS couple
      JOIN public.profiles AS profile
        ON profile.id = NEW.sender_id
       AND profile.couple_id = couple.id
     WHERE couple.id = NEW.couple_id
       AND (
         (profile.role = 'bride' AND couple.bride_id = NEW.sender_id)
         OR (profile.role = 'groom' AND couple.groom_id = NEW.sender_id)
       )
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  FOREACH v_path IN ARRAY v_paths
  LOOP
    SELECT * INTO v_session
      FROM public.chat_attachment_upload_sessions AS session
     WHERE session.final_path = v_path;
    IF NOT FOUND
       OR v_session.couple_id <> NEW.couple_id
       OR v_session.user_id <> NEW.sender_id
       OR v_session.client_request_id <> v_request_id
       OR v_session.status <> 'verified'
       OR v_session.attached_message_id IS NOT NULL
       OR v_session.final_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_SESSION_NOT_ATTACHABLE'
        USING ERRCODE = '23514';
    END IF;
    IF v_session.cleanup_claim_token IS NOT NULL THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_CLEANUP_IN_PROGRESS'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  UPDATE public.chat_attachment_upload_sessions AS session
     SET status = 'attached',
         attached_message_id = NEW.id,
         attached_at = clock_timestamp(),
         detached_at = NULL,
         updated_at = clock_timestamp()
   WHERE session.final_path = ANY(v_paths);
  RETURN NEW;
END;
$bind_message$;

CREATE OR REPLACE FUNCTION public.guard_chat_attachment_message_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $guard_message$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.chat_attachment_upload_sessions AS session
     WHERE session.attached_message_id = OLD.id
       AND (
         NEW.couple_id IS DISTINCT FROM OLD.couple_id
         OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
         OR NEW.metadata -> 'imagePaths'
           IS DISTINCT FROM OLD.metadata -> 'imagePaths'
         OR NEW.metadata -> 'client_request_id'
           IS DISTINCT FROM OLD.metadata -> 'client_request_id'
       )
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_MESSAGE_IDENTITY_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$guard_message$;

CREATE OR REPLACE FUNCTION public.detach_chat_attachment_uploads_on_message_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $detach_message$
BEGIN
  UPDATE public.chat_attachment_upload_sessions
     SET status = 'verified',
         attached_message_id = NULL,
         attached_at = NULL,
         detached_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE attached_message_id = OLD.id
     AND status = 'attached';
  RETURN OLD;
END;
$detach_message$;

DROP TRIGGER IF EXISTS chat_attachment_upload_bind
  ON public.chat_messages;
CREATE TRIGGER chat_attachment_upload_bind
BEFORE INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.bind_chat_attachment_uploads_on_message();

DROP TRIGGER IF EXISTS chat_attachment_upload_identity_guard
  ON public.chat_messages;
CREATE TRIGGER chat_attachment_upload_identity_guard
BEFORE UPDATE OF couple_id, sender_id, metadata ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.guard_chat_attachment_message_identity();

DROP TRIGGER IF EXISTS chat_attachment_upload_detach
  ON public.chat_messages;
CREATE TRIGGER chat_attachment_upload_detach
BEFORE DELETE ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.detach_chat_attachment_uploads_on_message_delete();

CREATE OR REPLACE FUNCTION public.claim_chat_attachment_cleanup_sessions(
  p_claim_token uuid,
  p_unattached_before timestamptz,
  p_stale_before timestamptz,
  p_limit integer DEFAULT 25
)
RETURNS SETOF public.chat_attachment_upload_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $claim_cleanup$
BEGIN
  IF p_claim_token IS NULL
     OR p_unattached_before IS NULL
     OR p_stale_before IS NULL
     OR p_unattached_before > clock_timestamp()
     OR p_stale_before > clock_timestamp()
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_CLEANUP_CLAIM_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.chat_attachment_runtime_state AS state
     WHERE state.singleton
       AND state.storage_write_contract = 'signed_only'
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_CLEANUP_REQUIRES_SIGNED_ONLY_STORAGE'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT session.id
      FROM public.chat_attachment_upload_sessions AS session
     WHERE session.status IN (
       'issued', 'verifying', 'verified', 'rejected', 'expired'
     )
       AND session.attached_message_id IS NULL
       AND session.final_deleted_at IS NULL
       AND GREATEST(
             session.expires_at,
             coalesce(session.token_not_after, session.expires_at)
           ) + interval '5 minutes' <= clock_timestamp()
       AND (
         session.status <> 'verified'
         OR coalesce(
           session.detached_at,
           session.verified_at,
           session.updated_at
         ) <= LEAST(
           p_unattached_before,
           clock_timestamp() - interval '24 hours'
         )
       )
       AND (
         session.cleanup_claim_token IS NULL
         OR session.cleanup_started_at <= LEAST(
           p_stale_before,
           clock_timestamp() - interval '15 minutes'
         )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.chat_messages AS message
          WHERE jsonb_typeof(message.metadata -> 'imagePaths') = 'array'
            AND (message.metadata -> 'imagePaths')
              @> jsonb_build_array(session.final_path)
       )
     ORDER BY session.updated_at, session.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.chat_attachment_upload_sessions AS session
     SET status = CASE
           WHEN session.status IN ('issued', 'verifying') THEN 'expired'
           ELSE session.status
         END,
         verification_claim_token = NULL,
         verification_started_at = NULL,
         rejection_code = CASE
           WHEN session.status IN ('issued', 'verifying')
             THEN coalesce(session.rejection_code, 'orphan_expired')
           ELSE session.rejection_code
         END,
         cleanup_claim_token = p_claim_token,
         cleanup_started_at = clock_timestamp(),
         updated_at = clock_timestamp()
    FROM candidates
   WHERE session.id = candidates.id
  RETURNING session.*;
END;
$claim_cleanup$;

CREATE OR REPLACE FUNCTION public.finalize_chat_attachment_cleanup(
  p_session_id uuid,
  p_claim_token uuid,
  p_object_absence_confirmed boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $finalize_cleanup$
DECLARE
  v_session public.chat_attachment_upload_sessions%ROWTYPE;
BEGIN
  IF p_session_id IS NULL
     OR p_claim_token IS NULL
     OR p_object_absence_confirmed IS DISTINCT FROM true THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.chat_attachment_runtime_state AS state
     WHERE state.singleton
       AND state.storage_write_contract = 'signed_only'
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_CLEANUP_REQUIRES_SIGNED_ONLY_STORAGE'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_session
    FROM public.chat_attachment_upload_sessions AS session
   WHERE session.id = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_session.status = 'deleted' THEN
    RETURN EXISTS (
      SELECT 1
        FROM public.chat_attachment_cleanup_receipts AS receipt
       WHERE receipt.session_id = p_session_id
         AND receipt.cleanup_claim_token = p_claim_token
         AND receipt.outcome = 'deleted'
         AND receipt.object_absence_confirmed
    );
  END IF;
  IF v_session.cleanup_claim_token <> p_claim_token
     OR v_session.attached_message_id IS NOT NULL
     OR v_session.final_deleted_at IS NOT NULL
     OR EXISTS (
       SELECT 1
         FROM public.chat_messages AS message
        WHERE jsonb_typeof(message.metadata -> 'imagePaths') = 'array'
          AND (message.metadata -> 'imagePaths')
            @> jsonb_build_array(v_session.final_path)
     ) THEN
    RETURN false;
  END IF;

  UPDATE public.chat_attachment_upload_sessions
     SET status = 'deleted',
         verification_claim_token = NULL,
         verification_started_at = NULL,
         attached_message_id = NULL,
         attached_at = NULL,
         cleanup_claim_token = NULL,
         cleanup_started_at = NULL,
         rejection_code = coalesce(rejection_code, 'orphan_cleanup'),
         final_deleted_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE id = p_session_id;

  INSERT INTO public.chat_attachment_cleanup_receipts(
    session_id, cleanup_claim_token, outcome, object_absence_confirmed
  ) VALUES (p_session_id, p_claim_token, 'deleted', true)
  ON CONFLICT (session_id) DO NOTHING;
  RETURN true;
END;
$finalize_cleanup$;

REVOKE ALL ON FUNCTION public.bind_chat_attachment_uploads_on_message()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_chat_attachment_storage_contract()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_chat_attachment_message_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detach_chat_attachment_uploads_on_message_delete()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_chat_attachment_cleanup_sessions(
  uuid, timestamptz, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_chat_attachment_cleanup(
  uuid, uuid, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_attachment_cleanup_sessions(
  uuid, timestamptz, timestamptz, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_chat_attachment_cleanup(
  uuid, uuid, boolean
) TO service_role;

ALTER FUNCTION public.begin_chat_attachment_upload_sessions(
  uuid, uuid, uuid, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.guard_chat_attachment_storage_contract()
  OWNER TO postgres;
ALTER FUNCTION public.reserve_chat_attachment_upload_token(
  uuid, uuid, uuid, integer
) OWNER TO postgres;
ALTER FUNCTION public.confirm_chat_attachment_upload_token(
  uuid, uuid, uuid, integer, timestamptz
) OWNER TO postgres;
ALTER FUNCTION public.claim_chat_attachment_upload_session(
  uuid, uuid, uuid, timestamptz
) OWNER TO postgres;
ALTER FUNCTION public.finalize_chat_attachment_upload_verification(
  uuid, uuid, uuid, bigint, text, text, boolean, text
) OWNER TO postgres;
ALTER FUNCTION public.bind_chat_attachment_uploads_on_message()
  OWNER TO postgres;
ALTER FUNCTION public.guard_chat_attachment_message_identity()
  OWNER TO postgres;
ALTER FUNCTION public.detach_chat_attachment_uploads_on_message_delete()
  OWNER TO postgres;
ALTER FUNCTION public.claim_chat_attachment_cleanup_sessions(
  uuid, timestamptz, timestamptz, integer
) OWNER TO postgres;
ALTER FUNCTION public.finalize_chat_attachment_cleanup(
  uuid, uuid, boolean
) OWNER TO postgres;

COMMENT ON TABLE public.chat_attachment_upload_sessions IS
  'Service-only exact-path inventory created before chat-image signed tokens; stores a keyed binding, never a raw SHA-256 digest.';
COMMENT ON FUNCTION public.reserve_chat_attachment_upload_token(
  uuid, uuid, uuid, integer
) IS
  'Durably reserves one bounded two-hour signed-upload token generation before external signing; a new generation requires the prior signing window to close.';
COMMENT ON FUNCTION public.confirm_chat_attachment_upload_token(
  uuid, uuid, uuid, integer, timestamptz
) IS
  'Confirms the current signed-token generation and observed expiry before a signer response may be exposed to a client.';
COMMENT ON FUNCTION public.claim_chat_attachment_cleanup_sessions(
  uuid, timestamptz, timestamptz, integer
) IS
  'Leases only token-drained, unattached, unreferenced exact chat-image paths; stale cleanup leases are reclaimable after 15 minutes.';

DO $postcondition$
BEGIN
  IF (
    SELECT count(*)
      FROM public.chat_attachment_runtime_state
     WHERE singleton
       AND mode IN ('disabled', 'shadow', 'enforced')
       AND storage_write_contract IN ('legacy_mutable', 'signed_only')
  ) <> 1
  OR pg_catalog.to_regprocedure(
    'public.begin_chat_attachment_upload_sessions(uuid,uuid,uuid,jsonb)'
  ) IS NULL
  OR pg_catalog.to_regprocedure(
    'public.reserve_chat_attachment_upload_token(uuid,uuid,uuid,integer)'
  ) IS NULL
  OR pg_catalog.to_regprocedure(
    'public.confirm_chat_attachment_upload_token(uuid,uuid,uuid,integer,timestamp with time zone)'
  ) IS NULL
  OR pg_catalog.to_regprocedure(
    'public.claim_chat_attachment_upload_session(uuid,uuid,uuid,timestamp with time zone)'
  ) IS NULL
  OR pg_catalog.to_regprocedure(
    'public.finalize_chat_attachment_upload_verification(uuid,uuid,uuid,bigint,text,text,boolean,text)'
  ) IS NULL
  OR pg_catalog.to_regprocedure(
    'public.claim_chat_attachment_cleanup_sessions(uuid,timestamp with time zone,timestamp with time zone,integer)'
  ) IS NULL
  OR pg_catalog.to_regprocedure(
    'public.finalize_chat_attachment_cleanup(uuid,uuid,boolean)'
  ) IS NULL
  OR pg_catalog.has_table_privilege(
    'anon', 'public.chat_attachment_upload_sessions', 'SELECT'
  )
  OR pg_catalog.has_table_privilege(
    'authenticated', 'public.chat_attachment_upload_sessions', 'SELECT'
  )
  OR NOT pg_catalog.has_table_privilege(
    'service_role', 'public.chat_attachment_upload_sessions', 'SELECT'
  )
  OR pg_catalog.has_column_privilege(
    'service_role', 'public.chat_attachment_runtime_state',
    'storage_write_contract', 'UPDATE'
  )
  OR pg_catalog.has_function_privilege(
    'anon',
    'public.begin_chat_attachment_upload_sessions(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_chat_attachment_upload_sessions(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  OR pg_catalog.has_function_privilege(
    'anon',
    'public.reserve_chat_attachment_upload_token(uuid,uuid,uuid,integer)',
    'EXECUTE'
  )
  OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_chat_attachment_upload_token(uuid,uuid,uuid,integer)',
    'EXECUTE'
  )
  OR pg_catalog.has_function_privilege(
    'anon',
    'public.confirm_chat_attachment_upload_token(uuid,uuid,uuid,integer,timestamp with time zone)',
    'EXECUTE'
  )
  OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.confirm_chat_attachment_upload_token(uuid,uuid,uuid,integer,timestamp with time zone)',
    'EXECUTE'
  )
  OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.begin_chat_attachment_upload_sessions(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.reserve_chat_attachment_upload_token(uuid,uuid,uuid,integer)',
    'EXECUTE'
  )
  OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.confirm_chat_attachment_upload_token(uuid,uuid,uuid,integer,timestamp with time zone)',
    'EXECUTE'
  )
  OR (
    SELECT count(*)
      FROM pg_catalog.pg_trigger AS trigger
     WHERE NOT trigger.tgisinternal
       AND (
         (
           trigger.tgrelid = 'public.chat_attachment_runtime_state'::regclass
           AND trigger.tgname = 'chat_attachment_storage_contract_guard'
         )
         OR (
           trigger.tgrelid = 'public.chat_messages'::regclass
           AND trigger.tgname IN (
             'chat_attachment_upload_bind',
             'chat_attachment_upload_identity_guard',
             'chat_attachment_upload_detach'
           )
         )
       )
       AND trigger.tgenabled <> 'D'
  ) <> 4 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SESSION_POSTCONDITION_INVALID';
  END IF;
END;
$postcondition$;

COMMIT;
