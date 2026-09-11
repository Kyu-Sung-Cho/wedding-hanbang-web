# 계정 삭제 Community Storage Saga 운영 계약

> 상태: **로컬 구현·합성 테스트 완료 후보, 운영 적용 전**
>
> 기준 migration: `20260716113000_account_deletion_storage_saga.sql`
>
> 운영 DB·Storage 쓰기, 운영 배포, 실제 사용자 삭제 검증은 이 문서 작성 범위에서 수행하지 않았다.

## 왜 필요한가

기존 `/api/auth/delete`는 Supabase Auth 사용자를 먼저 삭제했다. 그러면
`community_upload_sessions`가 `ON DELETE CASCADE`로 사라지지만 Storage의 staging,
public image, legacy video 객체는 DB 트랜잭션 밖에 남을 수 있다. 아직 유효한 signed
upload token이 있으면 Auth 삭제 뒤 staging 객체가 다시 생길 수도 있다.

새 경계는 다음 순서를 바꿀 수 없는 계약으로 둔다.

1. Auth 사용자가 존재할 때 `account_deletion_jobs`를 먼저 만든다.
2. 그 시점부터 community upload init/finalize를 fail-closed로 차단한다.
3. durable upload session과 community 세 버킷에서 **정확한 사용자 한 단계 prefix**만
   inventory한다. `chat-image`는 Storage 루트의 UUID couple 폴더를 페이지 단위로 읽고,
   각 `<couple_uuid>/<user_uuid>` exact prefix를 다시 페이지 단위로 읽는다. 따라서
   `chat_messages` 기록이 유실된 orphan 첨부도 Storage 원장에서 발견한다.
4. session staging/final 경로는 객체가 아직 없어도 manifest에 넣고, signed token
   만료 시각에 5분을 더한 시각까지 기다린다.
5. 증명된 정확한 경로만 삭제하고 각 경로에 대해 Storage `exists(path) === false`를
   확인한 뒤 DB checkpoint를 남긴다.
6. community 사용자 prefix 전체가 빈 것을 다시 확인하고, `chat-image` 루트와 exact
   uploader prefix를 Auth 삭제 직전에 다시 전수 검사한다.
7. 그 뒤에만 Auth 사용자를 삭제하고 익명 탈퇴 사유를 기록한다.

Storage 삭제, checkpoint, Auth 삭제, 최종화 사이에서 프로세스가 죽어도 lease와
idempotent checkpoint로 이어서 처리한다. 한 실행에서 최대 20개 객체만 처리하며,
크론은 한 번에 최대 3개 job을 선택한다.
이미 checkpoint한 정확한 경로가 prefix 재검사에서 다시 보이면 Auth로 넘어가지 않고
그 경로를 다시 삭제한 뒤 다음 실행에서 prefix 전체를 재검증한다.
아직 `ready_after`가 오지 않은 `inventory_ready` job은 이 제한된 배치에서 제외해,
긴 token grace가 다른 사용자의 삭제 작업을 굶기지 않게 한다.

## 자동 처리 범위와 격리 범위

자동 삭제 가능한 버킷은 다음 세 개뿐이다.

- `community-media-staging`
- `community-images`
- `community-videos`

자동 삭제 가능한 객체는 다음 둘뿐이다.

- `community_upload_sessions`의 사용자·upload UUID·bucket·path와 정확히 일치하는
  staging/final 객체
- 과거 uploader가 만든 것으로 코드에서 확인된
  `<user_uuid>/<13-digit-ms>_<uuid>.<allowlisted-extension>` 객체

UUID 파일인데 session이 없거나, 사람이 만든 이름, 폴더, 중첩 경로, 제어문자 경로,
허용되지 않은 확장자는 임의로 삭제하지 않는다. `source='quarantine'` manifest를 남기고
job을 `manual_review`로 정지한다. worker는 quarantine 객체를 삭제할 수 없다.

`chat-image`는 자동 삭제 범위에 포함되지 않는다. 다음 strict shape만 삭제 job 사용자의
소유 후보로 수집하지만, 유효하더라도 항상 `source='quarantine'`으로 기록하고
`manual_review`로 정지한다.

