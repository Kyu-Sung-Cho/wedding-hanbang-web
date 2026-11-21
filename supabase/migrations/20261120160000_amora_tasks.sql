-- 20261120160000: 아모라가 맡은 일 (D-84 맡은 일, D-88 비용 한도, 25장 갈래 4)
--
-- 2026-11-20 파운더 결정(18장 9절, 원문 "시작해 줘"): 읽기·찾기·정리·초안은 대화 밖에서도 한다. 계획을 바꾸는
-- 쓰기는 카드로 묻고, 밖으로 보내는 일은 커플이 한다. 맡은 일은 카드 한 번을 눌러 시작한다.
--
--   - 대화의 카드(offer)는 공유 대화에서만 나온다. 결과는 두 사람이 함께 보므로 "나만 상담" 의 말이 상대에게
--     가지 않게 한다(01장 I8). 카드는 24시간 뒤 닫힌다.
--   - 누르면(start) 대기열에 들어간다. 커플마다 한국 날짜 하루에 맡길 수 있는 수가 정해져 있다(D-88, 기본 3).
--   - 일꾼(크론)은 한 번에 한 일을 선점한다. 선점에는 매번 새 토큰이 붙고, 진행 저장·사용량 예약·끝내기는
--     그 토큰이 맞을 때만 된다. 다른 일꾼이 다시 선점하면 앞 일꾼의 쓰기는 모두 거절된다(펜싱).
--   - 모델 걸음과 인터넷 찾기는 걸음마다 먼저 예약한다. 일 하나의 상한, 커플의 하루 상한(D-88 기본 60·30),
--     서비스 전체의 하루 금액 상한(전역 상한의 20%, 앱이 계산해 넘긴다)을 한 거래에서 함께 본다.
--     넘으면 예약하지 않고 까닭을 돌려준다. 일꾼은 그 일을 "확인해 주세요" 로 둔다.
--   - 이 표들에는 쓰기 도구의 실행이 없다. 계획(예산·일정·할 일)을 바꾸는 줄은 여기서 생기지 않는다.
--     결과의 "다음에 할 일" 은 대화 입력칸에 채울 글일 뿐이고, 반영은 대화의 확인 카드로만 한다(01장 I1).
--   - 회원은 자기 커플 줄만 읽고, 그중 화면에 쓰는 칸만 받는다. 입력 조건, 일꾼의 중간 기록, 선점 토큰,
--     비용, 오류 코드는 서버만 본다. 쓰기는 모두 service_role 전용 함수가 한다.
--   - 탈퇴가 진행 중인 사람이 속한 커플의 일은 일꾼이 잡지 않고, 새로 맡기지도 못한다. 커플 줄이 지워지면
--     맡은 일도 함께 지워진다. 맡긴 사람의 계정이 지워지면 그 칸만 비운다(공유 기록은 남는 것과 같은 규칙).
--   - 대화 내용을 지울 수 없는 기록으로 쌓지 않는다(01장 I13). 걸음 기록에는 서버가 정한 짧은 이름만 남는다.
--   - 기존 표는 건드리지 않는다(트리거·칸·정책 모두 새 표에만 있다).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 0) 도우미
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.amora_task_kst_day(p_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT (p_at AT TIME ZONE 'Asia/Seoul')::date;
$function$;

-- 탈퇴가 끝나지 않은 사람이 그 커플에 있는가.
CREATE FUNCTION public.amora_task_couple_deletion_pending(p_couple_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.couples AS couple
    JOIN public.account_deletion_jobs AS deletion
      ON deletion.user_id IN (couple.bride_id, couple.groom_id)
    WHERE couple.id = p_couple_id
      AND deletion.status <> 'completed'
  );
$function$;

-- ---------------------------------------------------------------------------
-- 1) 맡은 일
-- ---------------------------------------------------------------------------

