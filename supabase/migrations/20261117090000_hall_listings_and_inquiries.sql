-- 20261117090000: 웨딩홀 비교와 상담 문의 편지 (W2, W3, WS1, WS2, WS5, W4 운영자 파일럿, W5)
--
-- 2026-11-17 파운더 요청(디자인 아티팩트): 웨딩홀 비교, 문의 편지, 답장과 상담 확정이 실제로 돌게.
-- 바깥으로 보내는 일을 운영에서 켜는 것은 따로 정한다(D-19). 그래서 이 파일은 이렇게 만든다.
--
--   - 업체 자료는 운영자가 출처 주소와 확인일을 적어 넣는 표다. 빈 표로 시작하고 시드는 넣지 않는다.
--     한국소비자원 참가격 자료는 어디서도 읽지 않는다(D-79 "모두 그만 쓰기").
--   - 편지는 판마다 내용 지문을 남긴다. 승인은 그 판과 지문에 묶인다. 받는 곳, 글, 알려줄 정보 가운데
--     하나라도 바뀌면 새 판이 생기고 새 승인이 든다(WS1). 판의 내용은 고칠 수 없다(트리거).
--   - 같은 커플이 같은 홀에 같은 내용을 두 번 대기열에 넣지 못한다. 발송 줄의 지문이 유일하다(WS2).
--   - 승인이 끝나도 문의 스위치가 꺼져 있으면 대기열에 넣지 않는다. 커플마다, 그리고 서비스 전체로 하루
--     상한을 넘겨도 넣지 않는다(WS5). 스위치와 상한은 서버 환경값에서 오고 기본은 꺼짐이다. 꺼진 동안 받은
--     승인은 켜진 뒤 대기열로 이어지지 않는다. 켜진 뒤 다시 승인해야 한다.
--   - 승인 방식은 커플이 고른다(D-76, 2026-11-16 파운더 "커플이 정하게"). 고르기 전에는 두 사람 중
--     누구든 승인할 수 있고 두 사람 모두 알림을 받는다. 정한 한 사람, 또는 두 사람 모두를 고를 수 있다.
--     상대의 승인 권한을 줄이는 변경은 상대가 확인할 때까지 제안으로만 남고 지금 방식이 그대로 쓰인다.
--     승인 방식이 바뀌면 앞 방식에서 받은 승인은 세지 않는다(revision). 승인은 지금 방식에서 승인할 수
--     있는 사람의 것만 남는다.
--   - 보내는 일은 사람(운영자)이 한다. 운영자가 대기열의 편지를 업체의 공식 문의 창구로 보내고 보냈다고
--     표시하며, 답장 원문과 정해진 칸을 적는다(W4 파일럿). 메일, 문자, 메신저 자동 발송은 없다(D-75).
--   - 업체에 넘길 수 있는 이름, 휴대폰, 예산은 편지 판에만 남는다. 끈 정보는 값을 남기지 않는다.
--     운영자는 승인 뒤 대기열에서만 본다. 실제로 보내기 전에 개인정보 처리방침을 고친다(D-25).
--   - 탈퇴(account_deletion_jobs)가 시작되면 그 사람이 지금 속한 커플의 편지, 그리고 그 사람이 쓰거나 승인한
--     편지를 곧바로 지운다. 글, 맺음말, 알려줄 정보, 지문, 답장 원문과 메모, 운영자 메모는 값을 남기지 않는다.
--     아직 보내지 않은 문의는 거둬들인다. 누가 썼는지, 누가 승인했는지 같은 사람 칸도 비운다.
--     탈퇴가 끝날 때까지 그 커플은 문의 기록을 새로 쓰지 못한다(20260920120000 준비 성향과 같은 방식).
--
-- 표 이름의 hall_ 은 2026-07-04 에 지운 옛 청첩장 표(invitations 등)와 섞이지 않게 붙였다.
-- 쓰기는 모두 service_role 전용 함수가 한다. 예외는 커플이 홀을 담고 빼는 것 하나이고 회원 RLS가 지킨다.
-- 커플 회원은 자기 커플 줄만 읽는다. 잠금 순서는 couples 행이 먼저다(공동 계획 쓰기와 같은 순서).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 0) 글자 검사와 지문
-- ---------------------------------------------------------------------------

-- 제어 문자와 보이지 않는 서식 문자를 막는다(`couple_plan_change_has_unsafe_display_text` 와 같은 목록).
-- 편지 본문과 답장 원문만 줄바꿈을 허용한다.
CREATE FUNCTION public.hall_inquiry_text_is_unsafe(p_value text, p_allow_newline boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT (CASE WHEN p_allow_newline THEN replace(p_value, chr(10), '') ELSE p_value END) ~ '[[:cntrl:]]'
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        173, 1564, 6158,
        8203, 8204, 8205, 8206, 8207,
        8232, 8233, 8234, 8235, 8236, 8237, 8238,
        8288, 8289, 8290, 8291, 8292,
        8294, 8295, 8296, 8297, 8298, 8299, 8300, 8301, 8302, 8303,
        65279
      ]::integer[]) AS forbidden(codepoint)
      WHERE strpos(p_value, chr(forbidden.codepoint)) > 0
    );
$function$;

-- 알려줄 정보: 이름, 휴대폰, 예산 세 칸. 켠 칸만 값을 갖고, 끈 칸의 값은 null 이어야 한다.
CREATE FUNCTION public.hall_inquiry_shares_are_valid(p_shares jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_key text;
  v_entry jsonb;
  v_value text;
BEGIN
  IF p_shares IS NULL
     OR jsonb_typeof(p_shares) IS DISTINCT FROM 'object'
     OR p_shares - ARRAY['name', 'phone', 'budget']::text[] <> '{}'::jsonb
     OR NOT (p_shares ? 'name' AND p_shares ? 'phone' AND p_shares ? 'budget') THEN
    RETURN false;
  END IF;
  FOREACH v_key IN ARRAY ARRAY['name', 'phone', 'budget']::text[] LOOP
    v_entry := p_shares -> v_key;
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR v_entry - ARRAY['on', 'value']::text[] <> '{}'::jsonb
       OR jsonb_typeof(v_entry -> 'on') IS DISTINCT FROM 'boolean'
       OR NOT (v_entry ? 'value') THEN
      RETURN false;
    END IF;
    IF (v_entry ->> 'on')::boolean THEN
      IF jsonb_typeof(v_entry -> 'value') IS DISTINCT FROM 'string' THEN
        RETURN false;
      END IF;
      v_value := v_entry ->> 'value';
      IF char_length(v_value) NOT BETWEEN 1 AND 40
         OR v_value IS DISTINCT FROM btrim(v_value)
         OR public.hall_inquiry_text_is_unsafe(v_value, false) THEN
        RETURN false;
      END IF;
      IF v_key = 'phone' AND v_value !~ '^01[016789]-[0-9]{3,4}-[0-9]{4}$' THEN
        RETURN false;
      END IF;
    ELSIF jsonb_typeof(v_entry -> 'value') IS DISTINCT FROM 'null' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$function$;

-- 지문에 넣는 알려줄 정보의 고정 표기. 칸 이름 순서, 켬 여부, 값 길이, 값.
CREATE FUNCTION public.hall_inquiry_shares_canonical(p_shares jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT string_agg(
    item.key || ':'
      || CASE WHEN (p_shares -> item.key ->> 'on')::boolean THEN '1' ELSE '0' END || ':'
      || COALESCE(
        char_length(p_shares -> item.key ->> 'value')::text || ':' || (p_shares -> item.key ->> 'value'),
        '-'
      ),
    '|' ORDER BY item.key
  )
  FROM unnest(ARRAY['budget', 'name', 'phone']::text[]) AS item(key);
$function$;

-- 편지 판의 지문: 커플, 받는 곳(정렬), 글, 맺음말, 알려줄 정보. 길이를 앞에 붙여 경계가 섞이지 않게 한다.
CREATE FUNCTION public.hall_inquiry_letter_fingerprint(
  p_couple_id uuid,
  p_recipient_hall_ids uuid[],
  p_body text,
  p_signature text,
  p_shares jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT encode(sha256(convert_to(
    'hall-inquiry-letter-v1' || chr(10)
      || p_couple_id::text || chr(10)
      || array_to_string(ARRAY(SELECT item FROM unnest(p_recipient_hall_ids) AS item ORDER BY item), ',') || chr(10)
      || char_length(p_body)::text || ':' || p_body || chr(10)
      || char_length(p_signature)::text || ':' || p_signature || chr(10)
      || public.hall_inquiry_shares_canonical(p_shares),
    'UTF8'
  )), 'hex');
$function$;

-- 발송 한 줄의 지문: 커플, 받는 홀 하나, 글, 맺음말, 알려줄 정보. 이 값이 유일해서 같은 내용이 두 번 나가지 않는다.
CREATE FUNCTION public.hall_inquiry_dispatch_fingerprint(
  p_couple_id uuid,
  p_hall_id uuid,
  p_body text,
  p_signature text,
  p_shares jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT encode(sha256(convert_to(
    'hall-inquiry-dispatch-v1' || chr(10)
      || p_couple_id::text || chr(10)
      || p_hall_id::text || chr(10)
      || char_length(p_body)::text || ':' || p_body || chr(10)
      || char_length(p_signature)::text || ':' || p_signature || chr(10)
      || public.hall_inquiry_shares_canonical(p_shares),
    'UTF8'
  )), 'hex');
$function$;

-- ---------------------------------------------------------------------------
-- 1) 운영자가 검수해 넣는 웨딩홀 자료(W2)
-- ---------------------------------------------------------------------------

CREATE TABLE public.hall_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  region text NOT NULL,
  area_label text NOT NULL,
  kind_label text NOT NULL,
  meal_price_won integer NOT NULL,
  rental_fee_won integer,
  rental_included boolean NOT NULL DEFAULT false,
  minimum_guarantee integer,
  station_walk_minutes smallint,
  transit_note text,
  photo_url text,
  source_url text NOT NULL,
  checked_on date NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hall_listings_name_check CHECK (
    char_length(name) BETWEEN 1 AND 60 AND name = btrim(name)
    AND NOT public.hall_inquiry_text_is_unsafe(name, false)
  ),
  -- 지역은 정본 목록(packages/shared/src/invitation/regions.ts 의 INVITATION_REGIONS)의 짧은 이름만 받는다.
  -- 커플 조건의 지역과 글자 그대로 맞아야 비교에 나온다. 목록을 바꾸면 두 곳을 함께 바꾼다(시험이 맞춰 본다).
  CONSTRAINT hall_listings_region_check CHECK (
    region IN (
      '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
      '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'
    )
  ),
  CONSTRAINT hall_listings_area_check CHECK (
    char_length(area_label) BETWEEN 1 AND 40 AND area_label = btrim(area_label)
    AND NOT public.hall_inquiry_text_is_unsafe(area_label, false)
  ),
  CONSTRAINT hall_listings_kind_check CHECK (
    char_length(kind_label) BETWEEN 1 AND 30 AND kind_label = btrim(kind_label)
    AND NOT public.hall_inquiry_text_is_unsafe(kind_label, false)
  ),
  CONSTRAINT hall_listings_meal_check CHECK (meal_price_won BETWEEN 1000 AND 1000000),
  -- 대관료는 "식대에 포함"이거나 금액이 있어야 한다. 둘 다 비어 있으면 NULL 이 검사를 통과하므로 IS NOT NULL 을 적는다.
  CONSTRAINT hall_listings_rental_check CHECK (
    (rental_included AND rental_fee_won IS NULL)
    OR (NOT rental_included AND rental_fee_won IS NOT NULL AND rental_fee_won BETWEEN 0 AND 200000000)
  ),
  CONSTRAINT hall_listings_minimum_check CHECK (
    minimum_guarantee IS NULL OR minimum_guarantee BETWEEN 1 AND 3000
  ),
  CONSTRAINT hall_listings_walk_check CHECK (
    station_walk_minutes IS NULL OR station_walk_minutes BETWEEN 0 AND 120
  ),
  CONSTRAINT hall_listings_transit_check CHECK (
    transit_note IS NULL OR (
      char_length(transit_note) BETWEEN 1 AND 40 AND transit_note = btrim(transit_note)
      AND NOT public.hall_inquiry_text_is_unsafe(transit_note, false)
    )
  ),
  CONSTRAINT hall_listings_photo_check CHECK (
    photo_url IS NULL OR (
      char_length(photo_url) <= 500 AND photo_url ~ '^https://[^[:space:]]+$'
      AND NOT public.hall_inquiry_text_is_unsafe(photo_url, false)
    )
  ),
  CONSTRAINT hall_listings_source_check CHECK (
    char_length(source_url) <= 500 AND source_url ~ '^https://[^[:space:]]+$'
    AND NOT public.hall_inquiry_text_is_unsafe(source_url, false)
  ),
  CONSTRAINT hall_listings_checked_on_check CHECK (checked_on >= DATE '2024-01-01')
);

CREATE INDEX hall_listings_region_idx ON public.hall_listings (region, active, name);

COMMENT ON TABLE public.hall_listings IS
  'Operator-curated wedding hall listings with source URL and checked date. Starts empty; never derived from public price disclosure tables.';

-- 커플이 상담 후보로 담은 홀. 회원 RLS로 담고 뺀다.
CREATE TABLE public.hall_shortlists (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  hall_id uuid NOT NULL REFERENCES public.hall_listings(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, hall_id)
);

CREATE INDEX hall_shortlists_hall_idx ON public.hall_shortlists (hall_id);

-- 담기는 회원이 PostgREST 로 바로 쓸 수 있어서, 커플마다 10곳이라는 상한을 DB 에서도 지킨다
-- (apps/web/src/lib/invitation/hallRepository.ts 의 MAX_SHORTLIST 와 같은 수, 시험이 맞춰 본다).
-- 이미 담긴 홀을 다시 담는 것은 기본 키가 막도록 그대로 둔다. 동시에 두 곳을 담아도 넘지 않게 커플마다 잠근다.
CREATE FUNCTION public.hall_shortlists_enforce_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:hall-shortlist:' || NEW.couple_id::text, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.hall_shortlists AS pick
    WHERE pick.couple_id = NEW.couple_id AND pick.hall_id = NEW.hall_id
  ) THEN
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM public.hall_shortlists AS pick WHERE pick.couple_id = NEW.couple_id) >= 10 THEN
    RAISE EXCEPTION 'HALL_SHORTLIST_FULL' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_hall_shortlists_limit
  BEFORE INSERT ON public.hall_shortlists
  FOR EACH ROW EXECUTE FUNCTION public.hall_shortlists_enforce_limit();