```text
<couple_uuid>/<job_user_uuid>/<file_uuid>.<jpeg|jpg|png|gif|webp>
```

job 사용자는 반드시 두 번째 path segment와 정확히 같아야 한다. UUID가 아닌 루트 폴더,
루트의 파일, 중첩 파일명, 폴더로 반환된 첨부, 허용 외 확장자, 중복 path는 ownership을
추정하지 않고 fail-closed한다. 한 inventory에서 최대 1,000 couple 폴더, 전체 manifest
최대 10,000 객체, 최대 1,111 Storage list page로 제한한다. 어느 상한이든 초과하면 Auth나
Storage 삭제로 진행하지 않는다. 수동검토를 resume해도 객체가 남아 있으면 새 inventory가
같은 quarantine을 다시 만들고 즉시 `manual_review`로 되돌린다.

수동 확인 후 객체를 정확히 삭제하거나 승인된 별도 보관 위치로 이동한 운영자는
service-role 전용 `resume_account_deletion_after_manual_review(job_uuid)`를 호출할 수 있다.
이 RPC는 기존 manifest를 신뢰하거나 삭제 완료로 표시하지 않고 job을 inventory 단계로
되돌린다. 다음 worker가 Storage를 처음부터 다시 읽으므로 객체가 남았으면 다시
`manual_review`가 된다. 운영 승인 없이 이 RPC를 호출하면 안 된다.

## DB 객체 identity와 백업 대상

### 신규 테이블

- `public.account_deletion_jobs`
- `public.account_deletion_media_manifest`

두 테이블 모두 RLS enabled + FORCE RLS이고 `anon`, `authenticated`, `PUBLIC`에 table
권한이 없다. service role만 읽고 쓴다. 활성 job의 `user_id`와 exact Storage path는 민감
운영 데이터이므로 백업·로그·티켓에 원문을 복사하지 않는다. 탈퇴 사유는 자유문자를 받지
않고 `unknown`, `unsatisfied`, `alternative`, `wedding_done`, `privacy`, `low_usage`,
`other`, `mobile_request` 코드만 저장한다. finalizer도 이 코드만 익명 audit에 옮긴다.

### 신규 함수 — signature까지 일치해야 함

- `public.begin_account_deletion_job(uuid,text)`
- `public.claim_account_deletion_job(uuid,uuid,timestamptz)`
- `public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)`
- `public.release_account_deletion_job(uuid,uuid,text)`
- `public.mark_account_deletion_manual_review(uuid,uuid,text)`
- `public.resume_account_deletion_after_manual_review(uuid)`
- `public.checkpoint_account_deletion_media(uuid,uuid,text,text)`
- `public.prepare_account_deletion_auth_delete(uuid,uuid)`
- `public.finalize_account_deletion_job(uuid,uuid)`

모든 함수는 `SECURITY DEFINER`, 빈 `search_path`, fully-qualified object 참조를 사용한다.
`PUBLIC`, `anon`, `authenticated` execute 권한은 revoke되고 service role만 execute한다.

### 신규 인덱스·제약·트리거

- `account_deletion_jobs_active_user_idx`
- `account_deletion_jobs_worker_idx`
- `account_deletion_media_pending_idx`
- 두 테이블의 primary key 및 manifest의 job FK
- status, identity state, claim state, error code, bucket, source, path shape,
  quarantine state CHECK 제약
- **신규 trigger는 없다.** 상태 전이는 위 RPC에서만 수행한다.

### 기존 의존 객체

- `auth.users`
- `public.account_deletions`
- `public.community_upload_sessions`
- 위 community 세 Storage bucket, `chat-image`, `storage.objects`

백업 inventory에는 신규 두 테이블의 schema와 활성 행, 신규 함수 9개의 정의·권한,
인덱스·제약·RLS/privilege 상태를 넣는다. 기존 의존 객체도 복구 세트에 실제로 포함되는지
확인한다. DB backup은 Storage 객체 본문을 포함하지 않으므로 공급자 Storage backup/보존
정책을 별도로 확인해야 한다.

## 크론과 애플리케이션 경계

