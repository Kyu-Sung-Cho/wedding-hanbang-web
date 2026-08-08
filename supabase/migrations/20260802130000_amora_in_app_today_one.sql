BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- TodayOne is an in-app, explicitly opted-in care surface. It is deliberately
-- isolated from the legacy proactive chat/outbound care queue and performs no
-- email, push, provider, or chat-message write.

CREATE FUNCTION public.amora_today_one_text_is_safe(
  p_value text,
  p_min_length integer,
  p_max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT p_value IS NOT NULL
     AND char_length(btrim(p_value)) >= p_min_length
     AND char_length(p_value) <= p_max_length
     AND p_value !~ '[[:cntrl:]]'
     AND NOT EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         173,
         1564,
         6158,
         8203, 8204, 8205, 8206, 8207,
         8232, 8233, 8234, 8235, 8236, 8237, 8238,
         8288, 8289, 8290, 8291, 8292,
         8294, 8295, 8296, 8297, 8298, 8299, 8300, 8301, 8302, 8303,
         65279
       ]::integer[]) AS forbidden(codepoint)
       WHERE strpos(p_value, chr(forbidden.codepoint)) > 0
     )
$function$;

CREATE FUNCTION public.amora_today_one_presentation_is_valid(
  p_value jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_next_action jsonb;
  v_choices jsonb;
  v_href text;
BEGIN
  IF jsonb_typeof(p_value) <> 'object'
     OR pg_column_size(p_value) > 8192
     OR NOT p_value ?& ARRAY[
       'kind', 'whyNow', 'confirmed', 'unknown', 'nextAction', 'impact', 'choices'
     ]
     OR (SELECT count(*) FROM jsonb_object_keys(p_value)) <> 7
     OR p_value->>'kind' <> 'schedule_moment'
     OR NOT public.amora_today_one_text_is_safe(p_value->>'whyNow', 1, 240)
     OR NOT public.amora_today_one_text_is_safe(p_value->>'impact', 1, 180)
     OR jsonb_typeof(p_value->'confirmed') <> 'array'
     OR jsonb_array_length(p_value->'confirmed') NOT BETWEEN 1 AND 4
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_value->'confirmed') AS item(value)
       WHERE jsonb_typeof(item.value) <> 'string'
          OR NOT public.amora_today_one_text_is_safe(item.value #>> '{}', 1, 180)
     )
     OR jsonb_typeof(p_value->'unknown') <> 'array'
     OR jsonb_array_length(p_value->'unknown') NOT BETWEEN 0 AND 4
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_value->'unknown') AS item(value)
       WHERE jsonb_typeof(item.value) <> 'string'
          OR NOT public.amora_today_one_text_is_safe(item.value #>> '{}', 1, 180)
     ) THEN
    RETURN false;
  END IF;

  v_next_action := p_value->'nextAction';
  IF jsonb_typeof(v_next_action) <> 'object'
     OR NOT v_next_action ?& ARRAY['label', 'href']
     OR (SELECT count(*) FROM jsonb_object_keys(v_next_action)) <> 2
     OR NOT public.amora_today_one_text_is_safe(v_next_action->>'label', 1, 80)
     OR NOT public.amora_today_one_text_is_safe(v_next_action->>'href', 1, 240) THEN
    RETURN false;
  END IF;

  v_href := v_next_action->>'href';
  IF left(v_href, 1) <> '/'
     OR left(v_href, 2) = '//'
     OR position(E'\\' IN v_href) > 0 THEN
    RETURN false;
  END IF;

  v_choices := p_value->'choices';
  IF jsonb_typeof(v_choices) <> 'array'
     OR jsonb_array_length(v_choices) NOT BETWEEN 2 AND 4
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_choices) AS choice(value)
       WHERE jsonb_typeof(choice.value) <> 'object'
          OR NOT choice.value ?& ARRAY['action', 'label']
          OR (SELECT count(*) FROM jsonb_object_keys(choice.value)) <> 2
          OR choice.value->>'action' NOT IN (
            'open_source', 'snooze', 'dismiss', 'mute_source'
          )
          OR NOT public.amora_today_one_text_is_safe(
            choice.value->>'label', 1, 40
          )
     )
     OR (
       SELECT count(DISTINCT choice.value->>'action')
       FROM jsonb_array_elements(v_choices) AS choice(value)
     ) <> jsonb_array_length(v_choices) THEN
    RETURN false;
  END IF;

  RETURN true;
