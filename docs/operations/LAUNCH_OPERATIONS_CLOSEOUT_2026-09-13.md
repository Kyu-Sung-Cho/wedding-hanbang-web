# 출시 운영 점검 종결 기록 — 2026-09-13

범위: 기존 두 시험 계정·삭제·복구·경보 증거를 대조하고, 고객 자료 없는 로컬 실행으로 실제 준비 결함을 닫는다. 운영 DB/Auth/Storage 변경, 새 계정 생성, 메일 발송, OS 설치·재부팅은 수행하지 않는다. 기존 release controller와 배포 승인은 변경하지 않는다.

## 이미 끝난 검사는 다시 시작하지 않는다

| 항목 | 보존된 실행 증거 | 정확한 판정 |
|---|---|---|
| 독립 C/D 두 계정 | `launch-close-20260912/accounts/two-actor-api-result-safe.json` | 2026-09-12 00:13–00:14 UTC 실제 API PASS: 필수 동의, 온보딩·초대, 개인/공유 RLS, 상대 개인 쓰기 403, 메시지 중복 방지, 총예산 0→1,000→0, 양측 조회·상대 알림, 재확인 멱등성 |
| 시험 공간/계정 정리 | 같은 폴더 `actor-c-cleanup-safe.json`, `actor-d-cleanup-safe.json` | 두 actor hash와 실행 결과를 대조했다. 정확한 시험 공간 6개 관계 잔존 0, 세션 폐기·Auth 삭제·profile 부재 PASS. 실제 제품 탈퇴 saga 전체 검증은 아님 |
| 삭제 전 토큰 거부 | `deleted-actor-access-result-safe.json` | 아직 5분 이상 유효한 C/D access token의 `GET /api/auth/me?consent_only=1` 각 401. refresh 0·기타 요청 0 |
| 원래 시험 계정 보존 | `TWO_ACTOR_EXECUTION_RESULT.md` 및 전후 읽기 전용 영수증 | 기존 연결, 3,500만 원 예산, 결정/진행정보 fingerprint, private marker 동일 |

이번 `scripts/launch-operations-diagnose.mjs` 실행은 위 공개 영수증의 bytes/hash와 actor 간 결합·후조건을 다시 읽어 확인했다. 과거 API를 재실행한 것으로 집계하지 않는다. C/D는 삭제되어 현재 다시 로그인 가능한 계정이 아니다.

과거 운영 commit은 `4cec226f06954b322aa072cfe2eab408bdf6fd0b`다. 현재 HEAD와 비교한 위 API 경계 중 온보딩 route와 관련 테스트에만 변경이 있었다. 삭제 route/cron/saga, reset, 사용자 메시지 저장, journey, 준비 변경 승인, 알림 경로는 이 비교에서 변경이 없다. 현재 온보딩 변경의 회귀 검사와 기존 실증을 결합해야 하며, 과거 한 번의 실행을 모든 미래 commit 검증으로 확대하지 않는다.

## 오늘 실제로 확인한 환경과 실행

