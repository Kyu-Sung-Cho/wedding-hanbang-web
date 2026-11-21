BEGIN;

-- 2026-11-13 P2 "먼저 말 걸기 켜기, 강도, 시간" (설계도 10장 P2).
--
-- 1. 강도: 사람마다 덜(light), 보통(normal), 더(more). 커플에 적용되는 값은 두 사람 중
--    더 조심스러운 쪽이다. 함께 대화 글은 두 사람이 같이 보기 때문이다.
--    덜 = 전날 확인(moment d1)과 마감이 급한 안내(lifecycle critical)만, 하루 한 건.
--    보통 = 하루 한 건. 더 = 하루 세 건. 기본은 보통(2026-11-13 파운더 결정).
-- 2. 하루 상한: 함께 대화에 아모라가 먼저 남기는 글(예약 경로, 화면 열 때의 모멘트,
--    수명 주기 안내, 저장 글 회수)을 한국 날짜 하루 단위로 센다. 세 길 모두 이 DB 함수를
--    지나고, 커플마다 advisory lock 으로 직렬화해서 두 길이 동시에 상한을 넘지 못한다.
-- 3. 받는 시간: 사람마다 09시~20시(한국 시각) 안에서 좁힐 수 있다. 커플 적용값은 두 사람이
--    고른 시간이 겹치는 구간이다. 예약 경로에만 쓴다. 화면 열 때의 글은 사람이 앱을 연
--    순간에 생기므로 시간과 무관하다. 09~20 바깥으로 넓히는 것은 파운더 결정으로 남겨 둔다.
-- 4. 예약 경로는 보내기 직전에 계획의 판번호(wedding_journeys.state_revision)를 다시 본다.
--    워커가 지금 계획으로 다시 계산한 글과 판번호를 넘기고, 판번호가 달라졌으면 넣지 않고
--    작업을 되돌린다. 해당하지 않게 된 글은 cancel_amora_care_job_source_changed 로 닫는다.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS care_intensity text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS care_window_start_hour smallint NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS care_window_end_hour smallint NOT NULL DEFAULT 20;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_care_cadence_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_care_cadence_valid
  CHECK (
    care_intensity IN ('light', 'normal', 'more')
    AND care_window_start_hour BETWEEN 9 AND 19
    AND care_window_end_hour BETWEEN 10 AND 20
    AND care_window_start_hour < care_window_end_hour
  ) NOT VALID;
ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_care_cadence_valid;

-- The direct-write guard now covers the cadence columns too. Clients keep
-- table-level UPDATE on their own row; every care setting goes through RPCs.
CREATE OR REPLACE FUNCTION public.prevent_direct_amora_care_consent_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (
       NEW.care_notifications_enabled IS DISTINCT FROM OLD.care_notifications_enabled
       OR NEW.care_notifications_consented_at IS DISTINCT FROM OLD.care_notifications_consented_at
       OR NEW.care_email_enabled IS DISTINCT FROM OLD.care_email_enabled
       OR NEW.care_email_consented_at IS DISTINCT FROM OLD.care_email_consented_at
       OR NEW.care_prompt_answered_at IS DISTINCT FROM OLD.care_prompt_answered_at
       OR NEW.care_intensity IS DISTINCT FROM OLD.care_intensity
       OR NEW.care_window_start_hour IS DISTINCT FROM OLD.care_window_start_hour
       OR NEW.care_window_end_hour IS DISTINCT FROM OLD.care_window_end_hour
     ) THEN
    RAISE EXCEPTION 'AMORA_CARE_CONSENT_DIRECT_UPDATE_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_prevent_direct_amora_care_consent_change ON public.profiles;
CREATE TRIGGER trg_prevent_direct_amora_care_consent_change
  BEFORE UPDATE OF
    care_notifications_enabled,
    care_notifications_consented_at,
    care_email_enabled,
    care_email_consented_at,
    care_prompt_answered_at,
    care_intensity,
    care_window_start_hour,
    care_window_end_hour
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_direct_amora_care_consent_change();

