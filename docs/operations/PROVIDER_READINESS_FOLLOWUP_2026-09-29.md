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
실제 실행 결과는 통과한 commit과 CI run으로 별도 기록해야 한다.

## 아직 끝나지 않은 일

1. 현재 운영에 읽기 전용 재접속하여 정확한 기존 삭제 함수·제약·권한과 migration 이력 차이를 확인.
2. 그 관찰에 맞는 제공자 production apply controller, 전역 write fence·백업·복원·실패 복구 증거 연결.
3. 빈 hosted 환경의 Next HTTP·브라우저·사진 공개 철회 및 35분 대기 삭제 worker 검증.
4. 같은 후보의 필수 CI, DB·Storage 적용 사후 검사, 웹 배포 및 실서비스 확인.

이번 세션에는 Supabase/Vercel connector와 Management API 토큰이 없으며 이 PC에 Docker도 없다.
이전 원격 관찰을 새 관찰로 재사용하지 않는다. 로컬 엔지니어링과 CI 준비는 계속할 수 있으나
운영 기준선 확정과 hosted 검증에는 해당 환경 연결이 필요하다.
