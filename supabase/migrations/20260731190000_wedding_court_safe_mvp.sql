-- 오늘의 웨딩 선택 법정: 검수된 합성 사건만 다루는 안전한 선택 놀이.
-- 실제 커플 사연, 자유 댓글, 성별 팀, 준비 계획 자동 반영은 이 스키마에 없다.

CREATE TABLE public.wedding_court_cases (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9-]{3,48}$'),
  docket_label text NOT NULL
    CHECK (char_length(docket_label) BETWEEN 2 AND 32),
  title text NOT NULL
    CHECK (char_length(title) BETWEEN 4 AND 80),
  question text NOT NULL
    CHECK (char_length(question) BETWEEN 8 AND 160),
  opening text NOT NULL
    CHECK (char_length(opening) BETWEEN 8 AND 280),
  initial_facts jsonb NOT NULL
    CHECK (
      jsonb_typeof(initial_facts) = 'array'
      AND jsonb_array_length(initial_facts) BETWEEN 2 AND 5
    ),
  choice_a_label text NOT NULL
    CHECK (char_length(choice_a_label) BETWEEN 2 AND 64),
  choice_b_label text NOT NULL
    CHECK (char_length(choice_b_label) BETWEEN 2 AND 64),
  reason_chips jsonb NOT NULL
    CHECK (
      jsonb_typeof(reason_chips) = 'array'
      AND jsonb_array_length(reason_chips) BETWEEN 4 AND 8
    ),
  new_evidence_title text NOT NULL
    CHECK (char_length(new_evidence_title) BETWEEN 2 AND 64),
  new_evidence text NOT NULL
    CHECK (char_length(new_evidence) BETWEEN 8 AND 280),
  choice_a_perspective text NOT NULL
    CHECK (char_length(choice_a_perspective) BETWEEN 8 AND 280),
  choice_b_perspective text NOT NULL
    CHECK (char_length(choice_b_perspective) BETWEEN 8 AND 280),
  ending text NOT NULL
    CHECK (char_length(ending) BETWEEN 8 AND 320),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  sort_order smallint NOT NULL UNIQUE
    CHECK (sort_order BETWEEN 1 AND 99),
  is_synthetic boolean NOT NULL DEFAULT true
    CHECK (is_synthetic = true),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.wedding_court_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL
    REFERENCES public.wedding_court_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  round smallint NOT NULL
    CHECK (round IN (1, 2)),
  choice text NOT NULL
    CHECK (choice IN ('a', 'b')),
  reason_chip text NOT NULL
    CHECK (
      char_length(reason_chip) BETWEEN 1 AND 40
      AND reason_chip ~ '^[a-z0-9_]+$'
    ),
  predicted_majority text
    CHECK (predicted_majority IS NULL OR predicted_majority IN ('a', 'b')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wedding_court_votes_one_per_round
    UNIQUE (case_id, user_id, round),
  CONSTRAINT wedding_court_votes_prediction_by_round
    CHECK (
      (round = 1 AND predicted_majority IN ('a', 'b'))
      OR (round = 2 AND predicted_majority IS NULL)
    )
);

CREATE INDEX wedding_court_votes_case_round_idx
  ON public.wedding_court_votes (case_id, round);

ALTER TABLE public.wedding_court_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_court_votes ENABLE ROW LEVEL SECURITY;

-- 사건 원문에는 1심 뒤에만 보여야 하는 새 단서가 함께 있으므로 브라우저의
-- 직접 SELECT를 허용하지 않는다. API의 인증된 서버 직렬화만 공개 범위를 정한다.
REVOKE ALL ON TABLE public.wedding_court_cases
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT
  ON TABLE public.wedding_court_cases
  TO service_role;

-- 사용자는 본인 선택을 확인만 할 수 있다. 서비스 역할도 테이블에 직접 쓰지
-- 못하며, 서버가 검증한 auth.user.id를 받는 SECURITY DEFINER RPC만 쓸 수 있다.
REVOKE ALL ON TABLE public.wedding_court_votes
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wedding_court_votes TO authenticated;
GRANT SELECT
  ON TABLE public.wedding_court_votes
  TO service_role;

