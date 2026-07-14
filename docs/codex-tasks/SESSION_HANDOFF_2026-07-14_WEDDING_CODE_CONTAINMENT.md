# Wedding Code Containment Handoff — 2026-07-14

## 현재 상태

- 현재 Production 기준: PR `#40` (`hotfix/wedding-code-pg17-maintain-followup`)
- 현재 merge 및 Production source SHA: `d2eab99304c0d79fbbe6f20354074b229c9035cf`
- 현재 Vercel Production: `97F6fJLkAULPSpv9CVNGbbecvTpk`, `Current/Ready`, `hanbang.ai`
- PR `#39`는 최초 containment 배포 영수증이며 현재 Production이 아니다.
- 웨딩코드 웹 수집 경계와 운영 DB 쓰기 경계는 닫혔다.
- 문항과 결과 해석의 타당도는 검증 완료가 아니다. 별도 승인 없이 테스트나 수집을 다시 열지 않는다.
- 이 문서에는 비밀값, 환경변수 값, 행 본문, 로컬 암호화 키를 기록하지 않는다.

## 사고 전 관찰과 정정

핫픽스 전 `https://hanbang.ai/wedding-code`는 `v0.5-candidate.4` 수집 UI를 노출했고, 세 API는
안전한 무효 요청에 `410 Gone`이 아닌 `400 Bad Request`를 반환했다.

- `POST /api/wedding-code/response`
- `POST /api/wedding-code/pair`
- `GET /api/wedding-code/couple-report`

초기 대시보드 관찰에서는 `wedding_code_responses`와 관련 함수를 찾지 못했고 원격 migration
history의 마지막 항목이 `20260630233211 enable_booking_progress_realtime`로 보였다. 이 관찰을
“운영 테이블 부재”로 해석한 것은 잘못이었다.

권위 있는 후속 검증 결과, source commit
`ae6c0f5b06fb02d3db6e6b16a5ed808bb7dc31b3`의 원래 creator SQL은 Management API로 운영에
직접 적용됐다. `public.wedding_code_responses`에는 13개 행이 있었고 `service_role` table ACL과
`wc_responses_service_only` 정책이 존재했다. Management API 직접 SQL 적용은 저장소 migration
ledger에 기록되지 않았기 때문에 ledger가 뒤처져 있었다. ledger 부재는 schema 부재의 증거가 아니다.

## 백업 및 복구 증거

- Supabase 프로젝트는 Free Plan이 아니라 **Pro Plan**이며 Daily Backup이 활성화돼 있다.
- fence 전 확인한 최신 physical backup 시각: `2026-07-13 20:13:33 UTC`
- 암호화 logical backup 생성: `2026-07-14 15:51 KST`
- logical source SHA-256:
  `2D5F1E077CBC11B2993B92BA225E5E33DA1D577B510BF3CE91F4AC504FA04E71`
- encrypted artifact SHA-256:
  `A3973B3AF6E2FB8A2E2DAE283EB4E41D42EA0DFC18F186A3E167B59DE3C1B485`
- 격리 복구 검증: 13개 행, 13개 distinct ID, content digest
  `2743544526a9db04c7b8ed1c83754b5c` 일치

암호화 artifact는 Git에 올리지 않았다. Windows DPAPI `CurrentUser`로 보호돼 **생성한 컴퓨터의
같은 사용자 프로필에 종속**된다. 다른 컴퓨터나 다른 Windows 프로필에서는 복구 수단으로 간주하지
말고, Pro physical backup 또는 승인된 새 logical export를 사용한다. 행 본문이나 키를 이 문서나
GitHub에 복사하지 않는다.

## 운영 DB targeted fence 영수증

운영에는 전체 migration chain이나 저장소의 raw migration 파일을 실행하지 않았다.
`supabase/migrations/20260714104000_disable_wedding_code_collection.sql`의 retirement contract를
기반으로, production prestate count·min/max·digest gate, dependency gate, lock, owner write probe와
postcheck를 추가한 **별도 standalone targeted transaction**을 SQL Editor에서 적용했다. 실행 artifact는
Git 밖의 로컬 전용 경로
`C:\Users\kcho1\Documents\WeddingHanbang-Private-Backups\wedding-code\20260714-155146\targeted_fence.sql`에
보관한다. 이 artifact와 현재 저장소 migration 파일은 같은 파일이 아니며 서로의 hash로 대체하거나
raw migration 재실행을 운영 복구 절차로 간주하면 안 된다.

- 운영에 적용한 SQL artifact SHA-256:
  `9F9C36B62A05AAE9D9552B37C67294CA7FC160DAD101F055FDA8FEE098B26D88`
- postcheck receipt SHA-256:
  `FC81B55C2FF3491E80845516BA0C9383781632F5926B4B3D7DE48FA0C635FEF8`
