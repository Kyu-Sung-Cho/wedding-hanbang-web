# 아모라 배포 실행·검증 기록 — 2026-09-21

상태: **진행 중 / 운영 배포 미완료**. 이 문서는 이번 세션에서 직접 실행한 것과 아직 실행하지 않은 것을 구분한다. 기존 전체 회귀 기록은 `AMORA_RELEASE_INTEGRATION_REPAIR_2026-09-21.md`, 직전 재확인은 `AMORA_RELEASE_LIVE_RECHECK_2026-09-21.md`에 남아 있다.

## 실제 외부 작업

- 2026-09-20 23:09:32 UTC: 기존 시험 프로젝트 `rgxdizztidbgwnsbadml`가 INACTIVE이고 소속 조직 `bfveiwfnisejfffwhind`의 plan이 `free`인 것을 Management API로 확인했다. 공식 OpenAPI의 기존 프로젝트 재개 endpoint `POST /v1/projects/{ref}/restore`를 확인했다. 새 프로젝트 복제나 운영 DB 복원이 아니다.
- 23:09:49 UTC: 위 **기존 시험 프로젝트 한 개**에 재개 요청을 보냈고 HTTP 200을 받았다.
- 23:14:08 UTC: ACTIVE_HEALTHY를 독립 조회했다. 프로젝트 생성·요금제 변경·기존 행 삭제·운영 Supabase 변경은 수행하지 않았다.
- 공식 API 참고: <https://supabase.com/docs/reference/api/v1-restore-a-project>. 요청에 새 프로젝트나 요금제 인자를 사용하지 않았다.

## 시험 환경은 운영과 동일하지 않다

모든 관측 SQL은 `BEGIN TRANSACTION READ ONLY`와 시간 제한을 사용했고 API 요청은 `read_only:true`였다. 실제 관측 역할은 `supabase_read_only_user`다. 계정 원문·대화·파일 이름·파일 내용·인증값을 조회 결과나 이 문서에 넣지 않았다.

| 항목 | 기존 운영 | 재개한 기존 무료 시험 환경 |
| --- | --- | --- |
| Project ref | `slrtobkksjmxgzatjyqb` | `rgxdizztidbgwnsbadml` |
| DB system identifier | `7581440907192989109` | `7662742571317219726` |
| 실제 migration ledger 행 | 226 | 230 |
| 실제 ledger head | `20260920120000` | `20260820150000` |
| Storage 객체 수 | 663 | 924 |
| Storage metadata 크기 합계 | 104,928,862 bytes | 39,089,539 bytes |
| cron.job 행 수 | 0 | 1 |
| vault.secrets 행 수 | 0 | 0 |
| Storage 정책 수 | 20 | 4 |

시험 환경에는 Auth 계정 197개와 public 테이블 212개가 있었다. 비어 있거나 폐기 가능한 환경으로 취급하지 않았다. Storage 크기는 metadata 집계이며 실제 원본 다운로드·백업 완료 증거가 아니다. 실행 중 쓰기 transaction의 순간 관측 0도 전역 쓰기 차단 증거가 아니다.

23:14:55 UTC 비교에서 운영 ledger에만 있는 version 25개와 시험 ledger에만 있는 version 29개를 확인했다. 공통 version 중에도 statements 배열의 digest가 다른 항목이 있다. 이 차이는 원문 저장·분할 방식의 차이일 수도 있으므로, 개수나 digest 차이만으로 migration 누락·손상을 판정하거나 이력을 repair하지 않았다.

이번 후보가 바꾸는 기존 함수 8개는 두 환경에 모두 존재했다. 이 중 다음 2개의 `pg_get_functiondef` digest가 달랐고, 나머지 6개는 같았다.

- `apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)`
- `reset_current_couple_membership()`

새 migration은 기존 구현을 rename하고 위임하므로, 시험 환경에 새 SQL 두 개만 추가해도 운영과 같은 동작을 검증했다고 할 수 없다. 기존 데이터 덮어쓰기·전체 migration 재실행·시험 환경 cron 변경은 하지 않았다.

## 운영 백업·복원 경계

23:16:46 UTC Management API에서 운영의 최신 provider backup이 `COMPLETED`, `is_physical_backup:true`, 생성 시각 `2026-09-20T20:13:53.225Z`임을 확인했다. 이는 **provider 물리 백업 존재**의 증거일 뿐 파일 원본 백업이나 격리 복원 검증이 아니다.

독립 코드 검토에서 확인한 재사용 가능 구현:

- `current-baseline-backup-runtime.mjs` / `current-baseline-backup-collector.mjs`: 일관된 snapshot, schema/globals, 관계·sequence, Storage 원본 암호화 수집 및 재관측.
- `postgres-snapshot-archive.mjs`: 동일 snapshot의 실제 custom-format pg_dump 및 archive decode 검사.

남은 실행 공백:

- 기존 수집 CLI/source fence는 과거 release 계약에 고정되어 있어 이번 후보의 실제 기준과 binding이 필요하다.
- `recovery-database-stage.mjs`는 합성 원본만 허용한다. 운영 고객 원본 운송·완전 격리 복원·Storage 원본 복원 검증은 구현·실행되지 않았다.
- 기존 Storage freeze SQL은 옛 19개 정책을 전제로 한다. 현재 관측한 운영 정책 20개에 그대로 실행하지 않았다.
- 기존 배포 절차의 signed-upload 대기는 120분+10분과 추가 안정성 관측이다. resumable upload는 별도 증거가 필요하다. 이번 후보의 실제 write fence·drain·finalizer가 완료됐다는 뜻이 아니다.
- 운영 로그인·저장·업로드의 장시간 점검 모드는 시작하지 않았다. 영향이 큰 점검 시간 선택을 사용자에게 별도 질문했다.

