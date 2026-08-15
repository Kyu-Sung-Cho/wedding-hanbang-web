BEGIN;

-- Recipient-private, one-time follow-up for a mediation decision that both
-- current partners explicitly confirmed. This storage boundary is separate
-- from TodayOne and amora_actions by design: one person's answer must never
-- mutate a shared decision, a shared action, or the other person's card.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.amora_mediation_outcome_follow_up_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES public.decision_nodes(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  proposal_version uuid NOT NULL,
  roster_fingerprint text NOT NULL
    CHECK (roster_fingerprint ~ '^[a-f0-9]{32}$'),
  privacy_epoch bigint NOT NULL CHECK (privacy_epoch >= 1),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  outcome_idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready', 'recorded', 'invalidated')),
  eligible_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT amora_mediation_outcome_follow_up_cards_window_check
    CHECK (expires_at > eligible_at),
  CONSTRAINT amora_mediation_outcome_follow_up_cards_owner_source_unique
    UNIQUE (decision_id, recipient_user_id),
  CONSTRAINT amora_mediation_outcome_follow_up_cards_owner_request_unique
    UNIQUE (recipient_user_id, outcome_idempotency_key)
);

CREATE INDEX amora_mediation_outcome_follow_up_cards_ready_idx
  ON public.amora_mediation_outcome_follow_up_cards(
    couple_id, recipient_user_id, state, eligible_at
  );

CREATE TABLE public.amora_mediation_outcome_follow_up_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL UNIQUE
    REFERENCES public.amora_mediation_outcome_follow_up_cards(id) ON DELETE CASCADE,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES public.decision_nodes(id) ON DELETE CASCADE,
  card_revision bigint NOT NULL CHECK (card_revision >= 1),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('resolved', 'changed', 'blocked', 'stop')),
  idempotency_key uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT amora_mediation_outcome_follow_up_receipts_owner_request_unique
    UNIQUE (recipient_user_id, idempotency_key)
);

-- Cross-device safety fence. This row intentionally contains no disclosure,
-- summary, reason, classification, or inferred partner state. `expires_at` is
-- a revalidation deadline only; elapsed time is never treated as proof that a
-- safety concern was resolved. A same-owner/couple hold is never implicitly
-- released by time or a privacy epoch transition; only roster/couple scope
-- exit or a separately reviewed
-- explicit resolution contract may release it.
CREATE TABLE public.amora_mediation_private_safety_holds (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  privacy_epoch bigint NOT NULL CHECK (privacy_epoch >= 1),
  version smallint NOT NULL DEFAULT 1 CHECK (version = 1),
  active boolean NOT NULL DEFAULT true CHECK (active = true),
  expires_at timestamptz NOT NULL,
  sealed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (couple_id, recipient_user_id),
  CONSTRAINT amora_mediation_private_safety_holds_expiry_check
    CHECK (expires_at > sealed_at)
);

CREATE OR REPLACE FUNCTION public.seal_amora_mediation_follow_up_safety_marker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
BEGIN
  IF (NEW.metadata -> 'mediation_follow_up_safety')
       IS DISTINCT FROM (OLD.metadata -> 'mediation_follow_up_safety')
     AND (
       OLD.metadata ? 'mediation_follow_up_safety'
       OR NEW.metadata ? 'mediation_follow_up_safety'
     ) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_SAFETY_MARKER_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_seal_amora_mediation_follow_up_safety_marker
  ON public.chat_messages;
CREATE TRIGGER trg_seal_amora_mediation_follow_up_safety_marker
  BEFORE UPDATE OF metadata ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.seal_amora_mediation_follow_up_safety_marker();

ALTER TABLE public.amora_mediation_outcome_follow_up_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_mediation_outcome_follow_up_cards FORCE ROW LEVEL SECURITY;
ALTER TABLE public.amora_mediation_outcome_follow_up_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_mediation_outcome_follow_up_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.amora_mediation_private_safety_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_mediation_private_safety_holds FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.amora_mediation_outcome_follow_up_cards
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.amora_mediation_outcome_follow_up_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.amora_mediation_private_safety_holds
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.amora_mediation_outcome_follow_up_cards TO service_role;
GRANT ALL ON TABLE public.amora_mediation_outcome_follow_up_receipts TO service_role;
GRANT ALL ON TABLE public.amora_mediation_private_safety_holds TO service_role;

