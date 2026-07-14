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

### Supabase 읽기 전용 확인

Supabase 대시보드에서 프로젝트 `slrtobkksjmxgzatjyqb`를 읽기 전용으로 확인했다. SQL은 실행하지
않았고 설정도 변경하지 않았다.

- 원격 migration history의 마지막 항목은
  `20260630233211 enable_booking_progress_realtime`였다.
- `public` 테이블 목록에 `wedding_code_responses`가 없었다.
- `wedding_code`로 검색한 `public` 함수도 없었다.
- 프로젝트는 Free Plan이라 Supabase 관리형 백업을 제공받지 않는다.

즉 현재 운영 DB에는 알려진 웨딩코드 저장 테이블과 관련 RPC가 아직 생성되지 않았다. 따라서 기존
웹 화면과 API가 열려 있어도 현재 확인한 저장 경로에는 목적지가 없다. 기준 `main`의 원래
2026-07 creator는 저장 테이블과 `service_role` 권한을 만들도록 작성돼 있었기 때문에, 수정 전 상태로
일반적인 전체 `db push`를 실행하면 이 안전 경계가 다시 열릴 수 있었다. 이 사고 대응 중에는 전체
migration push를 실행하지 않는다.

핫픽스는 아직 운영에 적용되지 않은 `20260705160000` creator도 수정해 테이블 생성과 같은 migration
transaction 안에서 모든 application role 권한을 회수하고 `CHECK (false) NOT VALID`를 설치한다.
따라서 향후 전체 chain을 적용할 때 creator와 후행 retirement migration 사이에 `service_role` 쓰기가
열리는 migration 간격도 남기지 않는다. 이미 creator가 적용된 다른 환경은 `20260714104000` 후행
retirement migration이 모든 ACL·policy·RPC를 회수하고 같은 제약을 다시 검증한다.

### Vercel 배포 및 복구 기준

Vercel 대시보드에서 현재 `hanbang.ai`에 연결된 Production 배포를 읽기 전용으로 확인했다.

- deployment id: `U4tSiF85BfeFVMnoG7Kq5rSAqjvY`
- immutable URL: `https://wedding-hanbang-me2k784f2-hanbang.vercel.app`
- source commit: `8d8933e18a973dbc74ce097c46fca0de0d08cda5`
- source branch: `main`
- domains: `hanbang.ai`, main-branch URL, immutable deployment URL

현재 Vercel 설정은 `main` push가 Production 배포를 만들고, 새 Production 배포에 custom domain을
자동 할당한다. 따라서 PR merge는 곧 운영 변경이며 Preview와 정확한 HEAD SHA 검증 전에 실행하면
안 된다. 위 기존 배포의 `Redeploy` 경로는 확인했지만 실제 복구 동작은 실행하지 않았다.

익명 HTTP HEAD로 현재 immutable Production URL, 바로 이전 Production URL, 과거 WeddingCode Preview,
실패한 핫픽스 Preview를 확인했다. 네 URL 모두 앱 본문을 제공하지 않고 Vercel SSO로 `302` 전환했으며
`X-Robots-Tag: noindex`를 반환했다. 따라서 확인한 과거 deployment URL은 일반 소비자에게 열려 있지
않다. Vercel에 인증된 승인 계정은 접근할 수 있으므로 오래된 아티팩트 자체가 삭제됐다고 해석하면
안 된다.

저장소는 GitHub 비공개 저장소이며 현재 플랜에서는 branch protection/rules API가 `403`과 함께
GitHub Pro 또는 공개 저장소가 필요하다고 응답했다. 따라서 GitHub가 required check나 review를
강제한다고 가정하면 안 된다. 이번 핫픽스는 merge 직전에 PR HEAD를 다시 읽고, 동일 SHA의 CI와
Vercel Preview 성공을 수동으로 확인한 뒤 `--match-head-commit`으로만 merge한다.

첫 핫픽스 Preview는 Supabase 변수가 Production에만 있고 Preview에는 없는 상태에서 관리자 seed
route가 module import 시 service client를 생성해 빌드에 실패했다. 운영 비밀값을 Preview로 복사하지
않고, 요청 인증·seed gate 통과 뒤에만 service client를 만들도록 수정했다. 같은 무설정 빌드에서
발견한 세 커뮤니티 내 활동 페이지도 render-time client 생성을 제거하고 명시적인 안전 안내를
표시하도록 수정했다.

## 이 핫픽스가 닫는 경계

- `/wedding-code`를 입력이나 제출 기능이 없는 "정식 검증 준비 중" 안내 화면으로 교체한다.
- 안내 화면은 현재 답변을 받거나 저장하지 않는다고 명시하고 `/wedding` 복귀 링크를 제공한다.
- `/wedding-code`와 결과 페이지의 `noindex`를 유지한다.
- `/wedding-code/result` 직접 접근은 React streaming과 Next 설정 redirect보다 앞선 proxy 단계에서
  `/wedding-code`로 `307 Temporary Redirect`한다.