## 이번 세션에서 실행한 테스트

### 로컬 실제 PostgreSQL

`node --test scripts/tests/amora-privacy-decision-native.test.mjs scripts/tests/recovery-database-stage-native.test.mjs`

- **11 passed / 0 failed / 0 skipped**, 약 55.5초.
- 승인된 결정의 단일 저장·정확한 receipt, 완료 실패 시 원자 rollback, 초기화와 memory/decision 간 동시 실행, stale owner/epoch 거절, 내부 RPC 직접 접근 차단을 검사했다.
- 복원 테스트는 **격리된 로컬 합성 DB**의 실제 pg_dump/pg_restore 및 bigint·sequence 비교다. 운영 고객 원본 복원이나 hosted Supabase Auth 테스트가 아니다.

### 운영 브라우저 읽기 중심 점검

현재 운영 버전에 대해 실제 브라우저에서 다음을 확인했다. 이 결과는 아직 배포하지 않은 수정본의 결과로 표시하지 않는다.

- 랜딩에서 로그인 페이지로 이동.
- 빈 로그인 제출 시 이메일·비밀번호 입력 안내.
- 로그인 없이 준비 방식 소개 페이지 표시.
- 공개 견적 점검에서 사진 항목 하나를 포함으로 선택한 뒤, 결과가 확인 필요 11개로 연결됨.
- 결과의 아모라 이어 묻기를 누르면 로그인으로 이동하며 원래 대화 prefill이 redirect에 보존됨. 로그인 후 복귀·저장은 아직 검사하지 않았다.
- 공시 가격 페이지 정상 표시.
- 이 경로들의 브라우저가 수집한 error/warn 로그는 비어 있었다. 전체 앱·OAuth·실제 계정 저장·모바일 실기기 통과를 뜻하지 않는다.

`qa` 스킬의 자동 수정·커밋 절차는 기존 미커밋 변경을 보존하기 위해 clean-worktree 관문에서 보류했다. 위 브라우저 점검은 별도 읽기 중심 진단이며 `qa` 전체 완료나 건강 점수를 선언하지 않는다.

### 운영의 익명 접근 경계

- 인증 쿠키·사용자 JWT 없이 `GET /api/amora/memory`, `GET /api/amora/today-one/preferences`, `GET /api/profile`은 각각 401이었다.
- `/api/chat/messages`는 GET 미지원으로 405였다. 출처 없는 빈 POST는 403, `Origin: https://hanbang.ai`를 보낸 비로그인 빈 POST는 401이었다. 실제 사용자 메시지는 보내지 않았다.
- 운영 Supabase의 공개 anon key만 사용하여 `select=id&limit=1`을 조회했다. `decision_nodes`는 200/0행, `chat_messages`, `profiles`, `couples`는 각각 401이었다. 식별자 값이나 고객 행은 출력하지 않았다.
- 이는 **익명 접근 경계** 검사다. 로그인된 서로 다른 두 계정 간 RLS·저장·초기화 동시 실행의 hosted 증거를 대신하지 않는다.

## 이번에 추가하는 실행 도구

239 후보 전용 **읽기 전용** 관측기·통신·CLI를 TDD로 추가했다. 기존 237 계약이나 원문 핀을 완화하지 않았다. 전체 재검증 결과는 아래에 후속 기록한다.

이 도구는 inspect만 허용하고 apply/rehearse/finalize를 제공하지 않는다. 전체 ledger와 정확한 8+6 함수·추가 overload·나머지 catalog를 관측하더라도 결과는 `observed-unreviewed`, `releaseAuthorized:false`다. 신규 관측기 완료는 운영 적용 controller·backup/restore·hosted 인증 검증·Vercel 배포 완료와 구분한다.

독립 검토에서 Git의 `skip-worktree`/`assume-unchanged`로 숨긴 수정본이 clean 상태로 보일 수 있다는 결함을 찾았다. 담당자는 실제 임시 Git 저장소에서 숨긴 변경이 기존 검사로 통과하는 RED를 재현한 뒤, 숨김 index flag 전체 거절·핵심 실행 파일의 expectedCommit blob 원문 비교를 추가하여 GREEN을 확인했다. 최종 테스트와 재검토는 별도로 기록한다.

### 새 점검 도구의 검증

- 이어진 독립 검토에서 `GIT_CONFIG_PARAMETERS`로 Git 설정을 주입할 수 있는 경계 누락을 재현했다. 모든 `GIT_CONFIG`/`GIT_CONFIG_*`를 거절하도록 RED→GREEN으로 수정했다. TLS 검증 완화·추가 인증서·Git 실행 경로 변경 환경 변수도 거절한다.
- 검토자는 두 수정 후 소스를 재검토하여 추가 must-fix를 발견하지 않았고, catalog unit 6개 + transport/CLI 12개를 별도로 실행해 **18 passed / 0 failed / 0 skipped**를 확인했다.
- 실제 로컬 PostgreSQL catalog 검사는 **4 passed / 0 skipped**였다. 추가 ledger 열까지 전체 digest에 포함되는지, 실제 anon EXECUTE 권한·overload·관련 없는 RLS 변경이 관측되는지 확인했다.
- 새 세 테스트 파일을 `test:repo`에 연결했다. 연결 검사는 RED 3개→GREEN 3개였다.
- `prove-guard`로 validator 2개, native catalog 2개, transport/CLI 4개의 실제 변형을 심었고 **8개 모두 탐지**했다. 검사가 성공값만 반환하는 가짜 가드가 아님을 확인하고 원본 소스 해시가 복원된 것을 확인했다.
- native guard의 최초 clean baseline은 6.9초 후 파일 단위 실패로 종료됐고 상세 원인은 로그에 없었다. 같은 파일의 직접 TAP 실행 4/4와 동일 guard 명령 재실행은 통과했다. 첫 실패는 `.audit-output/release-inspector-0921/native-clean-first-failure.log`에 보존했다. 원인 자체를 해결했다고 주장하지 않는다.

