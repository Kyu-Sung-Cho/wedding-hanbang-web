-- 20260824130000: 중재안을 확인하면 상대에게 알린다.
--
-- 중재 카드가 1/2 에서 영원히 멈췄다. 한 사람이 "이 선택안을 확인했어요" 를
-- 눌러도 상대는 알 방법이 없었고, 스크롤을 거슬러 같은 카드를 우연히 찾아
-- 눌러야만 했다. `accept_amora_mediation` 은 알림을 한 건도 내지 않았다
-- (2026-08-24 감사, 저장소 전역에서 중재 관련 알림 발행 0건 확인).
--
-- 두 사람 승인 자체는 남긴다. 중재 결정문은 "두 파트너가 아모라 중재안에 직접
-- 동의함" 을 기록하는데, 한 사람만 눌렀는데 그렇게 적으면 거짓 기록이 된다
-- (CLAUDE.md: 커플 결정은 사용자가 확인한 변경만 저장한다). 없어서 문제였던
-- 것은 승인이 아니라 **알림**이다.
--
-- 아직 끝나지 않았을 때만 넣는다 — 완료됐으면 상대도 이미 눌렀다는 뜻이다.
-- `action_id` 로 제안 버전을 쓰므로 같은 제안에 알림이 두 번 쌓이지 않는다.
--
-- 아래 정의는 운영 DB 에서 그대로 받아 알림 블록만 더한 것이다. 손으로 옮겨
-- 적지 않았다.

BEGIN;