CREATE TABLE public.amora_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'offered',
  title text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_lane text NOT NULL,
  source_request_key text NOT NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  review_reason text,
  error_code text,
  model_steps integer NOT NULL DEFAULT 0,
  web_searches integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  reserved_cost_microusd bigint NOT NULL DEFAULT 0,
  cost_microusd bigint NOT NULL DEFAULT 0,
  run_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  lease_token uuid,
  leased_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  notify_state text NOT NULL DEFAULT 'none',
  notify_attempts integer NOT NULL DEFAULT 0,
  notify_claimed_at timestamptz,
  notify_reason text,
  offer_expires_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amora_tasks_kind_check CHECK (kind IN (
    'hall_candidates', 'sdm_candidates', 'quote_compare', 'todo_deadlines',
    'inquiry_letters', 'reply_digest', 'date_candidates'
  )),
  CONSTRAINT amora_tasks_status_check CHECK (status IN (
    'offered', 'queued', 'searching', 'organizing', 'needs_review', 'done', 'cancelled', 'expired'
  )),
  CONSTRAINT amora_tasks_title_check CHECK (
    char_length(title) BETWEEN 1 AND 80
    AND NOT public.couple_plan_change_has_unsafe_display_text(title)
  ),
  CONSTRAINT amora_tasks_input_check CHECK (
    jsonb_typeof(input) = 'object' AND octet_length(input::text) <= 8192
  ),
  CONSTRAINT amora_tasks_source_lane_check CHECK (source_lane = 'shared'),
  CONSTRAINT amora_tasks_source_request_key_check CHECK (
    source_request_key ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT amora_tasks_progress_check CHECK (
    jsonb_typeof(progress) = 'object' AND octet_length(progress::text) <= 262144
  ),
  CONSTRAINT amora_tasks_steps_check CHECK (
    jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 30 AND octet_length(steps::text) <= 8192
  ),
  CONSTRAINT amora_tasks_result_check CHECK (
    result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 65536)
  ),
  CONSTRAINT amora_tasks_review_reason_check CHECK (
    review_reason IS NULL OR review_reason IN (
      'daily_step_limit', 'daily_search_limit', 'background_budget', 'task_step_limit',
      'gate_blocked', 'needs_input', 'source_unavailable', 'failed', 'stale'
    )
  ),
  CONSTRAINT amora_tasks_review_reason_status_check CHECK (
    (status = 'needs_review') = (review_reason IS NOT NULL)
  ),
  CONSTRAINT amora_tasks_error_code_check CHECK (
    error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'
  ),
  CONSTRAINT amora_tasks_counters_check CHECK (
    model_steps >= 0 AND web_searches >= 0 AND input_tokens >= 0 AND output_tokens >= 0
    AND reserved_cost_microusd >= 0 AND cost_microusd >= 0 AND run_count >= 0
    AND failure_count >= 0 AND notify_attempts >= 0
  ),
  CONSTRAINT amora_tasks_lease_pair_check CHECK ((lease_token IS NULL) = (leased_until IS NULL)),
  CONSTRAINT amora_tasks_lease_running_check CHECK (
    lease_token IS NULL OR status IN ('searching', 'organizing')
  ),
  CONSTRAINT amora_tasks_started_check CHECK (
    status IN ('offered', 'expired', 'cancelled') OR started_at IS NOT NULL
  ),
  CONSTRAINT amora_tasks_notify_state_check CHECK (notify_state IN ('none', 'pending', 'sent', 'skipped')),
  -- 앱 알림 함수(갈래 2 sendAmoraPush)가 돌려준 까닭. 값을 담지 않는 짧은 코드만 남긴다.
  CONSTRAINT amora_tasks_notify_reason_check CHECK (notify_reason IS NULL OR notify_reason ~ '^[a-z_]{1,40}$'),
  CONSTRAINT amora_tasks_offer_unique UNIQUE (couple_id, source_request_key, kind)
);

CREATE INDEX amora_tasks_couple_recent_idx
  ON public.amora_tasks (couple_id, updated_at DESC);
CREATE INDEX amora_tasks_runnable_idx
  ON public.amora_tasks (available_at, created_at)
  WHERE status IN ('queued', 'searching', 'organizing');
CREATE INDEX amora_tasks_offer_expiry_idx
  ON public.amora_tasks (offer_expires_at)
  WHERE status = 'offered';
CREATE INDEX amora_tasks_notify_idx
  ON public.amora_tasks (finished_at)
  WHERE notify_state = 'pending';
CREATE INDEX amora_tasks_requested_by_idx
  ON public.amora_tasks (requested_by)
  WHERE requested_by IS NOT NULL;

COMMENT ON TABLE public.amora_tasks IS
'아모라가 맡은 일(D-84). 읽기·찾기·정리·초안만 한다. 계획을 바꾸는 쓰기와 바깥 전송은 이 표의 일이 아니다. 쓰기는 service_role 함수만 한다.';
COMMENT ON COLUMN public.amora_tasks.input IS
'맡은 일의 조건(종류별 정해진 칸). 서버만 읽는다. 회원 칸 권한에 없다.';
COMMENT ON COLUMN public.amora_tasks.progress IS
'일꾼의 중간 기록(모은 근거와 다음 걸음). 서버만 읽는다.';
COMMENT ON COLUMN public.amora_tasks.steps IS
'화면에 보이는 걸음 기록. 서버가 정한 짧은 이름과 시각만 담는다(최대 30).';
COMMENT ON COLUMN public.amora_tasks.result IS
'같은 기준 표, 출처, 다음에 할 일(대화 입력칸에 채울 글). 반영 권한이 아니다.';

