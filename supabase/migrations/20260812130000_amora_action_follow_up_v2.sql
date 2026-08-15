BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.amora_actions
  ADD COLUMN IF NOT EXISTS follow_up_revision bigint NOT NULL DEFAULT 1;

ALTER TABLE public.amora_actions
  DROP CONSTRAINT IF EXISTS amora_actions_follow_up_revision_check;
ALTER TABLE public.amora_actions
  ADD CONSTRAINT amora_actions_follow_up_revision_check
    CHECK (follow_up_revision >= 1) NOT VALID;
ALTER TABLE public.amora_actions
  VALIDATE CONSTRAINT amora_actions_follow_up_revision_check;

CREATE OR REPLACE FUNCTION public.bump_amora_action_follow_up_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF ROW(
    NEW.title, NEW.description, NEW.due_date, NEW.category_key, NEW.priority,
    NEW.status, NEW.source, NEW.href, NEW.metadata
  ) IS DISTINCT FROM ROW(
    OLD.title, OLD.description, OLD.due_date, OLD.category_key, OLD.priority,
    OLD.status, OLD.source, OLD.href, OLD.metadata
  ) THEN
    NEW.follow_up_revision := OLD.follow_up_revision + 1;
  ELSE
    NEW.follow_up_revision := OLD.follow_up_revision;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS bump_amora_action_follow_up_revision ON public.amora_actions;
CREATE TRIGGER bump_amora_action_follow_up_revision
  BEFORE UPDATE ON public.amora_actions
  FOR EACH ROW EXECUTE FUNCTION public.bump_amora_action_follow_up_revision();

CREATE TABLE public.amora_action_follow_up_cards_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_id text NOT NULL REFERENCES public.amora_actions(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  source_revision bigint NOT NULL CHECK (source_revision >= 1),
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  privacy_epoch bigint NOT NULL CHECK (privacy_epoch >= 1),
  claimed_for_date date NOT NULL,
  outcome_idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready', 'consumed', 'deferred')),
  eligible_again_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consumed_at timestamptz,
  UNIQUE (recipient_user_id, action_id, source_revision),
  UNIQUE (recipient_user_id, outcome_idempotency_key),
  UNIQUE (couple_id, recipient_user_id, claimed_for_date),
  CHECK ((state = 'ready' AND consumed_at IS NULL)
    OR (state <> 'ready' AND consumed_at IS NOT NULL))
);

CREATE INDEX amora_action_follow_up_cards_v2_ready_idx
  ON public.amora_action_follow_up_cards_v2(
    recipient_user_id, state, eligible_again_at, created_at
  );

CREATE TABLE public.amora_action_follow_up_outcomes_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.amora_action_follow_up_cards_v2(id)
    ON DELETE RESTRICT,
  action_id text NOT NULL REFERENCES public.amora_actions(id) ON DELETE RESTRICT,
  card_revision bigint NOT NULL CHECK (card_revision >= 1),
  source_revision bigint NOT NULL CHECK (source_revision >= 1),
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  privacy_epoch bigint NOT NULL CHECK (privacy_epoch >= 1),
  outcome text NOT NULL CHECK (
    outcome IN ('completed', 'blocked', 'changed', 'not_sure')
  ),
  blocker_code text CHECK (
    blocker_code IS NULL
    OR blocker_code IN ('time', 'partner_check', 'missing_info', 'other')
  ),
  action_status text NOT NULL CHECK (
    action_status IN ('open', 'done', 'dismissed')
  ),
  action_revision bigint NOT NULL CHECK (action_revision >= 1),
  idempotency_key uuid NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (recipient_user_id, idempotency_key),
  CHECK ((outcome = 'blocked') = (blocker_code IS NOT NULL)),
  CHECK (
    (outcome = 'completed' AND action_status = 'done')
    OR (outcome IN ('blocked', 'changed', 'not_sure') AND action_status = 'open')
  )
);

ALTER TABLE public.amora_action_follow_up_cards_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_action_follow_up_outcomes_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_action_follow_up_cards_v2 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.amora_action_follow_up_outcomes_v2 FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.amora_action_follow_up_cards_v2
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.amora_action_follow_up_outcomes_v2
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.amora_action_follow_up_cards_v2 TO service_role;
GRANT ALL ON TABLE public.amora_action_follow_up_outcomes_v2 TO service_role;