CREATE POLICY wedding_court_votes_select_own
  ON public.wedding_court_votes
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.wedding_court_cast_vote(
  p_user_id uuid,
  p_case_id uuid,
  p_round smallint,
  p_choice text,
  p_reason_chip text,
  p_predicted_majority text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case public.wedding_court_cases%ROWTYPE;
  v_vote_id uuid;
  v_existing public.wedding_court_votes%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_user';
  END IF;

  IF p_round NOT IN (1, 2) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_round';
  END IF;

  IF p_choice NOT IN ('a', 'b') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_choice';
  END IF;

  SELECT *
  INTO v_case
  FROM public.wedding_court_cases
  WHERE id = p_case_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'case_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_case.reason_chips) AS chip
    WHERE chip->>'id' = p_reason_chip
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_reason_chip';
  END IF;

  IF p_round = 1 AND p_predicted_majority NOT IN ('a', 'b') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'prediction_required';
  END IF;

  IF p_round = 2 THEN
    IF p_predicted_majority IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'prediction_not_allowed';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.wedding_court_votes
      WHERE case_id = p_case_id
        AND user_id = p_user_id
        AND round = 1
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'first_round_required';
    END IF;
  END IF;

  INSERT INTO public.wedding_court_votes (
    case_id,
    user_id,
    round,
    choice,
    reason_chip,
    predicted_majority
  )
  VALUES (
    p_case_id,
    p_user_id,
    p_round,
    p_choice,
    p_reason_chip,
    CASE WHEN p_round = 1 THEN p_predicted_majority ELSE NULL END
  )
  ON CONFLICT (case_id, user_id, round) DO NOTHING
  RETURNING id INTO v_vote_id;

  IF v_vote_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'action', 'created');
  END IF;

  SELECT *
  INTO v_existing
  FROM public.wedding_court_votes
  WHERE case_id = p_case_id
    AND user_id = p_user_id
    AND round = p_round;

  IF v_existing.choice = p_choice
    AND v_existing.reason_chip = p_reason_chip
    AND v_existing.predicted_majority IS NOT DISTINCT FROM
      (CASE WHEN p_round = 1 THEN p_predicted_majority ELSE NULL END)
  THEN
    RETURN jsonb_build_object('ok', true, 'action', 'existing');
  END IF;

  -- 집계를 본 뒤 같은 심급을 고쳐 쓰는 전략 투표는 막는다.
  RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'vote_locked';
END;
$$;