-- ---------------------------------------------------------------------------
-- 2) 하루 사용량(한국 날짜)
-- ---------------------------------------------------------------------------

CREATE TABLE public.amora_task_daily_usage (
  usage_day date NOT NULL,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  tasks_started integer NOT NULL DEFAULT 0,
  model_steps integer NOT NULL DEFAULT 0,
  web_searches integer NOT NULL DEFAULT 0,
  reserved_cost_microusd bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_day, couple_id),
  CONSTRAINT amora_task_daily_usage_counters_check CHECK (
    tasks_started >= 0 AND model_steps >= 0 AND web_searches >= 0 AND reserved_cost_microusd >= 0
  )
);

CREATE TABLE public.amora_task_global_daily_usage (
  usage_day date PRIMARY KEY,
  model_steps integer NOT NULL DEFAULT 0,
  reserved_cost_microusd bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amora_task_global_daily_usage_counters_check CHECK (
    model_steps >= 0 AND reserved_cost_microusd >= 0
  )
);

COMMENT ON TABLE public.amora_task_daily_usage IS
'커플별 하루(한국 날짜) 맡은 일 수, 모델 걸음, 인터넷 찾기 수. 서버만 읽고 쓴다.';
COMMENT ON TABLE public.amora_task_global_daily_usage IS
'서비스 전체의 하루 맡은 일 예약 금액. 전역 하루 금액 상한의 20%(D-88)를 넘지 않게 한다.';

