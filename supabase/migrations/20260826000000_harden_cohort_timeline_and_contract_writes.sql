-- 동기방 타임라인·계약가에 아무나 글을 심을 수 있던 것을 막는다.
--
-- ## 무엇이 있었나
--
-- 2026-08-26 운영 실측(pg_policies):
--
--   cohort_timeline_events · INSERT · {public} · WITH CHECK: true
--   cohort_contracts       · INSERT · {public} · WITH CHECK: true
--
-- 그리고 `has_table_privilege('anon', …, 'INSERT')` 가 둘 다 true 였다. 즉 로그인
-- 없이 아무나 남의 `user_id` 로 동기방 타임라인 글을 심고, 계약가 행을 넣어
-- `cohort_stats` 의 평균 계약가를 조작할 수 있었다. 익명 삽입을 실제로 시도해
-- 뚫리는 것을 확인했다.
--
-- ## 저장소는 옳았다 — 운영이 어긋나 있었다
--
-- `20260408000000_community_v2.sql:146,170` 은 처음부터 `WITH CHECK (auth.uid() =
-- user_id)` 로 만들었고, 이 두 정책을 다시 정의하는 마이그레이션은 저장소에 **없다**
-- (전수 grep 확인). 그런데 운영은 `true` 였다. 어딘가에서 저장소를 거치지 않고
-- 약화됐고 그 기록이 남아 있지 않다.
--
-- 그래서 이 파일은 "새 기능"이 아니라 **운영과 저장소를 같은 상태로 고정**하는 것이다.
--
-- ## 왜 원래 정의보다 더 조이나
--
-- 같은 계열의 `cohort_messages` 는 이미 두 단계 하드닝을 받았다
-- (`20260614110000_lock_sensitive_anon_access.sql:275`):
--
--   {authenticated} · WITH CHECK ((author_id = auth.uid()) AND is_cohort_member(room_id))
--
-- `cohort_members` 도 `20260615090000` 에서 같이 조여졌다. **타임라인과 계약가만
-- 빠졌다.** 여기서 같은 모양으로 맞춘다.
--
-- 앱은 이미 그렇게 동작한다 — `api/community/cohort/[id]/timeline/route.ts` 와
-- `.../contracts/route.ts` 는 사용자 세션으로 쓰고, 삽입 전에 로그인 · 커뮤니티 쓰기
-- 권한 · **활성 멤버**를 모두 확인한 뒤 `user_id: user.id` 를 넣는다. 정책이 그
-- 확인을 DB 층에서 한 번 더 하는 것이라 정상 기능은 막지 않는다.
--
-- UPDATE·DELETE 는 손대지 않는다. 이미 `auth.uid() = user_id` 라 익명에게는
-- `NULL = user_id` 가 되어 통과하지 못한다(실측 확인).

REVOKE INSERT, UPDATE, DELETE ON TABLE public.cohort_timeline_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cohort_contracts FROM anon;

DROP POLICY IF EXISTS "cohort_timeline_insert" ON public.cohort_timeline_events;
CREATE POLICY "cohort_timeline_insert" ON public.cohort_timeline_events
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()) AND public.is_cohort_member(room_id));

DROP POLICY IF EXISTS "cohort_contracts_insert" ON public.cohort_contracts;
CREATE POLICY "cohort_contracts_insert" ON public.cohort_contracts
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()) AND public.is_cohort_member(room_id));

COMMENT ON POLICY "cohort_timeline_insert" ON public.cohort_timeline_events IS
  'Members write their own timeline events only. Anonymous inserts are revoked at the grant level as well.';
COMMENT ON POLICY "cohort_contracts_insert" ON public.cohort_contracts IS
  'Members write their own contract rows only, so cohort_stats averages cannot be poisoned by outsiders.';