CREATE OR REPLACE FUNCTION public.accept_amora_mediation(p_couple_id uuid, p_message_id uuid, p_user_id uuid, p_title text, p_resolution text, p_expected_proposal_version uuid, p_expected_roster_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_required integer;
  v_accepted integer;
  v_decision_id uuid;
  v_decision_resolution text;
  v_decision_version text;
  v_decision_roster_fingerprint text;
  v_canonical_resolution text;
  v_proposal_version_text text;
  v_proposal_version uuid;
  v_proposal_roster_fingerprint text;
  v_current_roster_fingerprint text;
  v_bride_id uuid;
  v_groom_id uuid;
BEGIN
  IF char_length(p_title) NOT BETWEEN 1 AND 80
     OR char_length(p_resolution) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Lock the canonical proposal row before the shared advisory key. A proposal
  -- UPDATE already owns this row before its binding trigger runs, so this
  -- ordering prevents a row/advisory inversion while serializing both paths.
  SELECT pg_catalog.btrim(message.metadata #>> '{mediation,resolution}'),
         message.metadata #>> '{mediation,proposalVersion}',
         message.metadata #>> '{mediation,rosterFingerprint}'
    INTO v_canonical_resolution, v_proposal_version_text,
         v_proposal_roster_fingerprint
  FROM public.chat_messages AS message
  WHERE message.id = p_message_id
    AND message.couple_id = p_couple_id
    AND message.sender_type = 'ai'
    AND message.role = 'assistant'
    AND message.visibility = 'shared'
  FOR SHARE;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:amora-mediation:' || p_message_id::text, 0)
  );

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
    AND (couple.bride_id = p_user_id OR couple.groom_id = p_user_id)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  v_current_roster_fingerprint := pg_catalog.md5(
    COALESCE(v_bride_id::text, '-') || ':' || COALESCE(v_groom_id::text, '-')
  );

  IF v_canonical_resolution IS NULL
     OR char_length(v_canonical_resolution) NOT BETWEEN 1 AND 500
     OR pg_catalog.btrim(p_resolution) IS DISTINCT FROM v_canonical_resolution THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_INVALID' USING ERRCODE = '22023';
  END IF;

  IF v_proposal_version_text IS NULL
     OR v_proposal_version_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_proposal_roster_fingerprint IS NULL
     OR v_proposal_roster_fingerprint !~ '^[a-f0-9]{32}$'
     OR v_proposal_roster_fingerprint IS DISTINCT FROM v_current_roster_fingerprint THEN
    -- Keep the existing application-visible conflict response while refusing
    -- proposals created for a previous couple roster or an unversioned draft.
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_CHANGED' USING ERRCODE = '55000';
  END IF;
  v_proposal_version := v_proposal_version_text::uuid;

  -- Consent belongs to the exact card revision rendered to this caller. Text
  -- can change away and back, so matching resolution alone is insufficient.
  IF p_expected_proposal_version IS DISTINCT FROM v_proposal_version
     OR p_expected_roster_fingerprint IS DISTINCT FROM v_proposal_roster_fingerprint THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_CHANGED' USING ERRCODE = '55000';
  END IF;

  SELECT count(DISTINCT member_id)::integer INTO v_required
  FROM public.couples AS couple
  CROSS JOIN LATERAL (VALUES (couple.bride_id), (couple.groom_id)) AS members(member_id)
  WHERE couple.id = p_couple_id
    AND member_id IS NOT NULL;

  IF v_required <> 2 THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PARTNER_REQUIRED' USING ERRCODE = '55000';
  END IF;

  -- A proposal revision is a new consent object even when its text later
  -- changes back to an earlier value. Remove every non-current revision before
  -- recording this click so an old acceptance can never become active again.
  DELETE FROM public.amora_mediation_acceptances
  WHERE couple_id = p_couple_id
    AND message_id = p_message_id
    AND (
      proposal_version IS DISTINCT FROM v_proposal_version
      OR proposal_resolution IS DISTINCT FROM v_canonical_resolution
      OR proposal_roster_fingerprint IS DISTINCT FROM v_current_roster_fingerprint
    );

  INSERT INTO public.amora_mediation_acceptances(
    couple_id, message_id, user_id, proposal_resolution, proposal_version,
    proposal_roster_fingerprint
  )
  VALUES (
    p_couple_id, p_message_id, p_user_id, v_canonical_resolution,
    v_proposal_version, v_current_roster_fingerprint
  )
  ON CONFLICT (message_id, user_id) DO UPDATE SET
    couple_id = excluded.couple_id,
    proposal_resolution = excluded.proposal_resolution,
    proposal_version = excluded.proposal_version,
    proposal_roster_fingerprint = excluded.proposal_roster_fingerprint,
    accepted_at = now();

  SELECT count(*)::integer INTO v_accepted
  FROM public.amora_mediation_acceptances AS acceptance
  JOIN public.couples AS couple ON couple.id = acceptance.couple_id
  WHERE acceptance.message_id = p_message_id
    AND acceptance.couple_id = p_couple_id
    AND acceptance.proposal_resolution = v_canonical_resolution
    AND acceptance.proposal_version = v_proposal_version
    AND acceptance.proposal_roster_fingerprint = v_current_roster_fingerprint
    AND acceptance.user_id IN (couple.bride_id, couple.groom_id);

  SELECT id, chosen_value ->> 'value', metadata ->> 'proposal_version',
         metadata ->> 'roster_fingerprint'
    INTO v_decision_id, v_decision_resolution, v_decision_version,
         v_decision_roster_fingerprint
  FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND category = 'conflict_resolution'
    AND source = 'chat'
    AND source_ref_id = p_message_id
  LIMIT 1;

  IF v_decision_id IS NOT NULL
     AND (
       v_decision_resolution IS DISTINCT FROM v_canonical_resolution
       OR v_decision_version IS DISTINCT FROM v_proposal_version_text
       OR v_decision_roster_fingerprint IS DISTINCT FROM v_current_roster_fingerprint
     ) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_CHANGED' USING ERRCODE = '55000';
  END IF;

  IF v_accepted >= v_required AND v_required > 0 AND v_decision_id IS NULL THEN
    INSERT INTO public.decision_nodes(
      couple_id, category, decision_type, title, chosen_value, reasoning,
      confidence, source, source_ref_id, visibility, decided_at, metadata
    ) VALUES (
      p_couple_id, 'conflict_resolution', 'decided', p_title,
      jsonb_build_object('value', v_canonical_resolution),
      CASE
        WHEN v_required > 1 THEN '두 파트너가 아모라 중재안에 직접 동의함'
        ELSE '현재 연결된 사용자가 아모라 중재안에 직접 동의함'
      END,
      1.00, 'chat', p_message_id, 'shared', now(),
      jsonb_build_object(
        'confirmed_by_both', true,
        'acceptance_count', v_accepted,
        'proposal_version', v_proposal_version_text,
        'roster_fingerprint', v_current_roster_fingerprint
      )
    )
    RETURNING id INTO v_decision_id;
  END IF;

  -- 상대에게 알린다.
  --
  -- 이게 없어서 중재가 끝까지 가지 못했다. 한 사람이 "이 선택안을 확인했어요" 를
  -- 눌러도 상대는 알 방법이 없었고, 스크롤을 거슬러 같은 카드를 우연히 찾아야만
  -- 했다. 그래서 1/2 에서 영원히 멈췄다(2026-08-24 감사).
  --
  -- 아직 끝나지 않았을 때만 넣는다. 완료됐으면 상대도 이미 눌렀다는 뜻이다.
  -- `action_id` 는 제안 버전이라 같은 제안에 알림이 두 번 쌓이지 않는다.
  IF v_decision_id IS NULL AND v_required > 1 THEN
    DECLARE
      v_partner_id uuid := CASE
        WHEN p_user_id = v_bride_id THEN v_groom_id
        WHEN p_user_id = v_groom_id THEN v_bride_id
        ELSE NULL
      END;
    BEGIN
      IF v_partner_id IS NOT NULL AND v_partner_id <> p_user_id THEN
        INSERT INTO public.couple_change_notifications(
          couple_id, recipient_user_id, actor_user_id, source_message_id,
          action_id, event_kind, tool_name, title, message, href
        ) VALUES (
          p_couple_id, v_partner_id, p_user_id, p_message_id,
          v_proposal_version, 'approval_requested', 'amora_mediation',
          '함께 확인할 중재안이 있어요',
          left(p_title, 240),
          '/chat'
        )
        ON CONFLICT (couple_id, recipient_user_id, action_id, event_kind)
          DO NOTHING;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'accepted_count', v_accepted,
    'required_count', v_required,
    'completed', v_decision_id IS NOT NULL,
    'decision_node_id', v_decision_id
  );
END
$function$;

COMMIT;
