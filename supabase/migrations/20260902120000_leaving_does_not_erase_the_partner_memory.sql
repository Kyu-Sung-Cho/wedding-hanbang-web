-- 한 사람이 떠나도 남은 사람의 기억은 지우지 않는다
--
-- ## 무엇이 문제였나
--
-- 스테이징에서 커플 두 명을 만들고 한쪽을 탈퇴시켜 재현했다(2026-09-02):
--
--     decision_nodes            4 → 1   (예산·갈등·개인메모가 사라짐)
--     chat_summaries            2 → 0
--     amora_memory_settings     shared enabled=true → false
--     amora_memory_consents     4 → 1
--     amora_mediation_acceptances  전부 삭제
--
-- 남은 배우자는 아무 통보 없이 두 사람이 함께 쌓은 예산·갈등 케어·중재 합의를
-- 잃는다. 운영 규모로는 shared decision_nodes 281개 중 225개가 이 조건에 걸린다.
--
-- 그런데 `/privacy` 와 `/terms` 는 **정반대**를 적어 놓았다 — "남은 파트너의
-- 화면에 유지되고, 탈퇴한 회원의 식별 정보만 제거됩니다".
--
-- ## 왜 이렇게 되어 있었나 — 그리고 왜 좁혀도 되는가
--
-- 두 트리거의 목적은 주석에 그대로 적혀 있다: **새 구성원이 기존 커플 행을 통해
-- 이전 로스터의 기억을 보게 되는 것**을 막는 것이다. 즉 겨냥하는 것은 **도착**이지
-- 이탈이 아니다.
--
-- 탈퇴는 이탈이고, 게다가 이탈 후에는 새 사람이 들어올 수도 없다 —
-- `enforce_couple_roster_epoch`(20260716094000)가 sealed 커플의 빈 슬롯 채우기를
-- `COUPLE_ROSTER_EPOCH_CLOSED` 로 막고 초대 코드 변경도 막는다. 즉 이탈 시점에
-- shared 기억을 지워서 지키려는 대상이 **존재할 수 없다.**
--
-- 그래서 판정을 "로스터가 바뀌었나" 에서 **"새 사람이 왔나"** 로 좁힌다.
-- 안전 목적은 그대로 지켜지고, 남은 배우자의 기억만 살아남는다.
--
-- ## 무엇을 바꾸지 않는가
--
-- **떠나는 사람 자신의 비공개 레인은 그대로 지운다.** 그건 탈퇴가 해야 할 일이고,
-- 남은 사람의 것이 아니다. 여기서 되살리는 것은 `shared` 뿐이다.
--
-- 그리고 도착 경로는 한 글자도 안 바뀐다 — 새 사람이 슬롯을 채우면 오늘과
-- 똑같이 shared 와 그 슬롯의 비공개 레인이 초기화된다.
--
-- 파운더 결정(2026-09-02): "기억은 남기고 트리거 좁혀줘".

CREATE OR REPLACE FUNCTION public.reset_amora_memory_after_membership_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_reset_at timestamptz := now();
  v_visibilities text[] := ARRAY[]::text[];
  v_visibility text;
  -- 슬롯에 **새 사람이 들어왔는가.** NULL 로 비는 것은 도착이 아니다.
  v_bride_arrived boolean :=
    NEW.bride_id IS NOT NULL AND NEW.bride_id IS DISTINCT FROM OLD.bride_id;
  v_groom_arrived boolean :=
    NEW.groom_id IS NOT NULL AND NEW.groom_id IS DISTINCT FROM OLD.groom_id;