- E: 기존 무설치 PostgreSQL **17.10**의 postgres/initdb/pg_ctl/pg_dump/pg_restore/psql 여섯 도구가 현재 실행된다. 새 설치가 필요하다는 가정은 틀리다. 경로는 `%LOCALAPPDATA%/WeddingHanbangTools/postgresql-17.10/pgsql/bin`이다.
- E: 기존 native 합성 snapshot/복원 시험을 실제 실행해 **5 PASS, 실패 0, skip 0**을 확인했다. 별도 loopback SCRAM cluster에서 이전 snapshot 값·큰 bytes·타입·고정 sequence·ACL을 빈 DB에 복원하고, 잘린 archive·닫힌 snapshot을 거부했다. 자체 생성 cluster와 임시 파일은 기존 소유권 가드로 정리됐다. 로그: `launch-closeout-20260913/native-synthetic-restore.tap`.
- E: native bundle에 `pg_cron`·`supabase_vault` control 파일은 없다. 이것을 전체 Supabase 복구 환경으로 표현하지 않는다.
- E: 기존 portable QEMU **11.1.1**이 실행된다. 9월 12일 원본 없는 Ubuntu 부팅·정상 종료 기록이 있으나 긴 serial 명령 일부가 유실되어 `OS`, `CPU`, `NIC_COUNT` 라벨 검사가 실패했다. 당시 Supabase 서비스 실행은 0회였다.
- E: 이번에는 고정 진단 script를 새 NoCloud seed의 `write_files/runcmd`에 넣었다. cloud-init이 직접 진단하고 guest를 종료한다. 긴 대화형 serial 명령을 보내지 않는다. 기존 서명된 실행 파일 111개·Ubuntu image hash를 확인했고, 새 ISO의 세 입력 파일을 Windows tar로 전량 대조했다. 기존 seed/overlay/실패 결과는 보존했다.
- E: **03:34:17 UTC 고정 seed 진단 10개 모두 PASS**, 271.478초 후 QEMU exit 0으로 정상 종료했다. `OS=ubuntu 24.04`, `CPU=2`, `NIC_COUNT=0`, `ROUTE_COUNT=0`과 완전한 probe 구간, poweroff, 원본 image/seed hash 유지까지 확인했다. forced quit/kill은 없고 종료 후 소유 PID 부재도 확인했다. 이전 실패는 그대로 보존하며 이번 별도 실행으로 serial 전달 의존을 없앤 개선을 입증했다. `launch-closeout-20260913/fixed-seed-boot-result.json`과 `owned-process-final-state.json`이 결과다. 소유 PID의 중간 순간 TCP/UDP endpoint는 모두 0이었지만 연속 네트워크 관측이나 전체 Supabase 서비스 격리 증거는 아니다.

기존 빈 hosted 대상도 존재한다. **2026-09-13 03:24:06 UTC**, `tvyblzioajnfsbkciubk`의 `BEGIN READ ONLY … ROLLBACK` 조회는 PG17.6, Auth 사용자/세션 0, Storage 객체/버킷 0, vault0.3.1 포함 확장 6개를 반환했다. 고객 원문·파일은 읽지 않았다. 이 관측은 빈 대상 메타데이터만 확인하며 API ingress, Auth refresh, 공개/서명 Storage, SMTP/HTTP/DB egress의 전체 격리를 입증하지 않는다.

## 전체 복구에서 실제로 남은 일

`FULL_RESTORE_PREPARATION_2026-09-11.md`의 native 합성 검증과 `launch-close-20260912/restore/CURRENT_RESTORE_STATUS.json`을 구분한다. 후자는 ledger217/head20260911080244 기준이며 `fullRestoreVerified=false`다. 옛 215 수집기에 최신 manifest를 이름만 바꿔 넣으면 안 된다.

1. **합성 환경 단계**: 원본 없는 QEMU의 고정 script 진단10개와 native PG 복원5개는 위 실제 실행으로 완료했다. 이를 다시 시작하지 않고, 다음 서비스 준비가 필요할 때 공식 image digest를 기존 `stage-b-image-pins.json`과 대조한다. 이번 실행은 추가 패키지·서비스를 설치하지 않았다. 무설치 native PG 결과는 archive/DB 계약 검증이며 전체 Supabase 서비스 복원과 구분한다.
2. **원본 복구 대상 단계**: 기존 빈 hosted 대상 또는 별도 격리 guest 중 하나를 정하고, 정확한 source/target identity·확장·관리 schema·역할 및 실제 ingress/egress 차단을 확인한다. 현재 Windows QEMU는 `dump-guest-core=off`를 지원하지 않는다는 기존 관측이 있다. 합성 실행은 가능하지만 고객 원본 admission을 자동 허용하지 않는다.
3. **수집·복원 실행 단계**: 현재 source catalog/ledger와 검토된 migration 목록에 맞는 capture-only successor, 실제 target-only restore executor, 독립 검수를 준비한다. 동일 backupSet의 DB/Auth/schema/권한과 Storage 원본 bytes를 검증된 경계 안에서 복원하고 관계·sequence·ACL/RLS/RPC·파일 identity/길이/hash를 대조한다.
4. **삭제 재적용과 인가 단계**: 복원 후 이미 접수/완료된 삭제 요청의 replay를 검증하고 실제 영수증을 정식 controller에 연결한다. `full-restore-target-admission.mjs`는 순수 증거 계약 검사이며 현재 반환값의 `restoreExecuted/releaseAuthorized=false`를 바꾸지 않는다.

