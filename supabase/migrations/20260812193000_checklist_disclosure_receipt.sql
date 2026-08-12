BEGIN;

-- Raw disclosure tokens are never persisted. The table stores only a SHA-256
-- hash plus every server-owned value that made the disclosed proposal exact.
CREATE TABLE IF NOT EXISTS public.couple_plan_change_disclosure_receipts (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  request_id uuid NOT NULL REFERENCES public.couple_plan_change_requests(id)
    ON DELETE CASCADE,
  couple_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL,
  base_revision bigint NOT NULL CHECK (
    base_revision BETWEEN 0 AND 9007199254740990
  ),
  change_digest text NOT NULL CHECK (change_digest ~ '^[a-f0-9]{64}$'),
  roster_fingerprint text NOT NULL CHECK (
    roster_fingerprint ~ '^[a-f0-9]{32}$'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX IF NOT EXISTS couple_plan_change_disclosure_receipts_lookup_idx
  ON public.couple_plan_change_disclosure_receipts(
    request_id,
    couple_id,
    reviewer_user_id,
    created_at DESC
  );

ALTER TABLE public.couple_plan_change_disclosure_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_plan_change_disclosure_receipts OWNER TO postgres;
REVOKE ALL ON TABLE public.couple_plan_change_disclosure_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_checklist_plan_change_disclosure_receipt(
  p_request_id uuid,
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_expected_base_revision bigint,
  p_expected_change_digest text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_revision bigint;
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_now timestamptz;
  v_expires_at timestamptz;
  v_raw_receipt text;
  v_token_hash text;
  v_rows integer := 0;
  v_attempt integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL
     OR p_couple_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_expected_base_revision IS NULL
     OR p_expected_base_revision NOT BETWEEN 0 AND 9007199254740990
     OR p_expected_change_digest IS NULL
     OR p_expected_change_digest !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  -- Shared lock order for issue and acceptance: couple -> journey -> request
  -- -> disclosure receipt. FOR UPDATE serializes bounded multi-tab issuance.
  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;
  IF v_bride_id IS NULL
     OR v_groom_id IS NULL
     OR v_bride_id = v_groom_id
     OR (
       p_actor_user_id IS DISTINCT FROM v_bride_id
       AND p_actor_user_id IS DISTINCT FROM v_groom_id
     ) THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  v_roster_fingerprint := md5(
    v_bride_id::text || ':' || v_groom_id::text
  );

  SELECT journey.state_revision
    INTO v_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id
    AND request.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_now := clock_timestamp();
  IF v_request.status <> 'pending'
     OR v_request.expires_at <= v_now THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_EXPIRED'
      USING ERRCODE = '40001';
  END IF;
  IF v_request.base_revision IS DISTINCT FROM v_revision
     OR v_request.base_revision IS DISTINCT FROM p_expected_base_revision
     OR v_request.roster_fingerprint IS DISTINCT FROM v_roster_fingerprint
     OR v_request.change_digest !~ '^[a-f0-9]{64}$'
     OR v_request.change_digest IS DISTINCT FROM p_expected_change_digest
     OR v_request.change_digest IS DISTINCT FROM
       public.couple_plan_change_digest(v_request.changes)
     OR v_request.is_high_impact IS DISTINCT FROM true
     OR v_request.required_count <> 2
     OR v_request.surface_href IS DISTINCT FROM '/schedule'
     OR jsonb_typeof(v_request.changes) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_request.changes -> 'progress_patch')
       IS DISTINCT FROM 'object'
     OR NOT (v_request.changes -> 'progress_patch' ? '__checklist_profile')
     OR v_request.changes - 'progress_patch' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  v_expires_at := LEAST(
    v_request.expires_at,
    v_now + interval '15 minutes'
  );
  DELETE FROM public.couple_plan_change_disclosure_receipts AS receipt
  WHERE receipt.request_id = v_request.id
    AND receipt.couple_id = v_request.couple_id
    AND receipt.reviewer_user_id = p_actor_user_id
    AND (
      receipt.consumed_at IS NOT NULL
      OR receipt.expires_at <= v_now
    );
  FOR v_attempt IN 1..4 LOOP
    v_raw_receipt := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(
      extensions.digest(decode(v_raw_receipt, 'hex'), 'sha256'),
      'hex'
    );
    INSERT INTO public.couple_plan_change_disclosure_receipts(
      token_hash,
      request_id,
      couple_id,
      reviewer_user_id,
      base_revision,
      change_digest,
      roster_fingerprint,
      created_at,
      expires_at
    ) VALUES (
      v_token_hash,
      v_request.id,
      v_request.couple_id,
      p_actor_user_id,
      v_request.base_revision,
      v_request.change_digest,
      v_request.roster_fingerprint,
      v_now,
      v_expires_at
    ) ON CONFLICT (token_hash) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 1;
  END LOOP;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_UNAVAILABLE'
      USING ERRCODE = '55000';
  END IF;

  -- Keep five simultaneously valid receipts for safe multi-tab review. Older
  -- receipts are removed under the request lock instead of growing unbounded.
  WITH superseded AS (
    SELECT receipt.token_hash
    FROM public.couple_plan_change_disclosure_receipts AS receipt
    WHERE receipt.request_id = v_request.id
      AND receipt.couple_id = v_request.couple_id
      AND receipt.reviewer_user_id = p_actor_user_id
      AND receipt.consumed_at IS NULL
      AND receipt.expires_at > v_now
    ORDER BY receipt.created_at DESC, receipt.token_hash DESC
    OFFSET 5
  )
  DELETE FROM public.couple_plan_change_disclosure_receipts AS receipt
  WHERE receipt.token_hash IN (
    SELECT superseded.token_hash FROM superseded
  );

  RETURN v_raw_receipt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_couple_plan_change_with_disclosure(
  p_request_id uuid,
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_disclosure_receipt text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_raw_bride_id uuid;
  v_raw_groom_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_revision bigint;
  v_request public.couple_plan_change_requests%ROWTYPE;
  v_receipt public.couple_plan_change_disclosure_receipts%ROWTYPE;
  v_is_checklist_situation boolean;
  v_token_hash text;
  v_now timestamptz;
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL
     OR p_couple_id IS NULL
     OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_INVALID_INPUT'
      USING ERRCODE = '22023';
  END IF;

  SELECT couple.bride_id, couple.groom_id
    INTO v_raw_bride_id, v_raw_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_bride_id := CASE
    WHEN public.is_current_couple_member(v_raw_bride_id, p_couple_id)
      THEN v_raw_bride_id
    ELSE NULL
  END;
  v_groom_id := CASE
    WHEN public.is_current_couple_member(v_raw_groom_id, p_couple_id)
      THEN v_raw_groom_id
    ELSE NULL
  END;
  IF p_actor_user_id IS DISTINCT FROM v_bride_id
     AND p_actor_user_id IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  v_roster_fingerprint := md5(
    COALESCE(v_bride_id::text, '-')
      || ':' ||
    COALESCE(v_groom_id::text, '-')
  );

  SELECT journey.state_revision
    INTO v_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.couple_plan_change_requests AS request
  WHERE request.id = p_request_id
    AND request.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  -- Terminal retries are read-only recovery. A same-actor retry while the
  -- partner is still pending also returns the durable prior acceptance.
  IF v_request.status <> 'pending' THEN
    RETURN public.couple_plan_change_result(p_request_id);
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.couple_plan_change_acceptances AS acceptance
    WHERE acceptance.request_id = v_request.id
      AND acceptance.couple_id = v_request.couple_id
      AND acceptance.user_id = p_actor_user_id
      AND acceptance.change_digest = v_request.change_digest
      AND acceptance.roster_fingerprint = v_request.roster_fingerprint
  ) THEN
    RETURN public.couple_plan_change_result(p_request_id);
  END IF;

  v_is_checklist_situation := COALESCE(
    jsonb_typeof(v_request.changes) = 'object'
    AND jsonb_typeof(v_request.changes -> 'progress_patch') = 'object'
    AND v_request.changes -> 'progress_patch' ? '__checklist_profile',
    false
  );
  IF NOT v_is_checklist_situation THEN
    IF p_disclosure_receipt IS NOT NULL THEN
      RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_UNEXPECTED'
        USING ERRCODE = '22023';
    END IF;
    RETURN public.accept_couple_plan_change(
      p_request_id,
      p_couple_id,
      p_actor_user_id
    );
  END IF;

  IF p_disclosure_receipt IS NULL THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_REQUIRED'
      USING ERRCODE = '22023';
  END IF;
  IF p_disclosure_receipt !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_MISMATCH'
      USING ERRCODE = '40001';
  END IF;

  v_now := clock_timestamp();
  IF v_request.expires_at <= v_now THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_EXPIRED'
      USING ERRCODE = '40001';
  END IF;
  IF v_bride_id IS NULL
     OR v_groom_id IS NULL
     OR v_bride_id = v_groom_id
     OR v_request.base_revision IS DISTINCT FROM v_revision
     OR v_request.roster_fingerprint IS DISTINCT FROM v_roster_fingerprint
     OR v_request.change_digest !~ '^[a-f0-9]{64}$'
     OR v_request.change_digest IS DISTINCT FROM
       public.couple_plan_change_digest(v_request.changes)
     OR v_request.is_high_impact IS DISTINCT FROM true
     OR v_request.required_count <> 2
     OR v_request.surface_href IS DISTINCT FROM '/schedule'
     OR v_request.changes - 'progress_patch' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  v_token_hash := encode(
    extensions.digest(decode(p_disclosure_receipt, 'hex'), 'sha256'),
    'hex'
  );
  SELECT receipt.*
    INTO v_receipt
  FROM public.couple_plan_change_disclosure_receipts AS receipt
  WHERE receipt.token_hash = v_token_hash
  FOR UPDATE;
  IF NOT FOUND
     OR v_receipt.request_id IS DISTINCT FROM v_request.id
     OR v_receipt.couple_id IS DISTINCT FROM v_request.couple_id
     OR v_receipt.reviewer_user_id IS DISTINCT FROM p_actor_user_id
     OR v_receipt.base_revision IS DISTINCT FROM v_request.base_revision
     OR v_receipt.change_digest IS DISTINCT FROM v_request.change_digest
     OR v_receipt.roster_fingerprint IS DISTINCT FROM
       v_request.roster_fingerprint THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_MISMATCH'
      USING ERRCODE = '40001';
  END IF;
  IF v_receipt.consumed_at IS NOT NULL
     OR v_receipt.expires_at <= v_now THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_EXPIRED'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.couple_plan_change_disclosure_receipts AS receipt
  SET consumed_at = v_now
  WHERE receipt.token_hash = v_receipt.token_hash
    AND receipt.consumed_at IS NULL
    AND receipt.expires_at > v_now;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_DISCLOSURE_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  RETURN public.accept_couple_plan_change(
    p_request_id,
    p_couple_id,
    p_actor_user_id
  );
END;
$function$;

ALTER FUNCTION public.issue_checklist_plan_change_disclosure_receipt(
  uuid, uuid, uuid, bigint, text
) OWNER TO postgres;
ALTER FUNCTION public.accept_couple_plan_change_with_disclosure(
  uuid, uuid, uuid, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.issue_checklist_plan_change_disclosure_receipt(
  uuid, uuid, uuid, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_couple_plan_change_with_disclosure(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.issue_checklist_plan_change_disclosure_receipt(
  uuid, uuid, uuid, bigint, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_couple_plan_change_with_disclosure(
  uuid, uuid, uuid, text
) TO service_role;

COMMENT ON TABLE public.couple_plan_change_disclosure_receipts IS
  'Service-only hashes of short-lived reviewer-specific checklist disclosure tokens; raw tokens are never stored.';
COMMENT ON FUNCTION public.issue_checklist_plan_change_disclosure_receipt(
  uuid, uuid, uuid, bigint, text
) IS 'Issues a random reviewer-specific token for the exact current checklist proposal without recording acceptance.';
COMMENT ON FUNCTION public.accept_couple_plan_change_with_disclosure(
  uuid, uuid, uuid, text
) IS 'Atomically consumes an exact checklist disclosure token while preserving idempotent recovery and ordinary plan approvals.';

COMMIT;
