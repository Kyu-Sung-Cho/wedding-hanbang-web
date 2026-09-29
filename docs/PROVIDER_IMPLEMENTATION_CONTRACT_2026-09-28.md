# 제공자 참여 구현 계약 · 2026-09-28

2026-09-29 보완: 서버 검색·커서, 관리자 큐, 서비스별 철회와 모바일 웹 진입을 반영했다.

구현 기준: production/main `4216fddad09f8fbfd4ff75399adc6b9b36f2651f`에서 분리. 운영 적용 전 검증 문서이며 운영 반영 사실이 아니다.

최신 사용자 결정: 한방 승인 후 제공자는 소개글·사진을 직접 즉시 게시한다. 신청 승인으로 공개가 자동 시작되지는 않는다. 서비스·가격과 추천 자격은 별도 심사. 사진마다 재승인을 기다리게 하는 이전 시안의 조건은 이 결정으로 변경한다.

## 공통

- wire fields는 snake_case. 공통 타입은 `apps/web/src/lib/providers/contracts.ts`.
- 웹 JSON mutation은 같은 출처 fetch, 인증 getUser와 서버 app_metadata의 계정 가입 동의 증거 확인. 공개 설명·프로필·탐색 외 쓰기는 로그인 필요. 계정의 확인된 이메일을 사용하고 새 이메일을 임의 신뢰하지 않는다.
- 신규 제공자 경로는 커플 온보딩을 강요하지 않는다. 기존 소비자 온보딩 규칙은 유지.
- 일반 에러 `{error:string,code:string}`. 401 로그인, 403 권한, 409 버전 충돌(새로 읽기), 400 입력 오류, 503 아직 준비되지 않음. 원본 DB 오류를 화면에 출력하지 않는다.
- 읽기/관리 응답 private no-store. 공개 미디어도 상태를 재검사하고 CDN 장기 캐시 금지.
- 소개·사진 immediate. 승인된 뒤에만 profile write/media upload; suspension은 즉시 차단. 단일 책임자 계정이 팀 프로필을 관리하며 팀원 초대는 이번 최초 릴리스 범위가 아님을 센터에서 안내.

## 웹 API

| API | 입력 / 출력 |
|---|---|
| GET `/api/provider/workspace` | `ProviderWorkspace` 직접 반환 |
| POST `/api/provider/applications` | `{request_id,kind,name,categories,regions,contact_name,application_note,consents:{privacy,price_transparency,extra_charges,standard_terms,version:'2026-09-28'}}` → `{provider_id,application_id,status}` |
| PATCH `/api/provider/applications/:id` | 위 정보(request_id 제외) + `expected_version` → 제출 결과 |
| PATCH `/api/provider/profiles/:id` | `{action:'save',expected_version,introduction,website,instagram}` 또는 `{action:'publish'|'pause',expected_version}` → profile 결과. 완료 후 workspace 다시 읽기 |
| POST `/api/provider/profiles/:id/media` | multipart `file`, `caption`, `alt_text`, `rights_confirmed:'true'`. JPEG/PNG/WebP 최대 5MiB, 12장. 서버 실제 디코드·메타데이터 제거 → `{media:ProviderMedia}` |
| GET `/api/provider/profiles/:id/media/:mediaId` | 공개된 승인 프로필의 ready사진 또는 해당 소유자의 ready사진 bytes. 미승인·정지·타인 초안은 404 |
| DELETE `/api/provider/profiles/:id/media/:mediaId` | 소유권 확인(정지 중에도 철회 가능) → removed 기록 → Storage cleanup. `{success:true,cleanup_pending:boolean}` |
| POST `/api/provider/profiles/:id/offerings` | `{name,category,description,base_price_krw,price_unit,includes:string[],extra_charges,conditions}` → 결과 |
| PATCH `/api/provider/profiles/:id/offerings/:offeringId` | 위 + `expected_version` 또는 `{action:'withdraw',expected_version}`. 수정/재제출은 active·pending·needs_review. 철회는 inactive·pending·blocked이며 소개·사진 유지 |
| GET `/api/providers` | `category`, `region`, `q`, `after=uuid` → `{providers:PublicProvider[],next_cursor:uuid|null}`. 전체 자료에서 조건을 먼저 적용한 30개 페이지. 별도 `?id=uuid` 조회는 검색 조건과 섞지 않음 |
| POST `/api/business/inquiries` | `{request_id,kind:'collaboration'|'media'|'data'|'other',subject,message,contact_name,privacy_consent:true}` → 접수 결과 |
| GET `/api/admin/providers` | `kind=applications|offerings|inquiries`, `status=all|종류별상태`, `after=uuid` → `ProviderWorkspace & {next_cursor:uuid|null}`. 현재 관리자만, 필터 후 30개 페이지와 참조 프로필 반환 |
| PATCH `/api/admin/providers/:id` | `{kind:'application'|'offering'|'profile'|'inquiry',action,expected_version,reason?,recommendation_status?,reply?}` → `{success:true}` 후 재조회 |