- `wedding_code_collection_retired CHECK (false) NOT VALID`: 1개
- matching named public routines: 0
- table triggers: 0
- dependent views: 0
- publication membership: 0
- runtime-role table privileges: 0
  (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` 포함)
- non-owner table ACL entries: 0
- non-owner column ACL entries: 0
- policies: 0
- named insert/pair RPC overloads: 0
- 보존 결과: 13개 행, 13개 distinct ID, digest
  `2743544526a9db04c7b8ed1c83754b5c` 불변

백업·무결성 검증 과정에서 행 본문을 문서나 GitHub에 노출하지 않았고, 운영 행은 수정·삭제하지
않았다. 운영 migration ledger는 실제 과거 적용 이력과 맞지 않지만, 이번 대응에서 **의도적으로
repair/mark하지 않았다**. 별도 검토와 승인 전에는
`supabase db push`, 전체 migration push, ledger repair/mark를 실행하지 않는다.

위 SQL SHA-256은 운영에 실제 적용한 artifact의 영수증이다. 이후 저장소에서 역사 주석을 바로잡으면
파일의 raw hash는 달라질 수 있으므로 현재 파일 hash와 억지로 맞추지 않는다. 실행 SQL 변경은 별도
review 대상으로 취급한다.

## 웹 merge, 배포 및 rollback 영수증

### 현재 Production — PR #40

- PR #40 검토 HEAD: `65b0563b7ce8e63ceb37afcaa6d0726702a46b40`
- merge 및 Production source SHA: `d2eab99304c0d79fbbe6f20354074b229c9035cf`
- Production deployment: `97F6fJLkAULPSpv9CVNGbbecvTpk`, `Current/Ready`
- immutable URL: `https://wedding-hanbang-h1gg9guts-hanbang.vercel.app`
- Production alias: `hanbang.ai`
- merge CI `29314941052` 통과
- 안내 `200`, legacy `ct` 제거와 result `307`, 세 API `410` + `no-store` apex canary 통과
- PR #40은 운영 DB와 migration ledger를 변경하지 않았다.

### 역사적 최초 containment — PR #39

- PR #39 검토 HEAD: `ed5e09707771b208a377d67be6e538ce0ad0e839`
- exact-HEAD Preview deployment: `8X6c6ERcc4nMAwsrGXY8QKUV7WyV`, `Ready`
- merge 및 Production source SHA: `5eed1c370e24808e4caa81a3395b3128cfb864f8`
- Production deployment: `59RjXEzenfmqLuKs8922fgw4mtXK` (현재 Production의 바로 이전 기록)
- immutable URL: `https://wedding-hanbang-rezz8r5vl-hanbang.vercel.app`
- Production alias: `hanbang.ai`
- 역사적 PR #39 이전 rollback baseline deployment: `U4tSiF85BfeFVMnoG7Kq5rSAqjvY`
- rollback baseline source SHA: `8d8933e18a973dbc74ce097c46fca0de0d08cda5`

Vercel은 `main` push를 자동으로 Production에 배포하고 custom domain을 자동 할당한다. 이후 변경도
merge 전에 exact-SHA Preview, CI, rollback 기준을 고정해야 한다. 동일 SHA라도 deployment ID가
다르면 같은 아티팩트로 간주하지 않는다.

## 닫힌 웹 경계

- `/wedding-code`는 입력·제출 기능 없이 “정식 검증 준비 중” 안내만 표시한다.
- `/wedding-code/result`는 React rendering 전에 `/wedding-code`로 `307` redirect한다.
- 세 API는 요청 본문, 쿼리, Supabase client를 읽거나 만들기 전에 `410 Gone`과
  `Cache-Control: no-store`를 반환한다.
- 과거 초대 URL의 `ct` capability token은 rendering·analytics 전에 제거한다.
- 관련 페이지의 `noindex`를 유지한다.
- 기존 13개 행의 보유·삭제 결정은 별도 법적·사업적 승인 대상으로 남겨 두고 이번 작업에서는
  삭제하지 않았다.

## 검증 증거

- 웹 테스트 52개 파일, 397개 테스트 통과
- 웹 ESLint, `tsc --noEmit`, 환경변수 없는 Next.js Production build 통과
- 로컬 Production HTTP: 안내 `200`, 초대 토큰 제거 `307`, 결과 `307`, 세 API `410` +
  `no-store`, 비허용 method `405`
- Chromium 1280px, 390px, 320px 검증. 320px에서 가로 overflow 없음, CTA 높이 48px
- 실제 PostgreSQL(PGlite)에서 table-absent, pending chain, legacy open-surface 세 시나리오 통과
- 운영 DB targeted postcheck에서 위 권한·policy·routine·trigger·view·publication 경계가 0이고,
  13개 행과 digest가 보존됨을 재확인

## 다른 컴퓨터에서 이어갈 때

1. `origin/main`을 fetch하고 HEAD가 현재 containment 기준
   `d2eab99304c0d79fbbe6f20354074b229c9035cf` 이상인지 먼저 확인한다.
2. 이 문서를 운영 source of truth로 사용한다. `docs/wedding-code`의 RETIRED 실행 문서를 따라 모집,
   Production 링크 배포, 수집 SQL 실행을 하지 않는다.
3. `supabase db push`, 전체 migration push, migration ledger repair/mark를 실행하지 않는다.
4. DPAPI logical backup은 원래 컴퓨터·사용자 프로필 밖에서 해독 가능하다고 가정하지 않는다.
5. 원격 작업이 새로 필요하면 row 내용 없이 read-only precheck로 fence·13/13·digest를 다시 증명하고,
   별도 백업·rollback·승인을 먼저 확보한다.
6. 질문 근거 검토, 인지면접, 전문가 검토와 타당도 연구가 끝날 때까지 웹/API/DB 수집을 다시 열지
   않는다.

## 남은 결정

- 13개 기존 응답의 보유 기간과 삭제 여부는 법적·사업적 결정이 필요하다.
- WeddingCode 문항과 결과 해석은 심리측정 또는 완전한 성향검사로 검증되지 않았다.
- 비공개 저장소의 branch protection 강제 여부는 저장소 플랜과 공개 여부에 관한 별도 결정이다.
- migration ledger와 실제 운영 schema의 차이는 별도 baseline/reconciliation 계획으로 해결해야 하며,
  이 containment 대응이 전체 DB migration 승인을 의미하지 않는다.
