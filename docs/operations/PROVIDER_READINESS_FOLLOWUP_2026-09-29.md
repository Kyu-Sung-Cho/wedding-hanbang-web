# 제공자 배포 선행 작업 진행 기록

운영 배포는 아직 보류다. 이번 보완은 이전 감사의 두 구멍인 정적 계약 미등록과 실행되지 않은
Auth·Storage 검증을 해결하기 위한 코드다. 운영 DB 적용·복원·웹 배포 성공 기록이 아니다.

## 수정한 검사

- 공용 production 빌드 검사가 제공자 243개 SQL 계약을 인식한다. 기존 240개 계약의
  exact-directory 검사를 약화하지 않고, 14개 선행 후속 변경과 제공자 3개만 검증한다.
- 새 `PROVIDER_RELEASE_OPERATIONS_NOT_READY` 검사는 제공자 운영 컨트롤러·runtime 증거·
  릴리스 인가가 없는 빌드를 막는다. 과거 벤더 릴리스 유예나 기존 환경변수 서명으로 열리지 않는다.
  새 버킷이 없는 DB에 웹을 먼저 올려 기존 사용자 탈퇴가 재시도에 머무는 위험을 배포 단계에서 차단한다.
- 일반 계정삭제의 provider inventory/최종 Storage 검사는 유지한다. DB 조회 실패를 무시하고
  Auth 사용자를 삭제하지 않는다. DB가 준비되기 전 이 앱을 운영에 올릴 수 있다는 의미도 아니다.

## 운영 읽기 전용 검사

```powershell
corepack pnpm supabase:provider:inspect
```

이 명령은 환경에 주입된 `SUPABASE_ACCESS_TOKEN`만 사용한다. 토큰을 인자나 문서·채팅에 넣지 않는다.
저장소의 고정 project ref와 system identifier를 검증한다. 임의 URL·SQL·apply·ledger repair 인자는 없다.
자격증명이 없으면 원격 호출 전에 중단한다.

Management API에 `read_only: true`와 `BEGIN TRANSACTION READ ONLY`를 함께 사용한다.
응답 크기·timeout·redirect·관찰 신선도를 제한하고 오류 원문과 인증정보를 출력하지 않는다.
테이블·함수·ACL·Storage 정책·버킷·제공자 ledger를 검토된 정확한 catalog와 대조한다.
기존 Storage metadata는 DB 내부 digest만 관찰하며 사진 bytes나 고객 행을 가져오지 않는다.

출력의 `schemaState`는 `absent-reviewed-baseline`, `installed-exact`, `partial-or-drifted` 중 하나다.
기존 migration version 차이는 별도 진단 목록이다. 229/243개처럼 개수가 다르다는 이유로
옛 SQL을 자동 적용하거나 실제 schema가 동등하다고 판정하지 않는다.
`schemaReady=true`여도 `releaseAuthorized=false`이며, 운영 적용 절차가 완성되기 전 종료 코드는 2다.
접속·신원·권한·입력 검증 실패는 종료 코드 1이다.