### 실제 운영 읽기 전용 관측

23:33:33–23:33:34 UTC에 고정 Management API transport와 catalog validator를 실제 운영에 실행했다.

- 대상은 기존 운영 `slrtobkksjmxgzatjyqb`, system identifier `7581440907192989109`였다.
- 실제 역할 `supabase_read_only_user`, transaction `readOnly:true`였다.
- 전체 ledger 226개, head `20260920120000`, 신규 후보 `candidate-absent`였다.
- 지정한 함수 slot 14개 중 기존 8개가 존재했고 신규 6개는 없었다. 별도 overload 2개도 제외하지 않고 관측했다.
- 전체 ledger SHA256: `b8a6d177e7776127a8545d5bd283504e9584445c828114a78798de8f76516486`.
- 결과는 `observed-unreviewed`이고 운영 적용·증거 완료·출시 인가·원격 쓰기 플래그는 모두 false다.
- 이는 **미커밋 모듈의 읽기 전용 진단**이다. clean commit을 요구하는 CLI의 정식 source-bound 영수증이나 승인된 before catalog로 가장하지 않는다. 사용자 행·함수 원문·인증값은 출력하지 않았다.

23:37:05 UTC Vercel API 재확인에서 실제 `hanbang.ai`와 `www.hanbang.ai`는 여전히 기존 production deployment `dpl_31QnaA1KfgCWosXyQwnX5XVB2NPp`, main commit `969f6f5ab8c67d1e0f19025063a9c4fafd767efd`, 상태 READY였다. 이는 기존 운영 상태 확인이며 이번 수정본 배포 성공이 아니다.

## 배포에 남은 구현 — 점검 시간만의 문제가 아니다

독립 읽기 전용 감사로 다음 다섯 경계를 다시 확인했다. 기존 도구의 이름이나 성공한 합성 테스트를 새 릴리스의 완료 증거로 재사용하지 않는다.

1. **239 적용 컨트롤러:** 현재 inspector는 inspect만 제공하고 production dispatcher에는 새 후보를 적용하는 경로가 없다. 실제 전체 ledger·함수 before/after에 묶인 두 SQL의 단일 transaction 적용, lease, 응답 유실 판정, rehearsal rollback과 독립 readback 구현이 남았다.
2. **현 운영 원본 백업·격리 복구:** 기존 collector는 이전 baseline에 고정돼 있고 실제 복원 runner는 합성 원본만 허용한다. 239에 묶인 원본 수집·인증된 private artifact 운송·빈 격리 target의 실제 DB/Storage 원본 검증 연결이 남았다. 새 유료 프로젝트를 뜻하지 않는다.
3. **전체 쓰기 차단:** 기존 웹/public DB 차단 부품만으로 Auth·직접 Storage·worker·진행 중 요청까지 차단됐다고 할 수 없다. 현재 정책과 cron·토큰 만료에 맞춘 검증 및 복원 가능한 lifecycle이 필요하다.
4. **hosted 행동 검증:** 기존 시험 환경은 비어 있지 않고 함수 기준도 다르다. 데이터 삭제 없이 허용된 격리 대상과 정확한 기준을 확보한 뒤, 실제 두 계정/JWT·RLS·동시성·재시도·구버전 복구를 검증해야 한다.
5. **새 버전 배포 후 검증·차단 해제:** Vercel 도구는 기존 것을 쓸 수 있지만, 새 개인정보 경계를 유지하는 호환 rollback과 같은 lease owner만 해제하는 finalizer 연결이 남았다.

여기서 239는 저장소 SQL 파일 수를 가리키는 후보 이름이지 운영 migration ledger의 목표 행 수가 아니다. 관측한 운영 226행에 이번 두 행만 정상 추가하면 228행이다. 숫자를 맞추려고 과거 SQL을 추가 실행하거나 이력을 repair하지 않는다. 무DB 수정 일부를 별도로 분리할 수는 있지만 결정 저장·기억·초기화 전체 수정은 새 RPC를 요구하므로 앱만 통째로 배포하면 안 된다. 무DB 분리도 현재 AGENTS의 운영 사전 관문을 면제하지 않는다.

`ship`/`land-and-deploy` 절차는 위 미완료 운영 게이트에서 보류했다. CI의 의도적인 production-readiness 차단을 삭제하거나 false 값을 true로 바꾸지 않았다. 점검 시간 합의는 위 구현 후의 서비스 중단·작업 배출·백업·적용·배포에 필요한 별도 조건이며, 그 합의만으로 미완료 구현이 충족되지는 않는다.

## 최종 전체 재검증

23:31:55 UTC에 현재 소스 해시를 고정하고 `scripts/verify-change.mjs`를 시작했다. 새 검사 45개 모두에 변형 탐지 영수증이 있는 것을 확인했다. 웹 타입 검사·린트는 통과했고 웹 전체 테스트 중 아래 새 결함이 발견돼 이 실행을 의도적으로 중단했다. **이 실행은 전체 통과가 아니다.** 정확한 wrapper PID와 하위 테스트 프로세스만 확인해 종료했고, 중단 전 source freeze는 `source-freeze-before-card-owner-fix.json`에 보존했다. 과거 `test-web.log`를 이번 결과로 집계하지 않는다.