CREATE POLICY amora_action_follow_up_cards_v2_service_all
  ON public.amora_action_follow_up_cards_v2
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY amora_action_follow_up_outcomes_v2_service_all
  ON public.amora_action_follow_up_outcomes_v2
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- v1 and v2 use different card tables. Serialize the actual v1 INSERT against
-- the v2 claim transaction so two mixed-version requests cannot both observe
-- an empty day and create two cards. The trigger is additive: the frozen v1
-- compiler remains byte-for-byte unchanged.
CREATE OR REPLACE FUNCTION public.enforce_amora_today_one_v1_v2_daily_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.couple_id IS NOT DISTINCT FROM OLD.couple_id
     AND NEW.recipient_user_id IS NOT DISTINCT FROM OLD.recipient_user_id
     AND NEW.claimed_for_date IS NOT DISTINCT FROM OLD.claimed_for_date THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'amora-today-one-daily-v1-v2:'
      || NEW.couple_id::text || ':'
      || NEW.recipient_user_id::text || ':'
      || NEW.claimed_for_date::text,
    0
  ));
  IF EXISTS (
    SELECT 1
    FROM public.amora_action_follow_up_cards_v2 AS card
    WHERE card.couple_id = NEW.couple_id
      AND card.recipient_user_id = NEW.recipient_user_id
      AND card.claimed_for_date = NEW.claimed_for_date
  ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DAILY_LIMIT_V2'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS enforce_amora_today_one_v1_v2_daily_claim
  ON public.amora_today_one_recipient_states;
CREATE TRIGGER enforce_amora_today_one_v1_v2_daily_claim
  BEFORE INSERT OR UPDATE ON public.amora_today_one_recipient_states
  FOR EACH ROW EXECUTE FUNCTION public.enforce_amora_today_one_v1_v2_daily_claim();

CREATE OR REPLACE FUNCTION public.amora_action_follow_up_digest_v2(
  p_action public.amora_actions
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, extensions
AS $function$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'id', p_action.id,
    'coupleId', p_action.couple_id,
    'title', p_action.title,
    'description', p_action.description,
    'dueDate', p_action.due_date,
    'categoryKey', p_action.category_key,
    'priority', p_action.priority,
    'status', p_action.status,
    'source', p_action.source,
    'href', p_action.href,
    'metadata', p_action.metadata,
    'revision', p_action.follow_up_revision
  )::text, 'UTF8'), 'sha256'), 'hex')
$function$;

