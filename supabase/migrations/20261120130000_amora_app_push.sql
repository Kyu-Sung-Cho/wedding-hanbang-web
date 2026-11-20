BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 2026-11-20 결정 D-86 "아모라 앱 알림" (설계 25장 2절·5절).
--
-- 내용 없는 알림("아모라가 정리한 게 있어요")을
--   1. 앱 알림에 따로 동의한 사람에게만 (메일 동의·커뮤니티 답글 알림 동의와 다른 칸),
--   2. 한국 시각 09~20시에만 (사람이 받는 시간을 좁혔으면 그 안에서만),
--   3. 하루 상한(KST 날짜마다 2건) 안에서만,
--   4. 같은 일로는 한 번만
-- 보낸다. 네 규칙은 서버 코드가 먼저 보고 이 파일의 함수가 같은 잠금 안에서 다시 지킨다.
--
-- 기기 토큰은 이미 있는 `mobile_push_device_tokens`(설치·사용자·로그인 세션에 묶임)를 그대로 쓰고
-- `get_mobile_push_delivery_targets` 로 지금 살아 있는 기기만 읽는다. 보낸 기록에는 내용을 남기지 않는다
-- (종류, 열 화면 이름, 날짜, 상태, 오류 이름만). 알림 문장은 서버 코드가 정한 고정 문장이고 DB 에 없다.
--
-- 이 파일은 발송 스위치를 켜지 않는다. 발송은 `AMORA_APP_PUSH_ENABLED="true"` 와 `EXPO_ACCESS_TOKEN` 이
-- 둘 다 있을 때만 서버 코드가 부른다(기본 꺼짐).

CREATE TABLE IF NOT EXISTS public.amora_push_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  consent_version smallint,
  consented_at timestamptz,
  disabled_at timestamptz DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT amora_push_preferences_consent_shape CHECK (
    (enabled AND consent_version = 1 AND consented_at IS NOT NULL AND disabled_at IS NULL)
    OR (NOT enabled AND consent_version IS NULL AND consented_at IS NULL AND disabled_at IS NOT NULL)
  )
);

