-- 조율 초안을 사람이 보내는 경로.
--
-- ## 왜
--
-- 지금은 중재를 요청하면 아모라의 답이 곧바로 공유 레인에 저장되고 상대에게
-- Realtime으로 전달된다. 요청자가 무엇이 갈지 먼저 볼 기회가 없다. 통제 관계에
-- 있는 사람이 도움을 청하면, 그 사람이 쓴 상황의 요약과 "두 분이 조금씩 양보하세요"
-- 류 합의안이 통제하는 쪽 화면에 뜬다. 되돌릴 수 없다.
--
-- 탐지로는 막을 수 없다는 것이 측정으로 확인됐다 — 강압적 통제 서술 45개 중 0개,
-- 신체 폭력도 서술형은 최근까지 평범한 결혼 갈등으로 분류됐다. 그래서 위험한 경우를
-- 골라내는 대신, **자동으로 전달되는 경로 자체를 없앤다.** 초안은 요청자 레인에서
-- 태어나고, 공유는 사람이 누르는 별도 사건이 된다.
--
-- ## 이 마이그레이션의 범위
--
-- 발송·폐기 RPC **만** 넣는다. 아직 아무도 호출하지 않으므로 동작은 바뀌지 않는다.
-- 레인을 요청자 쪽으로 고정하는 변경과, "공유된 조율 카드는 사람이 보낸 것뿐"이라는
-- 불변식 트리거는 **뒤따르는 릴리스**에 있다. 순서를 뒤집으면 안 된다 —
--   * 트리거를 먼저 넣으면 초안 없이 공유에 쓰는 오늘의 경로가 전부 실패한다.
--   * 레인을 먼저 바꾸면 보낼 방법이 없는 초안만 쌓인다.
-- 목적지를 먼저 만들고 마지막에 방향을 돌린다.