CREATE POLICY amora_mediation_outcome_follow_up_cards_service_all
  ON public.amora_mediation_outcome_follow_up_cards
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
CREATE POLICY amora_mediation_outcome_follow_up_receipts_service_all
  ON public.amora_mediation_outcome_follow_up_receipts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
CREATE POLICY amora_mediation_private_safety_holds_service_all
  ON public.amora_mediation_private_safety_holds
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.seal_amora_mediation_private_safety_hold(
  p_couple_id uuid,
  p_recipient_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_privacy_epoch bigint;
  v_hold public.amora_mediation_private_safety_holds%ROWTYPE;
BEGIN
  IF p_couple_id IS NULL OR p_recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PRIVATE_SAFETY_HOLD_CONTEXT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'hanbang:mediation-follow-up:' || p_couple_id::text || ':' ||
      p_recipient_user_id::text,
      0
    )
  );

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
    AND p_recipient_user_id IN (couple.bride_id, couple.groom_id)
  FOR UPDATE;
  IF NOT FOUND
     OR v_bride_id IS NULL
     OR v_groom_id IS NULL
     OR v_bride_id IS NOT DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PRIVATE_SAFETY_HOLD_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role = 'bride' AND profile.id = v_bride_id)
      OR (profile.role = 'groom' AND profile.id = v_groom_id)
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PRIVATE_SAFETY_HOLD_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT epoch.epoch INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs AS epoch
  WHERE epoch.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_privacy_epoch < 1 THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PRIVATE_SAFETY_HOLD_PRIVACY_UNAVAILABLE'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.amora_mediation_private_safety_holds(
    couple_id,
    recipient_user_id,
    privacy_epoch,
    version,
    active,
    expires_at
  ) VALUES (
    p_couple_id,
    p_recipient_user_id,
    v_privacy_epoch,
    1,
    true,
    clock_timestamp() + interval '31 days'
  )
  ON CONFLICT (couple_id, recipient_user_id) DO UPDATE
  SET privacy_epoch = EXCLUDED.privacy_epoch,
      version = 1,
      active = true,
      expires_at = CASE
        WHEN public.amora_mediation_private_safety_holds.privacy_epoch
             = EXCLUDED.privacy_epoch
          THEN GREATEST(
            public.amora_mediation_private_safety_holds.expires_at,
            EXCLUDED.expires_at
          )
        ELSE EXCLUDED.expires_at
      END,
      updated_at = clock_timestamp()
  RETURNING * INTO v_hold;

  RETURN jsonb_build_object(
    'version', v_hold.version,
    'recipientUserId', v_hold.recipient_user_id,
    'coupleId', v_hold.couple_id,
    'privacyEpoch', v_hold.privacy_epoch,
    'active', v_hold.active,
    'expiresAt', v_hold.expires_at
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.amora_mediation_private_safety_hold_active(
  p_couple_id uuid,
  p_recipient_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '30s'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.amora_mediation_private_safety_holds AS hold
    WHERE hold.couple_id = p_couple_id
      AND hold.recipient_user_id = p_recipient_user_id
      AND hold.version = 1
      AND hold.active = true
  )
$function$;

CREATE OR REPLACE FUNCTION public.amora_mediation_outcome_follow_up_source_digest(
  p_decision_id uuid,
  p_source_message_id uuid,
  p_proposal_version uuid,
  p_roster_fingerprint text,
  p_recipient_user_id uuid,
  p_eligible_at timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, extensions
AS $function$
  SELECT encode(
    extensions.digest(
      convert_to(
        concat_ws(
          '|',
          'v1',
          p_decision_id::text,
          p_source_message_id::text,
          p_proposal_version::text,
          p_roster_fingerprint,
          p_recipient_user_id::text,
          to_char(
            p_eligible_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$function$;

CREATE OR REPLACE FUNCTION public.amora_mediation_outcome_follow_up_provenance_valid(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_decision_id uuid,
  p_source_message_id uuid,
  p_proposal_version uuid,
  p_roster_fingerprint text,
  p_expected_source_digest text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET statement_timeout = '30s'
AS $function$
  WITH roster AS (
    SELECT couple.bride_id, couple.groom_id,
           md5(
             COALESCE(couple.bride_id::text, '-') || ':' ||
             COALESCE(couple.groom_id::text, '-')
           ) AS fingerprint
    FROM public.couples AS couple
    WHERE couple.id = p_couple_id
      AND couple.bride_id IS NOT NULL
      AND couple.groom_id IS NOT NULL
      AND couple.bride_id IS DISTINCT FROM couple.groom_id
      AND p_recipient_user_id IN (couple.bride_id, couple.groom_id)
  ), canonical AS (
    SELECT decision.decided_at,
           decision.decided_at + interval '24 hours' AS eligible_at,
           message.metadata #>> '{mediation,resolution}' AS resolution
    FROM public.decision_nodes AS decision
    JOIN public.chat_messages AS message
      ON message.id = decision.source_ref_id
     AND message.id = p_source_message_id
     AND message.couple_id = decision.couple_id
    JOIN roster ON roster.fingerprint = p_roster_fingerprint
    JOIN public.profiles AS profile
      ON profile.id = p_recipient_user_id
     AND profile.couple_id = p_couple_id
     AND (
       (profile.role = 'bride' AND profile.id = roster.bride_id)
       OR (profile.role = 'groom' AND profile.id = roster.groom_id)
     )
    JOIN public.amora_privacy_context_epochs AS epoch
      ON epoch.couple_id = p_couple_id
     AND epoch.epoch = p_expected_privacy_epoch
    WHERE decision.id = p_decision_id
      AND decision.couple_id = p_couple_id
      AND decision.category = 'conflict_resolution'
      AND decision.decision_type = 'decided'
      AND decision.source = 'chat'
      AND decision.visibility = 'shared'
      AND decision.superseded_at IS NULL
      AND decision.decided_at <= clock_timestamp() - interval '24 hours'
      AND decision.decided_at > clock_timestamp() - interval '31 days'
      AND decision.metadata ->> 'confirmed_by_both' = 'true'
      AND decision.metadata ->> 'acceptance_count' = '2'
      AND decision.metadata ->> 'proposal_version' = p_proposal_version::text
      AND decision.metadata ->> 'roster_fingerprint' = p_roster_fingerprint
      AND message.sender_type = 'ai'
      AND message.role = 'assistant'
      AND message.visibility = 'shared'
      AND message.metadata #>> '{mediation,proposalVersion}' = p_proposal_version::text
      AND message.metadata #>> '{mediation,rosterFingerprint}' = p_roster_fingerprint
      AND message.metadata -> 'mediation_follow_up_safety' = jsonb_build_object(
        'version', 1,
        'violence', false,
        'coercion', false,
        'privateSafetyHold', false,
        'contextComplete', true
      )
  )
  SELECT EXISTS (
    SELECT 1
    FROM canonical
    WHERE canonical.resolution IS NOT NULL
      AND char_length(canonical.resolution) BETWEEN 1 AND 500
      AND public.amora_mediation_outcome_follow_up_source_digest(
        p_decision_id,
        p_source_message_id,
        p_proposal_version,
        p_roster_fingerprint,
        p_recipient_user_id,
        canonical.eligible_at
      ) = p_expected_source_digest
      AND (
        SELECT count(DISTINCT acceptance.user_id)
        FROM public.amora_mediation_acceptances AS acceptance
        JOIN roster ON acceptance.user_id IN (roster.bride_id, roster.groom_id)
        WHERE acceptance.couple_id = p_couple_id
          AND acceptance.message_id = p_source_message_id
          AND acceptance.proposal_version = p_proposal_version
          AND acceptance.proposal_roster_fingerprint = p_roster_fingerprint
          AND acceptance.proposal_resolution = canonical.resolution
      ) = 2
      AND NOT public.amora_mediation_private_safety_hold_active(
        p_couple_id,
        p_recipient_user_id
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.amora_mediation_outcome_follow_up_card_response(
  p_card public.amora_mediation_outcome_follow_up_cards
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'version', 1,
    'state', 'ready',
    'recipientUserId', p_card.recipient_user_id,
    'coupleId', p_card.couple_id,
    'card', jsonb_build_object(
      'id', p_card.id,
      'revision', p_card.revision,
      'sourceDigest', p_card.source_digest,
      'outcomeIdempotencyKey', p_card.outcome_idempotency_key,
      'kind', 'mediation_outcome_follow_up',
      'visibility', 'private',
      'title', '둘이 확인한 조율, 지금은 어떤가요?',
      'question', '지금 그 조율은 어떻게 되었나요?',
      'confirmed', jsonb_build_array('두 분이 직접 확인한 조율안이 있어요.'),
      'unknown', jsonb_build_array('지금 실제 결과는 아직 확인하지 않았어요.'),
      'impact', '내 선택은 나에게만 보이며 공동 기록이나 상대 카드에는 영향을 주지 않아요.',
      'choices', jsonb_build_array(
        jsonb_build_object('outcome', 'resolved', 'label', '이제 괜찮아졌어요'),
        jsonb_build_object('outcome', 'changed', 'label', '상황이 달라졌어요'),
        jsonb_build_object('outcome', 'blocked', 'label', '아직 막혀 있어요'),
        jsonb_build_object('outcome', 'stop', 'label', '여기서 멈출게요')
      ),
      'safeguards', jsonb_build_object(
        'automaticSharedMutation', false,
        'automaticRemediation', false
      ),
      'eligibleAt', p_card.eligible_at,
      'expiresAt', p_card.expires_at
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.claim_amora_mediation_outcome_follow_up(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_candidate_decision_id uuid,
  p_expected_source_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_card public.amora_mediation_outcome_follow_up_cards%ROWTYPE;
  v_decision public.decision_nodes%ROWTYPE;
  v_source public.chat_messages%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_proposal_version uuid;
  v_eligible_at timestamptz;
BEGIN
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_expected_privacy_epoch < 1
     OR p_expected_source_digest !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CONTEXT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'hanbang:mediation-follow-up:' || p_couple_id::text || ':' ||
      p_recipient_user_id::text,
      0
    )
  );

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
    AND p_recipient_user_id IN (couple.bride_id, couple.groom_id)
  FOR UPDATE;
  IF NOT FOUND
     OR v_bride_id IS NULL
     OR v_groom_id IS NULL
     OR v_bride_id IS NOT DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  v_roster_fingerprint := md5(v_bride_id::text || ':' || v_groom_id::text);

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role = 'bride' AND profile.id = v_bride_id)
      OR (profile.role = 'groom' AND profile.id = v_groom_id)
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.amora_privacy_context_epochs AS epoch
  WHERE epoch.couple_id = p_couple_id
    AND epoch.epoch = p_expected_privacy_epoch
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.amora_mediation_private_safety_holds AS hold
  WHERE hold.couple_id = p_couple_id
    AND hold.recipient_user_id = p_recipient_user_id
    AND hold.version = 1
    AND hold.active = true
  FOR SHARE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'version', 1,
      'state', 'none',
      'recipientUserId', p_recipient_user_id,
      'coupleId', p_couple_id
    );
  END IF;

  IF p_candidate_decision_id IS NULL THEN
    RETURN jsonb_build_object(
      'version', 1,
      'state', 'none',
      'recipientUserId', p_recipient_user_id,
      'coupleId', p_couple_id
    );
  END IF;

  SELECT * INTO v_decision
  FROM public.decision_nodes AS decision
  WHERE decision.id = p_candidate_decision_id
    AND decision.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND
     OR v_decision.source_ref_id IS NULL
     OR COALESCE(v_decision.metadata ->> 'proposal_version', '')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object(
      'version', 1,
      'state', 'none',
      'recipientUserId', p_recipient_user_id,
      'coupleId', p_couple_id
    );
  END IF;
  v_proposal_version := (v_decision.metadata ->> 'proposal_version')::uuid;
  v_eligible_at := v_decision.decided_at + interval '24 hours';

  SELECT * INTO v_source
  FROM public.chat_messages AS message
  WHERE message.id = v_decision.source_ref_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'version', 1,
      'state', 'none',
      'recipientUserId', p_recipient_user_id,
      'coupleId', p_couple_id
    );
  END IF;

  PERFORM 1
  FROM public.amora_mediation_acceptances AS acceptance
  WHERE acceptance.couple_id = p_couple_id
    AND acceptance.message_id = v_source.id
    AND acceptance.proposal_version = v_proposal_version
    AND acceptance.proposal_roster_fingerprint = v_roster_fingerprint
  ORDER BY acceptance.user_id
  FOR SHARE;

  IF NOT public.amora_mediation_outcome_follow_up_provenance_valid(
    p_couple_id,
    p_recipient_user_id,
    p_expected_privacy_epoch,
    v_decision.id,
    v_source.id,
    v_proposal_version,
    v_roster_fingerprint,
    p_expected_source_digest
  ) THEN
    RETURN jsonb_build_object(
      'version', 1,
      'state', 'none',
      'recipientUserId', p_recipient_user_id,
      'coupleId', p_couple_id
    );
  END IF;

  SELECT * INTO v_card
  FROM public.amora_mediation_outcome_follow_up_cards AS card
  WHERE card.decision_id = v_decision.id
    AND card.recipient_user_id = p_recipient_user_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_card.state = 'ready'
       AND v_card.expires_at > clock_timestamp()
       AND v_card.privacy_epoch = p_expected_privacy_epoch
       AND v_card.roster_fingerprint = v_roster_fingerprint
       AND v_card.source_digest = p_expected_source_digest THEN
      RETURN public.amora_mediation_outcome_follow_up_card_response(v_card);
    END IF;
    RETURN jsonb_build_object(
      'version', 1,
      'state', 'none',
      'recipientUserId', p_recipient_user_id,
      'coupleId', p_couple_id
    );
  END IF;

  INSERT INTO public.amora_mediation_outcome_follow_up_cards(
    couple_id,
    recipient_user_id,
    decision_id,
    source_message_id,
    proposal_version,
    roster_fingerprint,
    privacy_epoch,
    source_digest,
    eligible_at,
    expires_at
  ) VALUES (
    p_couple_id,
    p_recipient_user_id,
    v_decision.id,
    v_source.id,
    v_proposal_version,
    v_roster_fingerprint,
    p_expected_privacy_epoch,
    p_expected_source_digest,
    v_eligible_at,
    v_eligible_at + interval '30 days'
  )
  RETURNING * INTO v_card;

  RETURN public.amora_mediation_outcome_follow_up_card_response(v_card);
END
$function$;

CREATE OR REPLACE FUNCTION public.amora_mediation_outcome_follow_up_receipt_response(
  p_receipt public.amora_mediation_outcome_follow_up_receipts
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'version', 1,
    'recipientUserId', p_receipt.recipient_user_id,
    'coupleId', p_receipt.couple_id,
    'receipt', jsonb_build_object(
      'id', p_receipt.id,
      'cardId', p_receipt.card_id,
      'cardRevision', p_receipt.card_revision,
      'sourceDigest', p_receipt.source_digest,
      'outcome', p_receipt.outcome,
      'recordedAt', p_receipt.recorded_at,
      'idempotencyKey', p_receipt.idempotency_key
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.record_amora_mediation_outcome_follow_up(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_card_id uuid,
  p_expected_card_revision bigint,
  p_expected_source_digest text,
  p_outcome text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_card public.amora_mediation_outcome_follow_up_cards%ROWTYPE;
  v_saved public.amora_mediation_outcome_follow_up_receipts%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_decision_id uuid;
  v_source_message_id uuid;
  v_proposal_version uuid;
BEGIN
  IF p_expected_privacy_epoch < 1
     OR p_expected_card_revision < 1
     OR p_expected_source_digest !~ '^[a-f0-9]{64}$'
     OR p_outcome NOT IN ('resolved', 'changed', 'blocked', 'stop')
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_OUTCOME_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'hanbang:mediation-follow-up:' || p_couple_id::text || ':' ||
      p_recipient_user_id::text,
      0
    )
  );

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
    AND p_recipient_user_id IN (couple.bride_id, couple.groom_id)
  FOR UPDATE;
  IF NOT FOUND
     OR v_bride_id IS NULL
     OR v_groom_id IS NULL
     OR v_bride_id IS NOT DISTINCT FROM v_groom_id THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  v_roster_fingerprint := md5(v_bride_id::text || ':' || v_groom_id::text);

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role = 'bride' AND profile.id = v_bride_id)
      OR (profile.role = 'groom' AND profile.id = v_groom_id)
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.amora_privacy_context_epochs AS epoch
  WHERE epoch.couple_id = p_couple_id
    AND epoch.epoch = p_expected_privacy_epoch
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.amora_mediation_private_safety_holds AS hold
  WHERE hold.couple_id = p_couple_id
    AND hold.recipient_user_id = p_recipient_user_id
    AND hold.version = 1
    AND hold.active = true
  FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT lookup.decision_id, lookup.source_message_id, lookup.proposal_version
    INTO v_decision_id, v_source_message_id, v_proposal_version
  FROM public.amora_mediation_outcome_follow_up_cards AS lookup
  WHERE lookup.id = p_card_id
    AND lookup.couple_id = p_couple_id
    AND lookup.recipient_user_id = p_recipient_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CARD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.decision_nodes AS decision
  WHERE decision.id = v_decision_id
    AND decision.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.chat_messages AS message
  WHERE message.id = v_source_message_id
    AND message.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.amora_mediation_acceptances AS acceptance
  WHERE acceptance.couple_id = p_couple_id
    AND acceptance.message_id = v_source_message_id
    AND acceptance.proposal_version = v_proposal_version
    AND acceptance.proposal_roster_fingerprint = v_roster_fingerprint
  ORDER BY acceptance.user_id
  FOR SHARE;

  SELECT * INTO v_card
  FROM public.amora_mediation_outcome_follow_up_cards AS card
  WHERE card.id = p_card_id
    AND card.couple_id = p_couple_id
    AND card.recipient_user_id = p_recipient_user_id
    AND card.decision_id = v_decision_id
    AND card.source_message_id = v_source_message_id
    AND card.proposal_version = v_proposal_version
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CARD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.amora_mediation_outcome_follow_up_provenance_valid(
    p_couple_id,
    p_recipient_user_id,
    p_expected_privacy_epoch,
    v_card.decision_id,
    v_card.source_message_id,
    v_card.proposal_version,
    v_roster_fingerprint,
    v_card.source_digest
  ) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_saved
  FROM public.amora_mediation_outcome_follow_up_receipts AS receipt
  WHERE receipt.recipient_user_id = p_recipient_user_id
    AND receipt.idempotency_key = p_idempotency_key
  FOR SHARE;
  IF FOUND THEN
    IF v_saved.card_id = p_card_id
       AND v_saved.card_revision = p_expected_card_revision
       AND v_saved.source_digest = p_expected_source_digest
       AND v_saved.outcome = p_outcome THEN
      RETURN public.amora_mediation_outcome_follow_up_receipt_response(v_saved);
    END IF;
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_IDEMPOTENCY_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  IF v_card.state <> 'ready'
     OR v_card.expires_at <= clock_timestamp()
     OR v_card.revision <> p_expected_card_revision
     OR v_card.source_digest <> p_expected_source_digest
     OR v_card.outcome_idempotency_key <> p_idempotency_key
     OR v_card.privacy_epoch <> p_expected_privacy_epoch
     OR v_card.roster_fingerprint <> v_roster_fingerprint THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.amora_mediation_outcome_follow_up_receipts(
    card_id,
    couple_id,
    recipient_user_id,
    decision_id,
    card_revision,
    source_digest,
    outcome,
    idempotency_key
  ) VALUES (
    v_card.id,
    v_card.couple_id,
    v_card.recipient_user_id,
    v_card.decision_id,
    v_card.revision,
    v_card.source_digest,
    p_outcome,
    p_idempotency_key
  )
  RETURNING * INTO v_saved;

  UPDATE public.amora_mediation_outcome_follow_up_cards
  SET state = 'recorded',
      recorded_at = v_saved.recorded_at,
      updated_at = clock_timestamp()
  WHERE id = v_card.id
    AND state = 'ready'
    AND revision = p_expected_card_revision
    AND source_digest = p_expected_source_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  RETURN public.amora_mediation_outcome_follow_up_receipt_response(v_saved);
END
$function$;

CREATE OR REPLACE FUNCTION public.read_amora_mediation_outcome_follow_up_receipt(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_saved public.amora_mediation_outcome_follow_up_receipts%ROWTYPE;
  v_card public.amora_mediation_outcome_follow_up_cards%ROWTYPE;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_card_id uuid;
  v_decision_id uuid;
  v_source_message_id uuid;
  v_proposal_version uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'hanbang:mediation-follow-up:' || p_couple_id::text || ':' ||
      p_recipient_user_id::text,
      0
    )
  );

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
    AND p_recipient_user_id IN (couple.bride_id, couple.groom_id)
  FOR UPDATE;
  IF NOT FOUND OR v_bride_id IS NULL OR v_groom_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  v_roster_fingerprint := md5(v_bride_id::text || ':' || v_groom_id::text);

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role = 'bride' AND profile.id = v_bride_id)
      OR (profile.role = 'groom' AND profile.id = v_groom_id)
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.amora_privacy_context_epochs AS epoch
  WHERE epoch.couple_id = p_couple_id
    AND epoch.epoch = p_expected_privacy_epoch
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.amora_mediation_private_safety_holds AS hold
  WHERE hold.couple_id = p_couple_id
    AND hold.recipient_user_id = p_recipient_user_id
    AND hold.version = 1
    AND hold.active = true
  FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT receipt.card_id INTO v_card_id
  FROM public.amora_mediation_outcome_follow_up_receipts AS receipt
  WHERE receipt.couple_id = p_couple_id
    AND receipt.recipient_user_id = p_recipient_user_id
    AND receipt.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT lookup.decision_id, lookup.source_message_id, lookup.proposal_version
    INTO v_decision_id, v_source_message_id, v_proposal_version
  FROM public.amora_mediation_outcome_follow_up_cards AS lookup
  WHERE lookup.id = v_card_id
    AND lookup.couple_id = p_couple_id
    AND lookup.recipient_user_id = p_recipient_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM 1
  FROM public.decision_nodes AS decision
  WHERE decision.id = v_decision_id
    AND decision.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM 1
  FROM public.chat_messages AS message
  WHERE message.id = v_source_message_id
    AND message.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM 1
  FROM public.amora_mediation_acceptances AS acceptance
  WHERE acceptance.couple_id = p_couple_id
    AND acceptance.message_id = v_source_message_id
    AND acceptance.proposal_version = v_proposal_version
    AND acceptance.proposal_roster_fingerprint = v_roster_fingerprint
  ORDER BY acceptance.user_id
  FOR SHARE;

  SELECT * INTO v_card
  FROM public.amora_mediation_outcome_follow_up_cards AS card
  WHERE card.id = v_card_id
    AND card.couple_id = p_couple_id
    AND card.recipient_user_id = p_recipient_user_id
    AND card.decision_id = v_decision_id
    AND card.source_message_id = v_source_message_id
    AND card.proposal_version = v_proposal_version
  FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT receipt.* INTO v_saved
  FROM public.amora_mediation_outcome_follow_up_receipts AS receipt
  WHERE receipt.card_id = v_card.id
    AND receipt.couple_id = p_couple_id
    AND receipt.recipient_user_id = p_recipient_user_id
    AND receipt.idempotency_key = p_idempotency_key
  FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_card.privacy_epoch <> p_expected_privacy_epoch
     OR v_card.roster_fingerprint <> v_roster_fingerprint
     OR NOT public.amora_mediation_outcome_follow_up_provenance_valid(
       p_couple_id,
       p_recipient_user_id,
       p_expected_privacy_epoch,
       v_card.decision_id,
       v_card.source_message_id,
       v_card.proposal_version,
       v_roster_fingerprint,
       v_card.source_digest
     ) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_FOLLOW_UP_CONTEXT_STALE'
      USING ERRCODE = '40001';
  END IF;

  RETURN public.amora_mediation_outcome_follow_up_receipt_response(v_saved);
END
$function$;

ALTER FUNCTION public.amora_mediation_outcome_follow_up_source_digest(
  uuid, uuid, uuid, text, uuid, timestamptz
) OWNER TO postgres;
ALTER FUNCTION public.seal_amora_mediation_follow_up_safety_marker()
  OWNER TO postgres;
ALTER FUNCTION public.seal_amora_mediation_private_safety_hold(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.amora_mediation_private_safety_hold_active(
  uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.amora_mediation_outcome_follow_up_provenance_valid(
  uuid, uuid, bigint, uuid, uuid, uuid, text, text
) OWNER TO postgres;
ALTER FUNCTION public.amora_mediation_outcome_follow_up_card_response(
  public.amora_mediation_outcome_follow_up_cards
) OWNER TO postgres;
ALTER FUNCTION public.claim_amora_mediation_outcome_follow_up(
  uuid, uuid, bigint, uuid, text
) OWNER TO postgres;
ALTER FUNCTION public.amora_mediation_outcome_follow_up_receipt_response(
  public.amora_mediation_outcome_follow_up_receipts
) OWNER TO postgres;
ALTER FUNCTION public.record_amora_mediation_outcome_follow_up(
  uuid, uuid, bigint, uuid, bigint, text, text, uuid
) OWNER TO postgres;
ALTER FUNCTION public.read_amora_mediation_outcome_follow_up_receipt(
  uuid, uuid, bigint, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.amora_mediation_outcome_follow_up_source_digest(
  uuid, uuid, uuid, text, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.seal_amora_mediation_follow_up_safety_marker()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.seal_amora_mediation_private_safety_hold(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_mediation_private_safety_hold_active(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_mediation_outcome_follow_up_provenance_valid(
  uuid, uuid, bigint, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_mediation_outcome_follow_up_card_response(
  public.amora_mediation_outcome_follow_up_cards
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_amora_mediation_outcome_follow_up(
  uuid, uuid, bigint, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_mediation_outcome_follow_up_receipt_response(
  public.amora_mediation_outcome_follow_up_receipts
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_amora_mediation_outcome_follow_up(
  uuid, uuid, bigint, uuid, bigint, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_amora_mediation_outcome_follow_up_receipt(
  uuid, uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_amora_mediation_outcome_follow_up(
  uuid, uuid, bigint, uuid, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.seal_amora_mediation_private_safety_hold(
  uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_amora_mediation_outcome_follow_up(
  uuid, uuid, bigint, uuid, bigint, text, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_amora_mediation_outcome_follow_up_receipt(
  uuid, uuid, bigint, uuid
) TO service_role;

COMMENT ON TABLE public.amora_mediation_outcome_follow_up_cards IS
  'Service-only recipient-private mediation outcome cards. Never shared and never backed by amora_actions or TodayOne rows.';
COMMENT ON TABLE public.amora_mediation_outcome_follow_up_receipts IS
  'Bounded recipient-private outcomes only; stores no raw chat, requester summary, free text, or inferred partner state.';
COMMENT ON TABLE public.amora_mediation_private_safety_holds IS
  'Opaque owner/couple/privacy-epoch safety fence only. Expiry requests revalidation and never proves resolution; no clear RPC exists.';

COMMIT;
