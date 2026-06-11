-- =============================================
-- Week 1 DB 핫픽스 (2026-06-11)
-- =============================================
-- 1) create_booking_atomic: SECURITY DEFINER인데 호출자가 p_couple_id 소유권을
--    증명하지 않아도 됨 → authenticated가 PostgREST로 직접 호출하면 타 커플
--    명의의 예약 생성 가능. authenticated EXECUTE 회수 — 서버(service_role)만 호출.
--    (웹 /api/bookings는 admin 클라이언트로 전환 완료 — 라우트가 본인 profiles.couple_id로 검증)
-- 2) security_invoker 없는 definer 뷰 제거 — RLS 우회로 PII(연락처·사업자번호·
--    예약자 실명) 노출. 코드 사용처 0 확인 후 DROP.
-- 3) 데모 업체 시드 제거 — 가짜 평점(4.7/128)·status='approved'로 실 카탈로그 오염.
-- =============================================

-- 1) 예약 RPC 권한 축소
REVOKE EXECUTE ON FUNCTION public.create_booking_atomic(
  UUID, UUID, DATE, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
) FROM authenticated;

-- 2) PII 노출·미사용 뷰 제거
DROP VIEW IF EXISTS admin_pending_vendors;      -- 업주 phone/email/사업자번호 전체 노출
DROP VIEW IF EXISTS vendor_today_bookings;      -- 예약자 실명·연락처 노출 (포털 삭제로 미사용)
DROP VIEW IF EXISTS public_vendors;             -- 코드 미사용 (탐색은 vendors 테이블 직접 조회)
DROP VIEW IF EXISTS community_human_posts;      -- 페르소나 시스템 삭제로 미사용
DROP VIEW IF EXISTS community_human_comments;
DROP VIEW IF EXISTS community_human_votes;
DROP VIEW IF EXISTS community_agent_daily_metrics;
DROP VIEW IF EXISTS community_agent_daily_overview;

-- 3) 데모 업체 시드 제거 (의존 행 먼저)
DELETE FROM product_timeslots
  WHERE product_id IN (SELECT id FROM vendor_products WHERE vendor_id = '11111111-1111-1111-1111-111111111111');
DELETE FROM vendor_bookings  WHERE vendor_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM vendor_timeslots WHERE vendor_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM vendor_products  WHERE vendor_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM vendor_staff     WHERE vendor_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM vendors          WHERE id        = '11111111-1111-1111-1111-111111111111';

-- =============================================
-- 검증 쿼리 (수동 실행):
--   SELECT viewname FROM pg_views WHERE schemaname='public'
--     AND viewname IN ('admin_pending_vendors','vendor_today_bookings','public_vendors');
--   → 0행이어야 함
--   SELECT COUNT(*) FROM vendors WHERE id='11111111-1111-1111-1111-111111111111'; → 0
-- =============================================
