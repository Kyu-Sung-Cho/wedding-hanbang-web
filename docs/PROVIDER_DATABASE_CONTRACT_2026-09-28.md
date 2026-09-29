# 제공자 승인·자율 게시 DB 계약

상태: 로컬 구현·PGlite/native PG17 검증. 운영 DB·Storage에는 적용하지 않았다.

최신 사용자 결정은 **한방의 제공자 승인 이후 소개글과 사진을 직접 게시**하는 것이다.
신청 승인, 사용자 게시 선택, 서비스 가격 심사, 추천 자격은 서로 다른 상태다.
기존 `vendors`, 공시가격, 기존 공개 사진 버킷은 신규 기능의 권한 경계로 사용하지 않는다.

## 파일과 적용 순서

1. 기존 저장소 릴리스 controller의 백업·복구·운영 승인 조건을 충족한다.
2. Storage 소유자 경로로 `supabase/platform-operations/storage/20260928135517_provider_portfolio_service_fence.sql`을 적용한다.
3. `supabase/migrations/20260928135517_provider_participation_self_publishing.sql`을 적용한다. 정확한 restrictive policy가 없거나 버킷 설정이 충돌하면 실패한다.
4. 후속 `20260928140701_provider_portfolio_account_deletion.sql`로 기존 삭제 saga의 신규 버킷 수집·삭제 계약을 연결한다.
5. `20260928142123_provider_media_cleanup.sql`로 미완료 업로드·삭제된 사진의 회수 작업을 연결한다.
6. 별도 hosted 합성 환경에서 ACL·동시성·Storage bytes·삭제 saga와 릴리스 controller를 검증한 뒤 공개 배포한다.

일반 migration 역할이 Supabase 소유 `storage.objects`의 정책을 수정할 수 있다고 가정하지 않는다.
이 문서는 운영 실행 권한이나 배포 성공 증거가 아니다. 오류 시 임의로 fence를 제거해 적용하지 않는다.

## 데이터와 권한

| 테이블 | 역할 |
|---|---|
| `provider_profiles` | 개인/팀/업체, 단일 책임자 계정, 소개, 승인 및 게시 상태, version |
| `provider_applications` | 비공개 신청 내용·연락처·동의·요청키·검수·제출 버전 |
| `provider_offerings` | 서비스 범위·기본금액·단위·포함·추가금·조건, is_active·서비스 심사·추천 자격 |
| `provider_media` | 서버 발급 경로·타입·크기·게시 권리 동의·상태·정렬 |
| `business_inquiries` | 비공개 사업 문의, 확인된 Auth 이메일, 포털 답변 |
| `provider_audit_events` | 행위자·대상·상태/버전 사건. 소개 본문·연락처·증빙 복사 없음 |

모든 테이블에 RLS를 켜고 클라이언트의 직접 INSERT/UPDATE/DELETE를 회수한다.
authenticated SELECT도 현재 소유자 또는 현재 `profiles.is_admin`에 한정된다.
모든 쓰기는 RPC가 `auth.uid()`와 Auth의 확인된 이메일·정지 상태를 다시 검사한다.
팀 프로필을 지원하지만 팀원 초대·역할 위임은 첫 릴리스에 포함하지 않는다.

공개 조회는 `provider_public_catalog`의 명시적 필드만 반환한다. 공개 프로필은 `approved + published`,
공개 서비스는 `is_active=true + review_status=approved`, 공개 사진은 `status=ready`여야 한다.
신청 본문·연락처·소유자·검수자·Storage 경로를 공개하지 않는다. 추천은 여기서도 별도의
`recommendation_status=eligible` 조건이 필요하며 게시 승인만으로 부여되지 않는다.

## 사용자·운영 RPC

wire contract는 `apps/web/src/lib/providers/contracts.ts` 및
`docs/PROVIDER_IMPLEMENTATION_CONTRACT_2026-09-28.md`를 함께 따른다.
`p_input`은 snake_case JSON이며 허용하지 않은 키는 거절한다.

