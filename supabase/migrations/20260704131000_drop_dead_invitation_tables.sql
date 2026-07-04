-- 죽은 청첩장/AI대본 테이블 정리 (감사 2.5 L1 + 0.2 죽은 코드 병합).
--
-- Week 1 수술(2026-06-11)로 코드가 전부 삭제된 기능의 테이블 잔재.
-- invitation_templates/guestbook은 SELECT USING(true), rsvp/guestbook/visits는
-- INSERT WITH CHECK(true)로 과permissive — anon이 죽은 테이블에 스팸 삽입 가능했다.
--
-- 삭제 전 확인 (2026-07-04, 프로덕션):
--  - 코드 참조 0건 (apps/·packages/ 전체 grep)
--  - 이 테이블들을 참조하는 외부 FK 0건 (pg_constraint 조회)
--  - 데이터: invitations 2행(테스트)·ai_scripts 1행(테스트)·invitation_templates
--    30행(시드 템플릿, 재생성 가능)·나머지 0행 — Week 1 실데이터 확인과 일치
--  - 스키마 복구는 pre-surgery 태그
--
-- congratulatory_money는 같은 마이그레이션 출신이지만 money 기능이 사용 중(참조 5곳) — 유지.

DROP TABLE IF EXISTS public.invitation_visits CASCADE;
DROP TABLE IF EXISTS public.invitation_guestbook CASCADE;
DROP TABLE IF EXISTS public.invitation_rsvp CASCADE;
DROP TABLE IF EXISTS public.invitation_accounts CASCADE;
DROP TABLE IF EXISTS public.invitation_photos CASCADE;
DROP TABLE IF EXISTS public.invitations CASCADE;
DROP TABLE IF EXISTS public.invitation_templates CASCADE;
DROP TABLE IF EXISTS public.ai_scripts CASCADE;