CREATE OR REPLACE FUNCTION public.amora_action_follow_up_due_date_v2(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $function$
DECLARE
  v_date date;
BEGIN
  IF p_value !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_date := p_value::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RETURN NULL;
  END;
  IF to_char(v_date, 'YYYY-MM-DD') IS DISTINCT FROM p_value THEN
    RETURN NULL;
  END IF;
  RETURN v_date;
END
$function$;

CREATE OR REPLACE FUNCTION public.amora_action_follow_up_card_response_v2(
  p_card public.amora_action_follow_up_cards_v2,
  p_action public.amora_actions
)
RETURNS jsonb
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'version', 2,
    'state', 'ready',
    'recipientUserId', p_card.recipient_user_id,
    'card', jsonb_build_object(
      'id', p_card.id,
      'revision', p_card.revision,
      'sourceRevision', p_card.source_revision,
      'sourceDigest', p_card.source_digest,
      'outcomeIdempotencyKey', p_card.outcome_idempotency_key,
      'kind', 'action_follow_up',
      'title', p_action.title,
      'whyNow', '아모라와 정한 준비 한 가지가 지금 어떻게 됐는지 확인해 주세요.',
      'confirmed', jsonb_build_array('할 일: ' || p_action.title),
      'unknown', '[]'::jsonb,
      'impact', '선택한 상태만 기록하며 다른 준비 내용은 바꾸지 않아요.',
      'choices', jsonb_build_array(
        jsonb_build_object('outcome', 'completed', 'label', '완료했어요'),
        jsonb_build_object('outcome', 'blocked', 'label', '막혀 있어요'),
        jsonb_build_object('outcome', 'changed', 'label', '계획이 바뀌었어요'),
        jsonb_build_object('outcome', 'not_sure', 'label', '아직 모르겠어요')
      ),
      'expiresAt', p_card.expires_at
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.claim_amora_action_follow_up_v2(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now AT TIME ZONE 'Asia/Seoul')::date;
  v_expires_at timestamptz :=
    ((v_now AT TIME ZONE 'Asia/Seoul')::date + 1)::timestamp
      AT TIME ZONE 'Asia/Seoul';
  v_bride_id uuid;
  v_groom_id uuid;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_privacy_epoch bigint;
  v_action public.amora_actions%ROWTYPE;
  v_card public.amora_action_follow_up_cards_v2%ROWTYPE;
  v_preference public.amora_today_one_preferences%ROWTYPE;
  v_digest text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_CLAIM_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR (
    p_recipient_user_id IS DISTINCT FROM v_bride_id
    AND p_recipient_user_id IS DISTINCT FROM v_groom_id
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id, profile.role
  INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_user_id
  FOR SHARE;
  IF NOT FOUND
     OR v_profile_couple_id IS DISTINCT FROM p_couple_id
     OR NOT (
       (v_profile_role = 'bride' AND v_bride_id = p_recipient_user_id)
       OR (v_profile_role = 'groom' AND v_groom_id = p_recipient_user_id)
     ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT epoch INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs
  WHERE couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT preference.* INTO v_preference
  FROM public.amora_today_one_preferences AS preference
  WHERE preference.user_id = p_recipient_user_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_preference.enabled OR v_preference.opted_in_at IS NULL THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'disabled', 'recipientUserId', p_recipient_user_id
    );
  END IF;
  IF v_preference.paused_until IS NOT NULL AND v_preference.paused_until > v_now THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'paused', 'recipientUserId', p_recipient_user_id
    );
  END IF;

  -- This lock key is identical to the v1 recipient-state trigger. It is held
  -- through the v1 recheck and the v2 card INSERT/renewal below.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'amora-today-one-daily-v1-v2:'
      || p_couple_id::text || ':'
      || p_recipient_user_id::text || ':'
      || v_today::text,
    0
  ));

  -- A v1 card owns today's allowance and remains the canonical fallback.
  IF EXISTS (
    SELECT 1
    FROM public.amora_today_one_recipient_states AS v1
    WHERE v1.couple_id = p_couple_id
      AND v1.recipient_user_id = p_recipient_user_id
      AND v1.claimed_for_date = v_today
  ) THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'none', 'recipientUserId', p_recipient_user_id
    );
  END IF;

  SELECT card.* INTO v_card
  FROM public.amora_action_follow_up_cards_v2 AS card
  WHERE card.couple_id = p_couple_id
    AND card.recipient_user_id = p_recipient_user_id
    AND card.state = 'ready'
  ORDER BY card.created_at, card.id
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    SELECT action.* INTO v_action
    FROM public.amora_actions AS action
    WHERE action.id = v_card.action_id
      AND action.couple_id = p_couple_id
    FOR SHARE;
    IF FOUND
       AND v_action.status = 'open'
       AND v_action.follow_up_revision = v_card.source_revision
       AND public.amora_action_follow_up_digest_v2(v_action) = v_card.source_digest
       AND v_card.privacy_epoch = v_privacy_epoch
       AND v_card.expires_at > v_now THEN
      RETURN public.amora_action_follow_up_card_response_v2(v_card, v_action);
    END IF;
    UPDATE public.amora_action_follow_up_cards_v2
    SET state = CASE
          WHEN v_action.status = 'open'
            AND v_action.follow_up_revision = v_card.source_revision
            AND public.amora_action_follow_up_digest_v2(v_action) = v_card.source_digest
            THEN 'deferred'
          ELSE 'consumed'
        END,
        eligible_again_at = CASE
          WHEN v_action.status = 'open'
            AND v_action.follow_up_revision = v_card.source_revision
            AND public.amora_action_follow_up_digest_v2(v_action) = v_card.source_digest
            THEN v_now
          ELSE NULL
        END,
        consumed_at = v_now
    WHERE id = v_card.id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.amora_action_follow_up_cards_v2 AS daily
    WHERE daily.couple_id = p_couple_id
      AND daily.recipient_user_id = p_recipient_user_id
      AND daily.claimed_for_date = v_today
  ) THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'daily_limit', 'recipientUserId', p_recipient_user_id
    );
  END IF;

  SELECT action.* INTO v_action
  FROM public.amora_actions AS action
  WHERE action.couple_id = p_couple_id
    AND action.status = 'open'
    AND (
      (
        public.amora_action_follow_up_due_date_v2(action.due_date) IS NOT NULL
        AND public.amora_action_follow_up_due_date_v2(action.due_date) < v_today
      )
      OR (
        public.amora_action_follow_up_due_date_v2(action.due_date) IS NULL
        AND action.updated_at <= v_now - interval '24 hours'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.amora_action_follow_up_cards_v2 AS prior
      WHERE prior.recipient_user_id = p_recipient_user_id
        AND prior.action_id = action.id
        AND prior.source_revision = action.follow_up_revision
        AND (
          prior.state = 'consumed'
          OR prior.state = 'deferred' AND prior.eligible_again_at > v_now
        )
    )
  ORDER BY
    CASE action.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
    action.due_date NULLS LAST,
    action.created_at,
    action.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'none', 'recipientUserId', p_recipient_user_id
    );
  END IF;

  v_digest := public.amora_action_follow_up_digest_v2(v_action);
  INSERT INTO public.amora_action_follow_up_cards_v2(
    couple_id, recipient_user_id, action_id, source_revision, source_digest,
    privacy_epoch, claimed_for_date, expires_at
  ) VALUES (
    p_couple_id, p_recipient_user_id, v_action.id,
    v_action.follow_up_revision, v_digest, v_privacy_epoch, v_today, v_expires_at
  )
  ON CONFLICT (recipient_user_id, action_id, source_revision) DO UPDATE
  SET revision = public.amora_action_follow_up_cards_v2.revision + 1,
      source_digest = EXCLUDED.source_digest,
      privacy_epoch = EXCLUDED.privacy_epoch,
      claimed_for_date = EXCLUDED.claimed_for_date,
      outcome_idempotency_key = gen_random_uuid(),
      state = 'ready',
      eligible_again_at = NULL,
      expires_at = EXCLUDED.expires_at,
      created_at = v_now,
      consumed_at = NULL
  WHERE public.amora_action_follow_up_cards_v2.state = 'deferred'
    AND public.amora_action_follow_up_cards_v2.eligible_again_at <= v_now
  RETURNING * INTO v_card;

  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object(
      'version', 2, 'state', 'daily_limit', 'recipientUserId', p_recipient_user_id
    );
  END IF;

  RETURN public.amora_action_follow_up_card_response_v2(v_card, v_action);