- 위 3개 API는 요청 본문, 쿼리, Supabase 클라이언트를 읽거나 만들기 전에 `410 Gone`과
  `Cache-Control: no-store`를 반환한다.
- 기존 초대 URL의 `ct` capability token은 페이지를 렌더하거나 analytics가 실행되기 전에 query가 없는
  `/wedding-code`로 redirect해 브라우저 주소와 분석 이벤트에서 제거한다.
- 기존 수집 데이터의 보유 또는 삭제에 관한 약속은 화면에 추가하지 않았다.

## 검증 증거

- 웹 전체 테스트: 52개 파일, 397개 테스트 통과
- 웹 전체 ESLint 통과
- 웹 전체 `tsc --noEmit` 통과
- Supabase URL·anon key·service-role 변수가 모두 없고 `.env.local`도 없는 Preview 조건에서 Next.js
  프로덕션 빌드 통과: 정적 페이지 100개 생성, 안내 화면은 정적 제공하고 결과·토큰 redirect는
  proxy가 React rendering 전에 처리
- API 회귀 테스트는 읽는 순간 실패하는 요청 객체와 Supabase 생성 스파이를 사용해 요청·DB 미접촉을 검증한다.
- 로컬 프로덕션 HTTP 검증에서 안내 `200`, 초대 토큰 제거 `307`, 결과 경로 `307`, 세 API `410`과
  `no-store`, 비허용 메서드 `405`를 확인했다. redirect 응답과 본문에는 테스트 토큰이 남지 않았고
  안전한 `utm_source`만 보존됐다.
- 실제 Chromium으로 1280px desktop, 390px mobile, 320px 최소 폭을 확인했다. 320px에서
  `innerWidth`와 `scrollWidth`가 모두 320px였고 CTA는 48px 높이로 가로 overflow 없이 표시됐다.
- PGlite의 실제 PostgreSQL 엔진에서 세 DB 시나리오를 실행했다: 운영과 같은 table-absent 상태, 전체
  pending creator/token/retirement chain, 기존 행·열린 ACL·policy·RPC overload가 있는 과거 상태.
  세 시나리오 모두 통과했고 기존 행은 보존됐으며 application role 접근, owner INSERT/UPDATE,
  insert/pair RPC overload가 모두 차단됐다.

## 아직 해결되지 않은 항목

- 확인한 과거 immutable Vercel deployment URL은 익명 사용자에게 Vercel SSO로 차단된다. 다만 승인된
  Vercel 계정은 오래된 아티팩트에 접근할 수 있으므로 운영 권한자에게도 이전 수집 UI를 사용하지
  않는다는 경계와 DB retirement fence가 필요하다.
- 현재 운영 DB에는 웨딩코드 테이블과 관련 함수가 없지만, 저장소의 대기 중인 2026-07 migration은
  테이블과 `service_role` 권한을 만들 수 있다. 향후 전체 migration chain이 적용돼도 수집 경계가
  닫히도록 후행 retirement migration과 회귀 계약을 함께 유지해야 한다.
- 기존에 수집된 웨딩코드 데이터의 보유·삭제는 아직 결정하거나 실행하지 않았다. 법적·사업적 결정,
  백업, 복구 방법과 검증된 실행 계획이 먼저 필요하다. 현재 프로젝트에는 Supabase 관리형 백업이 없다.
- 질문 문항과 결과 해석의 타당도는 검증 완료 상태가 아니다. 근거 검토와 사용자 연구 없이 테스트를 다시 열지 않는다.
- Vercel은 현재 `main`을 자동 Production 배포하고 custom domain도 자동 할당한다. exact SHA Preview,
  GitHub 필수 체크, 운영 롤백 기준, 배포 직후 카나리를 merge 전에 모두 고정해야 한다.
- 현재 비공개 저장소 플랜에는 branch protection 강제가 없다. 보호 기능을 사용하려면 유료 플랜 또는
  저장소 공개 여부에 관한 별도 사업·보안 결정을 해야 한다.

## 운영 해결 완료 조건

다음이 모두 확인되기 전에는 이 문제를 운영에서 해결 완료로 보고하지 않는다.

1. 핫픽스를 커밋하고 배포 대상 exact SHA를 기록한다.
2. GitHub CI와 Vercel Preview가 같은 exact SHA에서 통과한 뒤에만 merge한다. 현재 branch protection이
   없으므로 이를 수동 fail-closed gate로 취급한다.
3. merge 직전에도 `main` 자동 배포와 custom domain 자동 할당 설정이 바뀌지 않았는지 다시 확인한다.
4. Production 배포의 source SHA와 `hanbang.ai` alias가 의도한 merge SHA인지 확인한다.
5. 운영 카나리에서 안내 화면, 결과 리다이렉트, 3개 API의 `410`과 `no-store`를 확인한다.
6. 운영 로그와 데이터베이스 관찰로 웨딩코드 쓰기가 발생하지 않음을 확인한다.
7. 과거 immutable Vercel URL의 익명 SSO 차단을 재확인하고, 향후 migration이 만들 수 있는 DB 쓰기
   경계도 retirement migration으로 닫는다.