### 추가 발견: 계정 전환 후 남아 있는 확인 카드

독립 call-graph 검토에서 웹 `PendingAmoraActionCard`가 승인·실행 claim·승인 철회 요청에 `{messageId}`만 보내며, API는 요청 시점의 쿠키 계정을 RPC actor로 사용하는 것을 확인했다. A가 열어 둔 확인 창의 지연 callback이 같은 커플 B 로그인 뒤 실행되면 B의 승인/claim/철회를 먼저 기록할 수 있는 경로다. 후속 채팅의 owner 검사는 이 선행 쓰기를 막지 못한다. 최종 결정 행까지 곧바로 B 명의로 저장된다는 주장은 아니다.

새 회귀 재현과 수정 범위는 화면 계정·세션 세대 고정, 각 비동기 경계 재확인, 서버의 `expectedActorId` 대조다. 모바일의 기존 bearer 요청은 실제 인증 토큰에 actor가 고정되는지 별도로 검토하며, 오래된 cookie 요청의 주체를 새 로그인 사용자로 추측하지 않는다. 수정 후 국소 회귀·독립 재검토·전체 관문을 다시 실행한다.

모바일 호출부까지 추가 추적한 결과, 인증 helper는 전달받은 actor에 token을 고정하지만 확인 callback이 실행 시점의 `sessionUserIdRef.current`와 새 generation을 채택하고 있었다. 따라서 A 화면의 지연 callback이 B의 token을 새로 선택할 수 있었으며 helper만의 안전성을 전체 호출 흐름의 안전성으로 확장할 수 없었다. 이 발견을 근거로 웹 카드/API와 모바일 호출부를 병렬로 수정 중이다.

호환 방식은 두 대안을 비교했다. 기존 Bearer mutation의 actor 누락을 계속 허용하면 구버전의 위 동작을 서버가 정상 B의 확인과 구분할 수 없다. 따라서 P1/P3에 따라 **POST/PUT/DELETE 모두 명시적인 `expectedActorId`를 요구**하고, 누락·불일치는 쓰기 없이 409와 업데이트/재확인 안내로 거절한다. GET의 기존 Bearer 읽기 호환은 별개이며 새 모바일은 조회에도 actor를 보낸다. 이 후보가 배포될 때 구버전 모바일의 해당 승인 기능은 새 버전 또는 최신 웹에서 다시 확인해야 한다. 아직 운영에 적용된 호환 변경은 아니다.

담당자들이 실제 RED를 확인한 뒤 다음까지 완료하고 소스를 동결했다.

- 웹: 관련 6개 파일 **137/137 통과**, 웹 TypeScript·해당 파일 ESLint 통과. 같은 이벤트 턴의 오래된 확인/건너뛰기 callback, 늦은 fetch/JSON 응답, 로그아웃·커플 전환·unmount·A→B→A, 최초 인증 부팅과 재결박 방지를 검사했다.
- 모바일: 실제 screen 함수·transport·parser·generation guard로 기존 5개 통과/신규 11개 실패를 먼저 재현했다. 수정 후 actor 회귀 **26/26**, 관련 5개 파일 **157/157 통과**, 모바일 TypeScript·린트 통과. getSession·토큰 갱신·fetch·JSON 대기 중 세션 변경과 이전 finally가 새 계정의 작업 잠금을 풀지 않는지 검사했다.
- 현재 지원하는 도구 정책은 single이며 UI에서 실제로 도달하는 적용 시작은 PUT이다. 잠재적인 couple 승인 UI 분기를 늘 couple로 반환하는 가짜 정책으로 강제하지 않았다. POST/DELETE/GET은 서버·transport 단위 행동 검증과 stale entry 보호로 구분하며, 실제 활성화된 화면 전체를 검사했다고 표현하지 않는다.
- RED/GREEN 기록: `web-actor-tdd-evidence.md`, `mobile-shared-action-red.log`, `mobile-shared-action-green.log`. 웹 문서는 도구 출력의 전사이며 원시 실행 로그라고 가장하지 않는다.

이후 독립 소스 재검수에서 이 12개 파일 범위의 추가 must-fix는 발견되지 않았다. 실행한 추가 검증은 다음과 같다.

- 2026-09-21 00:06:02–00:10:20 UTC: 모바일 release readiness, 모바일·공용·디자인 토큰·ingest 타입 검사, 합성 환경의 웹 production build, iOS/Android/web 번들 export 모두 종료 코드 0이었다. Vercel/EAS/스토어 배포가 아니다.
- 00:10:46–00:11:21 UTC: 서버 actor 2개, 웹 카드 1개, 모바일 actor 4개, pending 2개, recovery 2개, history 5개, scroll 5개의 **21개 실제 변형을 모두 탐지**했다. 각 그룹 뒤 소스 해시 drift는 0이었다. 이전 모바일 파일 변경으로 낡아진 네 테스트의 증명도 실제로 다시 실행했다.
- 원시 로그·영수증: `.audit-output/release-inspector-0921/post-fix-build-receipts.json`, `actor-guard-receipts.json`, `actor-guards/`.
- 00:15:01 UTC 새 canonical 관문을 시작하여 웹 타입 검사·린트는 통과했으나, 아래 재진입 결함을 확인하여 웹 전체 검사 중 다시 중단했다. 정확히 확인한 wrapper PID 31804와 그 하위 프로세스만 종료했다. 중단 시점 소스는 `source-freeze-before-demo-reentry-fix.json`에 보존했다. 이 실행 역시 전체 통과로 집계하지 않는다.

