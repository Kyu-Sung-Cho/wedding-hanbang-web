# 커뮤니티 공개 식별자 전환 운영 게이트 (2026-08-03)

## 목적

공개 게시글·댓글·작성자 프로필과 신규 공개 미디어 URL에서 Supabase Auth UUID를 제거한다. 내부 RLS, 수정 권한, 삭제 증명은 계속 Auth UUID를 사용하고 공개 응답만 별도의 `community_public_id`를 사용한다.

## 배포 순서 (순서 변경 금지)

1. `20260803103000_add_community_public_identities.sql`과 `20260803104000_unlink_new_community_media_paths.sql`을 먼저 적용한다.
2. 웹과 모바일을 배포한다. 공개 게시글/댓글은 API 전용이며 `author_id` DTO는 `author_public_id` alias라는 점을 확인한다.
3. 강제 업데이트/최소 지원 버전으로 기존 직접 Supabase 조회 모바일 빌드를 차단한다. 이 확인 전에는 아래 contract apply를 실행하지 않는다.
4. 실제 프로덕션 트래픽에서 다음을 확인한다.
   - posts/comments/profile 공개 응답에 로그인 사용자의 Auth UUID가 없다.
   - `sort=my_posts`, 작성자 필터, 수정/삭제, 북마크, 투표가 동작한다.
   - 신규 업로드 URL이 `community-images/v2/<random-uuid>.<ext>` 형식이며 세션 ID 및 Auth UUID를 포함하지 않는다.
   - 계정 삭제 staging/manifest dry-run이 v2 final path를 exact session proof로 수집한다.
5. `20260803104500_community_public_identity_contract_inventory.sql`을 읽기 전용으로 실행해 null/mismatch가 모두 0인지 확인한다.
6. 백업 및 복원 가능성을 확인한 뒤 `..._apply.sql`을 한 번 실행한다. 이것은 원시 식별자 권한을 복원하지 않는 forward-only 보안 조치다.
7. 즉시 `..._verify.sql`을 실행하고 `community_public_identity_contract_verified = 1` 증거를 보관한다.

## Fail-closed 기준

- 최소 지원 모바일 버전, null/mismatch 0, 웹/모바일 smoke, 계정 삭제 v2 proof 중 하나라도 확인되지 않으면 apply를 실행하지 않는다.
- apply 이후 장애 시 `author_id`/`user_id` 공개 권한을 다시 부여하지 않는다. API/service-role 경계의 forward fix만 허용한다.
- raw `community_posts` WAL은 전체 행을 노출하므로 contract apply에서 Realtime publication을 제거한다. 컬럼 안전 broadcast가 생길 때까지 피드/댓글은 API 갱신을 사용한다.

## 기존 공개 미디어 잔여 위험

기존 `community-images/<auth-user-uuid>/...` 객체는 URL 자체에 Auth UUID가 남는다. 자동 rename은 Storage copy와 게시글·댓글·동기방 메시지·업로드 세션 URL 갱신 사이의 원자성을 보장하지 못하므로 이번 migration에서 이동하지 않는다.

별도 운영 작업은 반드시 다음 순서로 수행한다: 전체 참조 inventory → 새 random v2 path로 copy → byte size/hash 검증 → DB 참조와 `community_upload_sessions.final_path`를 트랜잭션으로 치환 → 앱 read 검증 → CDN grace 이후 legacy object 삭제. 이 작업의 dry-run/rollback/증거가 준비되기 전에는 기존 객체를 삭제하지 않는다.
