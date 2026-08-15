BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.amora_couple_core_criterion_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  proposer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bride_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  groom_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  value text NOT NULL CHECK (
    char_length(value) BETWEEN 1 AND 120
    AND value = btrim(value)
  ),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'confirmed', 'cancelled', 'invalidated')),
  base_decision_id uuid REFERENCES public.decision_nodes(id) ON DELETE SET NULL,
  confirmed_decision_id uuid UNIQUE
    REFERENCES public.decision_nodes(id) ON DELETE SET NULL,
  created_request_id uuid NOT NULL,
  cancel_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  CONSTRAINT amora_couple_core_criterion_proposals_roster_check
    CHECK (
      bride_user_id IS DISTINCT FROM groom_user_id
      AND proposer_user_id IN (bride_user_id, groom_user_id)
    ),
  CONSTRAINT amora_couple_core_criterion_proposals_close_check
    CHECK (
      (state = 'pending' AND closed_at IS NULL AND confirmed_decision_id IS NULL)
      OR (state = 'confirmed' AND closed_at IS NOT NULL AND confirmed_decision_id IS NOT NULL)
      OR (state IN ('cancelled', 'invalidated') AND closed_at IS NOT NULL AND confirmed_decision_id IS NULL)
    ),
  CONSTRAINT amora_couple_core_criterion_proposals_create_replay_unique
    UNIQUE (proposer_user_id, created_request_id)
);

CREATE UNIQUE INDEX amora_couple_core_criterion_one_pending_idx
  ON public.amora_couple_core_criterion_proposals(couple_id)
  WHERE state = 'pending';

CREATE INDEX amora_couple_core_criterion_proposals_history_idx
  ON public.amora_couple_core_criterion_proposals(couple_id, created_at DESC);

CREATE TABLE public.amora_couple_core_criterion_acceptances (
  proposal_id uuid NOT NULL
    REFERENCES public.amora_couple_core_criterion_proposals(id) ON DELETE CASCADE,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (proposal_id, user_id),
  CONSTRAINT amora_couple_core_criterion_acceptances_replay_unique
    UNIQUE (user_id, request_id)
);

ALTER TABLE public.amora_couple_core_criterion_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_couple_core_criterion_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.amora_couple_core_criterion_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_couple_core_criterion_acceptances FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.amora_couple_core_criterion_proposals
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.amora_couple_core_criterion_acceptances
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.amora_couple_core_criterion_proposals TO service_role;
GRANT ALL ON TABLE public.amora_couple_core_criterion_acceptances TO service_role;