-- The couple-level policy is the most careful member setting: the lowest
-- intensity and the overlap of both delivery windows.
CREATE OR REPLACE FUNCTION public.amora_care_couple_cadence(p_couple_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH members AS (
    SELECT member.care_intensity,
           member.care_window_start_hour,
           member.care_window_end_hour
    FROM public.couples AS couple
    JOIN public.profiles AS member
      ON member.id = couple.bride_id OR member.id = couple.groom_id
    WHERE couple.id = p_couple_id
  ),
  policy AS (
    SELECT
      CASE
        WHEN bool_or(care_intensity = 'light') THEN 'light'
        WHEN count(*) = 0 OR bool_or(care_intensity = 'normal') THEN 'normal'
        ELSE 'more'
      END AS intensity,
      COALESCE(max(care_window_start_hour), 9)::integer AS window_start_hour,
      COALESCE(min(care_window_end_hour), 20)::integer AS window_end_hour
    FROM members
  )
  SELECT jsonb_build_object(
    'intensity', policy.intensity,
    'daily_limit', CASE policy.intensity WHEN 'more' THEN 3 ELSE 1 END,
    'window_start_hour', policy.window_start_hour,
    'window_end_hour', policy.window_end_hour,
    'window_open', policy.window_start_hour < policy.window_end_hour
  )
  FROM policy
$function$;

-- "마감 임박" for 덜: the day-before check of a registered moment, or a
-- lifecycle guardrail the planner marked critical.
CREATE OR REPLACE FUNCTION public.amora_care_is_imminent(p_metadata jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(p_metadata->'moment'->>'cellKind', '') = 'd1'
      OR COALESCE(p_metadata->'lifecycle'->>'severity', '') = 'critical'
$function$;

CREATE OR REPLACE FUNCTION public.amora_care_posts_on_kst_day(
  p_couple_id uuid,
  p_at timestamptz
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT count(*)::integer
  FROM public.chat_messages AS message
  WHERE message.couple_id = p_couple_id
    AND message.sender_id IS NULL
    AND message.sender_type = 'ai'
    AND message.role = 'assistant'
    AND message.visibility = 'shared'
    AND (
      message.metadata->>'client_request_id' LIKE 'moment:%'
      OR message.metadata->>'client_request_id' LIKE 'lifecycle:%'
      OR message.metadata->>'client_request_id' LIKE 'saved-notes-recall:%'
    )
    AND message.created_at >= (((p_at AT TIME ZONE 'Asia/Seoul')::date)::timestamp AT TIME ZONE 'Asia/Seoul')
    AND message.created_at < ((((p_at AT TIME ZONE 'Asia/Seoul')::date + 1))::timestamp AT TIME ZONE 'Asia/Seoul')
$function$;

-- Returns 'allowed', 'intensity_filtered', or 'daily_care_limit'. Callers hold
-- the per-couple advisory lock until their insert commits, so two paths cannot
-- both see room under the cap.
CREATE OR REPLACE FUNCTION public.amora_care_post_allowance(
  p_couple_id uuid,
  p_metadata jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_cadence jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('amora_care_daily_cap:' || p_couple_id::text, 0)
  );
  v_cadence := public.amora_care_couple_cadence(p_couple_id);
  IF v_cadence->>'intensity' = 'light'
     AND NOT public.amora_care_is_imminent(COALESCE(p_metadata, '{}'::jsonb)) THEN
    RETURN 'intensity_filtered';
  END IF;
  IF public.amora_care_posts_on_kst_day(p_couple_id, now())
       >= (v_cadence->>'daily_limit')::integer THEN
    RETURN 'daily_care_limit';
  END IF;
  RETURN 'allowed';
END
$function$;

-- Screen-open paths (lifecycle guardrail, saved-note recall, and the moment
-- insert that delegates here) all pass through this function. NULL still means
-- "nothing was inserted", which those callers already treat as a quiet no-op.
ALTER FUNCTION public.insert_amora_care_message(uuid, text, jsonb)
  RENAME TO insert_amora_care_message_pre_cadence;

CREATE OR REPLACE FUNCTION public.insert_amora_care_message(
  p_couple_id uuid,
  p_content text,
  p_metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
BEGIN
  IF public.amora_care_post_allowance(p_couple_id, p_metadata) <> 'allowed' THEN
    RETURN NULL;
  END IF;
  RETURN public.insert_amora_care_message_pre_cadence(
    p_couple_id,
    p_content,
    p_metadata
  );
END
$function$;

-- Unchanged from 20260802090000 except that it takes the per-couple cap lock
-- first, so every path uses the same advisory -> couples -> journey order.
CREATE OR REPLACE FUNCTION public.insert_amora_moment_care_message(
  p_couple_id uuid,
  p_expected_journey_revision bigint,
  p_content text,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_current_revision bigint;
  v_message_id uuid;
BEGIN
  IF p_expected_journey_revision IS NULL
     OR p_expected_journey_revision < 0
     OR p_expected_journey_revision > 9007199254740991 THEN
    RAISE EXCEPTION 'AMORA_MOMENT_CARE_REVISION_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('amora_care_daily_cap:' || p_couple_id::text, 0)
  );

  PERFORM 1
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'source_stale');
  END IF;

  SELECT journey.state_revision
  INTO v_current_revision
  FROM public.wedding_journeys AS journey
  WHERE journey.couple_id = p_couple_id
  FOR SHARE;

  IF NOT FOUND OR v_current_revision IS DISTINCT FROM p_expected_journey_revision THEN
    RETURN jsonb_build_object(
      'state', 'source_stale',
      'current_revision', v_current_revision
    );
  END IF;

  v_message_id := public.insert_amora_care_message(
    p_couple_id,
    p_content,
    p_metadata
  );

  IF v_message_id IS NULL THEN
    RETURN jsonb_build_object('state', 'consent_required');
  END IF;

  RETURN jsonb_build_object(
    'state', 'inserted',
    'message_id', v_message_id
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.amora_care_cancel_job_internal(
  p_job_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.amora_care_deliveries
  SET status = 'cancelled', completed_at = now(), updated_at = now(),
      recipient_email = NULL, recipient_name = NULL,
      last_error = p_reason
  WHERE job_id = p_job_id AND status IN ('pending', 'processing');
  UPDATE public.amora_care_jobs
  SET status = 'cancelled', completed_at = now(), updated_at = now(),
      lease_token = NULL, lease_expires_at = NULL,
      last_error = p_reason,
      content = '[redacted]', email_subject = NULL, email_html = NULL,
      metadata = '{}'::jsonb
  WHERE id = p_job_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.amora_care_release_job_internal(
  p_job_id uuid,
  p_available_at timestamptz,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.amora_care_deliveries
  SET status = 'pending', updated_at = now()
  WHERE job_id = p_job_id AND status = 'processing';
  UPDATE public.amora_care_jobs
  SET status = 'pending',
      attempt_count = GREATEST(0, attempt_count - 1),
      available_at = p_available_at,
      claimed_at = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error = p_reason,
      updated_at = now()
  WHERE id = p_job_id;
END
$function$;

-- The worker found that the day's cell no longer exists in the current plan
-- (the event was cancelled, completed, or moved). Close the job without
-- writing anything to the shared chat.
CREATE OR REPLACE FUNCTION public.cancel_amora_care_job_source_changed(
  p_job_id uuid,
  p_lease_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_job public.amora_care_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.amora_care_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'processing'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_LEASE_LOST' USING ERRCODE = '55000';
  END IF;
  PERFORM public.amora_care_cancel_job_internal(v_job.id, 'source_changed');
  RETURN jsonb_build_object('state', 'cancelled', 'reason', 'source_changed');
END
$function$;

ALTER FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean)
  RENAME TO prepare_amora_care_job_pre_cadence;

CREATE OR REPLACE FUNCTION public.prepare_amora_care_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_email_enabled boolean,
  p_expected_journey_revision bigint DEFAULT NULL,
  p_content text DEFAULT NULL,
  p_email_subject text DEFAULT NULL,
  p_email_html text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_job public.amora_care_jobs%ROWTYPE;
  v_revision bigint;
  v_cadence jsonb;
  v_policy_now timestamptz;
  v_local timestamp;
  v_start_hour integer;
  v_end_hour integer;
  v_allowance text;
BEGIN
  SELECT * INTO v_job
  FROM public.amora_care_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'processing'
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_LEASE_LOST' USING ERRCODE = '55000';
  END IF;

  IF (p_content IS NULL) <> (p_expected_journey_revision IS NULL)
     OR (p_content IS NOT NULL AND char_length(p_content) NOT BETWEEN 1 AND 2000)
     OR (p_email_subject IS NULL) <> (p_email_html IS NULL)
     OR (p_email_subject IS NOT NULL AND (
       p_content IS NULL
       OR char_length(p_email_subject) NOT BETWEEN 1 AND 300
       OR char_length(p_email_html) NOT BETWEEN 1 AND 20000
     ))
     OR (p_expected_journey_revision IS NOT NULL AND (
       p_expected_journey_revision < 0
       OR p_expected_journey_revision > 9007199254740991
     )) THEN
    RAISE EXCEPTION 'AMORA_CARE_JOB_REFRESH_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Take the per-couple cap lock before any couple row lock, the same order as
  -- insert_amora_care_message (advisory -> couples), so the two paths cannot
  -- wait on each other in a cycle. Advisory locks are re-entrant in a session.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('amora_care_daily_cap:' || v_job.couple_id::text, 0)
  );
  -- Same couple -> journey lock order as insert_amora_moment_care_message.
  PERFORM 1 FROM public.couples WHERE id = v_job.couple_id FOR SHARE;

  -- Once the shared message is posted, a later run only finishes the email
  -- deliveries. The posted text is final: the email must repeat it exactly
  -- (Resend replays one idempotency key only with the same request), and the
  -- post already counted against the day, so no cadence check runs again.
  IF v_job.chat_message_id IS NOT NULL THEN
    RETURN public.prepare_amora_care_job_pre_cadence(
      p_job_id,
      p_lease_token,
      p_email_enabled
    );
  END IF;

  IF p_expected_journey_revision IS NOT NULL THEN
    SELECT journey.state_revision INTO v_revision
    FROM public.wedding_journeys AS journey
    WHERE journey.couple_id = v_job.couple_id
    FOR SHARE;
    IF NOT FOUND OR v_revision IS DISTINCT FROM p_expected_journey_revision THEN
      -- The plan moved between the worker's read and this insert. Do not post
      -- anything computed from the old plan; the worker recomputes shortly.
      PERFORM public.amora_care_release_job_internal(
        v_job.id,
        now() + interval '1 minute',
        'source_stale'
      );
      RETURN jsonb_build_object('state', 'deferred', 'reason', 'source_stale');
    END IF;
    UPDATE public.amora_care_jobs
    SET content = p_content,
        email_subject = p_email_subject,
        email_html = p_email_html,
        updated_at = now()
    WHERE id = v_job.id;
  END IF;

  v_policy_now := public.amora_care_delivery_clock();
  v_local := v_policy_now AT TIME ZONE 'Asia/Seoul';
  IF v_job.scan_day = v_local::date THEN
    v_cadence := public.amora_care_couple_cadence(v_job.couple_id);
    v_start_hour := (v_cadence->>'window_start_hour')::integer;
    v_end_hour := (v_cadence->>'window_end_hour')::integer;
    IF v_start_hour >= v_end_hour THEN
      PERFORM public.amora_care_cancel_job_internal(v_job.id, 'no_shared_care_window');
      RETURN jsonb_build_object('state', 'cancelled', 'reason', 'no_shared_care_window');
    END IF;
    IF v_local < v_job.scan_day + make_interval(hours => v_start_hour) THEN
      PERFORM public.amora_care_release_job_internal(
        v_job.id,
        (v_job.scan_day + make_interval(hours => v_start_hour)) AT TIME ZONE 'Asia/Seoul',
        'outside_delivery_window'
      );
      RETURN jsonb_build_object(
        'state', 'deferred',
        'reason', 'outside_delivery_window',
        'available_at',
        (v_job.scan_day + make_interval(hours => v_start_hour)) AT TIME ZONE 'Asia/Seoul'
      );
    END IF;
    IF v_local >= v_job.scan_day + make_interval(hours => v_end_hour) THEN
      PERFORM public.amora_care_cancel_job_internal(v_job.id, 'outside_care_window');
      RETURN jsonb_build_object('state', 'cancelled', 'reason', 'outside_care_window');
    END IF;

    SELECT * INTO v_job FROM public.amora_care_jobs WHERE id = p_job_id;
    v_allowance := public.amora_care_post_allowance(v_job.couple_id, v_job.metadata);
    IF v_allowance <> 'allowed' THEN
      PERFORM public.amora_care_cancel_job_internal(v_job.id, v_allowance);
      RETURN jsonb_build_object('state', 'cancelled', 'reason', v_allowance);
    END IF;
  END IF;

  -- The wrapped function still owns the global 09:00-20:00 fence, expiry,
  -- unanimous consent, roster, the chat insert, and the email deliveries.
  RETURN public.prepare_amora_care_job_pre_cadence(
    p_job_id,
    p_lease_token,
    p_email_enabled
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.set_amora_care_cadence(
  p_user_id uuid,
  p_intensity text DEFAULT NULL,
  p_window_start_hour integer DEFAULT NULL,
  p_window_end_hour integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR (p_intensity IS NULL AND p_window_start_hour IS NULL AND p_window_end_hour IS NULL)
     OR (p_intensity IS NOT NULL AND p_intensity NOT IN ('light', 'normal', 'more'))
     OR (p_window_start_hour IS NOT NULL AND p_window_start_hour NOT BETWEEN 9 AND 19)
     OR (p_window_end_hour IS NOT NULL AND p_window_end_hour NOT BETWEEN 10 AND 20) THEN
    RAISE EXCEPTION 'AMORA_CARE_CADENCE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_CARE_CADENCE_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(p_window_start_hour, v_profile.care_window_start_hour)
       >= COALESCE(p_window_end_hour, v_profile.care_window_end_hour) THEN
    RAISE EXCEPTION 'AMORA_CARE_CADENCE_WINDOW_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET care_intensity = COALESCE(p_intensity, care_intensity),
      care_window_start_hour = COALESCE(p_window_start_hour, care_window_start_hour)::smallint,
      care_window_end_hour = COALESCE(p_window_end_hour, care_window_end_hour)::smallint,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'intensity', v_profile.care_intensity,
    'window_start_hour', v_profile.care_window_start_hour,
    'window_end_hour', v_profile.care_window_end_hour
  );
END
$function$;

ALTER FUNCTION public.prevent_direct_amora_care_consent_change() OWNER TO postgres;
ALTER FUNCTION public.amora_care_couple_cadence(uuid) OWNER TO postgres;
ALTER FUNCTION public.amora_care_is_imminent(jsonb) OWNER TO postgres;
ALTER FUNCTION public.amora_care_posts_on_kst_day(uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.amora_care_post_allowance(uuid, jsonb) OWNER TO postgres;
ALTER FUNCTION public.insert_amora_care_message(uuid, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.insert_amora_care_message_pre_cadence(uuid, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.insert_amora_moment_care_message(uuid, bigint, text, jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.amora_care_cancel_job_internal(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.amora_care_release_job_internal(uuid, timestamptz, text) OWNER TO postgres;
ALTER FUNCTION public.cancel_amora_care_job_source_changed(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean, bigint, text, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.prepare_amora_care_job_pre_cadence(uuid, uuid, boolean) OWNER TO postgres;
ALTER FUNCTION public.set_amora_care_cadence(uuid, text, integer, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_direct_amora_care_consent_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_care_is_imminent(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amora_care_posts_on_kst_day(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_care_post_allowance(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.insert_amora_care_message_pre_cadence(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_care_cancel_job_internal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_care_release_job_internal(uuid, timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_amora_care_job_pre_cadence(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_care_couple_cadence(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_amora_care_message(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_amora_care_job_source_changed(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_amora_care_cadence(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.insert_amora_moment_care_message(uuid, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_amora_moment_care_message(uuid, bigint, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.amora_care_couple_cadence(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_amora_care_message(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_amora_care_job_source_changed(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_amora_care_job(uuid, uuid, boolean, bigint, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_amora_care_cadence(uuid, text, integer, integer)
  TO service_role;

COMMENT ON COLUMN public.profiles.care_intensity IS
  'Shared-chat care intensity chosen by the person: light (day-before checks only), normal (1/day), more (3/day). The couple uses the most careful member value.';
COMMENT ON COLUMN public.profiles.care_window_start_hour IS
  'First KST hour (inclusive, 9-19) the person accepts scheduled care. The couple uses the overlap of both windows.';
COMMENT ON COLUMN public.profiles.care_window_end_hour IS
  'KST hour (exclusive, 10-20) after which the person declines scheduled care.';

DO $postconditions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_care_cadence_valid'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'AMORA_CARE_CADENCE_SCHEMA_POSTCONDITION_FAILED';
  END IF;

  IF to_regprocedure('public.prepare_amora_care_job(uuid,uuid,boolean)') IS NOT NULL
     OR NOT has_function_privilege(
       'service_role',
       'public.prepare_amora_care_job(uuid,uuid,boolean,bigint,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.prepare_amora_care_job(uuid,uuid,boolean,bigint,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.prepare_amora_care_job_pre_cadence(uuid,uuid,boolean)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.insert_amora_care_message_pre_cadence(uuid,text,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.insert_amora_care_message(uuid,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.set_amora_care_cadence(uuid,text,integer,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.amora_care_post_allowance(uuid,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_CARE_CADENCE_PRIVILEGE_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;

COMMIT;