ALTER TABLE public.amora_push_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_push_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_push_preferences FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.amora_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('today_one', 'task_done')),
  dedupe_key text NOT NULL CHECK (dedupe_key ~ '^[a-z0-9:_-]{1,120}$'),
  route text NOT NULL CHECK (route IN ('home', 'chat')),
  kst_date date NOT NULL,
  state text NOT NULL DEFAULT 'claimed'
    CHECK (state IN ('claimed', 'ticketed', 'provider_failed')),
  target_count smallint NOT NULL CHECK (target_count BETWEEN 1 AND 8),
  ticketed_count smallint NOT NULL DEFAULT 0 CHECK (ticketed_count BETWEEN 0 AND 8),
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'DeviceNotRegistered', 'MessageTooBig', 'MessageRateExceeded', 'MismatchSenderId',
      'InvalidCredentials', 'ExpoServerError', 'network_error', 'invalid_response'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT amora_push_deliveries_dedupe_unique UNIQUE (recipient_id, dedupe_key),
  CONSTRAINT amora_push_deliveries_ticket_shape CHECK (
    (state = 'claimed' AND ticketed_count = 0)
    OR (state = 'ticketed' AND ticketed_count BETWEEN 1 AND target_count)
    OR (state = 'provider_failed' AND ticketed_count = 0 AND last_error_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS amora_push_deliveries_daily_idx
  ON public.amora_push_deliveries (recipient_id, kst_date);

ALTER TABLE public.amora_push_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_push_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.amora_push_deliveries FROM PUBLIC, anon, authenticated, service_role;

-- 시험이 시각을 바꿔 볼 수 있게 시계를 한 곳에 둔다(오늘의 한 가지의 `amora_today_one_clock` 과 같은 방식).
CREATE OR REPLACE FUNCTION public.amora_push_clock()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT clock_timestamp()
$function$;

-- 사람이 받는 시간(10장 P2, `profiles.care_window_*`)과 09~20시를 겹친 창이 지금 열려 있는가.
CREATE OR REPLACE FUNCTION public.amora_push_window_open(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_hour integer := extract(hour FROM (public.amora_push_clock() AT TIME ZONE 'Asia/Seoul'))::integer;
  v_start integer := 9;
  v_end integer := 20;
BEGIN
  SELECT greatest(9, coalesce(profile.care_window_start_hour, 9)),
         least(20, coalesce(profile.care_window_end_hour, 20))
  INTO v_start, v_end
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id;
  -- 프로필 줄이 없으면 SELECT INTO 가 위 기본값을 NULL 로 덮는다. 받는 시간을 모르면 열지 않는다.
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN v_start < v_end AND v_hour >= v_start AND v_hour < v_end;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_amora_push_preference()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row public.amora_push_preferences%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AMORA_PUSH_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.amora_push_preferences WHERE user_id = v_user;
  RETURN jsonb_build_object(
    'enabled', coalesce(v_row.enabled, false),
    'consentedAt', CASE WHEN v_row.enabled THEN v_row.consented_at END
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.set_amora_push_preference(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AMORA_PUSH_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'AMORA_PUSH_PREFERENCE_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('amora-push:' || v_user::text, 0));

  INSERT INTO public.amora_push_preferences AS preference (
    user_id, enabled, consent_version, consented_at, disabled_at, updated_at
  )
  VALUES (
    v_user,
    p_enabled,
    CASE WHEN p_enabled THEN 1 END,
    CASE WHEN p_enabled THEN v_now END,
    CASE WHEN p_enabled THEN NULL ELSE v_now END,
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE SET
    enabled = excluded.enabled,
    consent_version = excluded.consent_version,
    -- 이미 켜져 있던 사람이 다시 켜면 처음 동의 시각을 그대로 둔다.
    consented_at = CASE
      WHEN excluded.enabled AND preference.enabled THEN preference.consented_at
      ELSE excluded.consented_at
    END,
    disabled_at = CASE
      WHEN NOT excluded.enabled AND NOT preference.enabled THEN preference.disabled_at
      ELSE excluded.disabled_at
    END,
    updated_at = v_now;

  RETURN public.get_amora_push_preference();
END
$function$;

-- 보내기 전에 한 번 부른다. 받을 사람·시간·상한·중복을 사용자별 잠금 안에서 보고, 보내도 되면 기록 한 줄과
-- 지금 살아 있는 기기 목록을 돌려준다. 보내면 안 되면 이유 하나만 돌려주고 아무것도 쓰지 않는다.
CREATE OR REPLACE FUNCTION public.claim_amora_push_delivery(
  p_recipient_id uuid,
  p_kind text,
  p_dedupe_key text,
  p_route text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_daily_cap constant integer := 2;
  v_today date := (public.amora_push_clock() AT TIME ZONE 'Asia/Seoul')::date;
  v_sent_today integer;
  v_targets jsonb;
  v_target_count integer;
  v_delivery_id uuid;
  v_window_end_hour integer;
BEGIN
  IF p_recipient_id IS NULL
     OR p_kind IS NULL OR p_kind NOT IN ('today_one', 'task_done')
     OR p_route IS NULL OR p_route NOT IN ('home', 'chat')
     OR p_dedupe_key IS NULL OR p_dedupe_key !~ '^[a-z0-9:_-]{1,120}$' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('amora-push:' || p_recipient_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.amora_push_preferences AS preference
    WHERE preference.user_id = p_recipient_id AND preference.enabled
  ) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_consented');
  END IF;

  IF NOT coalesce(public.amora_push_window_open(p_recipient_id), false) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'quiet_hours');
  END IF;
  -- 꺼져 있던 기기가 나중에 켜져도 받는 시간이 끝난 뒤에는 오지 않게, 그 사람의 받는 시간이 끝나는 시각을
  -- 돌려준다(보내는 쪽이 알림의 ttl 을 그때까지로 줄인다). 위 창 검사가 프로필 줄이 있는 것을 확인했다.
  SELECT least(20, coalesce(profile.care_window_end_hour, 20))
  INTO v_window_end_hour
  FROM public.profiles AS profile
  WHERE profile.id = p_recipient_id;

  IF EXISTS (
    SELECT 1 FROM public.amora_push_deliveries AS delivery
    WHERE delivery.recipient_id = p_recipient_id AND delivery.dedupe_key = p_dedupe_key
  ) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'duplicate');
  END IF;

  -- 실제로 Expo 에 넘긴 것(또는 넘기는 중인 것)만 상한에 센다. 공급자가 거절한 건은 세지 않는다.
  SELECT count(*) INTO v_sent_today
  FROM public.amora_push_deliveries AS delivery
  WHERE delivery.recipient_id = p_recipient_id
    AND delivery.kst_date = v_today
    AND delivery.state IN ('claimed', 'ticketed');
  IF v_sent_today >= v_daily_cap THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'daily_cap');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'installationId', target.installation_id,
           'pushToken', target.push_token,
           'platform', target.platform,
           'bindingEpoch', target.binding_epoch
         ) ORDER BY target.installation_id), '[]'::jsonb),
         count(*)
  INTO v_targets, v_target_count
  FROM public.get_mobile_push_delivery_targets(p_recipient_id) AS target;
  IF v_target_count = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_device');
  END IF;

  INSERT INTO public.amora_push_deliveries (
    recipient_id, kind, dedupe_key, route, kst_date, target_count
  )
  VALUES (
    p_recipient_id, p_kind, p_dedupe_key, p_route, v_today, least(v_target_count, 8)
  )
  RETURNING id INTO v_delivery_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'deliveryId', v_delivery_id,
    'targets', v_targets,
    'windowEndsAt', (v_today + make_interval(hours => v_window_end_hour)) AT TIME ZONE 'Asia/Seoul'
  );
