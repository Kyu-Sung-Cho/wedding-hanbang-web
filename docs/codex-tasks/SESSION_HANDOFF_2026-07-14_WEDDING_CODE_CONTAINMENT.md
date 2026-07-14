# Wedding Code Containment Handoff — 2026-07-14

## 상태

- 작업 브랜치: `hotfix/disable-wedding-code-collection`
- 기준 커밋: `8d8933e18a973dbc74ce097c46fca0de0d08cda5`
- 이 문서 작성 시점에 핫픽스는 운영에 배포되지 않았다.
- 이 문서에는 비밀값이나 실제 환경변수 값을 기록하지 않는다.

## 2026-07-14 운영 관찰

`https://hanbang.ai/wedding-code`를 읽기 전용으로 확인했을 때 운영 번들은
`v0.5-candidate.4`를 표시했고, 기존 3분 테스트와 응답 수집 동의 UI가 노출되고 있었다.

유효한 응답 데이터는 전송하지 않았다. 안전한 무효 요청으로 경계를 확인한 결과 다음 운영 API는
`410 Gone`이 아니라 기존 `400 Bad Request`를 반환했다.

- `POST /api/wedding-code/response`
- `POST /api/wedding-code/pair`
- `GET /api/wedding-code/couple-report`

따라서 당시 운영은 웨딩코드 수집 경계가 닫힌 상태로 볼 수 없었다.

## 이 핫픽스가 닫는 경계

- `/wedding-code`를 입력이나 제출 기능이 없는 "정식 검증 준비 중" 안내 화면으로 교체한다.
- 안내 화면은 현재 답변을 받거나 저장하지 않는다고 명시하고 `/wedding` 복귀 링크를 제공한다.
- `/wedding-code`와 결과 페이지의 `noindex`를 유지한다.
- `/wedding-code/result` 직접 접근은 Next 설정 단계에서 `/wedding-code`로 `307 Temporary Redirect`한다.
- 위 3개 API는 요청 본문, 쿼리, Supabase 클라이언트를 읽거나 만들기 전에 `410 Gone`과
  `Cache-Control: no-store`를 반환한다.
- 기존 수집 데이터의 보유 또는 삭제에 관한 약속은 화면에 추가하지 않았다.

## 검증 증거

- 웨딩코드 집중 회귀 테스트: 6개 파일, 8개 테스트 통과(전체 웹 테스트 실행에 포함)
- 웹 전체 테스트: 48개 파일, 365개 테스트 통과
- 변경 파일 ESLint 통과
- 웹 전체 `tsc --noEmit` 통과
- Next.js 프로덕션 빌드 통과: 100개 정적 페이지 생성, 결과 경로는 동적 fallback으로 유지
- API 회귀 테스트는 읽는 순간 실패하는 요청 객체와 Supabase 생성 스파이를 사용해 요청·DB 미접촉을 검증한다.
- 로컬 프로덕션 HTTP 검증에서 결과 경로 `307`, 세 API `410`과 `no-store`, 비허용 메서드 `405`를 확인했다.

## 아직 해결되지 않은 항목

- 과거 immutable Vercel deployment URL은 새 production alias 배포와 별개로 이전 코드를 계속 제공할 수 있다.
  해당 URL의 접근 가능성과 차단 또는 잔여 위험 수용 여부를 별도로 확인해야 한다.
- 라우트 수준의 `410`은 데이터베이스 write fence가 아니다. `service_role`을 포함한 DB 권한·ACL과
  직접 쓰기 경로가 실제로 닫혔는지 운영 데이터베이스에서 검증해야 한다.
- 기존에 수집된 웨딩코드 데이터의 보유·삭제는 아직 결정하거나 실행하지 않았다. 법적·사업적 결정,
  백업, 복구 방법과 검증된 실행 계획이 먼저 필요하다.
- 질문 문항과 결과 해석의 타당도는 검증 완료 상태가 아니다. 근거 검토와 사용자 연구 없이 테스트를 다시 열지 않는다.
- trusted release controller와 배포 권한 경계가 검증되지 않았다. 승인된 주체가 검증된 경로로 exact SHA를
  배포했다는 증거가 필요하다.

## 운영 해결 완료 조건

다음이 모두 확인되기 전에는 이 문제를 운영에서 해결 완료로 보고하지 않는다.

1. 핫픽스를 커밋하고 배포 대상 exact SHA를 기록한다.
2. 신뢰된 release controller가 그 exact SHA를 production에 배포했음을 확인한다.
3. 운영 카나리에서 안내 화면, 결과 리다이렉트, 3개 API의 `410`과 `no-store`를 확인한다.
4. 운영 로그와 데이터베이스 관찰로 웨딩코드 쓰기가 발생하지 않음을 확인한다.
5. 과거 immutable Vercel URL과 DB `service_role` ACL/write fence의 잔여 위험을 별도로 처리한다.