END
$function$;

CREATE TABLE public.amora_today_one_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  opted_in_at timestamptz,
  paused_until timestamptz,
  daily_limit smallint NOT NULL DEFAULT 1 CHECK (daily_limit = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (enabled = (opted_in_at IS NOT NULL)),
  CHECK (paused_until IS NULL OR enabled)
);

CREATE TABLE public.amora_today_one_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_key text NOT NULL
    CHECK (source_key ~ '^[a-z0-9:_-]{1,200}$'),
  state_digest text NOT NULL
    CHECK (state_digest ~ '^[0-9a-f]{64}$'),
  source_revision bigint NOT NULL
    CHECK (source_revision BETWEEN 0 AND 9007199254740991),
  kind text NOT NULL CHECK (kind = 'schedule_moment'),
  presentation jsonb NOT NULL
    CHECK (public.amora_today_one_presentation_is_valid(presentation)),
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 100000),
  muted_at timestamptz,
  muted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The same profile can legitimately leave one couple and later join
  -- another. Source episodes and their mute state must never cross that
  -- relationship boundary.
  UNIQUE (couple_id, recipient_user_id, source_key),
  UNIQUE (id, couple_id, recipient_user_id),
  CHECK ((muted_at IS NULL) = (muted_by IS NULL)),
  CHECK (muted_by IS NULL OR muted_by = recipient_user_id)
);

CREATE TABLE public.amora_today_one_recipient_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL,
  couple_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  claimed_for_date date NOT NULL,
  state text NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready', 'snoozed', 'opened', 'dismissed', 'muted')),
  revision bigint NOT NULL DEFAULT 1
    CHECK (revision BETWEEN 1 AND 9007199254740991),
  source_revision bigint NOT NULL
    CHECK (source_revision BETWEEN 0 AND 9007199254740991),
  state_digest text NOT NULL CHECK (state_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  snoozed_until timestamptz,
  last_action text CHECK (
    last_action IS NULL
    OR last_action IN ('open_source', 'snooze', 'dismiss', 'mute_source')
  ),
  acted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (signal_id, couple_id, recipient_user_id)
    REFERENCES public.amora_today_one_signals(id, couple_id, recipient_user_id)
    ON DELETE CASCADE,
  -- A daily claim belongs to the exact relationship in which it was issued.
  -- Re-linking to a different couple on the same KST date must neither expose
  -- the old card nor consume the new relationship's one-card allowance.
  UNIQUE (couple_id, recipient_user_id, claimed_for_date),
  UNIQUE (couple_id, recipient_user_id, signal_id, claimed_for_date),
  CHECK (expires_at > created_at),
  CHECK (
    (state = 'ready' AND snoozed_until IS NULL AND last_action IS NULL)
    OR (state = 'snoozed' AND snoozed_until IS NOT NULL AND last_action = 'snooze')
    OR (state = 'opened' AND snoozed_until IS NULL AND last_action = 'open_source')
    OR (state = 'dismissed' AND snoozed_until IS NULL AND last_action = 'dismiss')
    OR (state = 'muted' AND snoozed_until IS NULL AND last_action = 'mute_source')
  ),
  CHECK ((last_action IS NULL) = (acted_at IS NULL))
);

CREATE INDEX amora_today_one_signals_recipient_updated_idx
  ON public.amora_today_one_signals(recipient_user_id, updated_at DESC, id);
CREATE INDEX amora_today_one_recipient_states_signal_idx
  ON public.amora_today_one_recipient_states(signal_id, claimed_for_date DESC);

