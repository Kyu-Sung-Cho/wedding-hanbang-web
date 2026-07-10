-- WeddingCode response version provenance + atomic two-person pairing.
--
-- The previous API performed count -> insert/update as separate statements.
-- Concurrent requests could both observe one slot and create a third row. The
-- functions below serialize each couple token with a transaction advisory lock,
-- and the trigger applies the same invariant to any direct service-role write.

ALTER TABLE public.wedding_code_responses
  ADD COLUMN IF NOT EXISTS scoring_version TEXT,
  ADD COLUMN IF NOT EXISTS submission_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS wedding_code_responses_submission_id_unique
  ON public.wedding_code_responses (submission_id)
  WHERE submission_id IS NOT NULL;

-- All v0.5 candidate revisions through candidate.9 share the same weight map.
-- Backfill only those known rows; older form families remain explicitly unknown.
UPDATE public.wedding_code_responses
SET scoring_version = 'v0.5-scoring.1'
WHERE scoring_version IS NULL
  AND form_version IN (
    'v0.5-candidate.1',
    'v0.5-candidate.2',
    'v0.5-candidate.3',
    'v0.5-candidate.4',
    'v0.5-candidate.5',
    'v0.5-candidate.6',
    'v0.5-candidate.7',
    'v0.5-candidate.8',
    'v0.5-candidate.9'
  );

COMMENT ON COLUMN public.wedding_code_responses.scoring_version IS
  '답변을 해석하는 가중치/채점 계약 버전. form_version(문항 문구)과 별도 관리';

COMMENT ON COLUMN public.wedding_code_responses.submission_id IS
  '클라이언트 제출 시도 UUID. 네트워크 재시도를 같은 응답으로 멱등 처리';

-- Migration-first rollout compatibility: the currently deployed candidate.4
-- writer does not send scoring_version. Fill only the form families whose
-- weight map is known to be scoring.1; leave unknown families explicit NULL.
CREATE OR REPLACE FUNCTION public.set_wedding_code_scoring_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.scoring_version IS NULL
    AND NEW.form_version IN (
      'v0.5-candidate.1',
      'v0.5-candidate.2',
      'v0.5-candidate.3',
      'v0.5-candidate.4',
      'v0.5-candidate.5',
      'v0.5-candidate.6',
      'v0.5-candidate.7',
      'v0.5-candidate.8',
      'v0.5-candidate.9'
    ) THEN
    NEW.scoring_version := 'v0.5-scoring.1';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wedding_code_set_scoring_version
  ON public.wedding_code_responses;
CREATE TRIGGER wedding_code_set_scoring_version
  BEFORE INSERT
  ON public.wedding_code_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_wedding_code_scoring_version();

-- Repair any historical race outcome deterministically: keep the first two
-- submissions paired and preserve later responses as ordinary unpaired rows.
WITH ranked_pairs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY couple_token
      ORDER BY created_at ASC, id ASC
    ) AS slot_number
  FROM public.wedding_code_responses
  WHERE couple_token IS NOT NULL
)
UPDATE public.wedding_code_responses AS response
SET couple_token = NULL
FROM ranked_pairs
WHERE response.id = ranked_pairs.id
  AND ranked_pairs.slot_number > 2;

CREATE OR REPLACE FUNCTION public.enforce_wedding_code_couple_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_existing_count INTEGER;
BEGIN
  IF NEW.couple_token IS NULL THEN
    RETURN NEW;
  END IF;

  -- An unchanged token is not claiming a new slot.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.couple_token IS NOT DISTINCT FROM NEW.couple_token THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.couple_token::TEXT, 0)
  );

  SELECT COUNT(*)::INTEGER
  INTO v_existing_count
  FROM public.wedding_code_responses AS response
  WHERE response.couple_token = NEW.couple_token
    AND response.id IS DISTINCT FROM NEW.id;

  IF v_existing_count >= 2 THEN
    RAISE EXCEPTION 'wedding_code_couple_full'
      USING ERRCODE = '23514',
            CONSTRAINT = 'wedding_code_couple_max_two';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wedding_code_couple_max_two
  ON public.wedding_code_responses;
