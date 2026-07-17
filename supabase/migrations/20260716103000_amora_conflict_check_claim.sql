-- Prevent duplicate Amora conflict checks for the same durable shared-message set.
--
-- The claim is keyed by (couple_id, message_digest), so requests from either
-- partner converge on one check. A per-attempt token fences a worker that
-- resumes after its lease was reclaimed by a newer request.

CREATE TABLE IF NOT EXISTS public.amora_conflict_check_claims (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  message_digest text NOT NULL,
  requester_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  checkpoint jsonb,
  result jsonb,
  failure_code text,
  attempt_count integer NOT NULL DEFAULT 1,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amora_conflict_check_claims_pkey
    PRIMARY KEY (couple_id, message_digest),
  CONSTRAINT amora_conflict_check_claims_digest_check
    CHECK (message_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT amora_conflict_check_claims_status_check
    CHECK (status IN ('processing', 'completed', 'failed')),
  CONSTRAINT amora_conflict_check_claims_attempt_count_check
    CHECK (attempt_count > 0),
  CONSTRAINT amora_conflict_check_claims_result_check
    CHECK (
      result IS NULL
      OR (jsonb_typeof(result) = 'object' AND pg_column_size(result) <= 65536)
    ),
  CONSTRAINT amora_conflict_check_claims_checkpoint_check
    CHECK (
      checkpoint IS NULL
      OR (jsonb_typeof(checkpoint) = 'object' AND pg_column_size(checkpoint) <= 32768)
    ),
  CONSTRAINT amora_conflict_check_claims_state_check
    CHECK (
      (status = 'processing' AND result IS NULL AND completed_at IS NULL AND failed_at IS NULL)
      OR (status = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL AND failed_at IS NULL)
      OR (status = 'failed' AND result IS NULL AND completed_at IS NULL AND failed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS amora_conflict_check_claims_completed_at_idx
  ON public.amora_conflict_check_claims (completed_at)
  WHERE status = 'completed';

ALTER TABLE public.amora_conflict_check_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_conflict_check_claims FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amora_conflict_check_claims_service_role_all
  ON public.amora_conflict_check_claims;
CREATE POLICY amora_conflict_check_claims_service_role_all
  ON public.amora_conflict_check_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.amora_conflict_check_claims
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.amora_conflict_check_claims
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_amora_conflict_check(
  p_couple_id uuid,
  p_message_digest text,
  p_requester_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.amora_conflict_check_claims%ROWTYPE;
  v_inserted_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECK_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_requester_user_id IS NULL
     OR p_message_digest IS NULL
     OR p_message_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECK_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_requester_user_id
      AND p.couple_id = p_couple_id
  ) THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECK_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.amora_conflict_check_claims (
    couple_id,
    message_digest,
    requester_user_id
  )
  VALUES (
    p_couple_id,
    p_message_digest,
    p_requester_user_id
  )
  ON CONFLICT (couple_id, message_digest) DO NOTHING
  ;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  IF v_inserted_count = 1 THEN
    SELECT *
    INTO STRICT v_claim
    FROM public.amora_conflict_check_claims
    WHERE couple_id = p_couple_id
      AND message_digest = p_message_digest;

    RETURN jsonb_build_object(
      'action', 'acquired',
      'attempt_count', v_claim.attempt_count,
      'claim_token', v_claim.claim_token,
      'checkpoint', v_claim.checkpoint,
      'reclaimed', false
    );
  END IF;

  SELECT *
  INTO v_claim
  FROM public.amora_conflict_check_claims
  WHERE couple_id = p_couple_id
    AND message_digest = p_message_digest
  FOR UPDATE;

  IF v_claim.status = 'completed' THEN
    RETURN jsonb_build_object(
      'action', 'completed',
      'attempt_count', v_claim.attempt_count,
      'result', v_claim.result
    );
  END IF;

  IF v_claim.status = 'processing'
     AND v_claim.claimed_at > now() - interval '6 minutes' THEN
    RETURN jsonb_build_object(
      'action', 'in_progress',
      'attempt_count', v_claim.attempt_count
    );
  END IF;

  UPDATE public.amora_conflict_check_claims
  SET requester_user_id = p_requester_user_id,
      status = 'processing',
      claim_token = gen_random_uuid(),
      result = NULL,
      failure_code = NULL,
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      completed_at = NULL,
      failed_at = NULL,
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND message_digest = p_message_digest
  RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'action', 'acquired',
    'attempt_count', v_claim.attempt_count,
    'claim_token', v_claim.claim_token,
    'checkpoint', v_claim.checkpoint,
    'reclaimed', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.checkpoint_amora_conflict_check(
  p_couple_id uuid,
  p_message_digest text,
  p_claim_token uuid,
  p_checkpoint jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECK_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_claim_token IS NULL
     OR p_message_digest IS NULL
     OR p_message_digest !~ '^[0-9a-f]{64}$'
     OR p_checkpoint IS NULL
     OR jsonb_typeof(p_checkpoint) IS DISTINCT FROM 'object'
     OR pg_column_size(p_checkpoint) > 32768 THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECK_INVALID_CHECKPOINT'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_conflict_check_claims
  SET checkpoint = p_checkpoint,
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND message_digest = p_message_digest
    AND claim_token = p_claim_token
    AND status = 'processing';

  RETURN FOUND;
END;
$$;

-- Token-aware completion used by the application. The token is intentionally
-- required after a claim is reclaimed, preventing a stale worker from winning.
CREATE OR REPLACE FUNCTION public.complete_amora_conflict_check(
  p_couple_id uuid,
  p_message_digest text,
  p_claim_token uuid,
  p_result jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECK_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_claim_token IS NULL
     OR p_message_digest IS NULL
     OR p_message_digest !~ '^[0-9a-f]{64}$'
     OR p_result IS NULL
     OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
     OR pg_column_size(p_result) > 65536 THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECK_INVALID_COMPLETION'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_conflict_check_claims
  SET status = 'completed',
      result = p_result,
      checkpoint = NULL,
      failure_code = NULL,
      completed_at = now(),
      failed_at = NULL,
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND message_digest = p_message_digest
    AND claim_token = p_claim_token
    AND status = 'processing';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_amora_conflict_check(
  p_couple_id uuid,
  p_message_digest text,
  p_claim_token uuid,
  p_failure_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECK_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_claim_token IS NULL
     OR p_message_digest IS NULL
     OR p_message_digest !~ '^[0-9a-f]{64}$'
     OR p_failure_code IS NULL
     OR length(btrim(p_failure_code)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'AMORA_CONFLICT_CHECK_INVALID_FAILURE'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_conflict_check_claims
  SET status = 'failed',
      result = NULL,
      failure_code = left(btrim(p_failure_code), 120),
      completed_at = NULL,
      failed_at = now(),
      updated_at = now()
  WHERE couple_id = p_couple_id
    AND message_digest = p_message_digest
    AND claim_token = p_claim_token
    AND status = 'processing';

  RETURN FOUND;
END;
$$;

ALTER FUNCTION public.claim_amora_conflict_check(uuid, text, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.checkpoint_amora_conflict_check(uuid, text, uuid, jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.complete_amora_conflict_check(uuid, text, uuid, jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.fail_amora_conflict_check(uuid, text, uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.claim_amora_conflict_check(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.checkpoint_amora_conflict_check(uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_amora_conflict_check(uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_amora_conflict_check(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_amora_conflict_check(uuid, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.checkpoint_amora_conflict_check(uuid, text, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_amora_conflict_check(uuid, text, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_amora_conflict_check(uuid, text, uuid, text)
  TO service_role;

COMMENT ON TABLE public.amora_conflict_check_claims IS
  'Durable, partner-shared idempotency claims for Amora conflict detection.';
COMMENT ON FUNCTION public.claim_amora_conflict_check(uuid, text, uuid) IS
  'Claims a durable shared-message digest once per couple; service role only.';
COMMENT ON FUNCTION public.checkpoint_amora_conflict_check(uuid, text, uuid, jsonb) IS
  'Stores a lease-fenced conflict-detection checkpoint for safe mediation retry.';
COMMENT ON FUNCTION public.complete_amora_conflict_check(uuid, text, uuid, jsonb) IS
  'Completes a conflict check only for the current lease token; service role only.';