-- ---------------------------------------------------------------------------
-- 2) 문의 승인 방식(D-76). 줄이 없으면 아직 고르지 않은 것(unset, revision 0)이다.
-- ---------------------------------------------------------------------------

CREATE TABLE public.hall_inquiry_settings (
  couple_id uuid PRIMARY KEY REFERENCES public.couples(id) ON DELETE CASCADE,
  approver_mode text NOT NULL CHECK (approver_mode IN ('unset', 'designated', 'both')),
  -- 탈퇴가 이 줄에 막히지 않도록 외래 키를 두지 않는다. 쓸 때마다 지금 회원인지 다시 본다.
  designated_user_id uuid,
  -- 실제 방식이 바뀔 때마다 오른다. 0 은 아직 고르지 않은 채 제안만 담은 줄이다.
  revision bigint NOT NULL CHECK (revision >= 0),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 상대가 가진 승인 권한을 줄이는 변경은 상대가 확인할 때까지 제안으로만 남는다(D-76 "커플이 정하게").
  -- 그동안은 위의 지금 방식이 그대로 쓰인다. 사람 칸에는 외래 키를 두지 않는다(탈퇴는 정리 함수가 비운다).
  proposal_id uuid,
  proposed_mode text CHECK (proposed_mode IN ('unset', 'designated', 'both')),
  proposed_designated_user_id uuid,
  proposed_by uuid,
  proposed_at timestamptz,
  CONSTRAINT hall_inquiry_settings_designated_check CHECK (
    (approver_mode = 'designated') = (designated_user_id IS NOT NULL)
  ),
  CONSTRAINT hall_inquiry_settings_unset_row_check CHECK (revision > 0 OR approver_mode = 'unset'),
  CONSTRAINT hall_inquiry_settings_proposal_check CHECK (
    (proposal_id IS NULL AND proposed_mode IS NULL AND proposed_designated_user_id IS NULL
      AND proposed_by IS NULL AND proposed_at IS NULL)
    OR (proposal_id IS NOT NULL AND proposed_mode IS NOT NULL AND proposed_by IS NOT NULL AND proposed_at IS NOT NULL
      AND (proposed_mode = 'designated') = (proposed_designated_user_id IS NOT NULL))
  )
);

-- ---------------------------------------------------------------------------
-- 3) 편지, 판, 승인(W3, WS1)
-- ---------------------------------------------------------------------------

CREATE TABLE public.hall_inquiry_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 대기열에 넣은 뒤에는 잠긴다. 고치고 싶으면 새 편지를 쓴다.
  locked_at timestamptz,
  UNIQUE (id, couple_id)
);

-- 커플마다 열려 있는 편지는 하나다.
CREATE UNIQUE INDEX hall_inquiry_letters_one_open_per_couple
  ON public.hall_inquiry_letters (couple_id)
  WHERE locked_at IS NULL;
CREATE INDEX hall_inquiry_letters_couple_idx
  ON public.hall_inquiry_letters (couple_id, created_at DESC);

CREATE TABLE public.hall_inquiry_letter_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id uuid NOT NULL,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 500),
  recipient_hall_ids uuid[] NOT NULL,
  recipient_names text[] NOT NULL,
  -- 글, 맺음말, 알려줄 정보, 지문은 탈퇴로 지운 판(redacted_at)에서만 비고 그 밖에는 반드시 있다.
  -- 지문도 지운다. 이름이나 휴대폰처럼 짐작하기 쉬운 값의 해시라서 원문을 되찾을 수 있다.
  body text,
  -- 맺음말("민지와 준호 드림")도 업체에 가는 글이라 판에 남기고 지문에 넣는다.
  signature text,
  shares jsonb,
  fingerprint text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approval_completed_at timestamptz,
  queued_at timestamptz,
  redacted_at timestamptz,
  UNIQUE (letter_id, version),
  UNIQUE (id, couple_id),
  FOREIGN KEY (letter_id, couple_id)
    REFERENCES public.hall_inquiry_letters(id, couple_id) ON DELETE CASCADE,
  CONSTRAINT hall_inquiry_letter_versions_recipients_check CHECK (
    cardinality(recipient_hall_ids) BETWEEN 1 AND 10
    AND cardinality(recipient_names) = cardinality(recipient_hall_ids)
    AND array_position(recipient_hall_ids, NULL) IS NULL
  ),
  -- CASE 로 적는다. 빈 값이 검사를 그냥 통과하지 못하게 하기 위해서다.
  CONSTRAINT hall_inquiry_letter_versions_body_check CHECK (
    CASE WHEN redacted_at IS NULL THEN
      body IS NOT NULL
      AND char_length(body) BETWEEN 1 AND 1000
      AND body = btrim(body, E' \n')
      AND NOT public.hall_inquiry_text_is_unsafe(body, true)
    ELSE body IS NULL END
  ),
  CONSTRAINT hall_inquiry_letter_versions_signature_check CHECK (
    CASE WHEN redacted_at IS NULL THEN
      signature IS NOT NULL
      AND char_length(signature) BETWEEN 1 AND 60 AND signature = btrim(signature)
      AND NOT public.hall_inquiry_text_is_unsafe(signature, false)
    ELSE signature IS NULL END
  ),
  CONSTRAINT hall_inquiry_letter_versions_shares_check CHECK (
    CASE WHEN redacted_at IS NULL THEN public.hall_inquiry_shares_are_valid(shares) ELSE shares IS NULL END
  ),
  CONSTRAINT hall_inquiry_letter_versions_fingerprint_check CHECK (
    CASE WHEN redacted_at IS NULL THEN fingerprint IS NOT NULL AND fingerprint ~ '^[0-9a-f]{64}$'
    ELSE fingerprint IS NULL END
  )
);

CREATE INDEX hall_inquiry_letter_versions_couple_idx
  ON public.hall_inquiry_letter_versions (couple_id, created_at DESC);

CREATE TABLE public.hall_inquiry_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  approver_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 승인할 때는 늘 채운다. 탈퇴로 편지를 지우면 판의 지문처럼 비운다.
  fingerprint text CHECK (fingerprint IS NULL OR fingerprint ~ '^[0-9a-f]{64}$'),
  settings_revision bigint NOT NULL CHECK (settings_revision >= 0),
  -- 승인한 때 문의 보내기가 켜져 있었는지. 꺼진 동안의 승인은 저장된 선택일 뿐이고, 켜진 뒤에는
  -- 켜진 동안 받은 승인만 대기열로 이어진다. 그래서 같은 사람이 켜진 뒤 한 번 더 승인할 수 있다.
  sending_enabled boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (version_id, couple_id)
    REFERENCES public.hall_inquiry_letter_versions(id, couple_id) ON DELETE CASCADE,
  UNIQUE (version_id, approver_user_id, settings_revision, sending_enabled)
);

CREATE INDEX hall_inquiry_approvals_couple_idx
  ON public.hall_inquiry_approvals (couple_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- 4) 운영자 대기열과 답장(WS2, W4)
-- ---------------------------------------------------------------------------