ALTER FUNCTION public.wedding_court_cast_vote(
  uuid, uuid, smallint, text, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wedding_court_cast_vote(
  uuid, uuid, smallint, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wedding_court_cast_vote(
  uuid, uuid, smallint, text, text, text
) TO service_role;

DO $wedding_court_postcondition$
DECLARE
  v_rpc_signature text :=
    'public.wedding_court_cast_vote(uuid,uuid,smallint,text,text,text)';
BEGIN
  IF has_table_privilege(
    'authenticated', 'public.wedding_court_cases', 'SELECT'
  )
    OR has_table_privilege(
      'authenticated', 'public.wedding_court_cases', 'INSERT'
    )
    OR has_table_privilege(
      'authenticated', 'public.wedding_court_cases', 'UPDATE'
    )
    OR has_table_privilege(
      'authenticated', 'public.wedding_court_cases', 'DELETE'
    )
    OR has_table_privilege('anon', 'public.wedding_court_cases', 'SELECT')
    OR has_table_privilege('anon', 'public.wedding_court_cases', 'INSERT')
    OR has_table_privilege('anon', 'public.wedding_court_cases', 'UPDATE')
    OR has_table_privilege('anon', 'public.wedding_court_cases', 'DELETE')
  THEN
    RAISE EXCEPTION
      'wedding_court_postcondition_failed: case table leaked to a client role';
  END IF;

  IF NOT has_table_privilege(
    'authenticated', 'public.wedding_court_votes', 'SELECT'
  )
    OR has_table_privilege(
      'authenticated', 'public.wedding_court_votes', 'INSERT'
    )
    OR has_table_privilege(
      'authenticated', 'public.wedding_court_votes', 'UPDATE'
    )
    OR has_table_privilege(
      'authenticated', 'public.wedding_court_votes', 'DELETE'
    )
    OR has_table_privilege('anon', 'public.wedding_court_votes', 'SELECT')
    OR has_table_privilege('anon', 'public.wedding_court_votes', 'INSERT')
    OR has_table_privilege('anon', 'public.wedding_court_votes', 'UPDATE')
    OR has_table_privilege('anon', 'public.wedding_court_votes', 'DELETE')
  THEN
    RAISE EXCEPTION
      'wedding_court_postcondition_failed: vote client grants are not SELECT-own only';
  END IF;

  IF NOT (
    has_table_privilege(
      'service_role', 'public.wedding_court_cases', 'SELECT'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.wedding_court_cases', 'INSERT'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.wedding_court_cases', 'UPDATE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.wedding_court_cases', 'DELETE'
    )
    AND has_table_privilege(
      'service_role', 'public.wedding_court_votes', 'SELECT'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.wedding_court_votes', 'INSERT'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.wedding_court_votes', 'UPDATE'
    )
    AND NOT has_table_privilege(
      'service_role', 'public.wedding_court_votes', 'DELETE'
    )
  ) THEN
    RAISE EXCEPTION
      'wedding_court_postcondition_failed: service role bypasses the RPC-only write boundary';
  END IF;

  IF has_function_privilege('anon', v_rpc_signature, 'EXECUTE')
    OR has_function_privilege('authenticated', v_rpc_signature, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_rpc_signature, 'EXECUTE')
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid = pg_catalog.to_regprocedure(v_rpc_signature)
        AND procedure_record.prosecdef
        AND pg_catalog.pg_get_userbyid(procedure_record.proowner) = 'postgres'
        AND procedure_record.proconfig IS NOT DISTINCT FROM
          ARRAY['search_path=""']::text[]
    )
  THEN
    RAISE EXCEPTION
      'wedding_court_postcondition_failed: vote RPC execution grants are unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.wedding_court_votes'::regclass
      AND relrowsecurity
  ) OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wedding_court_votes'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wedding_court_votes'
      AND policyname = 'wedding_court_votes_select_own'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual = '(user_id = auth.uid())'
  ) THEN
    RAISE EXCEPTION
      'wedding_court_postcondition_failed: own-vote RLS policy is missing or widened';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.wedding_court_votes'::regclass
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND confdeltype = 'c'
      AND pg_get_constraintdef(oid) LIKE
        'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE%'
  ) THEN
    RAISE EXCEPTION
      'wedding_court_postcondition_failed: Auth delete cascade is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.wedding_court_votes'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) =
        'UNIQUE (case_id, user_id, round)'
  ) THEN
    RAISE EXCEPTION
      'wedding_court_postcondition_failed: one-vote-per-round uniqueness is missing';
  END IF;
END;
$wedding_court_postcondition$;