END
$function$;

CREATE OR REPLACE FUNCTION public.assert_amora_today_one_v1_claim_available_v2(
  p_couple_id uuid,
  p_recipient_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_V1_V2_COORDINATOR_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'amora-today-one-daily-v1-v2:'
      || p_couple_id::text || ':'
      || p_recipient_user_id::text || ':'
      || v_today::text,
    0
  ));
  PERFORM 1
  FROM public.amora_action_follow_up_cards_v2 AS card
  WHERE card.couple_id = p_couple_id
    AND card.recipient_user_id = p_recipient_user_id
    AND card.claimed_for_date = v_today
  FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_DAILY_LIMIT_V2'
      USING ERRCODE = 'P0001';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.amora_action_follow_up_receipt_response_v2(
  p_outcome public.amora_action_follow_up_outcomes_v2
)
RETURNS jsonb
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'version', 2,
    'recipientUserId', p_outcome.recipient_user_id,
    'receipt', jsonb_strip_nulls(jsonb_build_object(
      'id', p_outcome.id,
      'cardId', p_outcome.card_id,
      'cardRevision', p_outcome.card_revision,
      'outcome', p_outcome.outcome,
      'actionStatus', p_outcome.action_status,
      'actionRevision', p_outcome.action_revision,
      'blockerCode', p_outcome.blocker_code,
      'recordedAt', p_outcome.recorded_at,
      'idempotencyKey', p_outcome.idempotency_key
    ))
  )
$function$;