이는 **원본 데이터 복구와 해당 DB/Storage 변경의 게이트**다. 기존 UI 표시, 읽기 기능, 합성 계정 검증을 모두 취소하거나 새 시험을 무한 반복하는 근거로 사용하지 않는다. 반대로 합성 DB 복원을 원본 DB/Auth/Storage 전체 복구 성공으로 쓰지도 않는다.

전체 출시의 상태·남은 경계는 `docs/WEB_LAUNCH_MASTER_CHECKLIST_2026-09-13.md` W12–W14에 연결한다. 같은 항목을 이 문서에서 새 출시 번호로 추가하지 않는다. 별도로 실행된 구형 초대 함수 ACL 회수는 `scripts/LEGACY_COUPLE_JOIN_ACL_RELEASE.md`의 실제 receipt로 마감됐으며, 이 운영 복원 점검을 수행한 담당자가 그 DDL까지 실행했다고 해석하지 않는다.

## 새 독립 계정이 필요한 경우의 기존 실행 경로

이미 통과한 C/D API 검사를 반복하려고 새 계정을 만들 필요는 없다. 향후 별도 브라우저/OAuth/Storage saga 검사에 독립 계정이 꼭 필요할 때만 범위와 생성·정리를 함께 고정한다.

- 실행 패킷: `launch-close-20260912/accounts/RUNNER_EXECUTION_REVIEW.md`.
- 생성/정리 helper: `visualizations/2026/09/05/01a071f6-3108-7a93-8bcd-58228c99b148/round10-amora-completion-20260907/sql1-rollout/create-hotfix-canary-actor.ps1` 및 `cleanup-hotfix-canary-actor.ps1`.
- 생성은 무작위 `tests.hanbang.invalid` 주소, `email_confirm:true`, 서버 `app_metadata.release_canary`로 `admin.createUser`를 호출하고 정상 `signInWithPassword`를 사용한다. 비밀번호/JWT는 HBAM2/DPAPI 캡슐에만 남기고 stdout에 출력하지 않는다. 이 방식은 초대메일을 보내지 않는다. [공식 createUser 문서](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- 실행 직전 현재 운영 commit/tree·runtime/helper hash·30분 이내 schema/plan 사전관측 pins를 갱신한다. 옛 명령의 시각·해시를 그대로 재사용하거나 가드를 낮추지 않는다. 기존 C/D 암호화 capsule도 새 계정으로 간주하지 않는다.
- 브라우저가 필요하면 정식 로그인 경로에 이 합성 계정만 사용하도록 별도로 검토한다. API Bearer 성공은 OAuth·realtime·iPhone UI 증거가 아니다.
- 제품 reset으로 정확한 시험 공간을 비운 뒤 helper는 암호화 identity/hash·서버 tag·현재 profile의 couple_id=null을 다시 확인하고 세션 폐기→정확한 Auth 삭제→Auth404/profile 부재를 확인한다. 실패 시 캡슐/상태를 보존하며 임의 cascade나 전체 사용자 삭제로 보상하지 않는다.

이번 작업에서는 계정 생성·캡슐 복호화·로그인·정리 helper를 실행하지 않았다.

## 제품 탈퇴와 경보: 서로 다른 미완료 항목

현재 코드의 `DELETE /api/auth/delete`는 intake flag가 정확한 `true`가 아니면 인증/job 쓰기 전에 503과 고객지원 주소를 반환한다. cron도 별도 flag가 `true`가 아니면 DB no-op이다. 이를 켜서 완료로 표시하지 않는다.

자동 탈퇴를 열려면 콘텐츠별 삭제/보존 정책, 담당 처리·승인·완료 기록, Storage/CDN 실제 부재, stale token·중단 재시도, 백업 복원 후 삭제 replay를 끝내야 한다. 합성 C/D의 admin cleanup은 제품 탈퇴 성공이 아니다. 현재 지원 방식의 접수·본인확인·처리 기록과 응답시간을 운영자가 확정할 수 있도록, 해당 절차만 별도로 닫는다. 법정 기간을 임의로 정하지 않는다.

경보는 기존 `accountDeletion/operations.ts` → `log.error` → Sentry 경로가 있다. manual review fingerprint는 `account-deletion/manual-review`이며 원문 고객자료 없이 고정 오류 코드를 보낸다. `warn/info/debug`는 운영에서 no-op이다. cron OFF 상태에서는 backlog 관측도 실행되지 않는다.

보존된 증거는 운영 Sentry DSN 설정까지다. **실제 이벤트 도착과 담당자 수신은 미확인**이며 DSN 설정만으로 완료 처리하지 않는다. 다음에는 로그인된 Sentry 프로젝트/환경·담당 rule을 읽고 기존 이벤트를 확인한다. 시험 이벤트나 알림 발송이 필요하면 고객자료 없는 정확한 1회 범위를 별도로 정한다. 이번에는 외부 이벤트/메시지를 발송하지 않았다.

사용자가 보류한 고객지원 시험메일은 계속 보류한다. `contact@hanbang.ai` 수신함 사용과 담당자 본인이라는 답변은 유효하지만 발송·수신·회신 시험 성공은 아니다. 관리 현황 GET API 역시 관리자 인증 과정에서 access log를 쓸 수 있으므로 순수 DB read-only probe로 오인하지 않는다.

## 증거 재확인 명령과 한계

```powershell
node scripts/launch-operations-diagnose.mjs --evidence-root 'C:/Users/kcho1/.codex/visualizations/launch-close-20260912' --pg-bin 'C:/Users/kcho1/AppData/Local/WeddingHanbangTools/postgresql-17.10/pgsql/bin' --qemu-bin 'C:/Users/kcho1/AppData/Local/WeddingHanbangTools/restore-lab-20260912/msys2-portable/ucrt64/bin'
```

이 진단은 고정된 공개 영수증 5개와 기존 binary의 `--version`만 읽고 결과를 stdout에 낸다. DB 연결·네트워크·계정/Storage 변경·메일·VM 시작 기능이 없으며 인자 없는 실행은 도움말이다. 이번 결과는 로컬 `launch-closeout-20260913/operations-readonly.json`, 빈 대상 메타데이터는 `isolated-target-readonly.json`에 보존했다. 제품/API 테스트 전체 재실행이나 원본 payload 복호화를 하지 않았다.

공식 범위: [DB 백업은 Storage 파일 bytes를 포함하지 않음](https://supabase.com/docs/guides/platform/backups), [DB Network Restrictions와 HTTPS API 범위의 차이](https://supabase.com/docs/guides/platform/network-restrictions), [관리자 사용자 삭제 API](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser). Supabase changelog도 이번 점검에서 확인했으며 self-hosted PG17/Auth URL/관리 역할 전환 사항은 새 환경의 실제 버전·설정 확인에 반영해야 한다.

## W12 후속: 수동 접수에서 실제 worker까지의 최소 실행 계획

03:40 UTC 로컬 검증 결과, 자동 intake/cron flag를 둘 다 false로 둔 상태에서 실제 `requestAccountDeletion`/`processAccountDeletionJob` 함수에 상태를 보존하는 합성 Supabase adapter를 연결했다. 빈 소유자 접수→inventory→Auth 삭제→완료 기록→중복 실행에서 Auth 삭제/완료 기록은 각각 1회였고, 업체 소유·미검토 media는 Auth/Storage 변경 없이 manual_review로 멈췄다. 자유문 사유는 접수 전에 거부했다. 네트워크·실제 DB/Auth/Storage 변경은 0이다. 결과는 `launch-closeout-20260913/w12-worker-local-result.json`이다. SQL lease/트랜잭션·실제 Storage/CDN 검증으로 확대하지 않는다.

실제 운영의 `/privacy`, `/terms`는 인증 없는 GET에서 각각 200, 고객센터 수동 접수 문구와 `contact@hanbang.ai`를 표시했다. 자동 접수 문구는 없었다. `w12-public-policy-readonly.json`에 기록했다. 이는 운영 고지의 관측이며 보호된 삭제 API를 실제로 실행하거나 최신 환경변수 원문을 읽은 증거는 아니다.

**구현 공백:** 기존 관리자 API는 GET 조회만 제공한다. 검토한 고객지원 요청을 정확한 사용자와 결합해 접수·실행·완료 영수증을 남기는 운영 명령/승인 경로는 없다. 고객지원 수신함이 있다는 사실만으로 담당 처리까지 완성됐다고 말하면 안 된다. 기존 Auth canary cleanup을 제품 삭제 대용으로 사용하지 않는다.

다음은 root가 실제 실행 코드와 대상·정리 권한을 검토한 뒤 위임할 최소 시험이다. 이 문서만으로 운영 실행하지 않는다.

| 단계 | 예상 변경과 검증 |
|---|---|
| 1. 합성 대상 1명 생성 | 기존 audited creator 사용. 무작위 invalid-domain 이메일·서버 canary tag·암호화 캡슐. Auth/profile 및 해당 로그인 세션만 생성. 메일 0 |
| 2. 대상 고정 | 정확한 project/현재 배포 SHA·helper/worker hash·fresh identity·server tag·profile couple_id=null·vendor 없음·기존 삭제job 없음·업로드 세션/Storage 없음. 암호화 support-case receipt에 소유 확인과 시험 삭제 승인을 연결. 고객 원문/비밀번호/JWT 공개 금지 |
| 3. 수동 접수 | `requestAccountDeletion(admin, exactUserId, 'privacy', now, {processImmediately:false})`. account_deletion_jobs 1개 생성. 전역 flags는 false 유지. actorId로 단일 새 job을 조회하고 exact jobId와 최초 snapshot을 고정 |
| 4. 검토 후 진행 | exact jobId의 worker로 inventory 1회. 빈 manifest와 quarantine 0·ready 시각·동일 actor를 다시 확인. 이어 worker 1회로 Storage 재조회→prepare RPC→해당 Auth 삭제→finalize. 이 단계는 새 합성 계정만 대상으로 하는 불가역 실행 |
| 5. 결과 확인 | Auth404/profile 부재, 아직 유효한 기존 token의 auth/me 거절, 정확한 job의 completed+storage_verified_at+auth_deleted_at+completed_at 및 user_id/reason null 확인. 익명 account_deletions 통계 1개가 남는다. 완료 기록을 증거 없이 삭제하지 않음 |

전체 예상 변경량은 새 Auth 1명과 그 프로필/로그인 세션의 생성 후 제거, 완료 job 1개 및 익명 삭제 통계 1개다. 새 커플/예산/대화/결정은 만들지 않고 Storage upload/remove는 0이어야 한다. 감사 로그·Auth 내부 기록이 전혀 남지 않는다고 보장하지 않는다. 계정 삭제는 복원 불가하며 기존 고객 계정은 대상이 아니다.

실제 worker의 chat-image inventory는 최상단 커플 폴더 이름을 읽은 뒤 각 `coupleId/exactNewUserId`를 조회한다. 파일 bytes나 다른 사용자 하위 파일을 읽지는 않지만, 이 최상단 metadata 읽기도 실행 범위에 포함해 검토해야 한다. 불필요한 전역 조회로 확대하거나 빈 응답 fixture로 바꿔 실제 worker 검증인 것처럼 표시하지 않는다.

실패 시: begin 전에는 기존 helper의 정확한 빈 canary cleanup을 검토할 수 있다. begin 이후에는 job·actor·암호화 캡슐을 보존하고 정확한 실패 단계에서 재개한다. Auth 삭제 후 finalize 실패는 같은 job의 복구 대상으로 남긴다. 기존 cleanup으로 job을 우회하거나 새 계정을 재생성해 롤백 성공으로 표시하지 않는다. 자동 무제한 재시도·플래그 활성화·범위 밖 cascade는 없다.

이 시험이 통과해도 무자료 solo 계정의 운영 worker 경로만 입증한다. 실제 고객지원 본인확인, 공유 자료·첨부·보존 판단, 완료 안내·응답시간, 백업 삭제 replay는 별도로 남는다. 지원메일 보류와 시험 이벤트 무발송 조건은 계속 유지한다.
