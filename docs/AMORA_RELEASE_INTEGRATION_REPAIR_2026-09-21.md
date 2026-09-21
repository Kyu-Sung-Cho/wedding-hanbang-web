# 아모라 수정본 통합·재검증 — 2026-09-21

## 상태와 범위

이 문서는 운영 배포 완료 선언이 아니다. 이전 아모라 수정본을 최신 main과 합치고,
충돌·구버전 앱 호환성·DB 개인정보 경계·검증 누락을 수정한 로컬 결과다.
GitHub push/PR/merge, Vercel 배포, 운영 Supabase 변경, 새 프로젝트 생성, 유료 AI 호출은 하지 않았다.
2026-09-21 02:24 KST 최종 정상 환경의 전체 로컬 검증 관문은 **통과**했다.
운영 적용 실행기와 실환경 증거는 아직 남아 있으므로 운영 출시 완료를 뜻하지 않는다.
수정본은 아직 미커밋이며 신규 소스·SQL·후보 명세에 untracked 파일이 포함돼 있다.
브랜치의 HEAD만 전달하면 수정본 전체가 전달되지 않으므로 아래 작업 폴더와 변경 파일을 함께 인계해야 한다.

- 통합 기준 main: `969f6f5ab8c67d1e0f19025063a9c4fafd767efd`
- 작업 브랜치: `codex/amora-release-integration-20260920`
- 새 작업 위치: `C:/Users/kcho1/.codex/worktrees/amora-release-integration-20260920/wedding`
- 보존한 이전 작업: `C:/Users/kcho1/.codex/worktrees/claude-update-audit-20260919/wedding`
- 기존 운영 Supabase 목적지: `slrtobkksjmxgzatjyqb`. 이번 작업에서 원격 migration ledger는 조회·변경하지 않았다.

## 수정한 것

### 1. 최신 main과의 통합 및 DB 버전 충돌

기존 main의 준비 스타일 migration `20260920120000_wedding_preparation_style.sql`은 그대로 보존했다.
이전 작업의 미배포 Amora SQL 두 개는 새 작업본에서만 다음 이름으로 옮겼다.
원래 작업본은 그대로 남겼고, SQL 내용은 기존 수정본과 byte-identical임을 대조했다.

- 결정 기록: `20260921100000_amora_approved_decision_records.sql`
- 개인정보 확인 대상: `20260921101000_privacy_confirmation_targets.sql`

중복 version 테스트를 먼저 실패시킨 뒤 번호 충돌을 해소했다.
Git의 실제 병합 충돌 6개는 양쪽 테스트 의도를 보존하며 해소했다.
기존 236/237개 이력 테스트는 해당 시점의 해시 고정 fixture에서 검증한다.
현재 239개 checkout을 옛 운영 권한으로 통과시키는 방식으로 바꾸지 않았다.
원본 변경·신규 178개 파일의 통합 대조에서도 기능 변경 누락은 확인되지 않았다.

### 2. 구버전 앱 호환성과 계정 경계

검토한 구버전 TodayOne 구현은 화면 계정에 고정된 Bearer로 요청한다.
따라서 `expectedOwnerId` 속성이 **아예 없는** 요청에만 제한된 호환 경로를 열었다.
공통 Authorization parser와 실제 서버 인증 helper를 사용하며,
Supabase가 실제로 검증한 Bearer 계정으로만 실행한다.
명시 null/잘못된 owner/다른 owner, 쿠키-only 누락, malformed Authorization은 계속 거절한다.
인증 오류와 겉보기 user가 동시에 반환돼도 실행하지 않는다.

Profile, 기억의 네 가지 변경(`toggle`, `clear_scope`, `update_memory`, `delete_memory`),
커플 연결 해제는 예전 화면의 확인 대상을 서버가 추정하지 않는다.
누락/잘못된 형식/실제 대상 변경을 구분하고,
구버전 앱이 표시하는 오류 문구 자체에 앱 업데이트 또는
`https://hanbang.ai/settings` / `https://hanbang.ai/settings/amora-memory`에서
같은 계정으로 새로 확인하는 경로를 안내한다.
구버전 앱 배포 없이 모든 예전 클라이언트의 변경 기능이 그대로 동작한다는 뜻은 아니다.