ALTER TABLE public.amora_today_one_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_today_one_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.amora_today_one_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_today_one_signals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.amora_today_one_recipient_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_today_one_recipient_states FORCE ROW LEVEL SECURITY;

CREATE POLICY amora_today_one_preferences_owner_select
  ON public.amora_today_one_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY amora_today_one_signals_current_owner_select
  ON public.amora_today_one_signals
  FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND profile.couple_id = amora_today_one_signals.couple_id
        AND (
          (profile.role = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role = 'groom' AND couple.groom_id = profile.id)
        )
    )
  );

CREATE POLICY amora_today_one_recipient_states_current_owner_select
  ON public.amora_today_one_recipient_states
  FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND profile.couple_id = amora_today_one_recipient_states.couple_id
        AND (
          (profile.role = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role = 'groom' AND couple.groom_id = profile.id)
        )
    )
  );

REVOKE ALL ON TABLE public.amora_today_one_preferences
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.amora_today_one_signals
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.amora_today_one_recipient_states
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.amora_today_one_preferences TO authenticated;
GRANT SELECT ON TABLE public.amora_today_one_signals TO authenticated;
GRANT SELECT ON TABLE public.amora_today_one_recipient_states TO authenticated;

CREATE FUNCTION public.amora_today_one_clock()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT statement_timestamp()
$function$;

CREATE FUNCTION public.amora_today_one_build_response(
  p_recipient_user_id uuid,
  p_claimed_for_date date,
  p_state text,
  p_recipient_state_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_card jsonb;
BEGIN
  IF p_state NOT IN (
    'ready', 'none', 'disabled', 'paused', 'daily_limit', 'source_stale'
  ) OR (p_state = 'ready') <> (p_recipient_state_id IS NOT NULL) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_RESPONSE_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_state = 'ready' THEN
    SELECT jsonb_build_object(
      'id', recipient_state.id,
      'revision', recipient_state.revision,
      'sourceRevision', signal.source_revision,
      'sourceKey', signal.source_key,
      'kind', signal.presentation->'kind',
      'whyNow', signal.presentation->'whyNow',
      'confirmed', signal.presentation->'confirmed',
      'unknown', signal.presentation->'unknown',
      'nextAction', signal.presentation->'nextAction',
      'impact', signal.presentation->'impact',
      'choices', signal.presentation->'choices',
      'expiresAt', recipient_state.expires_at
    )
    INTO v_card
    FROM public.amora_today_one_recipient_states AS recipient_state
    JOIN public.amora_today_one_signals AS signal
      ON signal.id = recipient_state.signal_id
     AND signal.couple_id = recipient_state.couple_id
     AND signal.recipient_user_id = recipient_state.recipient_user_id
    WHERE recipient_state.id = p_recipient_state_id
      AND recipient_state.recipient_user_id = p_recipient_user_id
      AND recipient_state.claimed_for_date = p_claimed_for_date
      AND recipient_state.state = 'ready'
      AND signal.muted_at IS NULL;
    IF v_card IS NULL THEN
      RAISE EXCEPTION 'AMORA_TODAY_ONE_READY_CARD_MISSING' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'state', p_state,
    'recipientUserId', p_recipient_user_id,
    'claimedForDate', to_char(p_claimed_for_date, 'YYYY-MM-DD'),
    'card', v_card
  ));
END
$function$;