-- ---------------------------------------------------------------------------
-- 3) 카드 만들기 (대화의 offer_amora_task 도구가 부른다)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.offer_amora_task(
  p_couple_id uuid,
  p_requested_by uuid,
  p_source_lane text,
  p_source_request_key text,
  p_kind text,
  p_title text,
  p_input jsonb,
  p_offer_ttl_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_existing public.amora_tasks%ROWTYPE;
  v_open integer;
  v_id uuid;
  v_expires timestamptz;
  v_visibility text;
BEGIN
  IF p_couple_id IS NULL OR p_requested_by IS NULL
     OR p_offer_ttl_seconds IS NULL OR p_offer_ttl_seconds < 600 OR p_offer_ttl_seconds > 172800 THEN
    RAISE EXCEPTION 'AMORA_TASK_OFFER_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_source_lane IS DISTINCT FROM 'shared' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'shared_lane_only');
  END IF;
  IF p_source_request_key IS NULL
     OR p_source_request_key NOT LIKE ('chat:' || p_requested_by::text || ':%') THEN
    RAISE EXCEPTION 'AMORA_TASK_OFFER_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_current_couple_member(p_requested_by, p_couple_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_member');
  END IF;
  IF public.amora_task_couple_deletion_pending(p_couple_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'deletion_pending');
  END IF;

  -- 앱이 넘긴 칸만 믿지 않는다. 그 대화 턴의 선점 기록이 공유 대화인지 DB 에서 다시 본다(01장 I8).
  SELECT claim.visibility INTO v_visibility
  FROM public.amora_chat_request_claims AS claim
  WHERE claim.couple_id = p_couple_id
    AND claim.request_key = p_source_request_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'request_not_found');
  END IF;
  IF v_visibility IS DISTINCT FROM 'shared' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'shared_lane_only');
  END IF;

  -- 같은 대화 턴을 다시 보내도(같은 요청 키) 카드가 둘이 되지 않는다.
  SELECT * INTO v_existing
  FROM public.amora_tasks
  WHERE couple_id = p_couple_id
    AND source_request_key = p_source_request_key
    AND kind = p_kind;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'code', 'existing', 'task_id', v_existing.id,
      'status', v_existing.status, 'offer_expires_at', v_existing.offer_expires_at
    );
  END IF;

  SELECT count(*) INTO v_open
  FROM public.amora_tasks
  WHERE couple_id = p_couple_id
    AND status = 'offered'
    AND offer_expires_at > now();
  IF v_open >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_many_offers');
  END IF;

  v_expires := now() + make_interval(secs => p_offer_ttl_seconds);
  INSERT INTO public.amora_tasks (
    couple_id, requested_by, kind, status, title, input, source_lane, source_request_key, offer_expires_at
  ) VALUES (
    p_couple_id, p_requested_by, p_kind, 'offered', p_title, COALESCE(p_input, '{}'::jsonb),
    p_source_lane, p_source_request_key, v_expires
  )
  ON CONFLICT ON CONSTRAINT amora_tasks_offer_unique DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.amora_tasks
    WHERE couple_id = p_couple_id
      AND source_request_key = p_source_request_key
      AND kind = p_kind;
    RETURN jsonb_build_object(
      'ok', true, 'code', 'existing', 'task_id', v_existing.id,
      'status', v_existing.status, 'offer_expires_at', v_existing.offer_expires_at
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'code', 'offered', 'task_id', v_id, 'status', 'offered', 'offer_expires_at', v_expires
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 4) 사람이 누르는 일: 맡기기, 그만하기, 이어서 하기
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.start_amora_task(
  p_task_id uuid,
  p_actor uuid,
  p_daily_task_cap integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_task public.amora_tasks%ROWTYPE;
  v_day date := public.amora_task_kst_day(now());
  v_started integer;
BEGIN
  IF p_task_id IS NULL OR p_actor IS NULL
     OR p_daily_task_cap IS NULL OR p_daily_task_cap < 0 OR p_daily_task_cap > 50 THEN
    RAISE EXCEPTION 'AMORA_TASK_START_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_task FROM public.amora_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_current_couple_member(p_actor, v_task.couple_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_task.status IN ('queued', 'searching', 'organizing', 'needs_review', 'done') THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_started', 'status', v_task.status);
  END IF;
  IF v_task.status <> 'offered' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'offer_closed', 'status', v_task.status);
  END IF;
  IF v_task.offer_expires_at <= now() THEN
    UPDATE public.amora_tasks SET status = 'expired', updated_at = now() WHERE id = p_task_id;
    RETURN jsonb_build_object('ok', false, 'code', 'offer_expired', 'status', 'expired');
  END IF;
  IF public.amora_task_couple_deletion_pending(v_task.couple_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'deletion_pending');
  END IF;

  INSERT INTO public.amora_task_daily_usage (usage_day, couple_id)
  VALUES (v_day, v_task.couple_id)
  ON CONFLICT (usage_day, couple_id) DO NOTHING;
  SELECT tasks_started INTO v_started
  FROM public.amora_task_daily_usage
  WHERE usage_day = v_day AND couple_id = v_task.couple_id
  FOR UPDATE;
  IF v_started >= p_daily_task_cap THEN
    RETURN jsonb_build_object('ok', false, 'code', 'daily_task_limit');
  END IF;

  UPDATE public.amora_task_daily_usage
  SET tasks_started = tasks_started + 1, updated_at = now()
  WHERE usage_day = v_day AND couple_id = v_task.couple_id;

  UPDATE public.amora_tasks
  SET status = 'queued',
      started_at = now(),
      available_at = now(),
      steps = jsonb_build_array(jsonb_build_object('at', now(), 'label', '맡았어요')),
      updated_at = now()
  WHERE id = p_task_id;

  RETURN jsonb_build_object('ok', true, 'code', 'started', 'status', 'queued');
END
$function$;