### 추가 발견: 오래된 체험 표식 뒤 로그인 목적지 유실

수정본의 로컬 production build를 운영 자격증명 없이 합성 환경에서 실행했다. 320px 랜딩·메뉴·로그인 및 빈 입력 안내, 375px 견적 선택, 1366px 로그인 표면을 실제 브라우저로 확인했다. 관측한 문서 폭은 각각 305/360/1366px로 해당 창보다 넓지 않았다. 이것을 로그인 후 앱 전체의 모바일 QA로 확대하지 않는다.

로컬 견적 POST의 첫 403은 `127.0.0.1`과 Next 요청의 `localhost` 출처 차이였다. 쿠키 없는 HTTP 진단에서도 같은 출처 차이를 재현했고, `localhost`에서는 입력 검증까지 도달했다. 브라우저를 `localhost`로 옮긴 뒤에는 합성 DB에 영속 요청 한도 정보를 기록할 수 없어 재시도 안내를 표시했다. 실제 결과 계산·저장 전체 통과로 집계하지 않는다. 출처 보호나 영속 한도 보호를 완화하지 않았다.

로컬 브라우저에서는 보호된 대화 주소의 prefill이 로그인 이동 중 사라지는 현상을 관측했다. 쿠키 없는 독립 HTTP 요청은 정상적으로 `redirect`에 목적지를 보존했다. 브라우저의 실제 쿠키는 조회·변경하지 않았으므로 브라우저 현상의 직접 원인은 확정하지 않았다.

다만 독립 코드 감사로 동일 현상을 만들 수 있는 P2 경로를 확정했다. `middleware.ts`는 서명 없이 `demo_mode=true`만 보고 보호 경로를 통과시키지만 `AuthenticatedAppShell`은 서명을 재검증한다. 서명이 없거나 만료되고 실사용자도 없으면 shell의 `/login` 이동이 원래 주소·query를 버린다. 두 파일은 기존 main과 동일하여 이번 actor 수정의 회귀는 아니다. 서버 재검증은 살아 있으므로 이를 인증 우회나 고객 DB 노출이라고 과장하지 않는다. 정상 서명 체험만 우회하고 나머지는 기존 인증·동의·온보딩의 목적지 보존 흐름을 사용하도록 TDD로 수정했다.

브라우저 크기 override를 원복하고 이 작업에서 만든 로컬 탭을 닫았다. 정확히 확인한 로컬 wrapper PID 42456과 자식만 종료했으며 다른 서버·테스트는 종료하지 않았다.

### 로그인·상담 진입의 연관 경계까지 수정 및 재검증

middleware 외에 authStore와 공개 페이지 상담 버튼도 읽을 수 있는 체험 표식을 서버 확인처럼 취급하는 경로가 있었다. 표식만 있고 실제 인증이 없는 경우 가짜 체험 프로필이나 빈 상담 패널이 열릴 수 있었다. 다음 세 구현 파일과 각각의 테스트, 총 6파일을 수정하고 동결했다.

- middleware: 같은 HMAC 검증기로 정상 서명 체험만 인정한다. 만료·변조·누락은 기존 인증 흐름으로 넘기고 원래 URL과 query를 보존한다. 관리자 경계를 우회하지 않는다.
- authStore: 성공한 서버 응답의 `user === null && demo === true`만 체험으로 인정하며 실제 사용자 응답을 우선한다. 인증 세대뿐 아니라 계정·커플 결박 세대를 비동기 경계에서 비교하여 늦은 사용자/체험/오류 응답이 새 상태를 덮지 못하게 했다. A→B→A도 포함한다.
- CommunityAmoraLauncher: 표식만 보고 창을 여는 지름길을 없앴다. 서버 probe, 검증된 초기화, 현재 계정 일치를 모두 확인한 후 연다. 비로그인은 기존 로그인 안내, 실패·계정 변경은 기존 재시도 안내를 사용한다. UI 스타일·카피는 바꾸지 않았다.

실제 실패 재현 후 국소 검사를 통과했다. middleware 53개, authStore 관련 6파일 179개, launcher 29개이며 서로 중복되는 검사이므로 단순 합계하지 않는다. 독립 검토자는 최종 조합 13파일 **312/312 통과**와 6파일의 실행 전후 SHA 동일, 추가 must-fix 없음, diff 검사 통과를 확인했다. 이 조합에는 preview 제한, 서버 shell, 동의·온보딩 및 auth/me가 포함된다.

00:40:01–00:40:34 UTC에 최종 6파일을 고정한 합성 환경의 웹 production build가 종료 코드 0으로 완료됐다. 운영 자격증명과 실제 AI 호출 없이 로컬 서버를 열어 다음을 재검증했다.

- 같은 브라우저에서 `/wedding/chat?prefill=예산 비교&source=release-check` 접근 시 로그인 URL의 `redirect`에 원래 질문과 source가 보존됐다. 실제 쿠키를 조회하거나 변경하지 않았다.
- 공개 페이지의 비로그인 내비게이션은 로그인 상태를 유지하고, 상담 버튼은 빈 상담 패널 대신 로그인 안내를 열었다.
- 320×740px에서 안내와 버튼이 보이고 문서·본문 폭이 모두 320px였다. 닫기 후 상담 버튼으로 초점 복귀, 다시 열기, 로그인 페이지 연결까지 확인했다.
- 브라우저가 수집한 warn/error 로그는 비어 있었다. 합성 DB를 사용하는 게시글 목록은 불러오기 실패·재시도 안내였으며, 이 목록이나 실제 로그인·저장의 성공을 주장하지 않는다.