- Vercel: `GET /api/cron/account-deletion`, `*/5 * * * *`
- 인증: `Authorization: Bearer $CRON_SECRET`
- 접수 스위치: `ACCOUNT_DELETION_INTAKE_ENABLED=true`인 경우에만 삭제 요청을 인증·접수한다.
  값이 없거나 정확히 일치하지 않으면 503을 반환하고 인증, rate limit, admin client, durable
  job, upload fence를 전혀 읽거나 만들지 않는다.
- 진행 스위치: `ACCOUNT_DELETION_CRON_ENABLED=true`인 경우에만 worker가 진행된다.
  값이 없거나 `false`, `TRUE`처럼 정확히 일치하지 않으면 cron은 DB를 전혀 읽거나 쓰지 않고
  `disabled`로 종료한다.
- API: 웹·모바일 모두 `DELETE /api/auth/delete`
- 접수 스위치가 켜지면 durable job과 upload fence를 만든다. 같은 HTTP 요청 안에서
  Storage/Auth 삭제를 즉시 진행하는 동기 처리는 진행 스위치까지 정확히 `true`일 때만
  허용한다. 따라서 현재 expand 배포에서는 접수와 파괴 단계를 모두 시작하지 않는다.
- upload fence: `/api/community/upload`와 `/api/community/upload/finalize`
- upload init은 빠른 사전 확인과 durable session 저장 직후·서명 직전 재확인의 이중
  펜스를 사용한다. 삭제 job이 두 확인 사이에 생겨도 미추적 signed token이 발급되지 않는다.
- `202 ACCOUNT_DELETION_PENDING`: durable job은 생겼지만 token grace 또는 worker 처리가 남음
- `409 ACCOUNT_DELETION_REVIEW_REQUIRED`: 증명되지 않은 객체로 수동 검토 필요

모바일에 있던 `/functions/v1/delete-account` 직접 호출은 제거했다. 웹·모바일은 pending을
성공 완료로 표시하지 않고 안내 후 로그아웃한다. 현재 pending 사용자의 재로그인을 전역으로
막는 경계는 없고 새 community upload만 막는다.

현재 expand 릴리스의 Production 환경 계약과 배포 전 검사기는
`ACCOUNT_DELETION_INTAKE_ENABLED=false`와 `ACCOUNT_DELETION_CRON_ENABLED=false`를 모두
요구한다. 아래 항목이 모두 승인·검증되기 전에는 운영에서 어느 값도 `true`로 바꾸지 않는다.
승인 후에도 접수를 먼저 제한된 카나리로 켜고 durable job·upload fence를 확인한 뒤 진행
스위치를 별도로 켠다.

1. 공유 `chat-image` 첨부파일의 삭제·보존·익명화 정책
2. manual review 담당자, 응답 SLA, 승인 기록과 객체 처리 절차
3. 삭제 완료 알림과 알림 실패 처리 정책
4. 법정 보존 자료의 분리 보관 경계와 보존 기간
5. 백업 보존 기간, 삭제 ledger 재적용, 격리 복구 리허설
6. hosted clone·Storage/CDN·실제 Vercel cron에서의 end-to-end 검증

### 활성화 NO-GO: 계정 연결 본문·AI·대화 데이터 분류

Auth FK의 `ON DELETE SET NULL`은 식별자 연결을 끊을 뿐, 같은 행의 자유 입력 본문이나 JSON,
couple 단위 파생 데이터가 삭제·익명화됐음을 뜻하지 않는다. 본문에 이름·연락처·계약 조건·고민
내용처럼 재식별 가능한 정보가 남으면 `user_id`/`sender_id`가 `NULL`이어도 파기 후조건을 충족했다고
판정할 수 없다. 반대로 공유 대화, 분쟁 자료, 계약·정산 자료를 임의로 삭제하는 결정도 migration이
대신하면 안 된다.

따라서 아래 데이터 분류 TODO를 데이터 책임자와 개인정보·법률 책임자가 승인하고, 각 항목에
`즉시 삭제`, `승인된 비식별화`, `통계 집계만 보존`, `법정 분리보관` 중 하나의 disposition과
보존기간·접근주체·파기 트리거를 기록하기 전까지
`ACCOUNT_DELETION_INTAKE_ENABLED=false`와 `ACCOUNT_DELETION_CRON_ENABLED=false`를 유지한다.
기존 AI 로그의 90일 raw-payload redaction 계약도 계정 탈퇴 시 보존을 자동 승인하는 근거로
간주하지 않는다.