-- ─────────────────────────────────────────────────────────────
-- 발송: 요청자 레인의 초안을 읽고 공유 레인에 카드를 만든다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.share_amora_mediation_draft(
  p_draft_message_id uuid,
  p_user_id uuid,
  p_accept boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_draft public.chat_messages%ROWTYPE;
  v_shared public.chat_messages%ROWTYPE;
  v_bride uuid;
  v_groom uuid;
  v_expected_lane text;
  v_current_fingerprint text;
  v_existing uuid;
  v_mediation jsonb;
  v_acceptance jsonb;
BEGIN
  SELECT * INTO v_draft
    FROM public.chat_messages
   WHERE id = p_draft_message_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_DRAFT_NOT_FOUND' USING ERRCODE = '42501';
  END IF;

  SELECT bride_id, groom_id INTO v_bride, v_groom
    FROM public.couples
   WHERE id = v_draft.couple_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  -- 레인은 호출자가 주는 값이 아니라 로스터에서 유도한다. 남의 레인 초안을
  -- 보내려는 시도는 여기서 끝난다.
  v_expected_lane := CASE
    WHEN v_bride = p_user_id THEN 'bride_private'
    WHEN v_groom = p_user_id THEN 'groom_private'
  END;

  IF v_expected_lane IS NULL
     OR v_draft.visibility IS DISTINCT FROM v_expected_lane
     OR v_draft.sender_type IS DISTINCT FROM 'ai'
     OR v_draft.role IS DISTINCT FROM 'assistant'
     OR COALESCE(v_draft.metadata ->> 'mediation_draft_sendable', 'false') <> 'true' THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_DRAFT_NOT_SENDABLE' USING ERRCODE = '42501';
  END IF;

  -- 두 번 눌러도 카드는 하나.
  v_existing := NULLIF(v_draft.metadata ->> 'mediation_shared_message_id', '')::uuid;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('shared_message_id', v_existing, 'reused', true);
  END IF;

  -- 초안을 만든 시점과 지금의 커플 구성이 다르면 보내지 않는다.
  v_current_fingerprint := pg_catalog.md5(
    COALESCE(v_bride::text, '-') || ':' || COALESCE(v_groom::text, '-')
  );
  IF v_draft.metadata ->> 'mediation_draft_roster_fingerprint'
       IS DISTINCT FROM v_current_fingerprint THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_DRAFT_ROSTER_CHANGED' USING ERRCODE = '55000';
  END IF;

  v_mediation := v_draft.metadata -> 'mediation';

  -- 본문은 서버 상수다. 초안 행의 산문(카드 밖 텍스트)은 한 글자도 복사하지 않는다 —
  -- 요청자가 확인 화면에서 본 것과 상대에게 도착한 것이 달라지면 안 된다.
  INSERT INTO public.chat_messages (
    couple_id, sender_id, sender_type, role, content, metadata, visibility
  ) VALUES (
    v_draft.couple_id,
    NULL,
    'ai',
    'assistant',
    CASE WHEN v_mediation IS NULL
      THEN '상대방이 아모라에게 정리를 부탁했고, 읽어본 뒤 여기로 보냈어요.'
      ELSE '요청하신 분이 초안을 읽고 이 카드를 보냈어요.'
    END,
    jsonb_strip_nulls(jsonb_build_object(
      'mediation', v_mediation,
      'mediation_source_draft_id', v_draft.id::text,
      'mediation_share_origin', 'requester_sent',
      'question_scope', v_draft.metadata ->> 'question_scope',
      'memory_eligible', false
    )),
    'shared'
  )
  RETURNING * INTO v_shared;

  UPDATE public.chat_messages
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'mediation_draft_state', 'sent',
           'mediation_shared_message_id', v_shared.id::text
         )
   WHERE id = v_draft.id;

  -- 보내면서 요청자 쪽 확인까지 한 트랜잭션에 끝낸다. 버튼을 두 번 누르게 하면
  -- 그만큼 압박 아래에서 눌릴 자리가 늘어난다.
  IF p_accept AND v_mediation IS NOT NULL THEN
    v_acceptance := public.accept_amora_mediation(
      v_shared.couple_id,
      v_shared.id,
      p_user_id,
      '함께 확인한 합의 · ' || left(btrim(v_shared.metadata #>> '{mediation,resolution}'), 56),
      btrim(v_shared.metadata #>> '{mediation,resolution}'),
      (v_shared.metadata #>> '{mediation,proposalVersion}')::uuid,
      v_shared.metadata #>> '{mediation,rosterFingerprint}'
    );
  END IF;

  RETURN jsonb_build_object(
    'shared_message_id', v_shared.id,
    'reused', false,
    'acceptance', v_acceptance
  );
END
$function$;

REVOKE ALL ON FUNCTION public.share_amora_mediation_draft(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_amora_mediation_draft(uuid, uuid, boolean)
  TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 폐기: 초안 행을 지운다. 흔적을 남기지 않는다.
-- ─────────────────────────────────────────────────────────────
--
-- 측정 코퍼스에 이 사람이 있다 — "여기서 나눈 얘기 기록에 남나요? 나중에 폰 보다가
-- 걸리면 설명하기가 좀 애매해서요." 초안을 요청자 레인에 두는 설계는 정확히 이
-- 사람이 두려워하는 물건을 이 사람의 폰에 하나 더 만든다. 개별 삭제가 없으면
-- 지우려고 나만 보기 대화를 통째로 날려야 한다.
--
-- "보내지 않음"이 진짜 안전한 기본값이 되려면 이 함수가 있어야 한다.
CREATE OR REPLACE FUNCTION public.discard_amora_mediation_draft(
  p_draft_message_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $function$
DECLARE
  v_draft public.chat_messages%ROWTYPE;
  v_bride uuid;
  v_groom uuid;
  v_expected_lane text;
BEGIN
  SELECT * INTO v_draft
    FROM public.chat_messages
   WHERE id = p_draft_message_id
   FOR UPDATE;
  IF NOT FOUND THEN
    -- 이미 없는 것을 지우는 것은 실패가 아니다. 두 번 눌러도 같은 결과여야 한다.
    RETURN false;
  END IF;

  SELECT bride_id, groom_id INTO v_bride, v_groom
    FROM public.couples
   WHERE id = v_draft.couple_id
   FOR SHARE;

  v_expected_lane := CASE
    WHEN v_bride = p_user_id THEN 'bride_private'
    WHEN v_groom = p_user_id THEN 'groom_private'
  END;

  IF v_expected_lane IS NULL
     OR v_draft.visibility IS DISTINCT FROM v_expected_lane
     OR v_draft.metadata ->> 'mediation_draft_state' IS NULL
     OR v_draft.metadata ->> 'mediation_shared_message_id' IS NOT NULL THEN
    -- 이미 보낸 초안은 지울 수 없다. 상대가 이미 읽었을 수 있고, 그 사실을
    -- 지운 것처럼 보이게 만들면 안 된다.
    RAISE EXCEPTION 'AMORA_MEDIATION_DRAFT_NOT_DISCARDABLE' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.chat_messages WHERE id = v_draft.id;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.discard_amora_mediation_draft(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_amora_mediation_draft(uuid, uuid)
  TO service_role;
