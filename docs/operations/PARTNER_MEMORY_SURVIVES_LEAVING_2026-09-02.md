# 한 사람이 떠나도 남은 사람의 기억은 지우지 않는다 (2026-09-02)

**파운더 결정**: "기억은 남기고 트리거 좁혀줘"

## 무엇이 문제였나

탈퇴 접수를 켜기 전 점검에서, 한쪽이 떠나면 **남은 배우자의 아모라 공유 기억이
통보 없이 사라진다**는 것이 스테이징 실측으로 드러났다. 그런데 `/privacy` 와
`/terms` 는 정반대를 적어 놓았다 — "남은 파트너의 화면에 유지되고, 탈퇴한 회원의
식별 정보만 제거됩니다".

운영 규모: `shared` `decision_nodes` 281개 중 삭제 조건에 걸리는 것 225개,
`shared` `chat_summaries` 11개, `conflict_resolution/chat` 18개, 2인 커플 5쌍.

## 왜 좁혀도 되는가

두 트리거의 목적은 함수 주석에 그대로 적혀 있다 — **새 구성원이 기존 커플 행을
통해 이전 로스터의 기억을 보는 것**을 막는 것. 겨냥하는 것은 **도착**이지
이탈이 아니다.

게다가 이탈 후에는 새 사람이 들어올 수 없다. `enforce_couple_roster_epoch`
(`20260716094000_couple_roster_epoch.sql`)가 sealed 커플의 빈 슬롯 채우기를
`COUPLE_ROSTER_EPOCH_CLOSED` 로 막고 초대 코드 변경도 막는다. **지키려는 대상이
존재할 수 없다.**

## 무엇을 바꿨나

판정을 "로스터가 바뀌었나" → **"새 사람이 왔나"** 로 좁혔다.

- `shared` 초기화는 **도착일 때만**
- 비공개 레인은 그 슬롯이 바뀌면 그대로 초기화(떠나는 사람 자신의 데이터)
- 중재 합의·갈등 케어도 같은 논리로 도착일 때만

마이그레이션: `supabase/migrations/20260902120000_leaving_does_not_erase_the_partner_memory.sql`

## 스테이징 실측 (같은 스크립트를 적용 전후로 실행)

커플을 만들고 공유 기억·갈등 케어·기억 스위치를 심은 뒤, (A) 신부가 떠나는 경우와
(B) 빈 슬롯에 새 사람이 들어오는 경우를 각각 재현했다.

| | 적용 전 | 적용 후 |
|---|---|---|
| A 이탈 — 공유 `decision_nodes` | 2 → **0** | 2 → **2** |
| A 이탈 — `conflict_resolution/chat` | 1 → **0** | 1 → **1** |
| A 이탈 — `amora_memory_settings.enabled` | true → **false** | true → **true** |
| A 이탈 — 떠난 사람 `bride_private` | → 0 | → **0** (그대로 지움) |
| B 도착 — 옛 로스터 공유 기억 | 1 → **0** | 1 → **0** (그대로 지움) |

안전 목적(도착 시 초기화)은 한 글자도 안 약해졌다.

## 되돌리는 SQL

두 함수를 이전 정의로 되돌린다. `CREATE OR REPLACE` 라 트리거 정의는 건드리지
않으므로 함수만 되돌리면 완전히 원래대로 돌아온다.

```sql
-- 1) 공유 기억 초기화를 로스터 변경 전체로 되돌린다
CREATE OR REPLACE FUNCTION public.reset_amora_memory_after_membership_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s' SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_reset_at timestamptz := now();
  v_visibilities text[] := ARRAY['shared']::text[];
  v_visibility text;
BEGIN
  IF OLD.bride_id IS DISTINCT FROM NEW.bride_id THEN
    v_visibilities := pg_catalog.array_append(v_visibilities, 'bride_private');
  END IF;
  IF OLD.groom_id IS DISTINCT FROM NEW.groom_id THEN
    v_visibilities := pg_catalog.array_append(v_visibilities, 'groom_private');
  END IF;
  FOREACH v_visibility IN ARRAY v_visibilities LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'hanbang:amora-memory-consent:' || NEW.id::text || ':' || v_visibility, 0));
  END LOOP;
  DELETE FROM public.decision_nodes
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities)
    AND (memory_key IS NOT NULL
      OR (jsonb_typeof(COALESCE(metadata, '{}'::jsonb)) = 'object'
          AND COALESCE(metadata, '{}'::jsonb) ? 'extracted_by'));
  DELETE FROM public.chat_summaries
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities);
  DELETE FROM public.amora_couple_profiles
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities);
  DELETE FROM public.amora_memory_consents
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities);
  UPDATE public.amora_memory_jobs
  SET status = 'cancelled', claimed_at = NULL, completed_at = v_reset_at, updated_at = v_reset_at
  WHERE couple_id = NEW.id AND visibility = ANY(v_visibilities)
    AND status IN ('pending', 'processing');
  IF EXISTS (SELECT 1 FROM public.couples WHERE id = NEW.id) THEN
    INSERT INTO public.amora_memory_settings(
      couple_id, visibility, enabled, enabled_by, enabled_at, memory_reset_at, created_at, updated_at)
    SELECT NEW.id, v, false, NULL, NULL, v_reset_at, v_reset_at, v_reset_at
    FROM pg_catalog.unnest(v_visibilities) AS v
    ON CONFLICT (couple_id, visibility) DO UPDATE
    SET enabled = false, enabled_by = NULL, enabled_at = NULL,
        memory_reset_at = v_reset_at, updated_at = v_reset_at;
  END IF;
  RETURN NEW;
END $function$;

-- 2) 중재 초기화를 무조건 실행으로 되돌린다
CREATE OR REPLACE FUNCTION public.reset_amora_mediation_after_membership_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  DELETE FROM public.amora_mediation_acceptances WHERE couple_id = NEW.id;
  DELETE FROM public.decision_nodes
  WHERE couple_id = NEW.id AND category = 'conflict_resolution' AND source = 'chat';
  RETURN NEW;
END $function$;
```

## 적용 상태

- 스테이징(`rgxdizztidbgwnsbadml`): **적용 · 리허설 통과**
- 운영(`slrtobkksjmxgzatjyqb`): **2026-09-04 09:40 KST 적용**(파운더 지시 "마이그레이션 적용해"). Management API 로 이 파일을 그대로 실행 → 두 함수 `pg_get_functiondef` md5 가 스테이징과 동일 (`reset_amora_memory_after_membership_change` 7a463a8a…, `reset_amora_mediation_after_membership_change` 5caec58a…) → `supabase_migrations.schema_migrations` 에 20260902120000 행 기록. 적용 직전 운영 정의는 `audit-2026-09-03/amora-launch/rollback-20260902120000-prod.sql`(저장소 밖) 에 있다. 스테이징에 같은 파일을 한 번 더 실행해 멱등을 확인한 뒤 적용했다.

## 함께 봐야 할 것

이 수정은 **배우자 기억 소실**만 푼다. 탈퇴 접수를 켜려면 남은 세 가지가 먼저다:

1. `finalize_account_deletion_job` 이 `account_deletions.user_id`(NOT NULL)를 안 채워
   **100% 실패**한다 — 계정은 지워지는데 작업은 영원히 "처리 중"
2. 사진을 올린 계정은 `manual_review` 로 고정되는데 **푸는 앱 경로가 0건**
3. 삭제 결과 통지 코드가 **0줄**(개인정보 보호법 제36조 2항)