브라우저 viewport를 원복하고 임시 탭을 닫았다. 프로세스 identity를 다시 확인한 로컬 wrapper PID 42708과 자식 36044만 종료했다. 실행 증거는 `post-demo-web-build-receipt.json`, 각 `demo-session-*`/`demo-launcher-*` 로그, `authstore-demo/` 로그에 남겼다. 이 단계 역시 Vercel production 배포가 아니다.

00:45:25–00:48:40 UTC에 최종 로그인·상담 수정과 영향을 받는 기존 복구 검사의 **17개 실제 변형을 모두 탐지**했다. middleware 2개, authStore 2개, launcher 3개, composer 1개, journey 4개, profile 5개다. 각 그룹 뒤 원본 source SHA drift는 0이었고, 전체 저장된 guard 증명 69파일의 test/target MD5를 재확인한 결과 낡은 증명은 없었다. 원시 로그와 `demo-guard-receipts.json`을 보존했다.

00:49:21 UTC에 같은 HEAD 기준의 새 canonical 전체 관문을 시작했다. 이 실행은 웹 전체 테스트에서 실패했고 아래와 같이 중단·보존했다. 전체 통과 기록이 아니다.

검사 도중 GitHub main이 `a6435ead34bc44ab0fce6c317fe1527c9d135132`로 전진한 것을 read-only 원격 조회와 fetch로 확인했다. 기존 기준 이후 #435의 준비 방식 공유 정확성 수정 4파일이며, 이번 task의 변경 파일과 직접 겹치지 않는다. 실행 중인 전체 검사는 여전히 `969f6f5ab8c67d1e0f19025063a9c4fafd767efd` 기준이다. 최신 main과 병합된 결과를 이미 검증했다고 주장하거나 다른 작업을 덮어쓰지 않는다.

00:52:07 UTC Vercel 읽기 전용 재조회에서 `hanbang.ai`는 위 최신 main의 deployment `dpl_9LLtUonW6VmLDfLfuT7E7Duu8L9n`, READY/production으로 전진해 있었다. **이 배포는 이번 task가 실행한 것이 아니며 이번 아모라 미커밋 수정본을 포함하지 않는다.** 현재 운영 SHA를 이전 `969f6f5a`로 계속 보고하지 않는다.

### 전체 검사가 발견한 테스트 계약 불일치 및 재실행

00:49 실행의 웹 결과는 **5파일 실패/1113파일 통과, 17검사 실패/17303검사 통과**였다. 웹 타입 검사·린트(오류 0/경고 23), 모바일 린트·1492검사, 공유 118검사는 통과했다. repository 검사는 완료 전에 정확한 해당 프로세스 트리를 종료했으므로 통과/실패 개수를 부여하지 않는다. 실패·중단 로그와 source freeze는 `full-gate-before-fixture-repair/`에 보존했고, 남아 있는 과거 canonical 성공 영수증은 이번 성공으로 재사용하지 않았다.

원인은 새 보호 장치와 기존 테스트 준비 데이터의 불일치였다. 4개 채팅 테스트는 사용자·초기화 상태·`getState`가 없거나 실제 UUID가 아닌 actor를 사용했고, 취향 체험 테스트는 unsigned cookie만 놓고 서버가 정상 체험을 확인했다고 기대했다. **실제 보호 코드를 완화하지 않고 테스트 데이터만 수정**했다.

- 채팅: 원본 16실패/77통과를 먼저 재현한 뒤 4파일 93/93 통과. 3파일은 실제 authStore와 정상 계정 fixture를 사용하며 SidePanel은 기존 역할·계정 변경 시나리오를 보존한 mock 계약을 완성했다. 기존 검증문 309개의 순서·내용은 identity 치환 외에 그대로 유지됐다. actor/API 관련 137/137, 웹 타입 검사·대상 린트·diff 검사도 통과했다.
- 취향: 원본 1실패를 먼저 재현했다. 서버가 서명을 확인한 200 응답, 표식 유무, unsigned 표식+guest/401, 거절된 403/503을 구분했다. 취향 22/22, 인증 관련 묶음 201/201 통과, 대상 린트 오류·경고 0이었다.
- 담당자가 처음 국소 검사에서 모든 화면의 인증 fixture까지 갱신하지 못한 실수다. 운영 미배포 상태에서 전체 관문이 발견했으며 이 후보 변경으로 운영 사용자에게 발생한 영향은 없다.

최신 main `a6435ead34bc44ab0fce6c317fe1527c9d135132`를 fast-forward로 합쳤다. upstream 4파일과 작업 변경의 직접 겹침은 없었다. 안전 비교의 baseline 53파일이 최신 main에서도 동일하고 current 56파일도 증거의 SHA와 일치함을 확인했다. 01:38:44–01:39:18 UTC에 바뀐 SidePanel 테스트의 기존 4개 변형 증명을 실제로 다시 실행하여 모두 탐지했고 제품 소스가 원래 SHA로 복원됐다. 전체 guard 69파일의 test/target 해시도 다시 모두 일치했다.

