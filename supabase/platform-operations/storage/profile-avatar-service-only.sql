-- storage.objects의 정책 관리가 허용된 역할로 실행할 정식 릴리스 작업 원문이다.
-- supautils.policy_grants는 비소유자 역할에도 정책 관리를 허용한다. 실제 권한과 적용 결과는 별도 검증한다.
-- 일반 DB migration/MCP에서 릴리스 검증을 우회하여 실행하지 않는다.
-- 전역 쓰기 차단·원본 백업/복구 증거 확인 후, 아바타 DB migration 직전에 적용한다.
-- 기존 Storage 정책은 변경하지 않는다. 이미 있으면 생성 오류로 멈추고 검증 후 판정한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE POLICY profile_avatar_service_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'profile-avatars') WITH CHECK (bucket_id <> 'profile-avatars');
COMMIT;
