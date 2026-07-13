BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

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
--  - invitation-photos Storage 객체 0건 확인; 계정 삭제 inventory에서도 제거
--  - 스키마 복구는 pre-surgery 태그
--
-- congratulatory_money는 같은 마이그레이션 출신이지만 money 기능이 사용 중(참조 5곳) — 유지.

-- Fail before deleting provenance. Seed-only invitation_templates may be
-- recreated, but user-authored invitation/script rows require an explicit
-- export and classification instead of being silently destroyed.
DO $$
DECLARE
  v_table regclass;
  v_rows bigint;
  v_thumbnail_rows bigint;
  v_template_fingerprint text;
BEGIN
  -- Stop both legacy table writes and storage metadata writes before the
  -- zero-row checks. Locks are retained until COMMIT, closing the check/drop
  -- race with old clients and service-role workers.
  FOREACH v_table IN ARRAY ARRAY[
    to_regclass('public.ai_scripts'),
    to_regclass('public.invitation_accounts'),
    to_regclass('public.invitation_guestbook'),
    to_regclass('public.invitation_photos'),
    to_regclass('public.invitation_rsvp'),
    to_regclass('public.invitation_templates'),
    to_regclass('public.invitation_visits'),
    to_regclass('public.invitations')
  ]
  LOOP
    IF v_table IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', v_table);
    END IF;
  END LOOP;

  -- Lock only the retired bucket row. Storage object inserts take a key-share
  -- lock on this FK target, so an in-flight insert either finishes before our
  -- count or makes this migration fail on the short lock timeout. Unrelated
  -- buckets remain writable.
  PERFORM 1
  FROM storage.buckets
  WHERE id = 'invitation-photos'
  FOR UPDATE;

  IF to_regclass('public.invitation_templates') IS NOT NULL THEN
    SELECT count(*),
           count(*) FILTER (WHERE thumbnail_url IS NOT NULL),
           md5(string_agg(concat_ws(
             E'\x1f', id, name, category, is_premium::text,
             color_palette::text, font_pair::text, layout_config::text,
             opening_animation
           ), E'\n' ORDER BY id))
    INTO v_rows, v_thumbnail_rows, v_template_fingerprint
    FROM public.invitation_templates;

    IF v_rows <> 30
      OR v_thumbnail_rows <> 0
      OR v_template_fingerprint <> '299c29b7db8596dfb373cd2684751e47'
    THEN
      RAISE EXCEPTION 'INVITATION_TEMPLATE_EXPORT_REQUIRED'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    to_regclass('public.invitation_visits'),
    to_regclass('public.invitation_guestbook'),
    to_regclass('public.invitation_rsvp'),
    to_regclass('public.invitation_accounts'),
    to_regclass('public.invitation_photos'),
    to_regclass('public.invitations'),
    to_regclass('public.ai_scripts')
  ]
  LOOP
    IF v_table IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %s', v_table) INTO v_rows;
      IF v_rows > 0 THEN
        RAISE EXCEPTION 'INVITATION_DATA_EXPORT_REQUIRED: % has % row(s)',
          v_table, v_rows
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'invitation-photos'
  ) THEN
    RAISE EXCEPTION 'INVITATION_STORAGE_EXPORT_REQUIRED'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Supabase protects bucket deletion from direct SQL. Make it private here;
-- the guarded release workflow removes the now-empty bucket through the
-- official Storage API and verifies absence before maintenance is lifted.
UPDATE storage.buckets
SET public = false
WHERE id = 'invitation-photos';

-- RESTRICT is deliberate: an unknown dependency is a release blocker, not
-- permission to delete unrelated views, functions, or foreign keys.
DROP TABLE IF EXISTS public.invitation_visits RESTRICT;
DROP TABLE IF EXISTS public.invitation_guestbook RESTRICT;
DROP TABLE IF EXISTS public.invitation_rsvp RESTRICT;
DROP TABLE IF EXISTS public.invitation_accounts RESTRICT;
DROP TABLE IF EXISTS public.invitation_photos RESTRICT;
DROP TABLE IF EXISTS public.invitations RESTRICT;
DROP TABLE IF EXISTS public.invitation_templates RESTRICT;
DROP TABLE IF EXISTS public.ai_scripts RESTRICT;

COMMIT;