API 계약 근거: [Supabase Run a query](https://supabase.com/docs/reference/api/v1-run-a-query).

## 실제 서비스 검증 경로

빈 Docker Supabase 스택을 매번 생성하는 runner와 별도 CI를 추가했다.
세 합성 계정의 실제 로그인·RPC·사진 업로드/다운로드/삭제·권한 회수·Auth 삭제를 실행하고 정리한다.
설정과 안전 경계는 [로컬 SDK 검증 문서](../PROVIDER_LOCAL_SDK_QA_2026-09-29.md)에 있다.
`b69d8413845478fb8a30ac669eadf66a1a2ceb0c`의
[Provider Integration 36538633277](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/36538633277)이 통과했다.
실제 Auth 로그인·승인 후 소개 수정·버전 충돌·WebP bytes 왕복·공개 철회·정리 worker 실패 재시도와
Auth 삭제를 확인했고, 합성 리소스 정리와 임시 스택 종료도 성공했다.
Next HTTP·브라우저·계정삭제 worker 전체·실제 35분 대기는 이 결과의 범위가 아니다.

최초 CI의 패키지 설치 서명 키 문제, SQL 한 파일의 혼합 줄바꿈 해시 차이,
기존 release fence 테스트 fixture의 신규 모듈 복사 누락을 수정했다.
수정 후 계약·native PG17 검사 11개, 준비 검사·SDK 안전장치·release fence 검사 30개가 통과했다.
pre-push의 모노레포 typecheck·lint·test 9개 작업도 성공했다.
같은 코드 commit의 [전체 CI 36538633364](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/36538633364)도
성공했다. 웹 빌드·품질, 웹 테스트 네 shard, 모바일, 저장소, 정적 release 계약과 최종 Code Quality가 모두 통과했다.
운영 준비 잡은 PR에서 실행하지 않는 구조이며, 코드 CI 성공은 운영 릴리스 인가가 아니다.

## 운영 기준선 재확인

2026-09-29 16:07 KST에 로컬 Supabase CLI 2.106.0의 기존 로그인과 원래 checkout의
고정 project ref를 이용해 같은 생성 SQL을 다시 실행했다. 새 CLI 버전 설치나 `link` 변경은 하지 않았다.
관찰 시각은 `2026-09-29T07:07:18.453657+00:00`, system identifier는
`7581440907192989109`, SQL 실행 사용자는 `postgres`, transaction read-only는 true였다.

- `schemaState=absent-reviewed-baseline`, 변경 대상의 before catalog 차이 0개.
  기존 삭제 manifest 함수 원문·인자·ACL와 세 CHECK 제약이 검토된 선행 상태와 일치했다.
- 제공자 테이블·RPC·private schema·버킷·restrictive 정책은 아직 없고 제공자 ledger도 비어 있었다.
- 전체 ledger 229개, 로컬에만 있는 version 15개, 원격에만 있는 version 1개는 이전 감사와 같았다.
  이력 차이가 전체 schema 동등성까지 설명됐다는 의미는 아니다.
- 실제 Storage 정책 관리 권한 검사를 통과했다. 운영 적용·hosted rollback은 실행하지 않았다.

검사 SQL SHA-256: `25b77c984ac8f9f6e80d9020254d3fd9a7e56ccec9ce90b299dc18ab20f29058`.
원문 관찰은 저장소 밖 임시 증거 디렉터리에 보관했으며 Git에는 넣지 않았다.
이 관찰은 120초 신선도 안에서 검증했고 적용 직전에 새로 수집해야 한다.
CLI가 관리하는 로그인 역할 초기화와 읽기 전용 제품 SQL 실행을 구분한다.
고객 행·사진 bytes 열람, 제품 DDL/DML, migration ledger 보정은 하지 않았다.

## 아직 끝나지 않은 일

1. 확인된 before catalog를 기준으로 제공자 production apply controller에 대상·비대상 보존 검사를 연결.
2. 전역 write fence·백업·복원·실패 복구 증거를 확보하고 적용 직전 기준선을 다시 검사.
3. 빈 hosted 환경의 Next HTTP·브라우저·사진 공개 철회 및 35분 대기 삭제 worker 검증.
4. 같은 후보의 필수 CI, DB·Storage 적용 사후 검사, 웹 배포 및 실서비스 확인.

다음 코드 연결 지점은 `scripts/lib/supabase-production-release-controller.mjs`의
`runProductionRelease`다. 현재 진입점에 제공자 운영 적용 분기는 없다.
새 분기는 정확한 commit·배포 대상·새 외부 증거를 검증한 뒤에만 열어야 한다.
기존 `profile-avatar` 경로의 영수증 기록·결과 불명확 시 재시도 금지 방식은 참고할 수 있지만,
과거 아바타 릴리스 인가나 이미 만료된 관찰을 새 제공자 릴리스 인가로 사용할 수는 없다.

제공자 원문 핀·대상 catalog·ledger 원문 비교는 이미 `provider-participation-release-contract.mjs`,
`provider-participation-catalog.mjs`, `providerBundleParts`/`expectedProviderLedger`에 있다.
운영 적용에서는 새로 관찰한 기존 ledger와 비대상 digest를 보존하면서 제공자 세 항목만 더해야 한다.
로컬 예행의 240→243개 수나 `buildProviderLocalBundle`의 loopback 전용 검사를 운영용으로 바꾸지 않는다.
전역 fence·DB와 파일 백업/복원·hosted 검증 증거가 연결되기 전까지 production 빌드 차단을 유지한다.

이번 세션에는 Supabase/Vercel connector와 환경변수의 Management API 토큰이 없었지만,
CLI의 기존 로그인을 확인하여 위 운영 읽기 검사는 완료했다. 이 PC에 Docker는 없으므로 실제
SDK 검사는 CI runner에서 실행한다. Next HTTP 검증에 사용할 빈 hosted 환경은 아직 정해지지 않았다.