- `ai_interactions_log`: `user_id`, `couple_id`, `session_id`, soft-link `message_id`뿐 아니라
  `user_input`, `ai_output`, `tool_input`, `tool_output`, `error_message`, 자유 형식 `metadata`를
  필드별로 분류한다. 비용·성능 집계에 필요한 최소 allowlist와 사용자별 raw payload를 분리한다.
- `chat_messages`: `sender_id=NULL`만으로 `content`가 익명화됐다고 보지 않는다. `shared`,
  `bride_private`, `groom_private` 및 같은 visibility의 AI 응답을 구분하고, 탈퇴자 단독 비밀 대화와
  생존 파트너가 참여한 공유 대화 각각의 열람·삭제·가명처리 규칙을 승인한다.
- 아모라 파생 기억: `decision_nodes`, `chat_summaries`, `amora_couple_profiles`,
  `amora_memory_settings`, `amora_memory_consents`, `amora_memory_jobs`와 source-message soft link를
  inventory한다. 원문을 지운 뒤에도 요약·결정·개인화 프로필에서 탈퇴자 정보가 복원되지 않는
  후조건을 정한다.
- 행동·검색·견적 데이터: `search_logs.query`, `customer_events.session_id`/`metadata`,
  `amora_quote_checks.vendor_name`/`memo`/`analysis`는 FK가 `SET NULL`이어도 자유 입력 정보가 남는다.
  사용자별 데이터와 제품 통계를 분리하고 승인된 disposition을 지정한다.
- 삭제 ledger와 과거 데이터: `account_deletions.user_id`/`email`의 기존 행, soft user ID,
  JSON 내부 식별자, FK가 없는 외부 로그·캐시·모델 입력 저장소를 별도 inventory한다. 현재 신규
  ledger가 allowlisted reason만 저장한다는 사실로 과거 행까지 정리됐다고 간주하지 않는다.
- 리뷰·커뮤니티·업체·계약·정산·분쟁 자료는 소유자와 공동 열람자를 구분한다. 자동 삭제 여부는
  제품·사업·법률 승인 없이 추정하지 않고, 보존 대상이면 일반 서비스 DB와 분리된 접근 경계 및
  만료 후 파기 증거를 요구한다.

활성화 전 hosted clone 검증은 FK 성공이나 UUID `NULL`만 확인해서는 안 된다. solo 사용자와
파트너가 남는 couple 사용자를 각각 synthetic fixture로 만들고, 승인된 disposition 표에 따라
원문·private/shared chat·AI 로그·아모라 파생 기억·검색/행동/견적 payload가 삭제·비식별화·분리보관
됐는지 값 단위로 검증한다. 백업 복구와 삭제 ledger 재적용 뒤에도 같은 후조건이 유지돼야 한다.

## 복구와 재시도

1. 웹 코드를 먼저 과거 auth-first 삭제 route로 롤백하면 안 된다. 장애 시 삭제 요청을
   503으로 막는 안전 패치를 유지하고 worker를 복구한다.
2. migration은 expand-only로 유지한다. 장애 대응 중 table/function을 drop하지 않는다.
3. DB 복구 시 `account_deletion_jobs`와 manifest를 같은 시점으로 복구한다. claim을 임의로
   지우지 않아도 15분 뒤 stale reclaim된다.
4. Storage가 DB보다 앞서 삭제됐으면 exact absence check 후 checkpoint가 복구된다.
5. DB가 Storage보다 앞서 checkpoint됐더라도 Auth 경계 전에 prefix 전체를 다시 스캔한다.
6. `auth_deleting`에서 Auth 사용자가 이미 없으면 finalizer가 익명 audit과 job anonymization을
   재시도한다. Auth 사용자가 복구돼 있으면 Storage를 다시 확인한 뒤 다시 삭제한다.
7. 복구 리허설은 실제 운영이 아닌 격리된 destination에서 수행하고 synthetic 사용자와
   객체를 마지막에 inventory한 뒤 제거한다.

## 운영 적용 전 필수 검증