CREATE POLICY amora_couple_core_criterion_proposals_service_all
  ON public.amora_couple_core_criterion_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY amora_couple_core_criterion_acceptances_service_all
  ON public.amora_couple_core_criterion_acceptances
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.read_amora_couple_core_criterion_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_profile_count integer;
  v_current public.decision_nodes%ROWTYPE;
  v_proposal public.amora_couple_core_criterion_proposals%ROWTYPE;
  v_accepted_user_ids jsonb;
  v_linked boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL OR p_recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR p_recipient_user_id NOT IN (v_bride_id, v_groom_id) THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO v_profile_count
  FROM public.profiles AS profile
  WHERE profile.couple_id = p_couple_id
    AND (
      (profile.id = v_bride_id AND profile.role = 'bride')
      OR (profile.id = v_groom_id AND profile.role = 'groom')
    );
  v_linked := v_bride_id IS NOT NULL
    AND v_groom_id IS NOT NULL
    AND v_bride_id IS DISTINCT FROM v_groom_id
    AND v_profile_count = 2;

  IF NOT v_linked THEN
    RETURN jsonb_build_object(
      'version', 1,
      'coupleId', p_couple_id,
      'linked', false,
      'current', NULL,
      'proposal', NULL
    );
  END IF;

  SELECT decision.* INTO v_current
  FROM public.decision_nodes AS decision
  WHERE decision.couple_id = p_couple_id
    AND decision.category = 'preference'
    AND decision.decision_type = 'decided'
    AND decision.visibility = 'shared'
    AND decision.source = 'manual'
    AND decision.source_actor_role IS NULL
    AND decision.metadata @> jsonb_build_object(
      'criterion_contract', 'amora_couple_core_criterion_v1',
      'criterion_version', 1,
      'bride_user_id', v_bride_id::text,
      'groom_user_id', v_groom_id::text,
      'acceptance_count', 2,
      'explicit', true
    )
  ORDER BY decision.user_confirmed_at DESC NULLS LAST,
           decision.created_at DESC,
           decision.id DESC
  LIMIT 1;

  SELECT proposal.* INTO v_proposal
  FROM public.amora_couple_core_criterion_proposals AS proposal
  WHERE proposal.couple_id = p_couple_id
    AND proposal.state = 'pending'
    AND proposal.bride_user_id = v_bride_id
    AND proposal.groom_user_id = v_groom_id
  ORDER BY proposal.created_at DESC, proposal.id DESC
  LIMIT 1;

  IF FOUND THEN
    SELECT COALESCE(
      jsonb_agg(acceptance.user_id::text ORDER BY acceptance.user_id),
      '[]'::jsonb
    ) INTO v_accepted_user_ids
    FROM public.amora_couple_core_criterion_acceptances AS acceptance
    WHERE acceptance.proposal_id = v_proposal.id
      AND acceptance.couple_id = p_couple_id
      AND acceptance.user_id IN (v_bride_id, v_groom_id);
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'coupleId', p_couple_id,
    'linked', true,
    'current', CASE WHEN v_current.id IS NULL THEN NULL ELSE jsonb_build_object(
      'decisionId', v_current.id,
      'value', v_current.chosen_value ->> 'value',
      'confirmedAt', to_char(
        COALESCE(v_current.user_confirmed_at, v_current.created_at) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ) END,
    'proposal', CASE WHEN v_proposal.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_proposal.id,
      'value', v_proposal.value,
      'revision', v_proposal.revision,
      'proposerUserId', v_proposal.proposer_user_id,
      'brideUserId', v_proposal.bride_user_id,
      'groomUserId', v_proposal.groom_user_id,
      'acceptedUserIds', v_accepted_user_ids,
      'createdAt', to_char(
        v_proposal.created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'updatedAt', to_char(
        v_proposal.updated_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ) END
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.propose_amora_couple_core_criterion_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_current_decision_id uuid,
  p_request_id uuid,
  p_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_bride_id uuid;
  v_groom_id uuid;
  v_current_id uuid;
  v_replay public.amora_couple_core_criterion_proposals%ROWTYPE;
  v_pending_id uuid;
  v_proposal_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL OR p_recipient_user_id IS NULL OR p_request_id IS NULL
     OR p_value IS NULL OR char_length(p_value) NOT BETWEEN 1 AND 120
     OR p_value IS DISTINCT FROM btrim(p_value) THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'hanbang:amora-couple-core-criterion:' || p_couple_id::text, 0
  ));
  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND OR v_bride_id IS NULL OR v_groom_id IS NULL
     OR v_bride_id IS NOT DISTINCT FROM v_groom_id
     OR p_recipient_user_id NOT IN (v_bride_id, v_groom_id)
     OR (SELECT count(*) FROM public.profiles AS profile
         WHERE profile.couple_id = p_couple_id AND (
           (profile.id = v_bride_id AND profile.role = 'bride')
           OR (profile.id = v_groom_id AND profile.role = 'groom')
         )) IS DISTINCT FROM 2::bigint THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.amora_couple_core_criterion_proposals AS proposal
  SET state = 'invalidated', closed_at = v_now, updated_at = v_now
  WHERE proposal.couple_id = p_couple_id AND proposal.state = 'pending'
    AND (proposal.bride_user_id IS DISTINCT FROM v_bride_id
         OR proposal.groom_user_id IS DISTINCT FROM v_groom_id);

  SELECT proposal.* INTO v_replay
  FROM public.amora_couple_core_criterion_proposals AS proposal
  WHERE proposal.proposer_user_id = p_recipient_user_id
    AND proposal.created_request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_replay.couple_id IS DISTINCT FROM p_couple_id
       OR v_replay.value IS DISTINCT FROM p_value
       OR v_replay.base_decision_id IS DISTINCT FROM p_expected_current_decision_id THEN
      RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_REQUEST_REUSED' USING ERRCODE = '22023';
    END IF;
    RETURN public.read_amora_couple_core_criterion_v1(p_couple_id, p_recipient_user_id);
  END IF;

  SELECT decision.id INTO v_current_id
  FROM public.decision_nodes AS decision
  WHERE decision.couple_id = p_couple_id
    AND decision.category = 'preference'
    AND decision.decision_type = 'decided'
    AND decision.visibility = 'shared'
    AND decision.source = 'manual'
    AND decision.source_actor_role IS NULL
    AND decision.metadata @> jsonb_build_object(
      'criterion_contract', 'amora_couple_core_criterion_v1',
      'criterion_version', 1,
      'bride_user_id', v_bride_id::text,
      'groom_user_id', v_groom_id::text,
      'acceptance_count', 2,
      'explicit', true
    )
  ORDER BY decision.user_confirmed_at DESC NULLS LAST,
           decision.created_at DESC, decision.id DESC
  LIMIT 1 FOR UPDATE;
  IF v_current_id IS DISTINCT FROM p_expected_current_decision_id THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  SELECT proposal.id INTO v_pending_id
  FROM public.amora_couple_core_criterion_proposals AS proposal
  WHERE proposal.couple_id = p_couple_id AND proposal.state = 'pending'
  LIMIT 1 FOR UPDATE;
  IF v_pending_id IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_PENDING_EXISTS' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.amora_couple_core_criterion_proposals(
    couple_id, proposer_user_id, bride_user_id, groom_user_id, value,
    revision, state, base_decision_id, created_request_id, created_at, updated_at
  ) VALUES (
    p_couple_id, p_recipient_user_id, v_bride_id, v_groom_id, p_value,
    1, 'pending', v_current_id, p_request_id, v_now, v_now
  ) RETURNING id INTO v_proposal_id;
  INSERT INTO public.amora_couple_core_criterion_acceptances(
    proposal_id, couple_id, user_id, request_id, accepted_at
  ) VALUES (v_proposal_id, p_couple_id, p_recipient_user_id, p_request_id, v_now);

  RETURN public.read_amora_couple_core_criterion_v1(p_couple_id, p_recipient_user_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.accept_amora_couple_core_criterion_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_proposal_id uuid,
  p_expected_revision bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_bride_id uuid;
  v_groom_id uuid;
  v_proposal public.amora_couple_core_criterion_proposals%ROWTYPE;
  v_replay_proposal_id uuid;
  v_acceptance_count integer;
  v_acceptances jsonb;
  v_decision_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL OR p_recipient_user_id IS NULL OR p_proposal_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 1 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'hanbang:amora-couple-core-criterion:' || p_couple_id::text, 0
  ));
  SELECT couple.bride_id, couple.groom_id INTO v_bride_id, v_groom_id
  FROM public.couples AS couple WHERE couple.id = p_couple_id FOR UPDATE;
  IF NOT FOUND OR v_bride_id IS NULL OR v_groom_id IS NULL
     OR v_bride_id IS NOT DISTINCT FROM v_groom_id
     OR p_recipient_user_id NOT IN (v_bride_id, v_groom_id)
     OR (SELECT count(*) FROM public.profiles AS profile
         WHERE profile.couple_id = p_couple_id AND (
           (profile.id = v_bride_id AND profile.role = 'bride')
           OR (profile.id = v_groom_id AND profile.role = 'groom')
         )) IS DISTINCT FROM 2::bigint THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;

  SELECT acceptance.proposal_id INTO v_replay_proposal_id
  FROM public.amora_couple_core_criterion_acceptances AS acceptance
  WHERE acceptance.user_id = p_recipient_user_id
    AND acceptance.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_replay_proposal_id IS DISTINCT FROM p_proposal_id THEN
      RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_REQUEST_REUSED' USING ERRCODE = '22023';
    END IF;
    RETURN public.read_amora_couple_core_criterion_v1(p_couple_id, p_recipient_user_id);
  END IF;

  SELECT proposal.* INTO v_proposal
  FROM public.amora_couple_core_criterion_proposals AS proposal
  WHERE proposal.id = p_proposal_id AND proposal.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND OR v_proposal.state IS DISTINCT FROM 'pending'
     OR v_proposal.revision IS DISTINCT FROM p_expected_revision
     OR v_proposal.bride_user_id IS DISTINCT FROM v_bride_id
     OR v_proposal.groom_user_id IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_CONFLICT' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.amora_couple_core_criterion_acceptances AS acceptance
    WHERE acceptance.proposal_id = p_proposal_id
      AND acceptance.user_id = p_recipient_user_id
  ) THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_ALREADY_ACCEPTED' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.amora_couple_core_criterion_acceptances(
    proposal_id, couple_id, user_id, request_id, accepted_at
  ) VALUES (p_proposal_id, p_couple_id, p_recipient_user_id, p_request_id, v_now);

  SELECT count(*)::integer,
         jsonb_agg(jsonb_build_object(
           'userId', acceptance.user_id,
           'acceptedAt', to_char(
             acceptance.accepted_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           )
         ) ORDER BY acceptance.user_id)
  INTO v_acceptance_count, v_acceptances
  FROM public.amora_couple_core_criterion_acceptances AS acceptance
  WHERE acceptance.proposal_id = p_proposal_id
    AND acceptance.couple_id = p_couple_id
    AND acceptance.user_id IN (v_bride_id, v_groom_id);
  IF v_acceptance_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_ACCEPTANCE_INCOMPLETE' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.decision_nodes(
    couple_id, category, decision_type, title, chosen_value,
    options_considered, reasoning, confidence, decided_at, source,
    source_ref_id, metadata, visibility, source_actor_role,
    user_confirmed_at, created_at, updated_at
  ) VALUES (
    p_couple_id, 'preference', 'decided', '우리 기준',
    jsonb_build_object('value', v_proposal.value), '[]'::jsonb,
    '두 사람이 각각 확인한 결혼 준비 기준', 1.00, v_now, 'manual',
    v_proposal.id,
    jsonb_build_object(
      'criterion_contract', 'amora_couple_core_criterion_v1',
      'criterion_version', 1,
      'proposal_id', v_proposal.id::text,
      'bride_user_id', v_bride_id::text,
      'groom_user_id', v_groom_id::text,
      'acceptance_count', 2,
      'acceptances', v_acceptances,
      'explicit', true
    ),
    'shared', NULL, v_now, v_now, v_now
  ) RETURNING id INTO v_decision_id;

  UPDATE public.amora_couple_core_criterion_proposals
  SET state = 'confirmed', confirmed_decision_id = v_decision_id,
      closed_at = v_now, updated_at = v_now, revision = revision + 1
  WHERE id = p_proposal_id;

  RETURN public.read_amora_couple_core_criterion_v1(p_couple_id, p_recipient_user_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.cancel_amora_couple_core_criterion_v1(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_proposal_id uuid,
  p_expected_revision bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_bride_id uuid;
  v_groom_id uuid;
  v_proposal public.amora_couple_core_criterion_proposals%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL OR p_recipient_user_id IS NULL OR p_proposal_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 1 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'hanbang:amora-couple-core-criterion:' || p_couple_id::text, 0
  ));
  SELECT couple.bride_id, couple.groom_id INTO v_bride_id, v_groom_id
  FROM public.couples AS couple WHERE couple.id = p_couple_id FOR UPDATE;
  IF NOT FOUND OR v_bride_id IS NULL OR v_groom_id IS NULL
     OR v_bride_id IS NOT DISTINCT FROM v_groom_id
     OR p_recipient_user_id NOT IN (v_bride_id, v_groom_id)
     OR (SELECT count(*) FROM public.profiles AS profile
         WHERE profile.couple_id = p_couple_id AND (
           (profile.id = v_bride_id AND profile.role = 'bride')
           OR (profile.id = v_groom_id AND profile.role = 'groom')
         )) IS DISTINCT FROM 2::bigint THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;

  SELECT proposal.* INTO v_proposal
  FROM public.amora_couple_core_criterion_proposals AS proposal
  WHERE proposal.id = p_proposal_id AND proposal.couple_id = p_couple_id
  FOR UPDATE;
  IF FOUND AND v_proposal.state = 'cancelled'
     AND v_proposal.cancel_request_id = p_request_id
     AND v_proposal.proposer_user_id = p_recipient_user_id THEN
    RETURN public.read_amora_couple_core_criterion_v1(p_couple_id, p_recipient_user_id);
  END IF;
  IF NOT FOUND OR v_proposal.state IS DISTINCT FROM 'pending'
     OR v_proposal.revision IS DISTINCT FROM p_expected_revision
     OR v_proposal.proposer_user_id IS DISTINCT FROM p_recipient_user_id
     OR v_proposal.bride_user_id IS DISTINCT FROM v_bride_id
     OR v_proposal.groom_user_id IS DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'AMORA_COUPLE_CRITERION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  UPDATE public.amora_couple_core_criterion_proposals
  SET state = 'cancelled', cancel_request_id = p_request_id,
      closed_at = v_now, updated_at = v_now, revision = revision + 1
  WHERE id = p_proposal_id;
  RETURN public.read_amora_couple_core_criterion_v1(p_couple_id, p_recipient_user_id);
END
$function$;

ALTER FUNCTION public.read_amora_couple_core_criterion_v1(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.propose_amora_couple_core_criterion_v1(uuid, uuid, uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.accept_amora_couple_core_criterion_v1(uuid, uuid, uuid, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.cancel_amora_couple_core_criterion_v1(uuid, uuid, uuid, bigint, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.read_amora_couple_core_criterion_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.propose_amora_couple_core_criterion_v1(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_amora_couple_core_criterion_v1(uuid, uuid, uuid, bigint, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_amora_couple_core_criterion_v1(uuid, uuid, uuid, bigint, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_amora_couple_core_criterion_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.propose_amora_couple_core_criterion_v1(uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_amora_couple_core_criterion_v1(uuid, uuid, uuid, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_amora_couple_core_criterion_v1(uuid, uuid, uuid, bigint, uuid) TO service_role;

COMMIT;