CREATE TABLE public.hall_inquiry_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  letter_id uuid NOT NULL,
  version_id uuid NOT NULL,
  hall_id uuid NOT NULL REFERENCES public.hall_listings(id) ON DELETE RESTRICT,
  recipient_name text NOT NULL CHECK (char_length(recipient_name) BETWEEN 1 AND 60),
  dispatch_fingerprint text CHECK (dispatch_fingerprint IS NULL OR dispatch_fingerprint ~ '^[0-9a-f]{64}$'),
  -- withdrawn: 탈퇴로 편지를 지우면서 아직 보내지 않은 문의를 거둬들인 줄.
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'withdrawn')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  channel_note text,
  withdrawn_at timestamptz,
  redacted_at timestamptz,
  FOREIGN KEY (letter_id, couple_id)
    REFERENCES public.hall_inquiry_letters(id, couple_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, couple_id)
    REFERENCES public.hall_inquiry_letter_versions(id, couple_id) ON DELETE CASCADE,
  UNIQUE (dispatch_fingerprint),
  UNIQUE (version_id, hall_id),
  UNIQUE (id, couple_id),
  CONSTRAINT hall_inquiry_dispatches_sent_check CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  -- 거둬들이는 것은 탈퇴로 지울 때뿐이다.
  CONSTRAINT hall_inquiry_dispatches_withdrawn_check CHECK (
    (status = 'withdrawn') = (withdrawn_at IS NOT NULL)
    AND (status <> 'withdrawn' OR redacted_at IS NOT NULL)
  ),
  -- 지운 줄은 지문과 운영자 메모를 남기지 않는다. 지우지 않은 줄은 지문이 반드시 있다.
  CONSTRAINT hall_inquiry_dispatches_redacted_check CHECK (
    CASE WHEN redacted_at IS NULL THEN dispatch_fingerprint IS NOT NULL
    ELSE dispatch_fingerprint IS NULL AND channel_note IS NULL END
  ),
  CONSTRAINT hall_inquiry_dispatches_note_check CHECK (
    channel_note IS NULL OR (
      char_length(channel_note) BETWEEN 1 AND 200 AND channel_note = btrim(channel_note)
      AND NOT public.hall_inquiry_text_is_unsafe(channel_note, false)
    )
  )
);

CREATE INDEX hall_inquiry_dispatches_queue_idx
  ON public.hall_inquiry_dispatches (status, queued_at);
CREATE INDEX hall_inquiry_dispatches_couple_idx
  ON public.hall_inquiry_dispatches (couple_id, queued_at DESC);
-- 서비스 전체 하루 상한이 오늘 넣은 줄을 센다.
CREATE INDEX hall_inquiry_dispatches_queued_at_idx
  ON public.hall_inquiry_dispatches (queued_at);

CREATE TABLE public.hall_inquiry_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  hall_id uuid NOT NULL REFERENCES public.hall_listings(id) ON DELETE RESTRICT,
  -- 업체 답장 원문. 커플 이름이 들어 있을 수 있어 탈퇴로 편지를 지우면 함께 지운다(redacted_at).
  -- 장소·가격 메모도 운영자가 옮겨 적은 글이라 함께 지운다. 결과와 시각은 남긴다(잡힌 상담을 알아야 한다).
  raw_text text,
  outcome text NOT NULL CHECK (
    outcome IN ('confirmed_time', 'proposed_time', 'declined', 'question', 'conditions_note')
  ),
  event_at timestamptz,
  place_note text,
  price_note text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  redacted_at timestamptz,
  FOREIGN KEY (dispatch_id, couple_id)
    REFERENCES public.hall_inquiry_dispatches(id, couple_id) ON DELETE CASCADE,
  CONSTRAINT hall_inquiry_replies_event_check CHECK (
    (outcome IN ('confirmed_time', 'proposed_time')) = (event_at IS NOT NULL)
  ),
  CONSTRAINT hall_inquiry_replies_raw_check CHECK (
    CASE WHEN redacted_at IS NULL THEN
      raw_text IS NOT NULL
      AND char_length(raw_text) BETWEEN 1 AND 4000 AND raw_text = btrim(raw_text, E' \n')
      AND NOT public.hall_inquiry_text_is_unsafe(raw_text, true)
    ELSE raw_text IS NULL END
  ),
  -- 지운 답장은 장소와 가격 메모도 남기지 않는다. 운영자가 업체 말을 옮겨 적은 칸이라 이름이 섞일 수 있다.
  CONSTRAINT hall_inquiry_replies_redacted_notes_check CHECK (
    redacted_at IS NULL OR (place_note IS NULL AND price_note IS NULL)
  ),
  CONSTRAINT hall_inquiry_replies_place_check CHECK (
    place_note IS NULL OR (
      char_length(place_note) BETWEEN 1 AND 80 AND place_note = btrim(place_note)
      AND NOT public.hall_inquiry_text_is_unsafe(place_note, false)
    )
  ),
  CONSTRAINT hall_inquiry_replies_price_check CHECK (
    price_note IS NULL OR (
      char_length(price_note) BETWEEN 1 AND 300 AND price_note = btrim(price_note)
      AND NOT public.hall_inquiry_text_is_unsafe(price_note, false)
    )
  )
);

-- 운영자가 같은 답장을 두 번 눌러도 한 줄만 남는다. 지운 답장은 원문이 없어 겹침 검사에서 뺀다.
CREATE UNIQUE INDEX hall_inquiry_replies_dedupe
  ON public.hall_inquiry_replies (
    dispatch_id, outcome, md5(raw_text), (COALESCE(event_at, '-infinity'::timestamptz))
  )
  WHERE redacted_at IS NULL;
CREATE INDEX hall_inquiry_replies_couple_idx
  ON public.hall_inquiry_replies (couple_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- 5) 기록은 덧붙이기만 한다. 판의 내용, 승인, 보낸 줄, 답장은 고칠 수 없다.
--    탈퇴로 사람 칸이 null 이 되는 것(외래 키 SET NULL)과 탈퇴로 내용을 지우는 것만 허용한다.
--    내용을 지우는 것은 값을 비우는 방향뿐이다. 다른 값으로 바꾸는 길은 없다. 비운 칸과
--    redacted_at 을 함께 묶는 것은 표의 검사 제약이 한다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.hall_inquiry_guard_record_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_nullable text[];
  v_once text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  IF TG_TABLE_NAME = 'hall_inquiry_letter_versions' THEN
    v_nullable := ARRAY['created_by', 'body', 'signature', 'shares', 'fingerprint'];
    v_once := ARRAY['approval_completed_at', 'queued_at', 'redacted_at'];
  ELSIF TG_TABLE_NAME = 'hall_inquiry_approvals' THEN
    v_nullable := ARRAY['approver_user_id', 'fingerprint'];
  ELSIF TG_TABLE_NAME = 'hall_inquiry_replies' THEN
    v_nullable := ARRAY['recorded_by', 'raw_text', 'place_note', 'price_note'];
    v_once := ARRAY['redacted_at'];
  ELSIF TG_TABLE_NAME = 'hall_inquiry_dispatches' THEN
    v_nullable := ARRAY['sent_by', 'channel_note', 'dispatch_fingerprint'];
    v_once := ARRAY['redacted_at'];
    IF OLD.status = 'queued' AND NEW.status = 'sent' THEN
      -- 보냈다고 표시하는 한 번만 상태, 시각, 보낸 사람, 메모를 함께 바꿀 수 있다.
      v_once := v_once || ARRAY['status', 'sent_at', 'sent_by', 'channel_note'];
    ELSIF OLD.status = 'queued' AND NEW.status = 'withdrawn' THEN
      -- 거둬들이는 것도 대기 중인 줄에서 한 번뿐이다.
      v_once := v_once || ARRAY['status', 'withdrawn_at'];
    END IF;
  ELSE
    RAISE EXCEPTION 'HALL_INQUIRY_RECORD_GUARD_MISCONFIGURED' USING ERRCODE = '55000';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_old) LOOP
    CONTINUE WHEN (v_old -> v_key) IS NOT DISTINCT FROM (v_new -> v_key);
    -- 탈퇴로 사람 칸이 비는 것.
    CONTINUE WHEN v_key = ANY(v_nullable) AND jsonb_typeof(v_new -> v_key) = 'null';
    -- 한 번만 채우는 칸(비어 있던 칸에 처음 값을 넣는 것). 상태는 queued 에서 sent 로 한 번.
    CONTINUE WHEN v_key = ANY(v_once)
      AND (jsonb_typeof(v_old -> v_key) = 'null' OR v_key = 'status');
    RAISE EXCEPTION 'HALL_INQUIRY_RECORD_IMMUTABLE' USING ERRCODE = '55000';
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_hall_inquiry_letter_versions_guard
  BEFORE UPDATE ON public.hall_inquiry_letter_versions
  FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_guard_record_update();
CREATE TRIGGER trg_hall_inquiry_approvals_guard
  BEFORE UPDATE ON public.hall_inquiry_approvals
  FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_guard_record_update();
CREATE TRIGGER trg_hall_inquiry_dispatches_guard
  BEFORE UPDATE ON public.hall_inquiry_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_guard_record_update();
CREATE TRIGGER trg_hall_inquiry_replies_guard
  BEFORE UPDATE ON public.hall_inquiry_replies
  FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_guard_record_update();

-- ---------------------------------------------------------------------------
-- 6) 함께 쓰는 도우미
-- ---------------------------------------------------------------------------