- migration 1080 → 1110 → 1130을 격리 Supabase clone에 순서대로 적용
- anon/authenticated가 신규 table과 RPC를 읽거나 실행하지 못함 확인
- 사용자 A job이 사용자 B prefix/object에 영향을 주지 않음 확인
- session 객체가 아직 없어도 manifest가 두 경로를 보존하고 token expiry+5분 전 Auth 삭제 불가
- Storage 삭제 직후 crash, checkpoint 직후 crash, Auth 삭제 직후 crash를 각각 재시도
- legacy image/video 정상 삭제, untracked UUID/임의 이름은 manual review 정지
- `chat-image` strict uploader path도 자동 삭제되지 않고 manual review 정지
- UUID couple 루트와 각 `<couple>/<user>` prefix pagination이 DB 메시지 없는 orphan을 발견
- chat-image malformed path와 folder/object/page 상한 초과가 fail-closed함 확인
- Auth 직전 재검사에서 새 chat 첨부가 보이면 다시 manual review가 됨 확인
- manual review 객체가 남은 채 resume하면 다시 manual review가 됨 확인
- 21개 이상 객체가 여러 cron 실행으로 진행되고 마지막에만 Auth가 삭제됨 확인
- old public URL을 익명 GET해 CDN cache가 삭제 후 콘텐츠를 반환하지 않음 확인
- active job+manifest backup을 격리 DB에 복구한 뒤 worker 후조건까지 확인
- Vercel `CRON_SECRET`, schedule, service-role destination fence 확인

## 아직 닫히지 않은 출시 게이트

다음은 코드로 임의 결정할 수 없으므로 완료로 표시하면 안 된다.

1. 이용약관·개인정보처리방침의 초안은 실제 비동기 처리와 맞게 “신청 접수 후 커뮤니티 새
   파일 업로드 제한 → 임시 접근 링크 만료·소유권 안전 확인 → 지체 없는 파기”로 맞췄다.
   다만 법률 검토, 개정 고지·시행일, 데이터 유형별 법정 보관 범위는 운영 책임자가 승인해야
   한다. 개인정보 보호법 제21조의 기본 원칙은 목적이 끝난 개인정보의 지체 없는 파기,
   법정 보관 정보의 분리 보관, 복구·재생 방지다.
2. 다른 사용자가 공유·재게시한 media와 couple 대화에서 상대방도 열람한 `chat-image`
   첨부, 분쟁·법정 보관 대상 콘텐츠를 삭제·익명화·보관할 제품/법률 정책이 확정되지
   않았다. 이 미승인 정책 때문에 `chat-image`는 strict uploader path여도 자동 삭제하지
   않고 반드시 quarantine/manual review에 둔다. 운영 책임자의 명시적 승인과 별도 절차
   없이는 해당 객체를 삭제하거나 resume하면 안 된다.
3. manual review 담당자, 응답 SLA, 승인 기록, 정확한 객체 이동/삭제 절차가 운영 책임자에게
   배정되지 않았다.
4. 로그아웃 뒤 사용자가 완료 여부를 확인하거나 완료 통지를 받는 UX가 없다. 이메일 발송을
   추가하려면 이메일 보유 목적·기간과 발송 실패 정책을 먼저 승인해야 한다.
5. hosted clone, Storage/CDN, 실제 Vercel cron 검증이 아직 수행되지 않았다.
6. 백업에서 과거 시점으로 복구할 때 이미 접수·완료된 삭제 요청을 다시 적용하는 외부 삭제
   ledger와 리플레이 절차가 없다. 승인된 백업 보유기간·폐기 정책과 함께 구현·복구 리허설이
   필요하다.

참고한 공식 자료:

- 국가법령정보센터, 개인정보 보호법 제21조:
  https://law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0021&lsiSeq=270351&urlMode=lsScJoRltInfoR
- 개인정보보호위원회, 개인정보 처리방침 작성지침(2026.4):
  https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000.Updated&nttId=12018

## 업체 계정 수동 검토 게이트