INSERT INTO public.wedding_court_cases (
  id,
  slug,
  docket_label,
  title,
  question,
  opening,
  initial_facts,
  choice_a_label,
  choice_b_label,
  reason_chips,
  new_evidence_title,
  new_evidence,
  choice_a_perspective,
  choice_b_perspective,
  ending,
  sort_order
)
VALUES
  (
    '11111111-1111-4111-8111-111111111901',
    'invitation-photo',
    '합성 사건 01',
    '모바일 청첩장 대표 사진',
    '자연스러운 순간과 단정한 대표 컷 중 어떤 사진을 첫 화면에 둘까요?',
    '두 사진 모두 마음에 들지만 첫인상은 하나만 고를 수 있어요. 취향과 전달 목적이 살짝 엇갈립니다.',
    '[
      "자연스러운 사진에는 두 사람다운 분위기가 잘 담겼어요.",
      "단정한 사진은 얼굴과 예식 정보가 한눈에 들어와요.",
      "사진은 가족과 지인에게 같은 링크로 공유될 예정이에요."
    ]'::jsonb,
    '우리다운 자연스러운 순간',
    '누구나 보기 편한 단정한 컷',
    '[
      {"id":"couple_style","label":"두 사람다운 분위기"},
      {"id":"first_impression","label":"첫인상"},
      {"id":"family_sharing","label":"가족 공유"},
      {"id":"information_clarity","label":"정보 전달"}
    ]'::jsonb,
    '새 단서: 공유 방식',
    '부모님도 이 링크를 친척 단체 대화방에 그대로 공유할 계획이라고 해요.',
    '자연스러운 순간을 고른 관점은 청첩장도 두 사람의 이야기여야 기억에 남는다고 봐요.',
    '단정한 컷을 고른 관점은 처음 보는 사람까지 편하게 이해하는 전달력을 중요하게 봐요.',
    '한 장이 모든 역할을 할 필요는 없어요. 첫 화면의 목적을 먼저 합의하고, 다른 사진은 다음 장에 배치하는 방식도 가능합니다.',
    1
  ),
  (
    '22222222-2222-4222-8222-222222222902',
    'guest-table-mix',
    '합성 사건 02',
    '친구 하객 테이블 배치',
    '이미 친한 사람끼리 앉힐까요, 새로운 대화가 생기도록 조금 섞을까요?',
    '좌석표를 만들다 보니 편안함과 활기 사이에서 선택이 필요해졌어요. 정해진 정답은 없습니다.',
    '[
      "친구 하객의 인원은 두 테이블 정도예요.",
      "일부는 서로 친하지만 모두가 아는 사이는 아니에요.",
      "식사 시간에는 자유롭게 자리 이동이 가능해요."
    ]'::jsonb,
    '친한 사람끼리 편하게',
    '대화가 생기도록 조금 섞기',
    '[
      {"id":"guest_comfort","label":"하객의 편안함"},
      {"id":"new_conversation","label":"새로운 대화"},
      {"id":"host_attention","label":"세심한 배려"},
      {"id":"simple_operation","label":"운영 단순함"}
    ]'::jsonb,
    '새 단서: 혼자 오는 하객',
    '서로 모르는 두 명의 하객이 각각 혼자 참석하며, 두 사람 외에는 아는 사람이 없다고 해요.',
    '친한 사람끼리 두는 관점은 하객이 긴장하지 않고 식사와 대화에 집중하는 편안함을 우선해요.',
    '조금 섞는 관점은 혼자 온 하객도 대화에 자연스럽게 들어올 연결점을 만드는 것을 우선해요.',
    '모두 섞거나 모두 고정할 필요는 없어요. 혼자 오는 하객 주변만 대화를 잘 여는 친구와 연결하는 절충도 가능합니다.',
    2
  ),
  (
    '33333333-3333-4333-8333-333333333903',
    'pre-ceremony-video',
    '합성 사건 03',
    '식전 영상의 길이',
    '추억을 충분히 담은 영상과 짧고 집중도 높은 영상 중 어느 쪽이 좋을까요?',
    '좋아하는 장면을 고르다 보니 영상이 길어졌어요. 담고 싶은 마음과 현장 흐름을 함께 봐야 합니다.',
    '[
      "현재 편집본은 약 6분이에요.",
      "짧은 편집본은 약 3분으로 만들 수 있어요.",
      "영상이 끝난 뒤 바로 예식 안내가 이어져요."
    ]'::jsonb,
    '추억을 충분히 담은 6분',
    '핵심만 남긴 3분',
    '[
      {"id":"memory_value","label":"추억의 가치"},
      {"id":"guest_focus","label":"하객 집중도"},
      {"id":"ceremony_flow","label":"예식 흐름"},
      {"id":"editing_regret","label":"빼고 난 아쉬움"}
    ]'::jsonb,
    '새 단서: 현장 음향',
    '예식장에서는 입장 준비 안내가 영상 마지막 1분과 겹칠 수 있다고 미리 알려왔어요.',
    '긴 영상을 고른 관점은 이날만 공유할 수 있는 장면과 사람들의 기억을 충분히 남기는 데 가치를 둬요.',
    '짧은 영상을 고른 관점은 가장 좋은 장면에 집중해야 메시지와 현장 흐름이 더 선명해진다고 봐요.',
    '길이보다 먼저 반드시 남길 장면을 함께 고르면 선택이 쉬워져요. 긴 버전은 보관하고 현장용만 짧게 나누는 방법도 있습니다.',
    3
  )
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.wedding_court_cases IS
  '운영자가 검수한 합성 웨딩 선택 사건. 실제 사용자 사연을 저장하지 않는다.';
COMMENT ON TABLE public.wedding_court_votes IS
  '자유 텍스트 없이 제한된 선택지만 저장하는 익명 집계용 심급별 투표.';