CREATE TRIGGER wedding_code_couple_max_two
  BEFORE INSERT OR UPDATE OF couple_token
  ON public.wedding_code_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_wedding_code_couple_limit();

CREATE OR REPLACE FUNCTION public.insert_wedding_code_response(
  p_submission_id UUID,
  p_form_version TEXT,
  p_scoring_version TEXT,
  p_participant_stage TEXT,
  p_answering_mode TEXT,
  p_quote_status TEXT,
  p_parent_involvement TEXT,
  p_biggest_concern TEXT[],
  p_biggest_concern_other TEXT,
  p_answers JSONB,
  p_stage_flags JSONB,
  p_feedback JSONB,
  p_cta_interest JSONB,
  p_free_text JSONB,
  p_duration_ms INTEGER,
  p_utm_source TEXT,
  p_utm_medium TEXT,
  p_utm_campaign TEXT,
  p_utm_content TEXT,
  p_couple_token UUID
)
RETURNS TABLE(
  response_id UUID,
  pairing_status TEXT,
  paired BOOLEAN,
  recovered BOOLEAN,
  couple_token UUID,
  form_version TEXT,
  scoring_version TEXT,
  participant_stage TEXT,
  quote_status TEXT,
  answers JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_response_id UUID;
  v_existing_token UUID;
  v_existing_count INTEGER := 0;
  v_stored_token UUID := NULL;
  v_pairing_status TEXT := 'unpaired';
  v_canonical_form_version TEXT := p_form_version;
  v_canonical_scoring_version TEXT := p_scoring_version;
  v_canonical_participant_stage TEXT := p_participant_stage;
  v_canonical_quote_status TEXT := p_quote_status;
  v_canonical_answers JSONB := p_answers;
BEGIN
  IF p_submission_id IS NULL
    OR NULLIF(pg_catalog.btrim(p_form_version), '') IS NULL
    OR NULLIF(pg_catalog.btrim(p_scoring_version), '') IS NULL THEN
    RAISE EXCEPTION 'wedding_code_version_required' USING ERRCODE = '22023';
  END IF;

  -- A response may commit while its HTTP reply is lost. Serialize the client
  -- attempt before the couple-token lock and return the existing row on retry,
  -- so one participant can never consume both pair slots.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wedding-code-submission:' || p_submission_id::TEXT, 0)
  );

  SELECT
    response.id,
    response.couple_token,
    response.form_version,
    response.scoring_version,
    response.participant_stage,
    response.quote_status,
    response.answers
  INTO
    v_response_id,
    v_existing_token,
    v_canonical_form_version,
    v_canonical_scoring_version,
    v_canonical_participant_stage,
    v_canonical_quote_status,
    v_canonical_answers
  FROM public.wedding_code_responses AS response
  WHERE response.submission_id = p_submission_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_token IS NOT NULL THEN
      -- The response idempotency capability owns its already-established
      -- token. A stale tab may request a different token; return the canonical
      -- one instead of losing the valid pair.
      v_stored_token := v_existing_token;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_existing_token::TEXT, 0)
      );
      SELECT COUNT(*)::INTEGER
      INTO v_existing_count
      FROM public.wedding_code_responses AS response
      WHERE response.couple_token = v_existing_token;
      v_pairing_status := CASE WHEN v_existing_count >= 2 THEN 'paired' ELSE 'waiting' END;
    ELSIF p_couple_token IS NOT NULL THEN
      -- The first exact attempt completed without claiming this full token.
      -- Preserve that immutable outcome on an ambiguous HTTP retry.
      v_pairing_status := 'full';
    END IF;

    -- Return the immutable DB snapshot. A user may edit the visible form after
    -- a lost response, but the client must render what was actually committed.
    RETURN QUERY
    SELECT
      v_response_id,
      v_pairing_status,
      v_pairing_status = 'paired',
      TRUE,
      v_stored_token,
      v_canonical_form_version,
      v_canonical_scoring_version,
      v_canonical_participant_stage,
      v_canonical_quote_status,
      v_canonical_answers;
    RETURN;
  END IF;

  IF p_couple_token IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_couple_token::TEXT, 0)
    );

    SELECT COUNT(*)::INTEGER
    INTO v_existing_count
    FROM public.wedding_code_responses AS response
    WHERE response.couple_token = p_couple_token;

    IF v_existing_count >= 2 THEN
      -- Preserve the completed response, but never silently claim a third slot.
      v_pairing_status := 'full';
    ELSE
      v_stored_token := p_couple_token;
      v_pairing_status := CASE WHEN v_existing_count = 1 THEN 'paired' ELSE 'waiting' END;
    END IF;
  END IF;

  INSERT INTO public.wedding_code_responses (
    submission_id,
    form_version,
    scoring_version,
    participant_stage,
    answering_mode,
    quote_status,
    parent_involvement,
    biggest_concern,
    biggest_concern_other,
    answers,
    stage_flags,
    feedback,
    cta_interest,
    free_text,
    duration_ms,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    couple_token
  ) VALUES (
    p_submission_id,
    p_form_version,
    p_scoring_version,
    p_participant_stage,
    p_answering_mode,
    p_quote_status,
    p_parent_involvement,
    p_biggest_concern,
    p_biggest_concern_other,
    p_answers,
    p_stage_flags,
    p_feedback,
    p_cta_interest,
    p_free_text,
    p_duration_ms,
    p_utm_source,
    p_utm_medium,
    p_utm_campaign,
    p_utm_content,
    v_stored_token
  )
  RETURNING id INTO v_response_id;

  RETURN QUERY
  SELECT
    v_response_id,
    v_pairing_status,
    v_pairing_status = 'paired',
    FALSE,
    v_stored_token,
    v_canonical_form_version,
    v_canonical_scoring_version,
    v_canonical_participant_stage,
    v_canonical_quote_status,
    v_canonical_answers;
