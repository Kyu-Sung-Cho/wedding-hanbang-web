# 뱃지 기록이 익명에게 열려 있다 — 적용 대기 (2026-08-28)

> **상태: 미적용.** 마이그레이션을 저장소에 넣지 않았다. 이유는 아래 "왜 아직
> 안 넣었나" 에 있다. 파운더 결정이 필요하다.

## 운영 실측 (2026-08-28, 읽기 전용, 공개 anon 키)

```
GET /rest/v1/community_achievements?select=*&limit=5
  → HTTP 206, content-range: 0-4/12

GET /rest/v1/community_xp_log      → 200, 0 행
GET /rest/v1/community_streaks     → 200, 0 행
```

`community_achievements` 만 **익명에게 12행**을 내준다. 노출되는 열은
`user_id`(회원 UUID)·`achievement_key`·`unlocked_at` 이다. 즉 가입만 하고 아무것도
공개하지 않은 사람의 식별자와 활동 시각이 누구에게나 열거된다 — 2026-08-26 에
회원 명부를 좁히며(`20260826120000_anon_sees_only_public_authors.sql`) 막으려던
바로 그 대상이다.

## 원인

`supabase/migrations/20260325000001_gamification.sql` 에서 형제 셋 중 이것만 넓다.

```
:19  community_xp_log        USING (user_id = auth.uid())
:33  community_streaks       USING (user_id = auth.uid())
:47  community_achievements  USING (true)        ← 이것만
```

`TO` 절이 없어 anon 에도 적용된다. 216개 마이그레이션 전체에 이 테이블에 대한
REVOKE 가 없고, 유일한 RESTRICTIVE 정책(`community_runtime_read_fence`)은 신원이
아니라 운영 모드만 보므로 평상시엔 항상 참이다.

## 화면 영향 — 없다

앱은 이 테이블을 읽지도 쓰지도 않는다. `community_unlock_achievement` 를 부르는
제품 코드가 0건이다. 좁혀도 잃는 화면이 없다.

"지금 아무도 안 본다" 는 열어 둘 이유가 아니다. 행은 이미 12개 있고, 기록 경로가
다시 켜지는 날 이 정책은 **열린 채로** 켜진다.

## 왜 아직 안 넣었나

마이그레이션을 `supabase/migrations/` 에 추가하면:

1. `scripts/lib/supabase-successor-release-contract.mjs` 의 고정된 마이그레이션
   목록이 어긋나 `pnpm test:repo` 가 5건 실패한다(실측).
2. 릴리스 매니페스트 sha256 이 바뀐다. 그러면
   `apps/web/vendorDisclosureProductionBuildFence.ts:119` 가 요구하는 Vercel 환경변수
   `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 을 **같이 갱신하지 않으면 프로덕션
   빌드가 통째로 죽는다.** 이 저장소에는 실제로 그렇게 죽인 이력이 있고, 직전 빌드가
   계속 서비스되므로 겉보기에는 멀쩡해 잘 보이지 않는다.

출시 직전 브랜치에 그 지뢰를 넣지 않았다. 적용은 릴리스 절차와 함께 해야 한다.

## 적용 절차

1. 아래 SQL 을 `supabase/migrations/20260828120000_achievements_are_not_public.sql`
   로 넣는다.
2. successor 릴리스 핀을 옮긴다(`pnpm test:repo` 가 무엇이 어긋났는지 정확히 알려준다).
3. 매니페스트 sha256 을 재계산하고 **Vercel `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`
   을 그 값으로 갱신한다.** 넣기 직전에 재계산할 것 — 그 사이 마이그레이션이 늘면
   값이 또 바뀐다.
4. 적용 뒤 위 실측 명령을 다시 돌려 `content-range` 가 `*/0` 인지 확인한다.

## SQL

```sql
-- 뱃지 기록이 익명에게 열려 있어 회원 user_id 가 열거된다.
--
-- ## 무엇이 있었나 (2026-08-28 운영 실측, 읽기전용)
--
-- `community_achievements` 의 SELECT 정책만 `USING (true)` 였다. 같은
-- 마이그레이션(20260325000001_gamification.sql)에서 만든 형제 둘은 반대로 좁다:
--
--     community_xp_log   :19   USING (user_id = auth.uid())
--     community_streaks  :33   USING (user_id = auth.uid())
--     community_achievements :47  USING (true)      ← 이것만
--
-- `TO` 절이 없으므로 anon 에도 적용된다. Supabase 는 public 스키마 테이블에 anon
-- GRANT 를 기본으로 주고, 216개 마이그레이션 전체에 이 테이블에 대한 REVOKE 가
-- 없다. 유일한 RESTRICTIVE 정책(`community_runtime_read_fence`)은 신원이 아니라
-- 운영 모드만 보므로 평상시엔 항상 참이다.
--
-- 공개 anon 키(브라우저 번들에 들어 있다)로 잰 값:
--
--     GET /rest/v1/community_achievements?select=*&limit=5
--       → HTTP 206, content-range: 0-4/12
--
--     community_xp_log      → 0 행
--     community_streaks     → 0 행
--
-- 12행이 열려 있고 형제 둘은 0이다. 노출되는 열은 `user_id`(회원 UUID)와
-- `achievement_key`, `unlocked_at` 이다. 즉 **가입만 하고 아무것도 공개하지 않은
-- 사람의 식별자와 활동 시각**이 누구에게나 열거된다 — 2026-08-26 에 회원 명부를
-- 좁히며 막으려던 바로 그 대상이다.
--
-- ## 왜 지금 고치나
--
-- 앱은 이 테이블을 읽지도 쓰지도 않는다(`community_unlock_achievement` 를 부르는
-- 제품 코드가 0건이다). 그래서 화면이 바뀌지 않는다 — 오늘 아무도 이 데이터를
-- 보고 있지 않고, 좁혀도 잃는 화면이 없다.
--
-- "지금 아무도 안 본다" 는 열어 둘 이유가 아니다. 행은 이미 12개 있고, 기록 경로가
-- 다시 켜지는 날 이 정책은 **열린 채로** 켜진다.
--
-- ## 무엇을 바꾸고 무엇을 안 바꾸나
--
-- SELECT 정책만 형제와 같은 모양으로 좁힌다. INSERT 는 그대로
-- `WITH CHECK (false)` 이고 기록은 SECURITY DEFINER RPC 만 할 수 있다 —
-- 그 경로는 손대지 않는다.

BEGIN;

DROP POLICY IF EXISTS "ach_select" ON public.community_achievements;

-- 형제(`community_xp_log`·`community_streaks`)와 같은 모양이다. 본인 것만 본다.
CREATE POLICY "ach_select" ON public.community_achievements
  FOR SELECT
  USING (user_id = auth.uid());

COMMIT;
```