최종 독립 검수에서 개별 기억 수정·삭제의 서버 계정 확인 누락을 추가로 발견했다.
같은 커플 B로 쿠키 로그인이 바뀌어도 A 화면의 target을 무시하고 B 권한으로 공유 기억을 변경할 수 있었다.
실제 PATCH route handler를 호출하되 인증과 DB RPC는 mock한 로컬 회귀 테스트 두 개에서
잘못된 200 응답 및 B 사용자 RPC 호출 인자를 확인한 뒤,
네 가지 변경 모두 화면 owner/couple 확인을 하도록 확장했다.
실제 브라우저의 로그인 전환이나 운영 DB 쓰기를 재현한 결과는 아니다.
진행 중이던 첫 전체 검사는 전용 프로세스만 중단하고 기록을 따로 보존했다.
이를 성공한 전체 검사로 집계하지 않는다.

이 수정은 개별 기억 행의 기존 UUID·커플·visibility·DB 권한 검사에 화면 계정 확인을 추가한 것이다.
개별 행에 새 revision/동시 편집 충돌 해결 계약을 도입한 것은 아니며,
범위 전체 변경의 DB 원자적 privacy epoch 확인과 구분한다.

### 3. 검증 fixture의 최신 개인정보 계약 반영

PGlite fixture가 2026-07-16의 오래된 기억 정리 함수만 사용하고 있었다.
실제 main의 2026-09-02 파트너 기억 보존 migration과
2026-09-05 채팅 화면 정리 시 privacy epoch 변경 migration을 반영했다.
각각 파트너/공유 기억 보존 및 오래된 확인 무효화 테스트가 먼저 실패하는 것을 확인한 뒤 수정했다.
이는 현재 main에 없던 데이터 삭제 버그를 새로 고쳤다는 주장이 아니라,
테스트가 실제 최신 보호 동작을 제대로 검증하게 만든 수정이다.

새 네이티브 PostgreSQL fixture에서도 실제 원문의 ACL·epoch RLS를 적용했다.
보안 함수를 성공으로 반환하는 mock으로 대체하지 않았다.

### 4. 새 릴리스 후보 명세와 운영 차단

`amora-decision-privacy-candidate-v1.json`은 기존 237개와 신규 2개 SQL을 고정한다.
`node scripts/supabase-release-fence.mjs --amora-decision-privacy`는 로컬 원문 검사만 한다.

- `productionApplyImplemented: false`
- `runtimeEvidenceVerified: false`
- `releaseAuthorized: false`

실제 PostgreSQL catalog 대조가 renamed claim 함수의 7/8인자 명세 오류를 잡았고,
7인자로 정정한 뒤 명세 해시를 다시 고정했다.
기존 운영 실행기, CI/QA 기본 fence, Vercel production build 승인 경로는 완화하지 않았다.
새 후보 flag를 운영 실행기에 넘기면 명령 실행 전에 거절한다.

## 검증

- 초기 API/UI/auth 회귀: 11 suites / 167 tests 통과.
- 추가 개별 기억 계정 경계 수정 후: 웹 3 suites / 63 tests, 관련 모바일 3 files / 44 tests 통과.
- 개인정보 PGlite 회귀: 8/8 통과.
- 최신 main 통합·배포 이력 관련 검사: 64/64 통과.
- 네이티브 PostgreSQL 17: 10/10 통과, skip 없음.
  - 기억 변경 ↔ 커플 해제 및 결정 저장 ↔ 커플 해제 양방향 실제 잠금 대기.
  - 저장 영수증 실패 시 결정과 영수증 함께 rollback, 동일 요청 재시도 1회 저장.
  - 상대방 기록 보존, 준비 방식 공유 철회, 타인 접근 거절.
  - 함수 8개 변경·6개 추가·삭제 없음, 나머지 관계/열/인덱스/제약/트리거/권한/RLS catalog 보존.
- 444개 고정 합성 문장에 대해 최신 main과 수정본의 안전/도구 범위 비교: 정의된 악화 사례 0.
  이 수치는 실제 모델 답변 품질·실사용 오탐률을 의미하지 않는다.
- 최종 코드 기준 신규 변이 가드: 10그룹·33개 모두 탐지. 개별 기억 수정 후 해당 5개를 다시 실행했다.
  로그에서 실제 동작/기대값 실패를 확인했고 원본 복원 해시를 검증했다.
- 추가 개별 기억 수정 후 웹 전체 타입 검사·린트 및 로컬 웹 빌드 재통과.
- 모바일 출시 준비 검사·타입 검사, 공유/디자인 토큰/적재 타입 검사 통과.
- iOS·Android·웹용 모바일 번들 생성 통과. 이후 변경은 웹 API·테스트 두 파일뿐이다.
- 최종 웹 전체: 1,118 files / 17,233 tests 통과.
- 최종 모바일 전체: 1,471 tests 통과 및 린트 통과.
- 최종 공유 코드 전체: 118 tests 통과.
- 적재 테스트: 858 통과, 4개 명시적 환경별 skip, 실패 없음.
  미실행은 Windows symlink 생성 권한(EPERM) 2개, 저장소에 포함하지 않는 실제 적재 원본 검증 1개,
  Windows.Media.Ocr 한국어 smoke 1개다. 이번 수정을 통과시키려고 추가한 skip이 아니다.