CREATE FUNCTION public.cancel_amora_task(p_task_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_task public.amora_tasks%ROWTYPE;
BEGIN
  IF p_task_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'AMORA_TASK_CANCEL_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_task FROM public.amora_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_current_couple_member(p_actor, v_task.couple_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_task.status IN ('done', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object('ok', v_task.status = 'cancelled', 'code', 'closed', 'status', v_task.status);
  END IF;
  UPDATE public.amora_tasks
  SET status = 'cancelled',
      review_reason = NULL,
      lease_token = NULL,
      leased_until = NULL,
      finished_at = now(),
      updated_at = now()
  WHERE id = p_task_id;
  RETURN jsonb_build_object('ok', true, 'code', 'cancelled', 'status', 'cancelled');
END
$function$;

CREATE FUNCTION public.resume_amora_task(p_task_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_task public.amora_tasks%ROWTYPE;
BEGIN
  IF p_task_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'AMORA_TASK_RESUME_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_task FROM public.amora_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_current_couple_member(p_actor, v_task.couple_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_task.status <> 'needs_review'
     OR v_task.review_reason NOT IN (
       'daily_step_limit', 'daily_search_limit', 'background_budget', 'source_unavailable', 'failed'
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_resumable', 'status', v_task.status);
  END IF;
  IF public.amora_task_couple_deletion_pending(v_task.couple_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'deletion_pending');
  END IF;
  UPDATE public.amora_tasks
  SET status = 'queued',
      review_reason = NULL,
      error_code = NULL,
      failure_count = 0,
      available_at = now(),
      updated_at = now()
  WHERE id = p_task_id;
  RETURN jsonb_build_object('ok', true, 'code', 'resumed', 'status', 'queued');
END
$function$;

-- ---------------------------------------------------------------------------
-- 5) 일꾼: 선점, 진행 저장, 사용량 예약, 쉬기, 끝내기
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.claim_amora_task(p_lease_seconds integer)
RETURNS SETOF public.amora_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 60 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'AMORA_TASK_CLAIM_INVALID' USING ERRCODE = '22023';
  END IF;

  -- 선점은 한 번에 하나씩 한다. 같은 일을 두 일꾼이 잡지 않는다.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:amora-task-claim', 0)
  );

  -- 닫을 것부터 닫는다(한 번에 정해진 수만).
  UPDATE public.amora_tasks
  SET status = 'expired', updated_at = now()
  WHERE id IN (
    SELECT id FROM public.amora_tasks
    WHERE status = 'offered' AND offer_expires_at <= now()
    ORDER BY offer_expires_at
    LIMIT 100
  );

  UPDATE public.amora_tasks
  SET status = 'needs_review',
      review_reason = 'stale',
      lease_token = NULL,
      leased_until = NULL,
      updated_at = now()
  WHERE id IN (
    SELECT id FROM public.amora_tasks
    WHERE status IN ('queued', 'searching', 'organizing')
      AND started_at < now() - interval '48 hours'
      AND (lease_token IS NULL OR leased_until < now())
    LIMIT 50
  );

  -- 앞 일꾼이 토큰을 돌려주지 않고 사라진 일은 실패로 센다. 세 번째면 사람에게 넘긴다.
  UPDATE public.amora_tasks
  SET status = 'needs_review',
      review_reason = 'failed',
      error_code = 'LEASE_EXHAUSTED',
      failure_count = failure_count + 1,
      lease_token = NULL,
      leased_until = NULL,
      updated_at = now()
  WHERE status IN ('searching', 'organizing')
    AND lease_token IS NOT NULL
    AND leased_until < now()
    AND failure_count >= 2;

  RETURN QUERY
  WITH candidate AS (
    SELECT task.id
    FROM public.amora_tasks AS task
    WHERE task.status IN ('queued', 'searching', 'organizing')
      AND task.available_at <= now()
      AND (task.lease_token IS NULL OR task.leased_until < now())
      AND NOT public.amora_task_couple_deletion_pending(task.couple_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.amora_tasks AS running
        WHERE running.couple_id = task.couple_id
          AND running.id <> task.id
          AND running.lease_token IS NOT NULL
          AND running.leased_until >= now()
      )
    ORDER BY task.available_at, task.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.amora_tasks AS task
  SET status = CASE WHEN task.status = 'queued' THEN 'searching' ELSE task.status END,
      failure_count = task.failure_count + CASE WHEN task.lease_token IS NOT NULL THEN 1 ELSE 0 END,
      run_count = task.run_count + 1,
      lease_token = gen_random_uuid(),
      leased_until = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  FROM candidate
  WHERE task.id = candidate.id
  RETURNING task.*;
END
$function$;

CREATE FUNCTION public.save_amora_task_progress(
  p_task_id uuid,
  p_lease_token uuid,
  p_status text,
  p_progress jsonb,
  p_step_label text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_microusd bigint,
  p_lease_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_task_id IS NULL OR p_lease_token IS NULL
     OR p_status NOT IN ('searching', 'organizing')
     OR p_progress IS NULL OR jsonb_typeof(p_progress) <> 'object'
     OR COALESCE(p_input_tokens, -1) < 0 OR COALESCE(p_output_tokens, -1) < 0
     OR COALESCE(p_cost_microusd, -1) < 0
     OR p_lease_seconds IS NULL OR p_lease_seconds < 60 OR p_lease_seconds > 900
     OR (p_step_label IS NOT NULL AND (
       char_length(p_step_label) NOT BETWEEN 1 AND 60
       OR public.couple_plan_change_has_unsafe_display_text(p_step_label)
     )) THEN
    RAISE EXCEPTION 'AMORA_TASK_PROGRESS_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_tasks AS task
  SET status = p_status,
      progress = p_progress,
      steps = CASE
        WHEN p_step_label IS NULL THEN task.steps
        ELSE (
          SELECT COALESCE(jsonb_agg(entry.value ORDER BY entry.ordinality), '[]'::jsonb)
          FROM jsonb_array_elements(
            task.steps || jsonb_build_array(jsonb_build_object('at', now(), 'label', p_step_label))
          ) WITH ORDINALITY AS entry(value, ordinality)
          WHERE entry.ordinality > jsonb_array_length(task.steps) + 1 - 30
        )
      END,
      input_tokens = task.input_tokens + p_input_tokens,
      output_tokens = task.output_tokens + p_output_tokens,
      cost_microusd = task.cost_microusd + p_cost_microusd,
      leased_until = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE task.id = p_task_id
    AND task.lease_token = p_lease_token
    AND task.status IN ('searching', 'organizing')
  RETURNING task.id INTO v_id;
  RETURN v_id IS NOT NULL;
END
$function$;

-- 걸음 하나를 쓰기 전에 부른다. 허락되면 세고, 아니면 까닭만 돌려준다.
CREATE FUNCTION public.reserve_amora_task_usage(
  p_task_id uuid,
  p_lease_token uuid,
  p_usage text,
  p_cost_microusd bigint,
  p_task_cap integer,
  p_couple_daily_cap integer,
  p_global_cost_cap_microusd bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_task public.amora_tasks%ROWTYPE;
  v_day date := public.amora_task_kst_day(now());
  v_couple public.amora_task_daily_usage%ROWTYPE;
  v_global_cost bigint;
BEGIN
  IF p_task_id IS NULL OR p_lease_token IS NULL
     OR p_usage NOT IN ('model_step', 'web_search')
     OR p_cost_microusd IS NULL OR p_cost_microusd < 0
     OR (p_usage = 'model_step' AND p_cost_microusd < 1)
     OR p_task_cap IS NULL OR p_task_cap < 0 OR p_task_cap > 200
     OR p_couple_daily_cap IS NULL OR p_couple_daily_cap < 0 OR p_couple_daily_cap > 1000
     OR p_global_cost_cap_microusd IS NULL OR p_global_cost_cap_microusd < 0 THEN
    RAISE EXCEPTION 'AMORA_TASK_USAGE_INVALID' USING ERRCODE = '22023';
  END IF;

  -- 잠그는 순서: 맡은 일 → 서비스 전체 → 커플. 모든 함수가 같은 순서를 지킨다.
  SELECT * INTO v_task FROM public.amora_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND OR v_task.lease_token IS DISTINCT FROM p_lease_token
     OR v_task.status NOT IN ('searching', 'organizing') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'lease_lost');
  END IF;

  IF p_usage = 'model_step' THEN
    IF v_task.model_steps >= p_task_cap THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'task_step_limit');
    END IF;
    INSERT INTO public.amora_task_global_daily_usage (usage_day) VALUES (v_day)
    ON CONFLICT (usage_day) DO NOTHING;
    SELECT reserved_cost_microusd INTO v_global_cost
    FROM public.amora_task_global_daily_usage WHERE usage_day = v_day FOR UPDATE;
  ELSE
    IF v_task.web_searches >= p_task_cap THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'task_step_limit');
    END IF;
  END IF;

  INSERT INTO public.amora_task_daily_usage (usage_day, couple_id) VALUES (v_day, v_task.couple_id)
  ON CONFLICT (usage_day, couple_id) DO NOTHING;
  SELECT * INTO v_couple FROM public.amora_task_daily_usage
  WHERE usage_day = v_day AND couple_id = v_task.couple_id FOR UPDATE;

  IF p_usage = 'model_step' THEN
    IF v_couple.model_steps >= p_couple_daily_cap THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'daily_step_limit');
    END IF;
    IF v_global_cost + p_cost_microusd > p_global_cost_cap_microusd THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'background_budget');
    END IF;
    UPDATE public.amora_task_global_daily_usage
    SET model_steps = model_steps + 1,
        reserved_cost_microusd = reserved_cost_microusd + p_cost_microusd,
        updated_at = now()
    WHERE usage_day = v_day;
    UPDATE public.amora_task_daily_usage
    SET model_steps = model_steps + 1,
        reserved_cost_microusd = reserved_cost_microusd + p_cost_microusd,
        updated_at = now()
    WHERE usage_day = v_day AND couple_id = v_task.couple_id;
    UPDATE public.amora_tasks
    SET model_steps = model_steps + 1,
        reserved_cost_microusd = reserved_cost_microusd + p_cost_microusd,
        updated_at = now()
    WHERE id = p_task_id;
  ELSE
    IF v_couple.web_searches >= p_couple_daily_cap THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'daily_search_limit');
    END IF;
    UPDATE public.amora_task_daily_usage
    SET web_searches = web_searches + 1, updated_at = now()
    WHERE usage_day = v_day AND couple_id = v_task.couple_id;
    UPDATE public.amora_tasks
    SET web_searches = web_searches + 1, updated_at = now()
    WHERE id = p_task_id;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', NULL);