| RPC | 중요한 조건 |
|---|---|
| `provider_submit_application(p_input,p_request_id)` | 이메일은 Auth에서 가져온다. 요청키는 사용자별 유일. 다른 payload 재사용 거절 |
| `provider_resubmit_application(p_application_id,p_expected_version,p_input)` | 반려/보완 상태만, 기존 공개 권한 재사용 없음 |
| `provider_update_profile(p_provider_id,p_expected_version,p_input)` | 승인 소유자만 introduction/website/instagram 저장. 즉시 반영 |
| `provider_set_publication(p_provider_id,p_expected_version,p_status)` | published는 승인 후 명시적 선택. paused/draft는 철회 |
| `provider_save_offering(p_provider_id,p_offering_id,p_expected_version,p_input)` | 신규 ID·version은 NULL. 중요 조건 편집은 pending/needs_review로 변경 |
| `provider_withdraw_offering(p_provider_id,p_offering_id,p_expected_version)` | 소유자가 서비스 이력을 보존하며 active=false, pending/blocked로 철회. 정지 중 가능, 재제출은 다시 검토 |
| `provider_get_workspace()` | 본인 프로필·신청·서비스·사진·사업문의. 본인 자료를 임의로 100개에서 자르지 않음 |
| `provider_admin_queue(p_kind,p_status,p_after,p_limit)` | 현재 관리자만. 종류·상태 선필터 후 UUID 커서, 기본 30개. 페이지가 참조하는 프로필을 함께 반환 |
| `provider_admin_workspace()` | 초기 호환 조회는 각 목록 최신 최대 100. 현재 관리자 UI는 전체 탐색 가능한 queue RPC 사용 |
| `provider_search_catalog(...)` | 공개 자료 선필터 후 UUID 커서. 추천 조회는 동일 서비스의 자격·분야·가격을 함께 확인 |
| `provider_review_application(...)` | 관리자, 제출 version 대조. 보완/반려 이유 필수. 승인해도 draft |
| `provider_review_offering(...)` | 서비스 심사와 추천 상태를 명시. 소개·사진 승인을 추천으로 확장하지 않음 |
| `provider_suspend_profile(...)` | 즉시 paused, 추천 blocked. 새 편집·사진 등록 차단 |
| `provider_restore_profile(...)` | 이전 승인 이력이 있는 중지 프로필만. paused 유지, 추천 자동 복구 없음 |
| `provider_submit_business_inquiry(p_input,p_request_id)` | confirmed Auth 이메일. 개인정보 동의. 사용자별 하루 10건 상한 |
| `provider_review_business_inquiry(...)` | version 대조. responded에는 포털 답변 필수. 이메일 발송을 의미하지 않음 |

응답은 신청 최초 제출의 `{provider_id,application_id,status}`를 제외하면 대상 DB 행 JSON이다.
웹 API가 확인한 schema로 parse하여 공개/관리 DTO를 반환한다. 원본 DB 예외는 사용자에게 내보내지 않는다.
범주 최대 10, 지역 최대 20, 사용자당 프로필 최대 10, 프로필당 서비스 최대 30이다.
신청 동의 버전은 문자열 `2026-09-28`이며 신청의 네 동의 값은 모두 true여야 한다.
신규 참여 기능은 Auth의 서버 소유 `raw_app_meta_data.signup_consent` 증거도 필수다.
일반 앱의 legacy cutoff 예외와 user_metadata 동의는 새 게시 권한의 증거로 사용하지 않는다.
필수 가입 동의가 없거나 손상되면 직접 RPC와 service 미디어 등록 모두
`PROVIDER_CONSENT_REQUIRED`로 거절한다. 기존 회원은 가입 동의를 갱신한 뒤 참여할 수 있다.

## 사진 등록과 실패 복구

`provider-portfolio`는 private, 최대 5MiB, JPEG/PNG/WebP만 허용한다.
Storage restrictive fence는 anon/authenticated의 모든 직접 작업을 차단한다.
서버가 실제 bytes를 디코드·메타데이터 제거한 다음 아래 순서로 처리한다.

1. service-only `provider_register_media_upload(p_provider_id,p_owner_id,p_mime_type,p_byte_size)`.
   DB가 `userId/providerId/mediaId.ext` 경로를 생성한다. 소유자·승인·계정삭제 상태를 재확인하고
   프로필 row lock 아래 uploading+ready 합계 12장 상한을 검사한다.
2. 서버가 반환된 경로에 private bytes를 `upsert:false`로 업로드한다.
3. 사용자 client가 `provider_finalize_media(p_media_id,p_caption,p_alt_text,p_rights_confirmed)`를 호출한다.
   현재 승인·소유권·예약 상태·객체 존재를 다시 확인한 뒤 ready로 바꾼다.
4. 실패 시 service-only `provider_abort_media_upload(p_media_id,p_owner_id)`를 호출한다.
   uploading/removed는 `{aborted:true,storage_path}`, ready는 `{aborted:false,storage_path:null}`이다.
   **aborted=true일 때만 bytes를 지운다.** finalize 성공 후 응답만 유실된 경우 사진을 지우지 않는다.