END
$function$;

-- 보낸 결과를 적는다. 공급자가 "등록되지 않은 기기"라고 한 기기는 그 설치·판만 해제한다
-- (커뮤니티 발송기의 `revoke_notification_push_target` 과 같은 방식).
CREATE OR REPLACE FUNCTION public.record_amora_push_result(
  p_delivery_id uuid,
  p_ticketed_count integer,
  p_error_code text,
  p_unregistered jsonb DEFAULT '[]'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_delivery public.amora_push_deliveries%ROWTYPE;
  v_item jsonb;
BEGIN
  SELECT * INTO v_delivery
  FROM public.amora_push_deliveries AS delivery
  WHERE delivery.id = p_delivery_id
  FOR UPDATE;
  IF NOT FOUND OR v_delivery.state <> 'claimed'
     OR p_ticketed_count IS NULL OR p_ticketed_count < 0 OR p_ticketed_count > v_delivery.target_count
     OR (p_ticketed_count = 0 AND p_error_code IS NULL)
     OR jsonb_typeof(coalesce(p_unregistered, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_unregistered, '[]'::jsonb)) > 8 THEN
    RETURN false;
  END IF;

  UPDATE public.amora_push_deliveries
  SET state = CASE WHEN p_ticketed_count > 0 THEN 'ticketed' ELSE 'provider_failed' END,
      ticketed_count = p_ticketed_count,
      last_error_code = p_error_code,
      updated_at = clock_timestamp()
  WHERE id = p_delivery_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_unregistered, '[]'::jsonb)) LOOP
    UPDATE public.mobile_push_device_tokens AS device_token
    SET push_token = NULL,
        revoked_at = coalesce(device_token.revoked_at, clock_timestamp()),
        revoke_reason = coalesce(device_token.revoke_reason, 'provider_device_not_registered'),
        last_seen_at = clock_timestamp()
    WHERE device_token.installation_id = (v_item->>'installationId')::uuid
      AND device_token.binding_epoch = (v_item->>'bindingEpoch')::bigint
      AND device_token.user_id = v_delivery.recipient_id
      AND device_token.revoked_at IS NULL
      AND device_token.push_token IS NOT NULL;
  END LOOP;
  RETURN true;