BEGIN
  -- 공유 레인은 **새 사람이 올 때만** 지운다.
  --
  -- 이전에는 로스터가 바뀌기만 하면 지웠고, 그래서 한쪽이 탈퇴할 때 남은 사람의
  -- 예산·갈등 케어 기억이 함께 사라졌다. 지켜야 할 대상(새로 들어온 사람)이 없는
  -- 이탈에서는 지울 이유가 없다.
  IF v_bride_arrived OR v_groom_arrived THEN
    v_visibilities := pg_catalog.array_append(v_visibilities, 'shared');
  END IF;

  -- 비공개 레인은 그 슬롯이 **바뀌기만 해도** 지운다 — 도착이면 새 사람이 옛
  -- 사람의 개인 기억을 보면 안 되고, 이탈이면 떠나는 사람 자신의 데이터다.
  IF OLD.bride_id IS DISTINCT FROM NEW.bride_id THEN
    v_visibilities := pg_catalog.array_append(v_visibilities, 'bride_private');
  END IF;
  IF OLD.groom_id IS DISTINCT FROM NEW.groom_id THEN
    v_visibilities := pg_catalog.array_append(v_visibilities, 'groom_private');
  END IF;

  IF pg_catalog.array_length(v_visibilities, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH v_visibility IN ARRAY v_visibilities LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'hanbang:amora-memory-consent:' || NEW.id::text || ':' || v_visibility,
        0
      )
    );
  END LOOP;

  DELETE FROM public.decision_nodes
  WHERE couple_id = NEW.id
    AND visibility = ANY(v_visibilities)
    AND (
      memory_key IS NOT NULL
      OR (
        jsonb_typeof(COALESCE(metadata, '{}'::jsonb)) = 'object'
        AND COALESCE(metadata, '{}'::jsonb) ? 'extracted_by'
      )
    );
  DELETE FROM public.chat_summaries
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities);
  DELETE FROM public.amora_couple_profiles
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities);
  DELETE FROM public.amora_memory_consents
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities);
  UPDATE public.amora_memory_jobs
  SET status = 'cancelled', claimed_at = NULL, completed_at = v_reset_at, updated_at = v_reset_at
  WHERE couple_id = NEW.id
    AND visibility = ANY(v_visibilities)
    AND status IN ('pending', 'processing');

  -- The empty-couple cleanup trigger may already have deleted the parent in
  -- the same AFTER UPDATE trigger queue. Do not recreate child settings for a
  -- parent that no longer exists; ON DELETE CASCADE already completed cleanup.
  IF EXISTS (SELECT 1 FROM public.couples WHERE id = NEW.id) THEN
    INSERT INTO public.amora_memory_settings(
      couple_id, visibility, enabled, enabled_by, enabled_at, memory_reset_at,
      created_at, updated_at
    )
    SELECT NEW.id, v, false, NULL, NULL, v_reset_at, v_reset_at, v_reset_at
    FROM pg_catalog.unnest(v_visibilities) AS v
    ON CONFLICT (couple_id, visibility) DO UPDATE
    SET enabled = false,
        enabled_by = NULL,
        enabled_at = NULL,
        memory_reset_at = v_reset_at,
        updated_at = v_reset_at;
  END IF;

  RETURN NEW;
END
$function$;

-- 중재 합의도 같은 논리다. 두 사람이 함께 만든 합의이고, 새 사람이 올 때만
-- 지우면 된다. 이전에는 조건 없이 전부 지워서, 한쪽이 탈퇴하면 남은 사람의
-- 갈등 케어 이력이 통째로 사라졌다.
CREATE OR REPLACE FUNCTION public.reset_amora_mediation_after_membership_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT (
    (NEW.bride_id IS NOT NULL AND NEW.bride_id IS DISTINCT FROM OLD.bride_id)
    OR (NEW.groom_id IS NOT NULL AND NEW.groom_id IS DISTINCT FROM OLD.groom_id)
  ) THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.amora_mediation_acceptances
  WHERE couple_id = NEW.id;

  DELETE FROM public.decision_nodes
  WHERE couple_id = NEW.id
    AND category = 'conflict_resolution'
    AND source = 'chat';

  RETURN NEW;
END
$function$;