END
$function$;

-- 한 번에 할 걸음을 다 했으면 토큰을 돌려주고 쉰다. 다음 차례(크론)가 잇는다.
CREATE FUNCTION public.release_amora_task(p_task_id uuid, p_lease_token uuid, p_delay_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_task_id IS NULL OR p_lease_token IS NULL
     OR p_delay_seconds IS NULL OR p_delay_seconds < 0 OR p_delay_seconds > 3600 THEN
    RAISE EXCEPTION 'AMORA_TASK_RELEASE_INVALID' USING ERRCODE = '22023';
  END IF;
  UPDATE public.amora_tasks
  SET lease_token = NULL,
      leased_until = NULL,
      available_at = now() + make_interval(secs => p_delay_seconds),
      updated_at = now()
  WHERE id = p_task_id
    AND lease_token = p_lease_token
    AND status IN ('searching', 'organizing')
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END
$function$;

CREATE FUNCTION public.finish_amora_task(
  p_task_id uuid,
  p_lease_token uuid,
  p_status text,
  p_review_reason text,
  p_result jsonb,
  p_error_code text,
  p_step_label text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_task_id IS NULL OR p_lease_token IS NULL
     OR p_status NOT IN ('done', 'needs_review')
     OR (p_status = 'done' AND (p_review_reason IS NOT NULL OR p_result IS NULL))
     OR (p_status = 'needs_review' AND p_review_reason IS NULL)
     OR (p_step_label IS NOT NULL AND (
       char_length(p_step_label) NOT BETWEEN 1 AND 60
       OR public.couple_plan_change_has_unsafe_display_text(p_step_label)
     )) THEN
    RAISE EXCEPTION 'AMORA_TASK_FINISH_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.amora_tasks AS task
  SET status = p_status,
      review_reason = p_review_reason,
      result = COALESCE(p_result, task.result),
      error_code = p_error_code,
      steps = CASE
        WHEN p_step_label IS NULL THEN task.steps
        ELSE (
          SELECT COALESCE(jsonb_agg(entry.value ORDER BY entry.ordinality), '[]'::jsonb)
          FROM jsonb_array_elements(
            task.steps || jsonb_build_array(jsonb_build_object('at', now(), 'label', p_step_label))
          ) WITH ORDINALITY AS entry(value, ordinality)
          WHERE entry.ordinality > jsonb_array_length(task.steps) + 1 - 30
        )
      END,
      lease_token = NULL,
      leased_until = NULL,
      finished_at = CASE WHEN p_status = 'done' THEN now() ELSE task.finished_at END,
      notify_state = CASE WHEN p_status = 'done' THEN 'pending' ELSE task.notify_state END,
      updated_at = now()
  WHERE task.id = p_task_id
    AND task.lease_token = p_lease_token
    AND task.status IN ('searching', 'organizing')
  RETURNING task.id INTO v_id;
  RETURN v_id IS NOT NULL;
END
$function$;

-- ---------------------------------------------------------------------------
-- 6) 끝남 알림(앱 알림은 갈래 2가 보낸다. 여기는 한 번만 보내게 선점만 한다)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.claim_amora_task_notifications(p_limit integer)
RETURNS TABLE (
  task_id uuid,
  couple_id uuid,
  requested_by uuid,
  kind text,
  notify_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
#variable_conflict use_column
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'AMORA_TASK_NOTIFY_INVALID' USING ERRCODE = '22023';
  END IF;

  -- 하루가 지났거나 너무 여러 번 미룬 알림은 보내지 않는다.
  UPDATE public.amora_tasks AS stale
  SET notify_state = 'skipped', notify_claimed_at = NULL, updated_at = now()
  WHERE stale.notify_state = 'pending'
    AND (stale.finished_at < now() - interval '24 hours' OR stale.notify_attempts >= 48);

  RETURN QUERY
  WITH candidate AS (
    SELECT task.id
    FROM public.amora_tasks AS task
    WHERE task.notify_state = 'pending'
      AND (task.notify_claimed_at IS NULL OR task.notify_claimed_at < now() - interval '30 minutes')
    ORDER BY task.finished_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.amora_tasks AS task
  SET notify_attempts = task.notify_attempts + 1,
      notify_claimed_at = now()
  FROM candidate
  WHERE task.id = candidate.id
  RETURNING task.id, task.couple_id, task.requested_by, task.kind, task.notify_attempts;
END
$function$;

-- 알림 함수는 끝날 때 한 번만 부른다. 조용한 시간·동의·하루 상한·중복은 그 함수가 판단하고 까닭만 돌려준다.
CREATE FUNCTION public.finish_amora_task_notification(p_task_id uuid, p_state text, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_task_id IS NULL OR p_state NOT IN ('sent', 'skipped')
     OR p_reason IS NULL OR p_reason !~ '^[a-z_]{1,40}$' THEN
    RAISE EXCEPTION 'AMORA_TASK_NOTIFY_INVALID' USING ERRCODE = '22023';
  END IF;
  UPDATE public.amora_tasks
  SET notify_state = p_state,
      notify_reason = p_reason,
      notify_claimed_at = NULL,
      updated_at = now()
  WHERE id = p_task_id
    AND notify_state = 'pending'
    AND notify_claimed_at IS NOT NULL
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END
$function$;

-- ---------------------------------------------------------------------------
-- 7) 권한
-- ---------------------------------------------------------------------------

ALTER TABLE public.amora_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_task_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amora_task_global_daily_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.amora_tasks,
  public.amora_task_daily_usage,
  public.amora_task_global_daily_usage
FROM PUBLIC, anon, authenticated, service_role;

-- 회원은 화면에 쓰는 칸만 읽는다. 입력 조건·중간 기록·선점 토큰·비용·오류는 빠진다.
GRANT SELECT (
  id, couple_id, kind, status, title, steps, result, review_reason,
  offer_expires_at, created_at, started_at, finished_at, updated_at
) ON TABLE public.amora_tasks TO authenticated;
GRANT ALL ON TABLE
  public.amora_tasks,
  public.amora_task_daily_usage,
  public.amora_task_global_daily_usage
TO service_role;

-- 자기 커플의 줄만. 로그아웃(anon)에게는 칸 권한도 정책도 없다.
CREATE POLICY amora_tasks_member_select
  ON public.amora_tasks
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY amora_tasks_service_all
  ON public.amora_tasks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY amora_task_daily_usage_service_all
  ON public.amora_task_daily_usage
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY amora_task_global_daily_usage_service_all
  ON public.amora_task_global_daily_usage
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER FUNCTION public.amora_task_kst_day(timestamptz) OWNER TO postgres;
ALTER FUNCTION public.amora_task_couple_deletion_pending(uuid) OWNER TO postgres;
ALTER FUNCTION public.offer_amora_task(uuid, uuid, text, text, text, text, jsonb, integer) OWNER TO postgres;
ALTER FUNCTION public.start_amora_task(uuid, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.cancel_amora_task(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.resume_amora_task(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.claim_amora_task(integer) OWNER TO postgres;
ALTER FUNCTION public.save_amora_task_progress(uuid, uuid, text, jsonb, text, integer, integer, bigint, integer) OWNER TO postgres;
ALTER FUNCTION public.reserve_amora_task_usage(uuid, uuid, text, bigint, integer, integer, bigint) OWNER TO postgres;
ALTER FUNCTION public.release_amora_task(uuid, uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.finish_amora_task(uuid, uuid, text, text, jsonb, text, text) OWNER TO postgres;
ALTER FUNCTION public.claim_amora_task_notifications(integer) OWNER TO postgres;
ALTER FUNCTION public.finish_amora_task_notification(uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.amora_task_kst_day(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.amora_task_couple_deletion_pending(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offer_amora_task(uuid, uuid, text, text, text, text, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_amora_task(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_amora_task(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resume_amora_task(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_amora_task(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_amora_task_progress(uuid, uuid, text, jsonb, text, integer, integer, bigint, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_amora_task_usage(uuid, uuid, text, bigint, integer, integer, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_amora_task(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finish_amora_task(uuid, uuid, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_amora_task_notifications(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finish_amora_task_notification(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.amora_task_kst_day(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.amora_task_couple_deletion_pending(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.offer_amora_task(uuid, uuid, text, text, text, text, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_amora_task(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_amora_task(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_amora_task(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_task(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_amora_task_progress(uuid, uuid, text, jsonb, text, integer, integer, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_amora_task_usage(uuid, uuid, text, bigint, integer, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_amora_task(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_amora_task(uuid, uuid, text, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_task_notifications(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_amora_task_notification(uuid, text, text) TO service_role;

COMMIT;