업체 계정은 일반 소비자 계정과 같은 자동 삭제 경로를 사용하지 않는다.
`vendors.owner_id`가 탈퇴 대상 사용자를 가리키면 웹 워커는 Storage 조회나 Auth 삭제 전에
`vendor_account_manual_review_required`로 작업을 중단한다. DB의
`prepare_account_deletion_auth_delete(uuid,uuid)`도 같은 소유 관계가 남아 있으면 Auth 경계를
열지 않는다.

이 게이트는 사업자등록증, 업체 이미지, 계약·정산 자료의 법정 보존 및 업체 소유권 이전을
운영자가 먼저 판단하게 한다. 현재 운영 기준에서 `vendor-images`와 `vendor-licenses`는 각각
객체 수 0이어야 하며, 최종 Storage 정책은 두 버킷의 authenticated 쓰기를 다시 열지 않는다.
향후 업체 업로드를 출시할 때는 객체별 소유권 ledger, 두 버킷의 삭제 inventory, 법적 보존
절차를 별도 승인한 뒤에만 이 수동 게이트를 자동 처리로 바꿀 수 있다.

이 검증과 실제 hosted 계정 삭제 probe가 끝날 때까지
`ACCOUNT_DELETION_INTAKE_ENABLED=false`와 `ACCOUNT_DELETION_CRON_ENABLED=false`를 유지한다.

위 승인 항목과 전체 release gate가 통과하기 전에는 운영 배포·실사용 계정 삭제 카나리를
진행하지 않는다.

## 2026-09-11 후속: 수동 확인 관측 및 처리 결과 조회

위 미완료 항목 중 **운영자가 멈춘 요청을 발견하고 저장된 처리 결과를 조회하는 코드**를
추가했다. 실제 운영 스위치 활성화, Sentry 수신, 고객지원 메일 발송, 수동 객체 처리,
제품 탈퇴·Storage/CDN 부재 확인을 수행했다는 뜻은 아니다. 새 migration은 없다.

검토한 대안은 (1) 영속 알림 ledger·메일 큐를 새로 만드는 안과 (2) 기존 cron·Sentry와
관리자 인증을 재사용하는 안이다. 현재 고객지원 체계와 삭제 경계를 보존하는 (2)를 택했다.
담당자는 서비스 운영자 본인이고 `contact@hanbang.ai` 수신함 사용은 확인되어 있다.
이는 알림 수신 시험이나 응답 시간 약속을 확정한 기록은 아니다.

### 발견·재알림

- `/api/cron/account-deletion`은 기존 exact-true gate가 켜진 정상 실행에서만 DB를 읽는다.
  OFF면 기존처럼 DB no-op이며, 따라서 OFF 상태에 자동 감시가 있다고 안내하면 안 된다.
- 자동 worker 상태 네 개는 그대로다. `manual_review`는 작업 목록에 넣지 않는다.
  batch 처리 뒤 별도 조회하여 이전에 멈춘 요청도 매 5분 정상 실행에서 다시 관측한다.
  작업 목록 조회 실패 때도 수동 확인 관측은 별도로 시도한다.
- JSON 이벤트 `account_deletion_manual_review`에는 관측 시각, 전체 잔여 건수,
  가장 오래된 요청의 생성 시각만 넣는다. `created_at`은 **수동 전환 시각이 아니라 접수 시각**이다.
  회원·job 식별자, 사유, 이메일, 파일 경로, DB/SDK 오류 원문은 넣지 않는다.
- 잔여가 있으면 기존 `log.error`→Sentry 경로에서 고정
  `fingerprint=["account-deletion","manual-review"]`와
  `log_scope=account-deletion/manual-review`를 사용한다. 반복 관측은 동일 이슈의 이벤트이며
  매번 새 사고로 만들지 않는다. 실제 수신 빈도는 별도 운영 알림 규칙이 결정한다.
  출시 전 담당자는 이 이슈의 최초 발생과 미해결 재알림(예: 24시간)의 수신 규칙을 확인해야 한다.
  이 코드는 규칙을 생성·변경하거나 메일을 발송하지 않는다.
- 잔여 0은 관측 로그로만 남긴다. 이것만으로 이전 요청 완료 또는 담당자 수신 성공을 선언하거나
  Sentry 이슈를 자동 해결하지 않는다. 조회 실패는 고정 `ACCOUNT_DELETION_MONITOR_UNAVAILABLE`
  오류로 구분하고, batch가 성공했더라도 HTTP 503과 실제 batch 결과를 반환한다.
  관측 실패 응답이 이미 완료한 삭제를 그 요청 안에서 다시 실행하지 않는다.