-- 지금 회원(자리 순서). 역할과 자리가 맞는 사람만 센다(`is_current_couple_member`).
CREATE FUNCTION public.hall_inquiry_current_members(p_couple_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE((
    SELECT array_remove(ARRAY[
      CASE WHEN public.is_current_couple_member(couple.bride_id, couple.id) THEN couple.bride_id END,
      CASE WHEN public.is_current_couple_member(couple.groom_id, couple.id) THEN couple.groom_id END
    ], NULL)
    FROM public.couples AS couple
    WHERE couple.id = p_couple_id
  ), ARRAY[]::uuid[]);
$function$;

-- 커플 알림. 링크는 홈(라운지)이다. 같은 줄은 한 번만 남는다.
CREATE FUNCTION public.hall_inquiry_notify(
  p_couple_id uuid,
  p_recipient_user_id uuid,
  p_actor_user_id uuid,
  p_action_id uuid,
  p_event_kind text,
  p_tool_name text,
  p_title text,
  p_message text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  INSERT INTO public.couple_change_notifications(
    couple_id, recipient_user_id, actor_user_id, source_message_id, action_id,
    event_kind, tool_name, title, message, href
  ) VALUES (
    p_couple_id, p_recipient_user_id, p_actor_user_id, p_action_id, p_action_id,
    p_event_kind, p_tool_name, left(p_title, 120), left(p_message, 240), '/lounge'
  )
  ON CONFLICT (couple_id, recipient_user_id, action_id, event_kind) DO NOTHING;
$function$;

CREATE FUNCTION public.hall_inquiry_lock_member(p_couple_id uuid, p_actor_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_couple_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'HALL_INQUIRY_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.couples AS couple WHERE couple.id = p_couple_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_current_couple_member(p_actor_user_id, p_couple_id) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_NOT_COUPLE_MEMBER' USING ERRCODE = '42501';
  END IF;
  -- 계정 삭제와 같은 잠금을 나눠 잡는다. 그 사람을 지우는 중이면 기다리지 않고 멈춘다.
  IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('hanbang:account-data:' || p_actor_user_id::text, 0)
  ) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_ACCOUNT_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  -- 탈퇴를 신청한 사람은 그 작업이 끝날 때까지(사람 검토 대기 포함) 쓰지 못한다. 기존 삭제 경계와 같다.
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_jobs AS job
    WHERE job.user_id = p_actor_user_id AND job.status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_ACCOUNT_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  -- 상대의 탈퇴가 실제로 진행 중일 때만 커플 전체를 멈춘다. 지운 뒤에 그 사람의 이름이나 연락처가
  -- 새 편지로 다시 들어오지 않게 하기 위해서다. 사람 검토를 기다리며 멈춘 작업(manual_review)은
  -- 언제 풀릴지 모르므로 남은 사람을 붙잡지 않는다. 작업이 다시 돌면 정리 함수가 그때 다시 지운다.
  -- 진행 중 상태 목록은 account_deletion_jobs 의 상태 검사 제약과 시험이 맞춰 본다.
  IF EXISTS (
    SELECT 1
    FROM public.couples AS couple
    JOIN public.account_deletion_jobs AS job
      ON job.user_id IN (couple.bride_id, couple.groom_id)
     AND job.user_id <> p_actor_user_id
     AND job.status IN ('inventorying', 'inventory_ready', 'deleting', 'auth_deleting')
    WHERE couple.id = p_couple_id
  ) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_ACCOUNT_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7) 편지 판 저장(W3, WS1)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.hall_inquiry_save_letter_version(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_letter_id uuid,
  p_recipient_hall_ids uuid[],
  p_body text,
  p_signature text,
  p_shares jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_ids uuid[];
  v_names text[];
  v_letter public.hall_inquiry_letters%ROWTYPE;
  v_latest public.hall_inquiry_letter_versions%ROWTYPE;
  v_has_latest boolean;
  v_fingerprint text;
  v_version_id uuid;
  v_version integer;
BEGIN
  PERFORM public.hall_inquiry_lock_member(p_couple_id, p_actor_user_id);

  IF p_recipient_hall_ids IS NULL
     OR cardinality(p_recipient_hall_ids) NOT BETWEEN 1 AND 10
     OR array_position(p_recipient_hall_ids, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT item) FROM unnest(p_recipient_hall_ids) AS item)
        <> cardinality(p_recipient_hall_ids) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_RECIPIENTS_INVALID' USING ERRCODE = '22023';
  END IF;

  -- 받는 곳은 지금 공개 중이고 이 커플이 담은 홀이어야 한다.
  SELECT array_agg(listing.id ORDER BY requested.ord), array_agg(listing.name ORDER BY requested.ord)
    INTO v_ids, v_names
  FROM unnest(p_recipient_hall_ids) WITH ORDINALITY AS requested(hall_id, ord)
  JOIN public.hall_listings AS listing
    ON listing.id = requested.hall_id AND listing.active
  JOIN public.hall_shortlists AS pick
    ON pick.hall_id = listing.id AND pick.couple_id = p_couple_id;
  IF v_ids IS NULL OR cardinality(v_ids) <> cardinality(p_recipient_hall_ids) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_RECIPIENTS_UNAVAILABLE' USING ERRCODE = '22023';
  END IF;

  IF p_body IS NULL
     OR char_length(p_body) NOT BETWEEN 1 AND 1000
     OR p_body IS DISTINCT FROM btrim(p_body, E' \n')
     OR public.hall_inquiry_text_is_unsafe(p_body, true) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_BODY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_signature IS NULL
     OR char_length(p_signature) NOT BETWEEN 1 AND 60
     OR p_signature IS DISTINCT FROM btrim(p_signature)
     OR public.hall_inquiry_text_is_unsafe(p_signature, false) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_BODY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT public.hall_inquiry_shares_are_valid(p_shares) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_SHARES_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_letter_id IS NULL THEN
    SELECT letter.* INTO v_letter
    FROM public.hall_inquiry_letters AS letter
    WHERE letter.couple_id = p_couple_id AND letter.locked_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.hall_inquiry_letters (couple_id, created_by)
      VALUES (p_couple_id, p_actor_user_id)
      RETURNING * INTO v_letter;
    END IF;
  ELSE
    SELECT letter.* INTO v_letter
    FROM public.hall_inquiry_letters AS letter
    WHERE letter.id = p_letter_id AND letter.couple_id = p_couple_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'HALL_INQUIRY_LETTER_NOT_FOUND' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_letter.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'HALL_INQUIRY_LETTER_LOCKED' USING ERRCODE = '55000';
  END IF;

  v_fingerprint := public.hall_inquiry_letter_fingerprint(p_couple_id, v_ids, p_body, p_signature, p_shares);

  SELECT version.* INTO v_latest
  FROM public.hall_inquiry_letter_versions AS version
  WHERE version.letter_id = v_letter.id
  ORDER BY version.version DESC
  LIMIT 1;
  v_has_latest := FOUND;

  -- 내용이 같으면 새 판을 만들지 않는다. 같은 판에 받은 승인이 그대로 유효하다.
  IF v_has_latest AND v_latest.fingerprint = v_fingerprint THEN
    RETURN jsonb_build_object(
      'letterId', v_letter.id,
      'versionId', v_latest.id,
      'version', v_latest.version,
      'fingerprint', v_latest.fingerprint,
      'created', false
    );
  END IF;

  v_version := CASE WHEN v_has_latest THEN v_latest.version + 1 ELSE 1 END;
  IF v_version > 500 THEN
    RAISE EXCEPTION 'HALL_INQUIRY_TOO_MANY_VERSIONS' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.hall_inquiry_letter_versions (
    letter_id, couple_id, version, recipient_hall_ids, recipient_names,
    body, signature, shares, fingerprint, created_by
  ) VALUES (
    v_letter.id, p_couple_id, v_version, v_ids, v_names,
    p_body, p_signature, p_shares, v_fingerprint, p_actor_user_id
  )
  RETURNING id INTO v_version_id;

  -- 앞 판의 확인 요청은 낡았다. 새 판은 새 승인이 필요하다.
  UPDATE public.couple_change_notifications AS notification
     SET event_kind = 'change_stale',
         title = '편지 내용이 바뀌었어요',
         message = '바뀐 편지를 다시 확인해 주세요.'
   WHERE notification.couple_id = p_couple_id
     AND notification.tool_name = 'hall_inquiry_letter'
     AND notification.event_kind = 'approval_requested'
     AND notification.action_id IN (
       SELECT version.id
       FROM public.hall_inquiry_letter_versions AS version
       WHERE version.letter_id = v_letter.id AND version.id <> v_version_id
     );

  RETURN jsonb_build_object(
    'letterId', v_letter.id,
    'versionId', v_version_id,
    'version', v_version,
    'fingerprint', v_fingerprint,
    'created', true
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8) 승인 방식 정하기(D-76, 2026-11-16 파운더 "커플이 정하게")
--    상대(Y)가 가진 승인 권한을 줄이는 변경은 Y 가 확인할 때까지 제안으로만 남고 지금 방식이 그대로
--    쓰인다. 줄이는 변경: both → 다른 것, designated(Y) → 다른 것, unset → designated(나).
--    Y 에게 권한을 더 주거나 내 권한만 줄이는 변경, 혼자인 커플의 변경은 바로 쓴다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.hall_inquiry_approver_change_needs_consent(
  p_current_mode text,
  p_current_designated uuid,
  p_next_mode text,
  p_next_designated uuid,
  p_actor_user_id uuid,
  p_members uuid[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE(
    cardinality(p_members) >= 2
    AND p_actor_user_id = ANY(p_members)
    AND (p_current_mode, p_current_designated) IS DISTINCT FROM (p_next_mode, p_next_designated)
    AND (
      p_current_mode = 'both'
      OR (p_current_mode = 'designated'
          AND p_current_designated IS DISTINCT FROM p_actor_user_id
          AND p_current_designated = ANY(p_members))
      OR (p_current_mode = 'unset' AND p_next_mode = 'designated' AND p_next_designated = p_actor_user_id)
    ),
    false
  );
$function$;

-- 지금 방식과 기다리는 제안을 화면이 읽는 모양으로 준다. 줄이 없으면 아직 고르지 않은 것(revision 0)이다.
CREATE FUNCTION public.hall_inquiry_approver_state(p_couple_id uuid, p_outcome text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'mode', COALESCE(setting.approver_mode, 'unset'),
    'designatedUserId', setting.designated_user_id,
    'revision', COALESCE(setting.revision, 0),
    'changed', p_outcome IN ('applied', 'confirmed'),
    'outcome', p_outcome,
    'pending', CASE WHEN setting.proposal_id IS NULL THEN NULL ELSE jsonb_build_object(
      'proposalId', setting.proposal_id,
      'mode', setting.proposed_mode,
      'designatedUserId', setting.proposed_designated_user_id,
      'proposedBy', setting.proposed_by,
      'proposedAt', setting.proposed_at
    ) END
  )
  FROM (SELECT 1) AS anchor
  LEFT JOIN public.hall_inquiry_settings AS setting ON setting.couple_id = p_couple_id;
$function$;

-- 기다리던 제안을 내린다. 확인을 부탁한 알림은 낡은 알림으로 바꾼다.
CREATE FUNCTION public.hall_inquiry_drop_approver_proposal(p_couple_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.couple_change_notifications AS notification
     SET event_kind = 'change_stale',
         title = '승인 방식 제안이 끝났어요',
         message = '확인을 기다리던 승인 방식 제안이 정리됐어요.'
   WHERE notification.couple_id = p_couple_id
     AND notification.tool_name = 'hall_inquiry_approver'
     AND notification.event_kind = 'approval_requested'
     AND notification.action_id = (
       SELECT setting.proposal_id FROM public.hall_inquiry_settings AS setting
       WHERE setting.couple_id = p_couple_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.couple_change_notifications AS stale
       WHERE stale.couple_id = notification.couple_id
         AND stale.recipient_user_id = notification.recipient_user_id
         AND stale.action_id = notification.action_id
         AND stale.event_kind = 'change_stale'
     );
  UPDATE public.hall_inquiry_settings
     SET proposal_id = NULL,
         proposed_mode = NULL,
         proposed_designated_user_id = NULL,
         proposed_by = NULL,
         proposed_at = NULL
   WHERE couple_id = p_couple_id
     AND proposal_id IS NOT NULL;
END;
$function$;

CREATE FUNCTION public.hall_inquiry_respond_approver(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_proposal_id uuid,
  p_accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_members uuid[];
  v_current public.hall_inquiry_settings%ROWTYPE;
BEGIN
  IF p_proposal_id IS NULL OR p_accept IS NULL THEN
    RAISE EXCEPTION 'HALL_INQUIRY_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.hall_inquiry_lock_member(p_couple_id, p_actor_user_id);
  v_members := public.hall_inquiry_current_members(p_couple_id);

  SELECT setting.* INTO v_current
  FROM public.hall_inquiry_settings AS setting
  WHERE setting.couple_id = p_couple_id
  FOR UPDATE;
  -- 화면이 본 제안과 지금 제안이 다르거나, 제안한 사람이 더는 회원이 아니면 답하지 않는다.
  IF NOT FOUND
     OR v_current.proposal_id IS DISTINCT FROM p_proposal_id
     OR NOT COALESCE(v_current.proposed_by = ANY(v_members), false) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_APPROVER_PROPOSAL_CHANGED' USING ERRCODE = '55000';
  END IF;
  -- 내가 낸 제안은 상대가 답한다. 거두려면 지금 방식을 다시 고른다.
  IF v_current.proposed_by = p_actor_user_id THEN
    RAISE EXCEPTION 'HALL_INQUIRY_APPROVER_PROPOSAL_OWN' USING ERRCODE = '42501';
  END IF;

  IF p_accept THEN
    -- 확인하는 때의 회원으로 다시 본다.
    IF v_current.proposed_mode = 'designated'
       AND NOT COALESCE(v_current.proposed_designated_user_id = ANY(v_members), false) THEN
      RAISE EXCEPTION 'HALL_INQUIRY_APPROVER_NOT_MEMBER' USING ERRCODE = '22023';
    END IF;
    IF v_current.proposed_mode = 'both' AND cardinality(v_members) < 2 THEN
      RAISE EXCEPTION 'HALL_INQUIRY_APPROVER_PARTNER_REQUIRED' USING ERRCODE = '22023';
    END IF;
    PERFORM public.hall_inquiry_drop_approver_proposal(p_couple_id);
    UPDATE public.hall_inquiry_settings
       SET approver_mode = v_current.proposed_mode,
           designated_user_id = v_current.proposed_designated_user_id,
           revision = v_current.revision + 1,
           updated_by = p_actor_user_id,
           updated_at = now()
     WHERE couple_id = p_couple_id;
    PERFORM public.hall_inquiry_notify(
      p_couple_id, v_current.proposed_by, p_actor_user_id,
      md5('hall-inquiry-approver-confirmed:' || p_proposal_id::text)::uuid,
      'change_applied', 'hall_inquiry_approver',
      '상담 문의 승인 방식이 바뀌었어요',
      '파트너가 확인해서 바꾸자던 승인 방식이 지금부터 쓰여요.'
    );
    RETURN public.hall_inquiry_approver_state(p_couple_id, 'confirmed');
  END IF;

  PERFORM public.hall_inquiry_drop_approver_proposal(p_couple_id);
  PERFORM public.hall_inquiry_notify(
    p_couple_id, v_current.proposed_by, p_actor_user_id,
    md5('hall-inquiry-approver-declined:' || p_proposal_id::text)::uuid,
    'change_rejected', 'hall_inquiry_approver',
    '승인 방식은 그대로예요',
    '파트너가 바꾸자던 승인 방식을 받아들이지 않았어요. 지금 방식이 그대로 쓰여요.'
  );
  RETURN public.hall_inquiry_approver_state(p_couple_id, 'declined');
END;
$function$;

CREATE FUNCTION public.hall_inquiry_set_approver(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_mode text,
  p_designated_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_members uuid[];
  v_current public.hall_inquiry_settings%ROWTYPE;
  v_found boolean;
  v_mode text := 'unset';
  v_designated uuid;
  v_revision bigint := 0;
  v_member uuid;
  v_message text;
  v_proposal uuid;
BEGIN
  PERFORM public.hall_inquiry_lock_member(p_couple_id, p_actor_user_id);
  IF p_mode IS NULL OR p_mode NOT IN ('unset', 'designated', 'both') THEN
    RAISE EXCEPTION 'HALL_INQUIRY_APPROVER_INVALID' USING ERRCODE = '22023';
  END IF;
  v_members := public.hall_inquiry_current_members(p_couple_id);
  IF p_mode = 'designated' THEN
    IF p_designated_user_id IS NULL OR NOT (p_designated_user_id = ANY(v_members)) THEN
      RAISE EXCEPTION 'HALL_INQUIRY_APPROVER_NOT_MEMBER' USING ERRCODE = '22023';
    END IF;
  ELSIF p_designated_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'HALL_INQUIRY_APPROVER_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'both' AND cardinality(v_members) < 2 THEN
    RAISE EXCEPTION 'HALL_INQUIRY_APPROVER_PARTNER_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT setting.* INTO v_current
  FROM public.hall_inquiry_settings AS setting
  WHERE setting.couple_id = p_couple_id
  FOR UPDATE;
  v_found := FOUND;
  IF v_found THEN
    v_mode := v_current.approver_mode;
    v_designated := v_current.designated_user_id;
    v_revision := v_current.revision;
  END IF;

  -- 지금 방식을 다시 고르면 바뀌는 것이 없다. 내가 낸 제안이 기다리고 있었다면 그것을 거둔다.
  IF v_mode = p_mode AND v_designated IS NOT DISTINCT FROM p_designated_user_id THEN
    IF v_found AND v_current.proposal_id IS NOT NULL AND v_current.proposed_by = p_actor_user_id THEN
      PERFORM public.hall_inquiry_drop_approver_proposal(p_couple_id);
      RETURN public.hall_inquiry_approver_state(p_couple_id, 'withdrawn');
    END IF;
    RETURN public.hall_inquiry_approver_state(p_couple_id, 'unchanged');
  END IF;

  -- 상대가 낸 제안과 같은 방식을 고르면 그 제안을 확인한 것이다.
  IF v_found AND v_current.proposal_id IS NOT NULL
     AND v_current.proposed_by IS DISTINCT FROM p_actor_user_id
     AND COALESCE(v_current.proposed_by = ANY(v_members), false)
     AND v_current.proposed_mode = p_mode
     AND v_current.proposed_designated_user_id IS NOT DISTINCT FROM p_designated_user_id THEN
    RETURN public.hall_inquiry_respond_approver(p_couple_id, p_actor_user_id, v_current.proposal_id, true);
  END IF;

  IF public.hall_inquiry_approver_change_needs_consent(
       v_mode, v_designated, p_mode, p_designated_user_id, p_actor_user_id, v_members
     ) THEN
    -- 앞 제안은 누가 냈든 새 제안으로 바뀐다. 지금 방식과 판 번호는 그대로다.
    PERFORM public.hall_inquiry_drop_approver_proposal(p_couple_id);
    v_proposal := gen_random_uuid();
    INSERT INTO public.hall_inquiry_settings (
      couple_id, approver_mode, designated_user_id, revision, updated_by, updated_at,
      proposal_id, proposed_mode, proposed_designated_user_id, proposed_by, proposed_at
    ) VALUES (
      p_couple_id, 'unset', NULL, 0, NULL, now(),
      v_proposal, p_mode, p_designated_user_id, p_actor_user_id, now()
    )
    ON CONFLICT (couple_id) DO UPDATE
      SET proposal_id = EXCLUDED.proposal_id,
          proposed_mode = EXCLUDED.proposed_mode,
          proposed_designated_user_id = EXCLUDED.proposed_designated_user_id,
          proposed_by = EXCLUDED.proposed_by,
          proposed_at = EXCLUDED.proposed_at;
    FOREACH v_member IN ARRAY v_members LOOP
      CONTINUE WHEN v_member = p_actor_user_id;
      PERFORM public.hall_inquiry_notify(
        p_couple_id, v_member, p_actor_user_id, v_proposal,
        'approval_requested', 'hall_inquiry_approver',
        '상담 문의 승인 방식을 함께 정해 주세요',
        '파트너가 승인 방식을 바꾸자고 했어요. 확인하면 바뀌고, 그전까지는 지금 방식이 그대로 쓰여요.'
      );
    END LOOP;
    RETURN public.hall_inquiry_approver_state(p_couple_id, 'proposed');
  END IF;

  -- 상대의 권한을 줄이지 않는 변경은 바로 쓴다. 기다리던 제안은 앞 방식을 두고 낸 것이라 내린다.
  PERFORM public.hall_inquiry_drop_approver_proposal(p_couple_id);
  v_revision := v_revision + 1;
  INSERT INTO public.hall_inquiry_settings (
    couple_id, approver_mode, designated_user_id, revision, updated_by, updated_at
  ) VALUES (
    p_couple_id, p_mode, p_designated_user_id, v_revision, p_actor_user_id, now()
  )
  ON CONFLICT (couple_id) DO UPDATE
    SET approver_mode = EXCLUDED.approver_mode,
        designated_user_id = EXCLUDED.designated_user_id,
        revision = EXCLUDED.revision,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

  FOREACH v_member IN ARRAY v_members LOOP
    CONTINUE WHEN v_member = p_actor_user_id;
    -- 알림에는 이름을 적지 않는다. 받는 사람 쪽에서 본 말로 쓴다.
    v_message := CASE
      WHEN p_mode = 'unset' THEN '두 사람 중 한 사람이 승인하면 돼요. 승인하면 두 사람 모두 알림을 받아요.'
      WHEN p_mode = 'both' THEN '두 사람이 모두 같은 편지를 승인해야 해요.'
      WHEN v_member = p_designated_user_id THEN '이제 내가 승인하면 편지를 보낼 수 있어요.'
      ELSE '이제 파트너가 승인하면 편지를 보낼 수 있어요.'
    END;
    PERFORM public.hall_inquiry_notify(
      p_couple_id, v_member, p_actor_user_id,
      md5('hall-inquiry-approver:' || p_couple_id::text || ':' || v_revision::text)::uuid,
      'change_applied', 'hall_inquiry_approver',
      '상담 문의 승인 방식이 바뀌었어요', v_message
    );
  END LOOP;

  RETURN public.hall_inquiry_approver_state(p_couple_id, 'applied');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9) 승인과 대기열(WS1, WS2, WS5)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.hall_inquiry_approve_letter(
  p_couple_id uuid,
  p_actor_user_id uuid,
  p_version_id uuid,
  p_fingerprint text,
  p_sending_enabled boolean,
  p_daily_cap integer,
  p_global_daily_cap integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_version public.hall_inquiry_letter_versions%ROWTYPE;
  v_letter public.hall_inquiry_letters%ROWTYPE;
  v_latest integer;
  v_mode text := 'unset';
  v_designated uuid;
  v_revision bigint := 0;
  v_members uuid[];
  v_approved uuid[];
  v_waiting uuid[];
  v_complete boolean;
  v_unavailable boolean := false;
  v_member uuid;
  v_candidates uuid[];
  v_duplicates uuid[];
  v_today_count integer;
  v_global_count integer;
  v_day_start timestamptz;
  v_eligible boolean;
  v_queued integer := 0;
  v_index integer;
  v_names text;
BEGIN
  IF p_version_id IS NULL
     OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_sending_enabled IS NULL
     OR p_daily_cap IS NULL OR p_daily_cap NOT BETWEEN 0 AND 50
     OR p_global_daily_cap IS NULL OR p_global_daily_cap NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'HALL_INQUIRY_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.hall_inquiry_lock_member(p_couple_id, p_actor_user_id);

  SELECT version.* INTO v_version
  FROM public.hall_inquiry_letter_versions AS version
  WHERE version.id = p_version_id AND version.couple_id = p_couple_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HALL_INQUIRY_LETTER_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  SELECT letter.* INTO v_letter
  FROM public.hall_inquiry_letters AS letter
  WHERE letter.id = v_version.letter_id
  FOR UPDATE;
  -- 잠금을 기다리는 사이 바뀌었을 수 있어 잠근 뒤에 다시 읽는다.
  SELECT version.* INTO v_version
  FROM public.hall_inquiry_letter_versions AS version
  WHERE version.id = p_version_id;
  SELECT max(version.version) INTO v_latest
  FROM public.hall_inquiry_letter_versions AS version
  WHERE version.letter_id = v_letter.id;

  -- 탈퇴로 지운 판은 승인할 내용이 없다.
  IF v_version.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'HALL_INQUIRY_LETTER_LOCKED' USING ERRCODE = '55000';
  END IF;
  -- 화면이 본 내용과 지금 판이 다르면 승인하지 않는다(WS1).
  IF v_version.version <> v_latest OR v_version.fingerprint IS DISTINCT FROM p_fingerprint THEN
    RAISE EXCEPTION 'HALL_INQUIRY_VERSION_CHANGED' USING ERRCODE = '55000';
  END IF;

  -- 이미 대기열에 들어간 판이면 같은 결과를 돌려준다. 두 번 눌러도 두 번 넣지 않는다(WS2).
  IF v_version.queued_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'queued',
      'notQueuedReason', NULL,
      'queuedCount', (
        SELECT count(*) FROM public.hall_inquiry_dispatches AS dispatch
        WHERE dispatch.version_id = v_version.id
      ),
      'duplicateHallIds', to_jsonb(ARRAY(
        SELECT item.hall_id
        FROM unnest(v_version.recipient_hall_ids) WITH ORDINALITY AS item(hall_id, ord)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.hall_inquiry_dispatches AS dispatch
          WHERE dispatch.version_id = v_version.id AND dispatch.hall_id = item.hall_id
        )
        ORDER BY item.ord
      )),
      'waitingFor', '[]'::jsonb
    );
  END IF;
  IF v_letter.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'HALL_INQUIRY_LETTER_LOCKED' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_version.recipient_hall_ids) AS item(hall_id)
    LEFT JOIN public.hall_listings AS listing
      ON listing.id = item.hall_id AND listing.active
    WHERE listing.id IS NULL
  ) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_RECIPIENTS_UNAVAILABLE' USING ERRCODE = '55000';
  END IF;

  SELECT setting.approver_mode, setting.designated_user_id, setting.revision
    INTO v_mode, v_designated, v_revision
  FROM public.hall_inquiry_settings AS setting
  WHERE setting.couple_id = p_couple_id;
  IF NOT FOUND THEN
    v_mode := 'unset';
    v_designated := NULL;
    v_revision := 0;
  END IF;

  v_members := public.hall_inquiry_current_members(p_couple_id);

  -- 지금 방식에서 승인할 수 있는 사람의 승인만 남긴다. 정한 한 사람이 있으면 그 사람뿐이다.
  -- 기다리는 승인 방식 제안은 여기서 보지 않는다. 확인되기 전까지는 지금 방식이 그대로다.
  v_eligible := CASE
    WHEN v_mode = 'designated' THEN p_actor_user_id = v_designated AND p_actor_user_id = ANY(v_members)
    ELSE p_actor_user_id = ANY(v_members)
  END;
  IF COALESCE(v_eligible, false) THEN
    INSERT INTO public.hall_inquiry_approvals (
      version_id, couple_id, approver_user_id, fingerprint, settings_revision, sending_enabled
    ) VALUES (
      v_version.id, p_couple_id, p_actor_user_id, v_version.fingerprint, v_revision, p_sending_enabled
    )
    ON CONFLICT (version_id, approver_user_id, settings_revision, sending_enabled) DO NOTHING;
  END IF;

  -- 문의 보내기가 켜져 있으면 켜진 동안 받은 승인만 센다. 꺼진 동안의 승인은 저장된 선택으로 남지만,
  -- 스위치가 켜진 뒤 누가 다시 눌러도 그것만으로 대기열에 들어가지 않는다. 켜진 뒤 새로 승인해야 한다.
  SELECT COALESCE(array_agg(DISTINCT approval.approver_user_id), ARRAY[]::uuid[])
    INTO v_approved
  FROM public.hall_inquiry_approvals AS approval
  WHERE approval.version_id = v_version.id
    AND approval.settings_revision = v_revision
    AND approval.fingerprint = v_version.fingerprint
    AND approval.approver_user_id = ANY(v_members)
    AND (NOT p_sending_enabled OR approval.sending_enabled);

  IF v_mode = 'designated' THEN
    v_unavailable := NOT COALESCE(v_designated = ANY(v_members), false);
    v_complete := NOT v_unavailable AND COALESCE(v_designated = ANY(v_approved), false);
    v_waiting := CASE WHEN v_complete OR v_unavailable THEN ARRAY[]::uuid[] ELSE ARRAY[v_designated] END;
  ELSIF v_mode = 'both' THEN
    v_unavailable := cardinality(v_members) < 2;
    v_complete := NOT v_unavailable AND COALESCE(v_members <@ v_approved, false);
    v_waiting := ARRAY(
      SELECT member FROM unnest(v_members) AS member WHERE NOT (member = ANY(v_approved))
    );
  ELSE
    v_complete := cardinality(v_approved) >= 1;
    v_waiting := CASE WHEN v_complete THEN ARRAY[]::uuid[] ELSE v_members END;
  END IF;

  v_names := array_to_string(v_version.recipient_names, ', ');

  IF NOT COALESCE(v_complete, false) THEN
    FOREACH v_member IN ARRAY v_waiting LOOP
      CONTINUE WHEN v_member = p_actor_user_id;
      PERFORM public.hall_inquiry_notify(
        p_couple_id, v_member, p_actor_user_id, v_version.id,
        'approval_requested', 'hall_inquiry_letter',
        '함께 확인할 상담 문의 편지가 있어요',
        v_names || '에 보낼 편지예요. 읽어 보고 승인해 주세요.'
      );
    END LOOP;
    RETURN jsonb_build_object(
      'status', 'awaiting_approval',
      'notQueuedReason', CASE WHEN v_unavailable THEN 'approver_unavailable' END,
      'queuedCount', 0,
      'duplicateHallIds', '[]'::jsonb,
      'waitingFor', to_jsonb(v_waiting)
    );
  END IF;

  UPDATE public.hall_inquiry_letter_versions
     SET approval_completed_at = now()
   WHERE id = v_version.id AND approval_completed_at IS NULL;

  -- 문의만 멈추는 스위치(WS5). 승인은 남기고 아무것도 넣지 않는다.
  IF NOT p_sending_enabled THEN
    FOREACH v_member IN ARRAY v_members LOOP
      PERFORM public.hall_inquiry_notify(
        p_couple_id, v_member, p_actor_user_id, v_version.id,
        'change_applied', 'hall_inquiry_letter',
        '상담 문의 편지가 승인됐어요',
        v_names || '에 보낼 편지예요. 지금은 문의 보내기를 멈춰 두어서 아직 보내지 않았어요. 다시 켜지면 한 번 더 승인해 주세요.'
      );
    END LOOP;
    RETURN jsonb_build_object(
      'status', 'approved_not_queued',
      'notQueuedReason', 'sending_disabled',
      'queuedCount', 0,
      'duplicateHallIds', '[]'::jsonb,
      'waitingFor', '[]'::jsonb
    );
  END IF;

  -- 같은 내용이 이미 그 홀로 들어간 곳은 다시 넣지 않는다(WS2).
  SELECT
    COALESCE(array_agg(item.hall_id ORDER BY item.ord) FILTER (WHERE existing.id IS NULL), ARRAY[]::uuid[]),
    COALESCE(array_agg(item.hall_id ORDER BY item.ord) FILTER (WHERE existing.id IS NOT NULL), ARRAY[]::uuid[])
    INTO v_candidates, v_duplicates
  FROM unnest(v_version.recipient_hall_ids) WITH ORDINALITY AS item(hall_id, ord)
  LEFT JOIN public.hall_inquiry_dispatches AS existing
    ON existing.dispatch_fingerprint = public.hall_inquiry_dispatch_fingerprint(
      p_couple_id, item.hall_id, v_version.body, v_version.signature, v_version.shares
    );

  -- 하루 상한(WS5). 한국 날짜로 오늘 대기열에 넣은 줄을 센다. 편지 한 통은 나누지 않는다.
  v_day_start := date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  SELECT count(*)::integer INTO v_today_count
  FROM public.hall_inquiry_dispatches AS dispatch
  WHERE dispatch.couple_id = p_couple_id
    AND dispatch.queued_at >= v_day_start
    AND dispatch.queued_at < v_day_start + interval '1 day';
  IF v_today_count + cardinality(v_candidates) > p_daily_cap THEN
    FOREACH v_member IN ARRAY v_members LOOP
      PERFORM public.hall_inquiry_notify(
        p_couple_id, v_member, p_actor_user_id, v_version.id,
        'change_applied', 'hall_inquiry_letter',
        '상담 문의 편지가 승인됐어요',
        v_names || '에 보낼 편지예요. 오늘 보낼 수 있는 문의 수를 넘어서 아직 보내지 않았어요.'
      );
    END LOOP;
    RETURN jsonb_build_object(
      'status', 'approved_not_queued',
      'notQueuedReason', 'daily_cap',
      'queuedCount', 0,
      'duplicateHallIds', to_jsonb(v_duplicates),
      'waitingFor', '[]'::jsonb
    );
  END IF;

  -- 서비스 전체의 하루 상한(WS5). 모든 커플이 오늘 넣은 줄을 함께 센다. 값이 없거나 틀리면 서버가 0 을
  -- 넘긴다(닫힌 채 실패). 두 커플이 동시에 마지막 자리를 차지하지 않게 세기 전에 잠근다. 커플 행을
  -- 먼저 잡은 뒤 이 잠금을 잡으므로 잠금 순서는 언제나 같다.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hanbang:hall-inquiry-global-cap', 0));
  SELECT count(*)::integer INTO v_global_count
  FROM public.hall_inquiry_dispatches AS dispatch
  WHERE dispatch.queued_at >= v_day_start
    AND dispatch.queued_at < v_day_start + interval '1 day';
  IF v_global_count + cardinality(v_candidates) > p_global_daily_cap THEN
    FOREACH v_member IN ARRAY v_members LOOP
      PERFORM public.hall_inquiry_notify(
        p_couple_id, v_member, p_actor_user_id, v_version.id,
        'change_applied', 'hall_inquiry_letter',
        '상담 문의 편지가 승인됐어요',
        v_names || '에 보낼 편지예요. 오늘 보낼 수 있는 문의 수를 넘어서 아직 보내지 않았어요.'
      );
    END LOOP;
    RETURN jsonb_build_object(
      'status', 'approved_not_queued',
      'notQueuedReason', 'global_daily_cap',
      'queuedCount', 0,
      'duplicateHallIds', to_jsonb(v_duplicates),
      'waitingFor', '[]'::jsonb
    );
  END IF;

  FOR v_index IN 1..cardinality(v_version.recipient_hall_ids) LOOP
    CONTINUE WHEN NOT (v_version.recipient_hall_ids[v_index] = ANY(v_candidates));
    INSERT INTO public.hall_inquiry_dispatches (
      couple_id, letter_id, version_id, hall_id, recipient_name, dispatch_fingerprint
    ) VALUES (
      p_couple_id, v_letter.id, v_version.id,
      v_version.recipient_hall_ids[v_index],
      v_version.recipient_names[v_index],
      public.hall_inquiry_dispatch_fingerprint(
        p_couple_id, v_version.recipient_hall_ids[v_index], v_version.body, v_version.signature, v_version.shares
      )
    )
    ON CONFLICT (dispatch_fingerprint) DO NOTHING;
    IF FOUND THEN
      v_queued := v_queued + 1;
    ELSE
      v_duplicates := v_duplicates || v_version.recipient_hall_ids[v_index];
    END IF;
  END LOOP;

  UPDATE public.hall_inquiry_letter_versions SET queued_at = now() WHERE id = v_version.id;
  UPDATE public.hall_inquiry_letters SET locked_at = now() WHERE id = v_letter.id;

  FOREACH v_member IN ARRAY v_members LOOP
    PERFORM public.hall_inquiry_notify(
      p_couple_id, v_member, p_actor_user_id,
      md5('hall-inquiry-queued:' || v_version.id::text)::uuid,
      'change_applied', 'hall_inquiry_letter',
      '상담 문의 편지를 보낼 준비가 됐어요',
      v_names || '에 보낼 편지예요. 담당자가 한 번 더 확인한 뒤 업체의 공식 문의 창구로 보내요.'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'queued',
    'notQueuedReason', NULL,
    'queuedCount', v_queued,
    'duplicateHallIds', to_jsonb(v_duplicates),
    'waitingFor', '[]'::jsonb
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10) 운영자: 보냈다고 표시하기, 답장 적기(W4 파일럿)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.hall_inquiry_assert_operator(p_operator_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_operator_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = p_operator_user_id AND profile.is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_OPERATOR_REQUIRED' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE FUNCTION public.hall_inquiry_mark_sent(
  p_dispatch_id uuid,
  p_operator_user_id uuid,
  p_channel_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_dispatch public.hall_inquiry_dispatches%ROWTYPE;
BEGIN
  PERFORM public.hall_inquiry_assert_operator(p_operator_user_id);
  SELECT dispatch.* INTO v_dispatch
  FROM public.hall_inquiry_dispatches AS dispatch
  WHERE dispatch.id = p_dispatch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HALL_INQUIRY_DISPATCH_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  -- 탈퇴로 거둬들인 문의는 보내지 않는다.
  IF v_dispatch.status = 'withdrawn' OR v_dispatch.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'HALL_INQUIRY_DISPATCH_WITHDRAWN' USING ERRCODE = '55000';
  END IF;
  IF v_dispatch.status = 'sent' THEN
    RETURN jsonb_build_object('status', 'sent', 'alreadySent', true, 'sentAt', v_dispatch.sent_at);
  END IF;
  UPDATE public.hall_inquiry_dispatches
     SET status = 'sent',
         sent_at = now(),
         sent_by = p_operator_user_id,
         channel_note = NULLIF(btrim(p_channel_note), '')
   WHERE id = p_dispatch_id
  RETURNING * INTO v_dispatch;
  RETURN jsonb_build_object('status', 'sent', 'alreadySent', false, 'sentAt', v_dispatch.sent_at);
END;
$function$;

CREATE FUNCTION public.hall_inquiry_record_reply(
  p_dispatch_id uuid,
  p_operator_user_id uuid,
  p_raw_text text,
  p_outcome text,
  p_event_at timestamptz,
  p_place_note text,
  p_price_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_dispatch public.hall_inquiry_dispatches%ROWTYPE;
  v_reply_id uuid;
  v_member uuid;
BEGIN
  PERFORM public.hall_inquiry_assert_operator(p_operator_user_id);
  SELECT dispatch.* INTO v_dispatch
  FROM public.hall_inquiry_dispatches AS dispatch
  WHERE dispatch.id = p_dispatch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HALL_INQUIRY_DISPATCH_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  -- 탈퇴로 지운 편지의 답장은 새로 적지 않는다. 답장 원문에 떠난 사람의 이름이 다시 들어올 수 있다.
  IF v_dispatch.status = 'withdrawn' OR v_dispatch.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'HALL_INQUIRY_DISPATCH_WITHDRAWN' USING ERRCODE = '55000';
  END IF;
  -- 보내지 않은 문의에는 답장이 있을 수 없다.
  IF v_dispatch.status <> 'sent' THEN
    RAISE EXCEPTION 'HALL_INQUIRY_REPLY_BEFORE_SENT' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.hall_inquiry_replies (
    dispatch_id, couple_id, hall_id, raw_text, outcome, event_at,
    place_note, price_note, recorded_by
  ) VALUES (
    v_dispatch.id, v_dispatch.couple_id, v_dispatch.hall_id, p_raw_text, p_outcome, p_event_at,
    NULLIF(btrim(p_place_note), ''), NULLIF(btrim(p_price_note), ''), p_operator_user_id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_reply_id;

  IF v_reply_id IS NULL THEN
    SELECT reply.id INTO v_reply_id
    FROM public.hall_inquiry_replies AS reply
    WHERE reply.dispatch_id = v_dispatch.id
      AND reply.outcome = p_outcome
      AND md5(reply.raw_text) = md5(p_raw_text)
      AND COALESCE(reply.event_at, '-infinity'::timestamptz)
          = COALESCE(p_event_at, '-infinity'::timestamptz);
    RETURN jsonb_build_object('replyId', v_reply_id, 'created', false);
  END IF;

  FOREACH v_member IN ARRAY public.hall_inquiry_current_members(v_dispatch.couple_id) LOOP
    CONTINUE WHEN v_member = p_operator_user_id;
    PERFORM public.hall_inquiry_notify(
      v_dispatch.couple_id, v_member, p_operator_user_id, v_reply_id,
      'change_applied', 'hall_inquiry_reply',
      '상담 문의에 답장이 왔어요',
      '담당자가 ' || v_dispatch.recipient_name || ' 답장을 정리했어요. 홈에서 확인해 주세요.'
    );
  END LOOP;

  RETURN jsonb_build_object('replyId', v_reply_id, 'created', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 11) 탈퇴(계정 삭제). 기존 삭제 준비 함수와 영수증은 바꾸지 않는다. 삭제 작업이 생기거나 단계가
--     바뀔 때마다 이 기능의 표에서 그 사람의 흔적을 곧바로 지운다(20260920120000 과 같은 방식).
--     같은 사람의 삭제 단계가 여러 번 지나가도 결과는 같다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.hall_inquiry_purge_for_account_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user uuid := NEW.user_id;
  v_now timestamptz := clock_timestamp();
  v_couples uuid[];
  v_letters uuid[];
BEGIN
  IF v_user IS NULL OR NEW.status = 'completed' THEN
    RETURN NEW;
  END IF;
  -- 기존 삭제 작업과 같은 잠금. 이 사람이 쓰던 문의가 끝난 뒤에 지운다.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hanbang:account-data:' || v_user::text, 0));

  -- 지금 속한 커플은 편지 쓰기와 같은 순서(커플 행 먼저)로 잠근다. 상대가 쓰던 편지도 끝난 뒤에 지운다.
  SELECT COALESCE(array_agg(couple.id ORDER BY couple.id), ARRAY[]::uuid[])
    INTO v_couples
  FROM public.couples AS couple
  WHERE couple.id IN (SELECT profile.couple_id FROM public.profiles AS profile WHERE profile.id = v_user)
     OR v_user IN (couple.bride_id, couple.groom_id);
  PERFORM 1
  FROM public.couples AS couple
  WHERE couple.id = ANY(v_couples)
  ORDER BY couple.id
  FOR UPDATE;

  -- 지울 편지: 지금 속한 커플의 편지 전부, 그리고 이 사람이 쓰거나 승인한 편지(예전 커플 것도).
  SELECT COALESCE(array_agg(letter.id ORDER BY letter.id), ARRAY[]::uuid[])
    INTO v_letters
  FROM public.hall_inquiry_letters AS letter
  WHERE letter.couple_id = ANY(v_couples)
     OR letter.created_by = v_user
     OR EXISTS (
       SELECT 1 FROM public.hall_inquiry_letter_versions AS version
       WHERE version.letter_id = letter.id AND version.created_by = v_user
     )
     OR EXISTS (
       SELECT 1
       FROM public.hall_inquiry_approvals AS approval
       JOIN public.hall_inquiry_letter_versions AS version ON version.id = approval.version_id
       WHERE version.letter_id = letter.id AND approval.approver_user_id = v_user
     );

  -- 지운 편지를 승인해 달라는 알림은 낡은 알림으로 바꾼다.
  UPDATE public.couple_change_notifications AS notification
     SET event_kind = 'change_stale',
         title = '상담 문의 편지를 지웠어요',
         message = '함께 쓰던 사람이 탈퇴해서 편지를 지웠어요. 필요하면 새로 써 주세요.'
   WHERE notification.tool_name = 'hall_inquiry_letter'
     AND notification.event_kind = 'approval_requested'
     AND notification.action_id IN (
       SELECT version.id FROM public.hall_inquiry_letter_versions AS version
       WHERE version.letter_id = ANY(v_letters)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.couple_change_notifications AS stale
       WHERE stale.couple_id = notification.couple_id
         AND stale.recipient_user_id = notification.recipient_user_id
         AND stale.action_id = notification.action_id
         AND stale.event_kind = 'change_stale'
     );

  -- 아직 보내지 않은 문의는 거둬들인다. 보낸 줄은 보낸 사실과 시각만 남기고 지문과 메모를 비운다.
  UPDATE public.hall_inquiry_dispatches AS dispatch
     SET status = CASE WHEN dispatch.status = 'queued' THEN 'withdrawn' ELSE dispatch.status END,
         withdrawn_at = CASE WHEN dispatch.status = 'queued' THEN v_now ELSE dispatch.withdrawn_at END,
         dispatch_fingerprint = NULL,
         channel_note = NULL,
         redacted_at = v_now
   WHERE dispatch.letter_id = ANY(v_letters)
     AND dispatch.redacted_at IS NULL;

  UPDATE public.hall_inquiry_replies AS reply
     SET raw_text = NULL,
         place_note = NULL,
         price_note = NULL,
         redacted_at = v_now
   WHERE reply.redacted_at IS NULL
     AND reply.dispatch_id IN (
       SELECT dispatch.id FROM public.hall_inquiry_dispatches AS dispatch
       WHERE dispatch.letter_id = ANY(v_letters)
     );

  UPDATE public.hall_inquiry_approvals AS approval
     SET fingerprint = NULL
   WHERE approval.fingerprint IS NOT NULL
     AND approval.version_id IN (
       SELECT version.id FROM public.hall_inquiry_letter_versions AS version
       WHERE version.letter_id = ANY(v_letters)
     );

  UPDATE public.hall_inquiry_letter_versions AS version
     SET body = NULL,
         signature = NULL,
         shares = NULL,
         fingerprint = NULL,
         redacted_at = v_now
   WHERE version.letter_id = ANY(v_letters)
     AND version.redacted_at IS NULL;

  -- 열려 있던 편지는 닫는다. 남은 사람은 새 편지로 다시 시작한다.
  UPDATE public.hall_inquiry_letters AS letter
     SET locked_at = v_now
   WHERE letter.id = ANY(v_letters)
     AND letter.locked_at IS NULL;

  -- 이 사람을 승인할 사람으로 정해 두었으면 고르기 전으로 돌린다. 앞 방식에서 받은 승인은 세지 않는다.
  UPDATE public.hall_inquiry_settings AS setting
     SET approver_mode = 'unset',
         designated_user_id = NULL,
         revision = setting.revision + 1,
         updated_by = NULL,
         updated_at = v_now
   WHERE setting.designated_user_id = v_user;

  -- 승인 방식 제안을 내린다(확인을 부탁한 알림도 낡은 알림으로). 지금 속한 커플의 제안은 이 사람이 냈거나
  -- 이 사람이 답해야 하는 것이라 모두 내리고, 예전 커플에서 이 사람이 내거나 이 사람을 가리킨 제안도 내린다.
  PERFORM public.hall_inquiry_drop_approver_proposal(setting.couple_id)
  FROM public.hall_inquiry_settings AS setting
  WHERE setting.proposal_id IS NOT NULL
    AND (setting.couple_id = ANY(v_couples)
      OR setting.proposed_by = v_user
      OR setting.proposed_designated_user_id = v_user);

  -- 남은 사람 칸. 이 사람이 운영자였다면 운영자 칸도 여기서 빈다.
  UPDATE public.hall_inquiry_settings SET updated_by = NULL WHERE updated_by = v_user;
  UPDATE public.hall_inquiry_approvals SET approver_user_id = NULL WHERE approver_user_id = v_user;
  UPDATE public.hall_inquiry_letter_versions SET created_by = NULL WHERE created_by = v_user;
  UPDATE public.hall_inquiry_letters SET created_by = NULL WHERE created_by = v_user;
  UPDATE public.hall_shortlists SET added_by = NULL WHERE added_by = v_user;
  UPDATE public.hall_inquiry_dispatches SET sent_by = NULL WHERE sent_by = v_user;
  UPDATE public.hall_inquiry_replies SET recorded_by = NULL WHERE recorded_by = v_user;
  UPDATE public.hall_listings SET created_by = NULL WHERE created_by = v_user;
  UPDATE public.hall_listings SET updated_by = NULL WHERE updated_by = v_user;

  IF EXISTS (
       SELECT 1 FROM public.hall_inquiry_letter_versions AS version
       WHERE version.letter_id = ANY(v_letters) AND version.redacted_at IS NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.hall_inquiry_dispatches AS dispatch
       WHERE dispatch.letter_id = ANY(v_letters)
         AND (dispatch.status = 'queued' OR dispatch.redacted_at IS NULL)
     )
     OR EXISTS (SELECT 1 FROM public.hall_inquiry_approvals WHERE approver_user_id = v_user)
     OR EXISTS (
       SELECT 1 FROM public.hall_inquiry_settings
       WHERE designated_user_id = v_user
          OR proposed_by = v_user
          OR proposed_designated_user_id = v_user
          OR (proposal_id IS NOT NULL AND couple_id = ANY(v_couples))
     ) THEN
    RAISE EXCEPTION 'HALL_INQUIRY_ACCOUNT_DELETION_POSTCONDITION_FAILED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_hall_inquiry_account_deletion
  AFTER INSERT OR UPDATE OF user_id, status ON public.account_deletion_jobs
  FOR EACH ROW EXECUTE FUNCTION public.hall_inquiry_purge_for_account_deletion();

-- 홀 담기는 회원 RLS 로 직접 쓴다. 탈퇴를 시작한 사람의 남은 로그인으로는 담지 못한다.
-- 묻는 사람 자신만 본다. 다른 사람의 탈퇴 여부는 알려주지 않는다.
CREATE FUNCTION public.hall_inquiry_viewer_account_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.account_deletion_jobs AS job
    WHERE job.user_id = auth.uid() AND job.status <> 'completed'
  );
$function$;

-- ---------------------------------------------------------------------------
-- 12) 권한과 RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.hall_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_shortlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_inquiry_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_inquiry_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_inquiry_letter_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_inquiry_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_inquiry_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_inquiry_replies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.hall_listings,
  public.hall_shortlists,
  public.hall_inquiry_settings,
  public.hall_inquiry_letters,
  public.hall_inquiry_letter_versions,
  public.hall_inquiry_approvals,
  public.hall_inquiry_dispatches,
  public.hall_inquiry_replies
FROM PUBLIC, anon, authenticated, service_role;

-- 회원이 표를 직접 읽어도 운영자 ID 와 운영자 메모는 보이지 않게 칸 단위로 준다.
-- 홀 자료의 created_by·updated_by, 발송 줄의 sent_by·channel_note·dispatch_fingerprint, 답장의 recorded_by 는 빠진다.
-- 운영자 화면은 service_role 로 읽는다.
GRANT SELECT (
  id, name, region, area_label, kind_label, meal_price_won, rental_fee_won, rental_included,
  minimum_guarantee, station_walk_minutes, transit_note, photo_url, source_url, checked_on, active,
  created_at, updated_at
) ON TABLE public.hall_listings TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.hall_shortlists TO authenticated;
GRANT SELECT ON TABLE
  public.hall_inquiry_settings,
  public.hall_inquiry_letters,
  public.hall_inquiry_letter_versions,
  public.hall_inquiry_approvals
TO authenticated;
GRANT SELECT (
  id, couple_id, letter_id, version_id, hall_id, recipient_name, status, queued_at, sent_at,
  withdrawn_at, redacted_at
) ON TABLE public.hall_inquiry_dispatches TO authenticated;
GRANT SELECT (
  id, dispatch_id, couple_id, hall_id, raw_text, outcome, event_at, place_note, price_note,
  recorded_at, redacted_at
) ON TABLE public.hall_inquiry_replies TO authenticated;
GRANT ALL ON TABLE
  public.hall_listings,
  public.hall_shortlists,
  public.hall_inquiry_settings,
  public.hall_inquiry_letters,
  public.hall_inquiry_letter_versions,
  public.hall_inquiry_approvals,
  public.hall_inquiry_dispatches,
  public.hall_inquiry_replies
TO service_role;

-- 공개 중인 홀, 또는 내 커플이 담아 둔 홀만 읽는다.
CREATE POLICY hall_listings_member_read
  ON public.hall_listings
  FOR SELECT TO authenticated
  USING (
    active
    OR EXISTS (
      SELECT 1 FROM public.hall_shortlists AS pick
      WHERE pick.hall_id = hall_listings.id
        AND public.is_couple_member(pick.couple_id)
    )
  );
CREATE POLICY hall_listings_service_all
  ON public.hall_listings
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY hall_shortlists_member_select
  ON public.hall_shortlists
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY hall_shortlists_member_insert
  ON public.hall_shortlists
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_couple_member(couple_id)
    AND added_by = auth.uid()
    AND public.hall_inquiry_viewer_account_active()
    AND EXISTS (
      SELECT 1 FROM public.hall_listings AS listing
      WHERE listing.id = hall_id AND listing.active
    )
  );
CREATE POLICY hall_shortlists_member_delete
  ON public.hall_shortlists
  FOR DELETE TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY hall_shortlists_service_all
  ON public.hall_shortlists
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY hall_inquiry_settings_member_select
  ON public.hall_inquiry_settings
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY hall_inquiry_settings_service_all
  ON public.hall_inquiry_settings
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY hall_inquiry_letters_member_select
  ON public.hall_inquiry_letters
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY hall_inquiry_letters_service_all
  ON public.hall_inquiry_letters
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY hall_inquiry_letter_versions_member_select
  ON public.hall_inquiry_letter_versions
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY hall_inquiry_letter_versions_service_all
  ON public.hall_inquiry_letter_versions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY hall_inquiry_approvals_member_select
  ON public.hall_inquiry_approvals
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY hall_inquiry_approvals_service_all
  ON public.hall_inquiry_approvals
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY hall_inquiry_dispatches_member_select
  ON public.hall_inquiry_dispatches
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY hall_inquiry_dispatches_service_all
  ON public.hall_inquiry_dispatches
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY hall_inquiry_replies_member_select
  ON public.hall_inquiry_replies
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY hall_inquiry_replies_service_all
  ON public.hall_inquiry_replies
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER FUNCTION public.hall_inquiry_text_is_unsafe(text, boolean) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_shares_are_valid(jsonb) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_shares_canonical(jsonb) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_letter_fingerprint(uuid, uuid[], text, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_dispatch_fingerprint(uuid, uuid, text, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_guard_record_update() OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_current_members(uuid) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_notify(uuid, uuid, uuid, uuid, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_lock_member(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_save_letter_version(uuid, uuid, uuid, uuid[], text, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_approver_change_needs_consent(text, uuid, text, uuid, uuid, uuid[]) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_approver_state(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_drop_approver_proposal(uuid) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_respond_approver(uuid, uuid, uuid, boolean) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_set_approver(uuid, uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.hall_shortlists_enforce_limit() OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_approve_letter(uuid, uuid, uuid, text, boolean, integer, integer) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_assert_operator(uuid) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_mark_sent(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_record_reply(uuid, uuid, text, text, timestamptz, text, text) OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_purge_for_account_deletion() OWNER TO postgres;
ALTER FUNCTION public.hall_inquiry_viewer_account_active() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.hall_inquiry_text_is_unsafe(text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_shares_are_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_shares_canonical(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_letter_fingerprint(uuid, uuid[], text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_dispatch_fingerprint(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_guard_record_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_current_members(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_notify(uuid, uuid, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_lock_member(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_save_letter_version(uuid, uuid, uuid, uuid[], text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_approver_change_needs_consent(text, uuid, text, uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_approver_state(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_drop_approver_proposal(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_respond_approver(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_set_approver(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_shortlists_enforce_limit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_approve_letter(uuid, uuid, uuid, text, boolean, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_assert_operator(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_mark_sent(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_record_reply(uuid, uuid, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_purge_for_account_deletion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hall_inquiry_viewer_account_active() FROM PUBLIC, anon, authenticated, service_role;

-- 검사 제약이 부르는 두 함수는 표에 직접 쓰는 service_role 도 실행할 수 있어야 한다.
GRANT EXECUTE ON FUNCTION public.hall_inquiry_text_is_unsafe(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.hall_inquiry_shares_are_valid(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hall_inquiry_save_letter_version(uuid, uuid, uuid, uuid[], text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hall_inquiry_set_approver(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hall_inquiry_respond_approver(uuid, uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.hall_inquiry_approve_letter(uuid, uuid, uuid, text, boolean, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.hall_inquiry_mark_sent(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hall_inquiry_record_reply(uuid, uuid, text, text, timestamptz, text, text) TO service_role;
-- 홀 담기 RLS 가 부른다.
GRANT EXECUTE ON FUNCTION public.hall_inquiry_viewer_account_active() TO authenticated;

COMMENT ON FUNCTION public.hall_inquiry_approve_letter(uuid, uuid, uuid, text, boolean, integer, integer) IS
  'Content-bound letter approval. Records an approval only for an actor eligible under the current approver policy. Queues one dispatch per recipient only when the policy is complete with approvals given while the inquiry switch was on, and both the per-couple and the service-wide daily caps allow it; identical content to the same hall is never queued twice.';

COMMIT;