01:39:47 UTC 최신 main + 수정본 210 source 파일을 동결하고 정식 `scripts/verify-change.mjs` 전체 검사를 새로 시작했다. private 증명 폴더를 제외한 intended 변경은 224파일이며, canonical 출력의 225는 untracked `.audit-output/` 항목까지 포함한 수다. 아래 옛 미리보기 결함을 독립 검토에서 확인하여 웹 전체 검사 중 정확한 wrapper PID 24556과 자식만 종료했다. 웹 타입 검사·린트는 통과했지만 웹 테스트와 뒤 관문은 완료되지 않았다. `full-gate-before-legacy-preview-fix/`에 증거를 보존했다. 별도의 축소/합성 영수증이나 Turbo 통과로 canonical 관문을 대체하지 않는다.

### 원본 스크린샷 재검토: 옛 산문 미리보기의 거짓 기능 부정

실제 승인 카드와 저장 영수증 이후의 경로는 확인됐지만, 옛 산문 미리보기만 있는 대화는 기존 회귀가 모델의 올바른 `[pending_action]` 표식을 가정했다. 표식 없이 “직접 저장할 수 없다/직접 입력해 달라”는 모델 답변을 주면 이 잘못된 기능 부정이 통과하는 경로를 추가로 찾았다. 기존 테스트의 초록불을 이 경우까지 검증한 것으로 확대하면 안 된다.

과거 미리보기에서 새 카드를 복구하는 대안도 검토했다. 다만 `canonicalRows`는 상대 대상 메시지·화면 정리 경계를 걸러낸 배열이라 실제 인접성을 증명하지 않으며, 옛 `metadata:{}` 행은 신뢰된 모델 이력의 응답 연결·범위 계약도 충족하지 않는다. 이 배열의 직전 행을 정규식으로 파싱해 사용자 확정 사실이나 승인으로 쓰지 않는다. 이번 수정은 **거짓 기능 부정을 막고 새 확인에 필요한 정보를 사실대로 안내**하는 작은 범위로 정했다. 새로운 원문 조회·이력 권위 확대·자동 저장은 추가하지 않는다. 모든 옛 대화의 카드 자동 복구와 재입력 불편 해소는 아직 완료 범위가 아니다.

이 좁은 수정은 helper·route와 각각의 기존 테스트, 총 4파일이다. 무표식·무효 표식·스크린샷의 markdown, 실제 저장 형태인 `toolResults: []`, 개인/체험/위기/다른 세그먼트/화면 정리/기존 카드·대기열·영수증·잘못된 결과 구조를 구분했다. 안내의 입력 형식은 실제 current-user parser와 맞췄으며, 안내 → 사용자가 새 필드를 명시 → 새 확인 카드의 두 턴도 검사했다. 실행은 0회이고 과거 문구가 새 입력에 섞이지 않음을 확인했다.

담당자 최종 당시 관련 5파일 **873/873 통과**, incremental cache를 끈 웹 타입 검사·대상 ESLint·diff 검사 통과였다. 이후 독립 검토 의견에 따라 부모가 5개 positive 분기에 `SSE done.fullContent === saved.content` 검증문만 추가했다. 해당 최종 해시의 route 전체 clean 실행과 변이 검사를 다시 수행했다. 02:04:44–02:05:46 UTC helper 5개·route 1개의 **6개 실제 변형을 모두 탐지**했고 제품 소스 SHA drift는 0이었다. 전체 guard 증명은 70파일 모두 test/target MD5가 일치하고, 기존 안전 비교의 current graph도 일치했다.

02:06:03 UTC 최종 수정본으로 정식 canonical 전체 관문을 다시 시작했고, **02:47:03 UTC 종료 코드 0**으로 완료했다. 새 영수증의 verdict는 pass이며 7개 관문이 모두 pass다. **웹 1118파일/17,373검사, 모바일 1492검사, 공유 118검사, repository 994검사**가 통과했다. 웹 타입 검사·웹 린트(오류 0/기존 경고 23)·모바일 린트도 통과했다. 새 검사 45파일의 변형 탐지 증명이 인정됐고, 동결한 source 210파일의 drift는 0이었다. 이 단계는 GitHub 업로드·CI 성공·Supabase 적용·Vercel 배포와 별개다. `legacy-decision-preview/receipt.json`과 `legacy-guard-receipts.json`에 국소 검사·각 RED 단계·소스 해시·남은 한계를 보존했다.

검증 기준 HEAD는 `a6435ead34bc44ab0fce6c317fe1527c9d135132`다. 검사 중 원격 main이 PR #436을 포함한 `bfecc241a17a367c07570132580fc450d707b09f`로 전진했다. upstream 8파일은 이번 intended 변경 224파일과 직접 겹치지 않았지만 합친 동작을 검증했다는 뜻은 아니다. 이번 검증본에는 그 후속 main 변경을 섞지 않았다. draft 보존과 운영 병합을 구분하며 실제 병합 전 최신 main 통합·재검증이 필요하다.

### GitHub 검증과 배포 준비의 차이

02:47:30–02:48:00 UTC에 canonical 검증본의 마지막 웹 production build도 종료 코드 0으로 통과했고 source drift는 0이었다. 로컬 합성 환경의 빌드이며 Vercel production의 환경·릴리스 서명 검증을 대신하지 않는다. 이 문서의 소스 커밋 준비 시점에는 이번 후보의 GitHub push/PR을 아직 수행하지 않았다. 업로드 후 상태는 해당 PR과 후속 작업 결과로 확인해야 한다. 검토한 224파일만 allowlist로 커밋하며 `.audit-output/`, 환경변수·원시 비공개 증거·빌드 산출물은 포함하지 않는다.