관리자 action:

- application: `approve`, `reject`, `request_changes` (거절/보완 사유 필수). 승인으로 게시 권한만 부여.
- offering: `approve`, `reject`. 승인 시 추천 자격은 `unreviewed` 또는 검토된 `eligible`; 거절·차단은 이유 필수.
- profile: `suspend`, `restore` (사유 필수, restore도 자동 게시 없음).
- inquiry: `reviewing`, `responded`, `closed` (`responded`는 답변 필수). 답변은 신청자 센터에서 열람, 이메일 발송 완료로 주장하지 않음.

공개 카탈로그는 공급 참여·공시 원문을 혼동하지 않는다. 새 등록 가격은 ‘제공자 공개 가격’. 업체/개인/팀에 같은 조건을 적용. 실제 일정은 미확인, 플랫폼 예약 확정·계약·결제 버튼은 추가하지 않는다.

공개 검색의 지역은 등록 문자열의 대소문자를 무시한 부분 일치이고, 이름/소개도 문자 그대로
검색한다. 와일드카드나 지리적 범위 추정을 적용하지 않는다. 커서는 수정 시각 변경에 영향을
받지 않는 UUID 오름차순이다. 관리자 서비스 `withdrawn` 필터는 제공 중단 이력을 보여 주며,
활성 pending 목록과 구분한다. 반복 쿼리 키·유효하지 않은 종류/상태 조합은 거부한다.

서비스 입력 기본값과 선택지는 승인된 프로필 분야를 따른다. 사진 변경 후 미저장 소개를
유지하며, 권한 변경·실패·사용자의 명시적 전체 새로고침 시에는 편집 상태를 재확인한다.
모바일 내 프로필의 두 진입 메뉴는 설정된 웹 origin의 외부 브라우저를 열고 앱 토큰을 전달하지 않는다.

`standard_terms`는 공개한 서비스 조건 준수와 적용 약관·취소 기준 안내를 확인하는 키다. 특정 계약 체결이나 표준계약서 서명을 의미하지 않는다.

사진 정리는 `/api/cron/provider-media-cleanup`에서 실패·만료 파일을 재시도한다. CRON_SECRET 인증 후 서비스 SDK를 사용하며 ready 사진은 제거하지 않는다. 계정 삭제 manifest는 PostgreSQL 마이크로초를 JS 날짜로 읽을 때의 절삭을 고려해 35분에 보수적인 1초 여유를 둔다.

## DB RPC

authenticated user client로 실행:

- `provider_submit_application(p_input,p_request_id)`
- `provider_resubmit_application(p_application_id,p_expected_version,p_input)`
- `provider_get_workspace()`
- `provider_update_profile(p_provider_id,p_expected_version,p_input)`
- `provider_set_publication(p_provider_id,p_expected_version,p_status)`
- `provider_save_offering(p_provider_id,p_offering_id,p_expected_version,p_input)`
- `provider_withdraw_offering(p_provider_id,p_offering_id,p_expected_version)` (소유자는 정지 중에도 철회 가능)
- `provider_finalize_media(p_media_id,p_caption,p_alt_text,p_rights_confirmed)`
- `provider_remove_media(p_media_id)`
- `provider_submit_business_inquiry(p_input,p_request_id)`
- admin용 `provider_admin_queue(p_kind,p_status,p_after,p_limit)`, `provider_review_application`, `provider_review_offering`, `provider_suspend_profile`, `provider_restore_profile`, `provider_review_business_inquiry` (매번 DB에서 현재 is_admin 확인). 초기의 제한된 `provider_admin_workspace()`는 남아 있으나 현재 UI는 큐 RPC를 사용한다.

공개 조회 `provider_public_catalog(p_provider_id,p_limit)`는 anon 호출 가능하며 허용된 공개 필드만 반환.
페이지 조회는 `provider_search_catalog(p_category,p_region,p_query,p_after,p_limit,p_recommendation_only,p_max_base_price_krw)`를 쓴다.
아모라는 전체 자료에서 같은 서비스의 active·approved·eligible·reviewed_at과 가격/분야를 함께
필터링한다. 일반 웹 검색과 달리 추천의 지역은 소문자·공백 제거 후 전체 일치만 허용한다.

서버만 `provider_register_media_upload(p_provider_id,p_owner_id,p_mime_type,p_byte_size)`를 service-role로 실행하여 DB가 생성한 경로를 받는다. 승인/소유권을 다시 확인한 뒤 private `provider-portfolio`에 올리고 사용자 RPC로 finalize한다. 실패 시 신규 객체 cleanup, 종료되지 못한 upload의 복구 기록을 남긴다.

DB migration, 실제 PostgreSQL/PGlite 실행, 권한 검증과 운영 적용 증거는 별도로 기록한다. 기존 `vendors` 승인상태·공시가격·공개사진 버킷을 신규 권한으로 재사용하지 않는다.