5. 사용자 삭제는 `provider_remove_media(p_media_id)`가 먼저 removed로 변경하고 `{id,storage_path}`를 반환한다.
   이후 서버 cleanup 실패가 공개 상태를 복구하지 않는다. removed 행의 경로는 cleanup 재시도에 사용한다.

uploading 예약은 30분 뒤 finalize가 거절된다. 다음 등록 시 만료 예약을 removed로 바꿔 용량을 회수한다.
본인·관리자 workspace의 사진 목록은 ready만 반환하며 진행 중 예약은 사진 카드로 노출하지 않는다.
만료/실패 객체 bytes의 제거는 별도 서버 cleanup이 필요하다. 예약 만료 자체를 bytes 삭제로 보고하지 않는다.
공개 이미지 응답은 서버가 매번 현재 approved/published/ready와 계정삭제 상태를 검사한 뒤 전달하며
장기 CDN 캐시나 장기 signed URL로 비노출을 우회하지 않는다.

## 계정삭제와 동시성

사용자 명령과 미디어 등록은 삭제 intake와 같은 `pg_advisory_xact_lock(hashtextextended(userId,0))`를 획득하고
`account_deletion_jobs.status <> completed`가 있으면 새 작업을 차단한다. 이후 프로필 row lock을 획득한다.
동일 프로필의 승인·수정·사진 예약·서비스 변경은 row lock으로 순서를 정하고 expected_version으로 오래된 요청을 거절한다.

Auth 삭제 시 소유 프로필·신청·사업문의는 CASCADE, 종속 서비스·사진도 CASCADE된다.
프로필·사업문의의 감사 이벤트도 종속 FK CASCADE로 함께 제거한다.
관리자 계정만 삭제할 때는 actor SET NULL로 다른 제공자의 운영 이력을 유지한다.
**DB cascade가 Storage bytes를 지우지는 않는다.**
후속 삭제 saga가 소유자 prefix를 근거로 bytes를 수집·제거한 뒤 Auth를 지워야 한다.

## 검증 증거와 남은 게이트

실행: `node --test scripts/tests/provider-participation-runtime.test.mjs`.
합성 PostgreSQL(PGlite)에서 SQL 실행, 익명·본인·타인·관리자·회수된 관리자·서비스 역할,
승인/게시/보완/중지/복구, 서비스 재심사, 사진 예약 상한·중복·실패복구,
Storage broad allow 옆 restrictive deny, 계정삭제 fence·CASCADE를 검증한다.
테스트 사용자와 서비스는 모두 합성이며 실제 고객 데이터가 아니다.

Hosted PostgreSQL·실제 Storage 네트워크 요청·복수 연결 동시성·운영 릴리스 증거는 별도 게이트다.
PGlite 통과를 운영 적용·실제 발송·모바일 동기화 성공으로 표현하지 않는다.

## 아모라 읽기 연결

`discover_providers`는 기존 도구 실행·AI 기록 경로를 이용한다. 신규 AI 호출이나 업체 연락은 만들지 않는다.
`provider_search_catalog`가 전체 공개 프로필에서 조건을 먼저 적용한 뒤 UUID 순서로 요청 수만큼 반환한다.
동일 서비스의 분야·활성 상태·approved·eligible·검토 시각·기본가 상한을 함께 적용하므로,
다른 분야의 저렴한 가격이나 최신 100개 제한으로 일치 여부를 판단하지 않는다.
등록 지역은 소문자·공백 제거 후 전체 문자열이 같은 경우만 일치하며, 조직 형태·광고·제휴를 순위에 사용하지 않는다.
응답 cursor 또는 응답 안의 미표시 서비스가 있으면 추가 후보가 있음을 표시한다.
전체 시장의 포괄성·품질 순위를 주장하지 않는다. 미지원 세부 지역을 넓은 권역으로 자동 완화하지 않는다.

도구에는 제공자 입력 가격 출처, 서비스 갱신 시각, 운영 검토 시각을 따로 보낸다.
운영 검토는 가격의 독립 확인이 아니며, 날짜·수용인원·실제 수행자·최종 총액은 미확인으로 남긴다.
긴 조건은 일부 표시 여부와 상세 페이지 링크를 남기며, 도구 결과 제한 안에서 조건과 경고가 함께 보존되게 한다.
도구가 활성인 턴만 공개 후보를 소개할 수 있고, 기존 예약·레거시 업체 추천 도구는 비활성 상태를 유지한다.