현재 CI는 `production_readiness`뿐 아니라 기존 strict 237 관문 `supabase:release:fence --preparation-style`도 실행한다. 새 SQL 두 개가 있는 239 후보에서 해당 로컬 명령을 실제 실행한 결과 `NEW_MIGRATION_NOT_REVIEWED`로 종료 코드 1이었다. 이것은 새 운영 적용 절차가 아직 통합되지 않은 실제 차단이다. 새 candidate의 정적 검증과 기존 릴리스 관문의 통과를 혼동하지 않으며, CI 전체 초록이나 배포 가능을 약속하지 않는다. 기존 관문과 역사 핀은 유지한다.

## 운영 접속·복원 준비의 추가 읽기 전용 확인

- 현재 프로세스에 `HBAM2_DATABASE_URL` 또는 DB password 설정은 없고, 기존 pooler 설정에도 password가 없다. 서비스 키·Management API 토큰의 존재를 DB 직접 접속 완료 증거로 취급하지 않는다.
- 공개 CA는 **역사 checkout에는 존재**하며 현재 통합 checkout의 collector 입력으로 결합되지 않은 상태다. 유효 기간·공개 인증서 여부·역사 핀의 일치를 확인했다. PG17.10 pg_dump/pg_restore도 설치돼 있다. 따라서 인증서·도구가 컴퓨터 어디에도 없다고 판정하지 않는다.
- 현재 archive collector loader는 `NEW_MIGRATION_NOT_REVIEWED`로 거절했다. DB URL 하나만 넣으면 해결되는 상태가 아니다.
- 역사 staging adapter에는 CLI dry-run 출력을 내부 파싱해 임시 접속을 받는 경로가 있다. 자격증명 발급 여부·권한 범위·운영 project binding을 검토해야 하므로 이번에는 실행하지 않았다. 비밀번호 재설정만 유일한 길이라고 주장하지 않는다.
- 고객 원본 admission/현재 source collector/Storage 서비스 복원은 여전히 false이고, Docker/Podman/설치된 WSL 환경은 발견하지 못했다. 설치된 PostgreSQL이나 과거 QEMU 자료의 존재만으로 고객 원본의 격리 복원 준비 완료를 선언하지 않는다.

## 최초 소비자 피드백과 아직 남은 제품 차이

첨부 4개와 기존 보고서를 다시 대조했다. 재현 오류 수정을 전체 제품 완성으로 확대하지 않는다. 다음은 별도 완료 증거가 필요하다.

1. 실제 모델 → 승인 카드 → 개인 할 일/예산 8항목/일정 3개/논의 중 결정 → DB 단일 저장 → 새로고침·상대 계정 조회의 완주.
2. 방향 전환·정정·검색 출처 유지의 실제 모델 다회 대화 품질. 합성 제공자 응답 테스트는 모델이 자연스럽게 답한다는 증거가 아니다.
3. 긴 대화·한도 종료·다음 방문의 확정/미정/보류 체크포인트. 이것은 테스트만 남은 것이 아니라 기존 보고서상 미완료 기능도 포함한다.
4. 실제 두 계정의 개인→공유 직접·간접 비노출과 안전 상담 다음 턴의 연속성. 안전 원문을 일반 이력에 다시 실어 해결하지 않는다.
5. 중재 대안별 응답·조건·후속 할 일의 완주와 모바일 네이티브 결정 보드 동등성. 웹 링크 연결을 네이티브 보드 구현 완료로 표현하지 않는다.

### 안전 분류 합성 결과의 정확한 해석

기존 444문장 비교 결과의 current 모듈 그래프 56파일 SHA가 이번 최종 소스와 동일한 것을 확인했다. 새 모델 호출이나 운영 트래픽 재평가는 아니다. 독립 읽기 감사로 숫자를 다시 해석했다.

- `falsePositives: 110→106`은 `safe`로 분류한 합성 180문장 중 안전 신호가 켜진 수다. 전체 444문장을 분모로 한 사용자 오탐률이 아니다.
- `missed: 20→0`은 합성 `danger` 214문장에서 안전 신호가 없는 수다. 올바른 위기 대응·후속 대화 전체가 검증됐다는 뜻이 아니다.
- `noTools: 16→0`은 합성 `wedding` 50문장에서 가상 도구 8개 중 하나도 허용되지 않은 수다. 실제 DB 저장·화면 연결 성공 증거가 아니다.

106건에는 정상 문장 과보호와 의도적인 보수적 보호가 섞여 있다. “신랑 예복 사이즈가 딱 맞았어”처럼 명백한 정상 문장도 안전 분기로 남는다. “남편이랑 다퉜는데 내가 맞았어”는 의견/피격의 중의성, “친구 남편 말이 맞았대”는 이번에 확장하지 않은 제삼자 경계다. 이를 모두 라벨 문제로 치부하지 않는다. 기존 `KNOWN_FALSE_POSITIVES` 88개와 `THIRD_PARTY_PARTNER_KEEPS_BASE` 18개가 합성 safe 목록에 포함돼 있으며 이 106개는 이번 회귀 관문의 실패 조건이 아니다.

이 한계는 기존 9월 19일·20일 보고서에도 명시돼 있다. 이번 전체 검사가 통과하더라도 **안전성 완벽 / 오탐 0 / 모든 상황의 기능 연결 완료**로 보고하지 않는다. 정상 대화 과보호 개선은 별도의 위기 누락 비회귀·독립 평가·다회 대화 검증을 갖춘 후속 범위로 남긴다.

첨부 raw_test1 본문의 기록 날짜는 2026-08-24이고, 9월 6일 1차 회귀 보고서는 전체 원문 부재를 명시한다. 과거 74점 등을 현재 품질 점수로 재사용하지 않는다.