CREATE FUNCTION public.set_amora_today_one_preference(
  p_enabled boolean,
  p_paused_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.amora_today_one_clock();
  v_preference public.amora_today_one_preferences%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL
     OR (NOT p_enabled AND p_paused_until IS NOT NULL)
     OR (
       p_paused_until IS NOT NULL
       AND (p_paused_until <= v_now OR p_paused_until > v_now + interval '30 days')
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_PREFERENCE_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.amora_today_one_preferences(
    user_id, enabled, opted_in_at, paused_until
  ) VALUES (
    v_user_id,
    p_enabled,
    CASE WHEN p_enabled THEN v_now ELSE NULL END,
    CASE WHEN p_enabled THEN p_paused_until ELSE NULL END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      opted_in_at = CASE
        WHEN EXCLUDED.enabled
          THEN COALESCE(
            public.amora_today_one_preferences.opted_in_at,
            v_now
          )
        ELSE NULL
      END,
      paused_until = CASE
        WHEN EXCLUDED.enabled THEN EXCLUDED.paused_until
        ELSE NULL
      END,
      updated_at = v_now
  RETURNING * INTO v_preference;

  RETURN jsonb_build_object(
    'enabled', v_preference.enabled,
    'optedInAt', v_preference.opted_in_at,
    'pausedUntil', v_preference.paused_until,
    'dailyLimit', v_preference.daily_limit
  );
END
$function$;

CREATE FUNCTION public.compile_amora_today_one_card(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_source_key text,
  p_state_digest text,
  p_source_revision bigint,
  p_priority integer,
  p_presentation jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_now timestamptz := public.amora_today_one_clock();
  v_today date := (v_now AT TIME ZONE 'Asia/Seoul')::date;
  v_expires_at timestamptz :=
    ((v_now AT TIME ZONE 'Asia/Seoul')::date + 1)::timestamp
      AT TIME ZONE 'Asia/Seoul';
  v_bride_id uuid;
  v_groom_id uuid;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_journey_revision bigint;
  v_preference public.amora_today_one_preferences%ROWTYPE;
  v_signal public.amora_today_one_signals%ROWTYPE;
  v_daily public.amora_today_one_recipient_states%ROWTYPE;
  v_signal_changed boolean := false;
BEGIN
  IF p_couple_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_source_key IS NULL
     OR p_source_key !~ '^[a-z0-9:_-]{1,200}$'
     OR p_state_digest IS NULL
     OR p_state_digest !~ '^[0-9a-f]{64}$'
     OR p_source_revision IS NULL
     OR p_source_revision NOT BETWEEN 0 AND 9007199254740991
     OR p_priority IS NULL
     OR p_priority NOT BETWEEN 0 AND 100000
     OR NOT public.amora_today_one_presentation_is_valid(p_presentation) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_SIGNAL_INVALID' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'AMORA_TODAY_ONE_RECIPIENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id, profile.role
  INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_user_id
  FOR SHARE;
  IF NOT FOUND
     OR v_profile_couple_id IS DISTINCT FROM p_couple_id
     OR NOT (
       (v_profile_role = 'bride' AND v_bride_id IS NOT DISTINCT FROM p_recipient_user_id)
       OR (v_profile_role = 'groom' AND v_groom_id IS NOT DISTINCT FROM p_recipient_user_id)
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_RECIPIENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT journey.state_revision
  INTO v_journey_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_journey_revision IS DISTINCT FROM p_source_revision THEN
    RETURN public.amora_today_one_build_response(
      p_recipient_user_id, v_today, 'source_stale'
    );
  END IF;

  SELECT * INTO v_preference
  FROM public.amora_today_one_preferences AS preference
  WHERE preference.user_id = p_recipient_user_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_preference.enabled OR v_preference.opted_in_at IS NULL THEN
    RETURN public.amora_today_one_build_response(
      p_recipient_user_id, v_today, 'disabled'
    );
  END IF;
  IF v_preference.paused_until IS NOT NULL
     AND v_preference.paused_until > v_now THEN
    RETURN public.amora_today_one_build_response(
      p_recipient_user_id, v_today, 'paused'
    );
  END IF;

  SELECT * INTO v_signal
  FROM public.amora_today_one_signals AS signal
  WHERE signal.couple_id = p_couple_id
    AND signal.recipient_user_id = p_recipient_user_id
    AND signal.source_key = p_source_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_signal.source_revision > p_source_revision
       OR (
         v_signal.source_revision = p_source_revision
         AND v_signal.state_digest IS DISTINCT FROM p_state_digest
       ) THEN
      RETURN public.amora_today_one_build_response(
        p_recipient_user_id, v_today, 'source_stale'
      );
    END IF;
    -- A mute belongs to the exact confirmed state digest that the owner saw.
    -- A newer, semantically changed digest is a recoverable new episode and
    -- may surface again; unrelated revision bumps with the same digest stay
    -- muted.
    IF v_signal.muted_at IS NOT NULL
       AND v_signal.state_digest IS NOT DISTINCT FROM p_state_digest THEN
      RETURN public.amora_today_one_build_response(
        p_recipient_user_id, v_today, 'none'
      );
    END IF;
    v_signal_changed := v_signal.source_revision < p_source_revision;
  END IF;

  SELECT * INTO v_daily
  FROM public.amora_today_one_recipient_states AS recipient_state
  WHERE recipient_state.couple_id = p_couple_id
    AND recipient_state.recipient_user_id = p_recipient_user_id
    AND recipient_state.claimed_for_date = v_today
  FOR UPDATE;
  IF FOUND AND (
    v_signal.id IS NULL OR v_daily.signal_id IS DISTINCT FROM v_signal.id
  ) THEN
    RETURN public.amora_today_one_build_response(
      p_recipient_user_id, v_today, 'daily_limit'
    );
  END IF;

  IF v_signal.id IS NULL THEN
    INSERT INTO public.amora_today_one_signals(
      couple_id, recipient_user_id, source_key, state_digest,
      source_revision, kind, presentation, priority
    ) VALUES (
      p_couple_id, p_recipient_user_id, p_source_key, p_state_digest,
      p_source_revision, p_presentation->>'kind', p_presentation, p_priority
    )
    RETURNING * INTO v_signal;
  ELSIF v_signal_changed THEN
    UPDATE public.amora_today_one_signals
    SET state_digest = p_state_digest,
        source_revision = p_source_revision,
        kind = p_presentation->>'kind',
        presentation = p_presentation,
        priority = p_priority,
        muted_at = CASE
          WHEN state_digest IS DISTINCT FROM p_state_digest THEN NULL
          ELSE muted_at
        END,
        muted_by = CASE
          WHEN state_digest IS DISTINCT FROM p_state_digest THEN NULL
          ELSE muted_by
        END,
        updated_at = v_now
    WHERE id = v_signal.id
    RETURNING * INTO v_signal;
  END IF;

  IF v_daily.id IS NULL THEN
    INSERT INTO public.amora_today_one_recipient_states(
      signal_id, couple_id, recipient_user_id, claimed_for_date,
      source_revision, state_digest, expires_at
    ) VALUES (
      v_signal.id, p_couple_id, p_recipient_user_id, v_today,
      v_signal.source_revision, v_signal.state_digest, v_expires_at
    )
    RETURNING * INTO v_daily;
  ELSIF v_signal_changed THEN
    UPDATE public.amora_today_one_recipient_states
    SET source_revision = v_signal.source_revision,
        state_digest = v_signal.state_digest,
        revision = revision + 1,
        updated_at = v_now
    WHERE id = v_daily.id
    RETURNING * INTO v_daily;
  END IF;

  IF v_daily.state = 'snoozed' AND v_daily.snoozed_until > v_now THEN
    RETURN public.amora_today_one_build_response(
      p_recipient_user_id, v_today, 'paused'
    );
  ELSIF v_daily.state = 'snoozed' THEN
    UPDATE public.amora_today_one_recipient_states
    SET state = 'ready',
        snoozed_until = NULL,
        last_action = NULL,
        acted_at = NULL,
        revision = revision + 1,
        updated_at = v_now
    WHERE id = v_daily.id
    RETURNING * INTO v_daily;
  ELSIF v_daily.state <> 'ready' THEN
    RETURN public.amora_today_one_build_response(
      p_recipient_user_id, v_today, 'none'
    );
  END IF;

  RETURN public.amora_today_one_build_response(
    p_recipient_user_id, v_today, 'ready', v_daily.id
  );
END
$function$;

CREATE FUNCTION public.act_on_amora_today_one_card(
  p_card_id uuid,
  p_expected_revision bigint,
  p_expected_source_revision bigint,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.amora_today_one_clock();
  v_today date := (v_now AT TIME ZONE 'Asia/Seoul')::date;
  v_couple_id uuid;
  v_bride_id uuid;
  v_groom_id uuid;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_journey_revision bigint;
  v_recipient_user_id_hint uuid;
  v_signal_id_hint uuid;
  v_source_revision_hint bigint;
  v_recipient_state public.amora_today_one_recipient_states%ROWTYPE;
  v_signal public.amora_today_one_signals%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_card_id IS NULL
     OR p_expected_revision IS NULL
     OR p_expected_revision NOT BETWEEN 1 AND 9007199254740991
     OR p_expected_source_revision IS NULL
     OR p_expected_source_revision NOT BETWEEN 0 AND 9007199254740991
     OR p_action NOT IN ('open_source', 'snooze', 'dismiss', 'mute_source') THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_ACTION_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT
    recipient_state.couple_id,
    recipient_state.recipient_user_id,
    recipient_state.signal_id,
    recipient_state.source_revision
  INTO
    v_couple_id,
    v_recipient_user_id_hint,
    v_signal_id_hint,
    v_source_revision_hint
  FROM public.amora_today_one_recipient_states AS recipient_state
  WHERE recipient_state.id = p_card_id;
  IF NOT FOUND OR v_recipient_user_id_hint IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_CARD_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT couple.bride_id, couple.groom_id
  INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = v_couple_id
  FOR SHARE;
  IF NOT FOUND OR (
    v_user_id IS DISTINCT FROM v_bride_id
    AND v_user_id IS DISTINCT FROM v_groom_id
  ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_CARD_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT profile.couple_id, profile.role
  INTO v_profile_couple_id, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id
  FOR SHARE;
  IF NOT FOUND
     OR v_profile_couple_id IS DISTINCT FROM v_couple_id
     OR NOT (
       (v_profile_role = 'bride' AND v_bride_id IS NOT DISTINCT FROM v_user_id)
       OR (v_profile_role = 'groom' AND v_groom_id IS NOT DISTINCT FROM v_user_id)
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_CARD_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Match compile's couple -> profile -> journey -> signal -> card lock order.
  -- These unlocked hints are never trusted for mutation; they only identify
  -- which source row must be locked before its recipient card.
  SELECT journey.state_revision
  INTO v_journey_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = v_couple_id
  FOR SHARE;
  IF NOT FOUND OR v_journey_revision IS DISTINCT FROM v_source_revision_hint THEN
    RETURN public.amora_today_one_build_response(
      v_user_id, v_today, 'source_stale'
    );
  END IF;

  SELECT * INTO v_signal
  FROM public.amora_today_one_signals AS signal
  WHERE signal.id = v_signal_id_hint
    AND signal.recipient_user_id = v_user_id
    AND signal.couple_id = v_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.amora_today_one_build_response(
      v_user_id, v_today, 'source_stale'
    );
  END IF;

  SELECT * INTO v_recipient_state
  FROM public.amora_today_one_recipient_states AS recipient_state
  WHERE recipient_state.id = p_card_id
    AND recipient_state.signal_id = v_signal.id
    AND recipient_state.recipient_user_id = v_user_id
    AND recipient_state.couple_id = v_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_CARD_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_journey_revision IS DISTINCT FROM v_recipient_state.source_revision
     OR v_recipient_state.revision IS DISTINCT FROM p_expected_revision
     OR v_recipient_state.source_revision IS DISTINCT FROM p_expected_source_revision
     OR v_signal.source_revision IS DISTINCT FROM p_expected_source_revision
     OR v_signal.state_digest IS DISTINCT FROM v_recipient_state.state_digest
     OR v_recipient_state.expires_at <= v_now
     OR v_recipient_state.claimed_for_date IS DISTINCT FROM v_today THEN
    RETURN public.amora_today_one_build_response(
      v_user_id, v_today, 'source_stale'
    );
  END IF;

  IF p_action = 'mute_source' THEN
    UPDATE public.amora_today_one_signals
    SET muted_at = v_now, muted_by = v_user_id, updated_at = v_now
    WHERE id = v_signal.id;
  END IF;

  UPDATE public.amora_today_one_recipient_states
  SET state = CASE p_action
        WHEN 'open_source' THEN 'opened'
        WHEN 'snooze' THEN 'snoozed'
        WHEN 'dismiss' THEN 'dismissed'
        WHEN 'mute_source' THEN 'muted'
      END,
      snoozed_until = CASE
        WHEN p_action = 'snooze'
          THEN LEAST(v_now + interval '2 hours', expires_at)
        ELSE NULL
      END,
      last_action = p_action,
      acted_at = v_now,
      revision = revision + 1,
      updated_at = v_now
  WHERE id = v_recipient_state.id
  RETURNING * INTO v_recipient_state;

  RETURN public.amora_today_one_build_response(
    v_user_id,
    v_today,
    CASE WHEN p_action = 'snooze' THEN 'paused' ELSE 'none' END
  );
END
$function$;

ALTER FUNCTION public.amora_today_one_text_is_safe(text, integer, integer)
  OWNER TO postgres;
ALTER FUNCTION public.amora_today_one_presentation_is_valid(jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.amora_today_one_clock() OWNER TO postgres;
ALTER FUNCTION public.amora_today_one_build_response(uuid, date, text, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.set_amora_today_one_preference(boolean, timestamptz)
  OWNER TO postgres;
ALTER FUNCTION public.compile_amora_today_one_card(
  uuid, uuid, text, text, bigint, integer, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.act_on_amora_today_one_card(uuid, bigint, bigint, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.amora_today_one_text_is_safe(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_today_one_presentation_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_today_one_clock()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_today_one_build_response(uuid, date, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_amora_today_one_preference(boolean, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.compile_amora_today_one_card(
  uuid, uuid, text, text, bigint, integer, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.act_on_amora_today_one_card(uuid, bigint, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_amora_today_one_preference(boolean, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.compile_amora_today_one_card(
  uuid, uuid, text, text, bigint, integer, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.act_on_amora_today_one_card(uuid, bigint, bigint, text)
  TO authenticated;

COMMENT ON TABLE public.amora_today_one_preferences IS
  'Per-user, explicit opt-in for the in-app TodayOne surface; never authorizes outbound delivery.';
COMMENT ON TABLE public.amora_today_one_signals IS
  'Latest recipient-scoped, source-revision-bound TodayOne evidence and presentation.';
COMMENT ON TABLE public.amora_today_one_recipient_states IS
  'One durable in-app card claim per recipient and KST day, including owner actions.';
COMMENT ON FUNCTION public.compile_amora_today_one_card(
  uuid, uuid, text, text, bigint, integer, jsonb
) IS 'Service-only atomic TodayOne validation, source-CAS, idempotent upsert, and daily claim. No external I/O.';

DO $postconditions$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'amora_today_one_preferences',
    'amora_today_one_signals',
    'amora_today_one_recipient_states'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = v_table
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'AMORA_TODAY_ONE_RLS_POSTCONDITION_FAILED:%', v_table;
    END IF;
  END LOOP;

  IF has_function_privilege(
       'authenticated',
       'public.compile_amora_today_one_card(uuid,uuid,text,text,bigint,integer,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.compile_amora_today_one_card(uuid,uuid,text,text,bigint,integer,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.set_amora_today_one_preference(boolean,timestamptz)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.act_on_amora_today_one_card(uuid,bigint,bigint,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.act_on_amora_today_one_card(uuid,bigint,bigint,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_TODAY_ONE_ACL_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;

COMMIT;