### 담당자 확인·처리 절차

1. 기존 관리자 로그인으로 `GET /api/admin/account-deletion`을 조회한다.
   기존 `verifyAdmin`/관리자 접속기록을 그대로 사용하고 응답은 `private, no-store`다.
   조회는 삭제·회원·Storage 업무 데이터를 바꾸지 않지만, 기존 인증 절차는
   `admin_access_log`에 관리자 접근 감사기록을 남긴다. DB 쓰기가 전혀 없는 API라는 뜻은 아니다.
   가장 오래된 수동 확인 요청 최대 50개와 전체 `outstanding`, `truncated`를 제공한다.
   50건을 전체라고 오인하지 않는다. 반환 필드는 job 참조와 상태·처리 시각뿐이다.
   worker가 OFF여도 이 관리자 조회는 가능하지만, 일반 회원에게는 열리지 않는다.
2. job 참조를 내부 지원 기록에 보존하고, 제한된 DB/Storage 운영 경로에서 해당 요청의
   실제 소유권·보존 사유·격리 manifest를 대조한다. 알림이나 외부 티켓에 고객 원문을 복제하지 않는다.
   필요한 객체 처리·보존 판단을 완료하기 전에는 `resume`하거나 상태를 직접 `completed`로 바꾸지 않는다.
3. 기존 위 절의 승인된 수동 처리와 `resume_account_deletion_after_manual_review` 절차를 따른다.
   새 현황 API는 GET만 제공하며 자동 삭제·재개·승인·완료 상태 변경 기능이 없다.
4. `GET /api/admin/account-deletion?jobId=<확인한 job UUID>`로 **같은 요청**을 다시 확인한다.
   `completedInLedger=true`는 `completed` 상태와 Storage 확인·Auth 삭제·완료 시각이 모두
   저장되어 있음을 뜻한다. 현재 CDN 부재 재검사나 백업 삭제 재적용을 새로 실행했다는 뜻은 아니다.
   목록에서 사라짐, 404, `inventorying` 복귀, 조회 실패는 완료 증거가 아니다.
5. 필요한 실제 객체·Auth 결과 확인을 마친 후 지원 기록과 Sentry 이슈를 수동 종료하고,
   기존 고객지원 채널로 안내한다. 담당자가 실제 메일을 보낼 권한·수신 확인은 별도다.
   자동 완료 메일 및 비로그인 고객의 셀프서비스 상태 조회는 이번 범위에 추가하지 않았다.

### 개인정보 안내 정정 이력

`privacy/page.tsx` 제3조의 90일 이후 “식별 불가 메타데이터”를 정정했다.
`ai-log.ts`가 회원·커플·세션·메시지 연결 식별자를 저장하며,
`20260716116000_ai_log_retention_contract.sql`은 원문 필드·메타데이터를 정리하지만
해당 연결 식별자와 처리 시각·사용량·비용 등 다른 운영 필드를 모두 삭제하지 않는다.
원문 제거와 익명화를 같다고 안내하지 않는다. 실제 처리·보유 기간·이용 목적을 바꾼 수정은 아니다.
문서와 신규 제출 동의의 대응을 위해 표시 최종수정일은 **2026-09-11**로 올렸다.
기존 2026-08-31 동의 기록은 과거 판본 그대로 보존하며 새 판본 동의로 승격하지 않는다.

### 검증 범위와 남은 운영 증거

합성 검사는 기존 수동 요청의 재관측·고정 fingerprint, 자동 worker 분리, 조회·알림 실패,
개인 정보 없는 출력, 관리자 인증·잘못된 조회, 미완료/없는 요청과 완료 checkpoint를 구분한다.
기존 worker·Storage saga·intake·개인정보 기간 검사도 함께 실행한다.
실제 알림 수신, 전용 시험 계정 탈퇴, 공유 첨부 수동 처리, 담당 응답 시간 확정,
전체 복원 후 삭제 ledger 재적용은 여전히 별도 출시 검증 항목이다.