END
$function$;

-- 아침 "오늘의 한 가지" 알림을 받을 수 있는 사람. 앱 알림과 오늘의 한 가지를 둘 다 켰고(멈춤 아님), 오늘 카드를
-- 아직 받지 않았고(앱을 이미 열었으면 알릴 필요가 없다), 오늘 이 알림을 아직 받지 않았고, 받는 시간 창이 열린 사람.
CREATE OR REPLACE FUNCTION public.list_amora_today_one_push_recipients(p_limit integer DEFAULT 50)
RETURNS TABLE (user_id uuid, couple_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
  SELECT profile.id, profile.couple_id
  FROM public.amora_push_preferences AS push
  JOIN public.amora_today_one_preferences AS today_one ON today_one.user_id = push.user_id
  JOIN public.profiles AS profile ON profile.id = push.user_id
  WHERE push.enabled
    AND today_one.enabled
    AND (today_one.paused_until IS NULL OR today_one.paused_until <= public.amora_push_clock())
    AND profile.couple_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.amora_today_one_recipient_states AS card
      WHERE card.recipient_user_id = push.user_id
        AND card.claimed_for_date = (public.amora_push_clock() AT TIME ZONE 'Asia/Seoul')::date
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.amora_push_deliveries AS delivery
      WHERE delivery.recipient_id = push.user_id
        AND delivery.dedupe_key = 'today_one:' || to_char((public.amora_push_clock() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')
    )
    AND public.amora_push_window_open(push.user_id)
  ORDER BY profile.id
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
$function$;

ALTER FUNCTION public.amora_push_clock() OWNER TO postgres;
ALTER FUNCTION public.amora_push_window_open(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_amora_push_preference() OWNER TO postgres;
ALTER FUNCTION public.set_amora_push_preference(boolean) OWNER TO postgres;
ALTER FUNCTION public.claim_amora_push_delivery(uuid, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.record_amora_push_result(uuid, integer, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.list_amora_today_one_push_recipients(integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.amora_push_clock() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_push_window_open(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_amora_push_preference() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_amora_push_preference(boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_amora_push_delivery(uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_amora_push_result(uuid, integer, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_amora_today_one_push_recipients(integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_amora_push_preference() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_amora_push_preference(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_amora_push_delivery(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_amora_push_result(uuid, integer, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_amora_today_one_push_recipients(integer) TO service_role;

COMMENT ON TABLE public.amora_push_preferences IS
  'Per-user explicit opt-in for content-free Amora app pushes (D-86). Separate from email and community reply push consent.';
COMMENT ON TABLE public.amora_push_deliveries IS
  'Content-free Amora push ledger: kind, route key, KST date, state and provider error name only. Enforces dedupe and the daily cap.';

DO $postconditions$
BEGIN
  IF has_table_privilege('authenticated', 'public.amora_push_preferences', 'SELECT')
     OR has_table_privilege('service_role', 'public.amora_push_preferences', 'SELECT')
     OR has_table_privilege('authenticated', 'public.amora_push_deliveries', 'SELECT')
     OR has_table_privilege('service_role', 'public.amora_push_deliveries', 'SELECT')
     OR has_table_privilege('anon', 'public.amora_push_deliveries', 'SELECT') THEN
    RAISE EXCEPTION 'AMORA_APP_PUSH_TABLE_ACL_POSTCONDITION_FAILED';
  END IF;
  IF has_function_privilege('authenticated', 'public.claim_amora_push_delivery(uuid, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_amora_push_result(uuid, integer, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.list_amora_today_one_push_recipients(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_amora_push_preference(boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.set_amora_push_preference(boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_amora_push_delivery(uuid, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AMORA_APP_PUSH_FUNCTION_ACL_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;

COMMIT;
