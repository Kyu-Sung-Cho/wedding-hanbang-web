-- 231 신규 빈 private 아바타 버킷 전용 후속 작업. 기존 bucket/object/고객 행을 변경하지 않는다.
-- 과거 profile-avatar-service-only.sql의 전체 Storage rollout과 별개다. 원본 복구 W13 완료를 주장하지 않는다.
-- profile-avatar-v1 계약의 exact source/target/정책 권한/원자 예행/사후 검증을 거친 controller만 실행한다.
-- 소유자 전환 또는 권한 추가 없이 현재 역할의 공식 정책 관리 위임으로 수행한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE POLICY profile_avatar_service_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'profile-avatars') WITH CHECK (bucket_id <> 'profile-avatars');
COMMIT;