CREATE OR REPLACE FUNCTION public.record_amora_action_follow_up_outcome_v2(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_card_id uuid,
  p_expected_card_revision bigint,
  p_expected_source_revision bigint,
  p_outcome text,
  p_blocker_code text,
  p_confirmed boolean,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_bride_id uuid;
  v_groom_id uuid;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_privacy_epoch bigint;
  v_card public.amora_action_follow_up_cards_v2%ROWTYPE;
  v_action public.amora_actions%ROWTYPE;
  v_saved public.amora_action_follow_up_outcomes_v2%ROWTYPE;
  v_preference public.amora_today_one_preferences%ROWTYPE;
  v_request_digest text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_OUTCOME_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_card_id IS NULL
     OR p_expected_card_revision IS NULL OR p_expected_card_revision < 1
     OR p_expected_source_revision IS NULL OR p_expected_source_revision < 1
     OR p_idempotency_key IS NULL
     OR p_outcome NOT IN ('completed', 'blocked', 'changed', 'not_sure')
     OR (p_outcome IN ('completed', 'changed') AND p_confirmed IS DISTINCT FROM true)
     OR (p_outcome IN ('blocked', 'not_sure') AND p_confirmed IS DISTINCT FROM false)
     OR (p_outcome = 'blocked' AND p_blocker_code NOT IN (
       'time', 'partner_check', 'missing_info', 'other'
     ))
     OR (p_outcome <> 'blocked' AND p_blocker_code IS NOT NULL) THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_OUTCOME_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_request_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'cardId', p_card_id,
    'cardRevision', p_expected_card_revision,
    'sourceRevision', p_expected_source_revision,
    'outcome', p_outcome,
    'blockerCode', p_blocker_code,
    'confirmed', p_confirmed
  )::text, 'UTF8'), 'sha256'), 'hex');

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR (
    p_recipient_user_id IS DISTINCT FROM v_bride_id
    AND p_recipient_user_id IS DISTINCT FROM v_groom_id
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id, profile.role
  INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_user_id
  FOR SHARE;
  IF NOT FOUND OR v_profile_couple_id IS DISTINCT FROM p_couple_id OR NOT (
    (v_profile_role = 'bride' AND v_bride_id = p_recipient_user_id)
    OR (v_profile_role = 'groom' AND v_groom_id = p_recipient_user_id)
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT epoch INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs
  WHERE couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT saved.* INTO v_saved
  FROM public.amora_action_follow_up_outcomes_v2 AS saved
  WHERE saved.recipient_user_id = p_recipient_user_id
    AND saved.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_saved.couple_id IS DISTINCT FROM p_couple_id
       OR v_saved.privacy_epoch IS DISTINCT FROM v_privacy_epoch
       OR v_saved.request_digest IS DISTINCT FROM v_request_digest THEN
      IF v_saved.privacy_epoch IS DISTINCT FROM v_privacy_epoch THEN
        RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_PRIVACY_STALE'
          USING ERRCODE = '40001';
      END IF;
      RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
    RETURN public.amora_action_follow_up_receipt_response_v2(v_saved);
  END IF;

  -- A previously recorded canonical receipt may still be replayed above, but
  -- a new durable outcome must respect an opt-out or pause that happened after
  -- the card was shown. Locking the preference row makes that race linearizable.
  SELECT preference.* INTO v_preference
  FROM public.amora_today_one_preferences AS preference
  WHERE preference.user_id = p_recipient_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR NOT v_preference.enabled
     OR v_preference.opted_in_at IS NULL
     OR (
       v_preference.paused_until IS NOT NULL
       AND v_preference.paused_until > v_now
     ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_PREFERENCE_INACTIVE'
      USING ERRCODE = '40001';
  END IF;

  SELECT card.* INTO v_card
  FROM public.amora_action_follow_up_cards_v2 AS card
  WHERE card.id = p_card_id
    AND card.couple_id = p_couple_id
    AND card.recipient_user_id = p_recipient_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_CARD_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;
  -- Another identical request may have committed while this transaction was
  -- waiting for the card lock. Re-read the canonical receipt after the lock
  -- and converge instead of reporting the now-consumed card as stale.
  SELECT saved.* INTO v_saved
  FROM public.amora_action_follow_up_outcomes_v2 AS saved
  WHERE saved.recipient_user_id = p_recipient_user_id
    AND saved.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_saved.couple_id IS DISTINCT FROM p_couple_id
       OR v_saved.privacy_epoch IS DISTINCT FROM v_privacy_epoch
       OR v_saved.request_digest IS DISTINCT FROM v_request_digest THEN
      RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
    RETURN public.amora_action_follow_up_receipt_response_v2(v_saved);
  END IF;
  IF v_card.state <> 'ready'
     OR v_card.expires_at <= v_now
     OR v_card.privacy_epoch IS DISTINCT FROM v_privacy_epoch
     OR v_card.revision IS DISTINCT FROM p_expected_card_revision
     OR v_card.source_revision IS DISTINCT FROM p_expected_source_revision
     OR v_card.outcome_idempotency_key IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_CARD_STALE'
      USING ERRCODE = '40001';
  END IF;

  SELECT action.* INTO v_action
  FROM public.amora_actions AS action
  WHERE action.id = v_card.action_id
    AND action.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_action.status <> 'open'
     OR v_action.follow_up_revision IS DISTINCT FROM v_card.source_revision
     OR public.amora_action_follow_up_digest_v2(v_action)
        IS DISTINCT FROM v_card.source_digest THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_SOURCE_STALE'
      USING ERRCODE = '40001';
  END IF;

  IF p_outcome = 'completed' THEN
    UPDATE public.amora_actions
    SET status = 'done',
        completed_at = COALESCE(completed_at, v_now),
        dismissed_at = NULL
    WHERE id = v_action.id
      AND couple_id = p_couple_id
      AND status = 'open'
      AND follow_up_revision = v_card.source_revision
    RETURNING * INTO v_action;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_SOURCE_STALE'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE public.amora_action_follow_up_cards_v2
  SET state = CASE
        WHEN p_outcome IN ('blocked', 'changed', 'not_sure') THEN 'deferred'
        ELSE 'consumed'
      END,
      eligible_again_at = CASE
        WHEN p_outcome IN ('blocked', 'changed', 'not_sure') THEN v_now + interval '24 hours'
        ELSE NULL
      END,
      consumed_at = v_now
  WHERE id = v_card.id;

  INSERT INTO public.amora_action_follow_up_outcomes_v2(
    couple_id, recipient_user_id, card_id, action_id, card_revision,
    source_revision, source_digest, privacy_epoch, outcome, blocker_code, action_status,
    action_revision, idempotency_key, request_digest, recorded_at
  ) VALUES (
    p_couple_id, p_recipient_user_id, v_card.id, v_action.id, v_card.revision,
    v_card.source_revision, v_card.source_digest, v_privacy_epoch, p_outcome, p_blocker_code,
    v_action.status, v_action.follow_up_revision, p_idempotency_key,
    v_request_digest, v_now
  )
  RETURNING * INTO v_saved;

  RETURN public.amora_action_follow_up_receipt_response_v2(v_saved);
END
$function$;

CREATE OR REPLACE FUNCTION public.read_amora_action_follow_up_outcome_v2(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_expected_privacy_epoch bigint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_privacy_epoch bigint;
  v_saved public.amora_action_follow_up_outcomes_v2%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_RECEIPT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  SELECT couple.bride_id, couple.groom_id INTO v_bride_id, v_groom_id
  FROM public.couples AS couple WHERE couple.id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  SELECT profile.couple_id, profile.role INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile WHERE profile.id = p_recipient_user_id
  FOR SHARE;
  IF NOT FOUND OR v_profile_couple_id IS DISTINCT FROM p_couple_id OR NOT (
    (v_profile_role = 'bride' AND v_bride_id = p_recipient_user_id)
    OR (v_profile_role = 'groom' AND v_groom_id = p_recipient_user_id)
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_RECIPIENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  SELECT epoch INTO v_privacy_epoch
  FROM public.amora_privacy_context_epochs WHERE couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_privacy_epoch IS DISTINCT FROM p_expected_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;
  SELECT saved.* INTO v_saved
  FROM public.amora_action_follow_up_outcomes_v2 AS saved
  WHERE saved.couple_id = p_couple_id
    AND saved.recipient_user_id = p_recipient_user_id
    AND saved.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_saved.privacy_epoch IS DISTINCT FROM v_privacy_epoch THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_PRIVACY_STALE'
      USING ERRCODE = '40001';
  END IF;
  RETURN public.amora_action_follow_up_receipt_response_v2(v_saved);
END
$function$;

ALTER FUNCTION public.bump_amora_action_follow_up_revision() OWNER TO postgres;
ALTER FUNCTION public.amora_action_follow_up_digest_v2(public.amora_actions)
  OWNER TO postgres;
ALTER FUNCTION public.amora_action_follow_up_due_date_v2(text) OWNER TO postgres;
ALTER FUNCTION public.enforce_amora_today_one_v1_v2_daily_claim()
  OWNER TO postgres;
ALTER FUNCTION public.amora_action_follow_up_card_response_v2(
  public.amora_action_follow_up_cards_v2, public.amora_actions
) OWNER TO postgres;
ALTER FUNCTION public.claim_amora_action_follow_up_v2(uuid, uuid, bigint)
  OWNER TO postgres;
ALTER FUNCTION public.assert_amora_today_one_v1_claim_available_v2(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.amora_action_follow_up_receipt_response_v2(
  public.amora_action_follow_up_outcomes_v2
) OWNER TO postgres;
ALTER FUNCTION public.record_amora_action_follow_up_outcome_v2(
  uuid, uuid, bigint, uuid, bigint, bigint, text, text, boolean, uuid
) OWNER TO postgres;
ALTER FUNCTION public.read_amora_action_follow_up_outcome_v2(
  uuid, uuid, bigint, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.bump_amora_action_follow_up_revision()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_action_follow_up_digest_v2(public.amora_actions)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_action_follow_up_due_date_v2(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_amora_today_one_v1_v2_daily_claim()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_action_follow_up_card_response_v2(
  public.amora_action_follow_up_cards_v2, public.amora_actions
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_amora_action_follow_up_v2(uuid, uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_amora_today_one_v1_claim_available_v2(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_action_follow_up_receipt_response_v2(
  public.amora_action_follow_up_outcomes_v2
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_amora_action_follow_up_outcome_v2(
  uuid, uuid, bigint, uuid, bigint, bigint, text, text, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_amora_action_follow_up_outcome_v2(
  uuid, uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_action_follow_up_v2(uuid, uuid, bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_amora_today_one_v1_claim_available_v2(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_amora_action_follow_up_outcome_v2(
  uuid, uuid, bigint, uuid, bigint, bigint, text, text, boolean, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_amora_action_follow_up_outcome_v2(
  uuid, uuid, bigint, uuid
) TO service_role;

COMMENT ON TABLE public.amora_action_follow_up_cards_v2 IS
  'Recipient-private action follow-up cards bound to an immutable canonical amora_actions revision and digest.';
COMMENT ON TABLE public.amora_action_follow_up_outcomes_v2 IS
  'Recipient-private bounded outcome receipts. No raw free-text blocker reason is stored.';

DO $postconditions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.amora_actions'::regclass
      AND attname = 'follow_up_revision'
      AND NOT attisdropped
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.amora_actions'::regclass
      AND tgname = 'bump_amora_action_follow_up_revision'
      AND NOT tgisinternal
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.amora_today_one_recipient_states'::regclass
      AND tgname = 'enforce_amora_today_one_v1_v2_daily_claim'
      AND NOT tgisinternal
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.amora_action_follow_up_cards_v2'::regclass
      AND relrowsecurity AND relforcerowsecurity
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.amora_action_follow_up_outcomes_v2'::regclass
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_V2_POSTCONDITION_FAILED';
  END IF;

  IF has_table_privilege('authenticated', 'public.amora_action_follow_up_cards_v2', 'SELECT')
     OR has_table_privilege('authenticated', 'public.amora_action_follow_up_outcomes_v2', 'SELECT')
     OR has_function_privilege(
       'authenticated',
       'public.claim_amora_action_follow_up_v2(uuid,uuid,bigint)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.record_amora_action_follow_up_outcome_v2(uuid,uuid,bigint,uuid,bigint,bigint,text,text,boolean,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.read_amora_action_follow_up_outcome_v2(uuid,uuid,bigint,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_FOLLOW_UP_V2_ACL_FAILED';
  END IF;
END
$postconditions$;

COMMIT;