END;
$$;

CREATE OR REPLACE FUNCTION public.pair_wedding_code_response(
  p_response_id UUID,
  p_couple_token UUID
)
RETURNS TABLE(pairing_status TEXT, couple_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_existing_token UUID;
  v_existing_count INTEGER;
  v_pairing_status TEXT;
BEGIN
  IF p_response_id IS NULL OR p_couple_token IS NULL THEN
    RAISE EXCEPTION 'wedding_code_pair_identifiers_required' USING ERRCODE = '22023';
  END IF;

  SELECT response.couple_token
  INTO v_existing_token
  FROM public.wedding_code_responses AS response
  WHERE response.id = p_response_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_existing_token IS NOT NULL THEN
    -- The response id is itself an unguessable capability. Return its
    -- canonical token so stale/multiple tabs recover rather than overwriting
    -- the only valid invite with a losing token.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_existing_token::TEXT, 0)
    );
    SELECT COUNT(*)::INTEGER
    INTO v_existing_count
    FROM public.wedding_code_responses AS response
    WHERE response.couple_token = v_existing_token;

    v_pairing_status := CASE WHEN v_existing_count >= 2 THEN 'paired' ELSE 'waiting' END;
    RETURN QUERY SELECT v_pairing_status, v_existing_token;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_couple_token::TEXT, 0)
  );

  SELECT COUNT(*)::INTEGER
  INTO v_existing_count
  FROM public.wedding_code_responses AS response
  WHERE response.couple_token = p_couple_token;

  IF v_existing_count >= 2 THEN
    RETURN QUERY SELECT 'full'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  UPDATE public.wedding_code_responses
  SET couple_token = p_couple_token
  WHERE id = p_response_id;

  v_pairing_status := CASE WHEN v_existing_count = 1 THEN 'paired' ELSE 'waiting' END;
  RETURN QUERY SELECT v_pairing_status, p_couple_token;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_wedding_code_couple_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_wedding_code_scoring_version() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.insert_wedding_code_response(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, JSONB, JSONB, JSONB, JSONB,
  JSONB, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_wedding_code_response(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, JSONB, JSONB, JSONB, JSONB,
  JSONB, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_wedding_code_response(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, JSONB, JSONB, JSONB, JSONB,
  JSONB, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.pair_wedding_code_response(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pair_wedding_code_response(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pair_wedding_code_response(UUID, UUID) TO service_role;

COMMENT ON COLUMN public.wedding_code_responses.couple_token IS
  '커플 페어링용 무의미 난수 토큰(UUID v4) — DB 트랜잭션에서 최대 2행 강제';