- 첫 최종 전체 관문: 앱 검사는 위와 같이 통과했으나 저장소 검사 970 통과 / 1개 파일 실패로 전체 판정은 실패.
  `account-deletion-customer-data-catalog.test.mjs`가 8.5초 후 파일 단위로 실패했고,
  기존 spec 출력에는 내부 오류·종료 신호가 남지 않았다. 이를 성공으로 재분류하지 않는다.
  동일 파일 단독 TAP 재실행은 2/2 통과, 전체 저장소 TAP 재검사는 972/972 통과(skip 없음).
  첫 실행은 정상 개별 테스트 두 개 대신 실패한 파일 하나로 집계되어 총수가 971이었다.
  실패 원인은 아직 확정하지 않았고, 테스트 삭제·skip·검증 기준 완화는 하지 않았다.
- 첫 최종 관문 전후 수정 소스 해시 변동 없음(`drift: []`).
- 01:27–01:55 KST 두 번째 전체 관문: 앱 검사 모두 재통과, 저장소는 899 통과 / 73 실패.
  담당 에이전트가 상세 로그를 위해 전역 `NODE_OPTIONS=--test-reporter=tap`을 주입한 검사 설정 오류였다.
  기존 운영 안전장치가 이 환경 변수를 금지하여 정상적으로 거절했다. 최초 native 파일의 두 사례는 이 실행에서 통과했다.
  제품 코드나 안전장치를 완화하지 않았고, 잘못된 audit wrapper를 비활성화하고 조기 환경 검사를 추가했다.
  실패 영수증은 `diagnostic-option-run/`에 보존했다. 이 실행도 성공한 통합 관문으로 집계하지 않는다.
- 01:56–02:24 KST 최종 정상 환경의 전체 관문: **통과(exit 0)**.
  웹 1,118 files / 17,233 tests, 모바일 1,471 tests, 공유 코드 118 tests,
  저장소 972 tests 통과. 적재는 858 통과 / 위에 명시한 4 skip / 실패 없음.
  타입 검사·웹/모바일 린트도 통과했고, 검사 전후 제품 소스 해시 변동은 없었다(`drift: []`).
  최초 native 파일 실패는 단독·전체 저장소 재실행과 마지막 통합 실행에서 재현되지 않았다.
  최초 종료 원인 자체를 고쳤다고 주장하지 않으며, 별도 원인 미확정 기록을 보존한다.
  최종 영수증: `.audit-output/release-integration-0921/full-gate/verification-receipt.json`.

로컬 증거 폴더: `.audit-output/release-integration-0921/`.
이전 가드는 테스트와 모든 mutation 대상의 실제 바이트 해시가 같은 50개만 재사용했다.
이전 실행 시각을 유지하며, 이를 이번 실행의 새 증명으로 표현하지 않는다.

## 아직 운영 완료가 아닌 이유

새 SQL은 기존 함수와 실행 권한을 변경한다. 따라서 단순 additive migration 경로를 재사용하거나
release fence를 풀어서 배포할 수 없다. 아래는 별도 운영 작업이다.

1. 새 변경 범위에 맞는 실제 production apply/rehearse/readback 실행기 및 증거 계약.
2. 실제 운영 목적지·원장 확인, 전역 웹/API/Auth/DB/Storage 쓰기 차단.
3. 기존 프로젝트의 DB·Storage 원본 백업과 격리된 복구 검증.
4. hosted 두 계정/RLS/동시성, 구버전·신버전 앱의 배포 순서와 복구 동작 확인.
5. 검토된 clean commit, 운영 적용·독립 readback, 쓰기 차단 해제/finalizer, hanbang.ai 확인.

로컬 synthetic PostgreSQL 검사는 전체 237개 migration replay, hosted Supabase Auth,
실기기, 실제 고객 트래픽, Production 검증을 대신하지 않는다.
개인정보 보호 권한을 원복하는 rollback 대신 보호 장치와 저장 데이터를 유지하는 호환 서버/전진 수정을 전제로 한다.

후속 구현 대안과 최소 증거 계약은 `docs/AMORA_239_RELEASE_REMAINING_PLAN_2026-09-21.md`에 정리했다.
237/239는 검토한 SQL 파일 수이지 이번에 확인한 운영 ledger 행 수가 아니다.
운영 프로젝트는 기존 것을 유지하며, 이 계획은 새 유료 프로젝트 생성이나 운영 DB 복원을 요구하지 않는다.
