# 웨딩한방 저장소 작업 규칙

## 최상위 원칙

- 모든 제품 판단은 `PRINCIPLES.md`의 여섯 원칙을 따른다. P6의 법령·보안·운영
  조건은 다른 원칙과 교환할 수 없는 출시 게이트다. 그 조건을 통과한 선택지끼리는
  P1 > P3 > P2 > P4 > P5 순서로 판단한다.
- 시각·UI 판단 전에는 `DESIGN.md`를 읽는다.
- AI 호출은 `ai_interactions_log`, 커플의 확정 의사결정은 `decision_nodes`에
  기록한다. 모델의 문장만으로 저장 성공을 간주하지 않는다.
- 테스트, 빌드, DB 적용, 배포, 백업, 복구는 실제 증거가 있을 때만 완료로
  보고한다.
- 날짜가 오래된 문서는 역사적 증거일 수 있다. 상단 상태 문구와 아래의 현재 기준
  문서를 먼저 확인한다.

## 프로젝트 개요

현재 모바일 우선 MVP에서 웨딩한방은 결혼 준비의 고민을 아모라와 처음부터 끝까지
이야기하고, 비슷한 시기에 준비하는 사람들의 기록을 함께 보며, 확인한 것만 예산·체크리스트·일정에 남기고 바뀐 내용을 서로에게 알리는 서비스다. 모바일 앱이 소비자의 주 제품이고,
웹은 유입·설명·정책·고객지원·관리자 운영과 데스크톱 연속성을 담당한다. 아모라가
제품의 중심이고, 커뮤니티는 실제 경험을 찾고 질문하는 보조 축이다(2026-11-16 아예 닫기로
결정했고 닫는 작업은 따로 한다). 아모라는 먼저 일하는 proactive AI 웨딩 비서이고(2026-11-16),
정본 호칭은 **AI 웨딩 비서**이며 "플래너"·"파트너"로 부르지 않는다. 관계·지식·선제
케어·조건 공유는 별도 축이 아니라 다섯 흐름 안의 층이다. 업체·예약·축의금은
장기 범위에는 남아 있지만 핵심 흐름보다 먼저 전면 확장하지 않는다. 현재 제품 방향은
`docs/PRODUCT_CONTRACT_PARTNER_2026-08-08.md`
(`docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`를 승계), 앱 출시 완료 기준은
`docs/MOBILE_PRODUCT_COMPLETION_STANDARD_2026-08-03.md`를 따른다.

현재 저장소는 모노레포다.

주요 실행 경계는 `apps/web`, `apps/mobile`, `packages/shared`다.

```text
<repo-root>/
├── apps/
│   ├── web/                 Next.js 16 웹·API·Vercel 배포 대상
│   └── mobile/              Expo/React Native·EAS 빌드 대상
├── packages/
│   ├── shared/              웹·모바일 공유 로직과 타입
│   └── design-tokens/       공통 디자인 토큰
├── supabase/
│   ├── migrations/          순서가 고정된 DB 마이그레이션
│   ├── platform-operations/ Dashboard에서 별도로 수행하는 운영 작업
│   ├── release-checks/      read-only 사후 검증
│   └── release-manifests/   파일 hash와 릴리스 순서를 고정하는 manifest
├── scripts/                 QA·백업·복구·릴리스 컨트롤러
├── docs/                    제품·연구·운영 문서와 검증 증거
├── DESIGN.md
└── PRINCIPLES.md
```

## 현재 기준 문서

- **새 컴퓨터·새 LLM의 모델 중립 진입점**(현재 배포 판정 · source 확인 · 금지 작업 ·
  P0-5 첫 RED test): `START_HERE.md`
- 문서 권한·상태 해석: `docs/README.md`
- **현재 아모라 개인정보·보안 작업 진행과 프로덕션 판정**(CURRENT FACTUAL HANDOFF ·
  P0/P1 · PR/CI/DB/Mobile 증거 · 다른 컴퓨터 재개 · production NO-GO):
  `docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md`
- **현재 전체 작업 트리·릴리스 인계**(exact inventory · 사용자와 확정한 결정 ·
  GitHub/Web/DB/Community/Mobile 개별 상태 · rollback · 남은 게이트):
  `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`
- **다른 컴퓨터 개발 인계**(clone · 환경변수 · 웹/모바일 연결 · 검증 · 이어서 할 일):
  `docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md`
- **2026-08-02 커뮤니티·전체 구현 보충 인계**(검색·신뢰·아모라 연결 · 구현/후속 구분):
  `docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md`
- **현재 아모라 대화 기반**(lane·segment · privacy fence · retry · 기억 복구 · 위기 안전):
  `docs/AMORA_CONVERSATION_FOUNDATION_2026-08-01.md`
- **아모라 개인정보 경계·소비자 안전 목표 아키텍처**(TARGET ARCHITECTURE · 현재 P0가 남아
  있어 production NO-GO):
  `docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md`
- **현재 아모라 통합 케어 계약**(W0~W5 · 실행 경계 · 평가 기준):
  `docs/AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30.md`
- **neutral couple member 전환 제안**(PLAN · 미구현 · 미배포):
  `docs/AMORA_NEUTRAL_COUPLE_MEMBER_MIGRATION_PROPOSAL_2026-08-02.md`
- **UI 작업용 선택적 Lazyweb 런북**(기기별 MCP·보안 경계·재설치, 제품 정본 아님):
  `docs/operations/LAZYWEB_MCP_DESIGN_WORKFLOW_2026-08-02.md`
- **현재 모바일 우선 MVP 제품 계약**(한 줄 정의 · 아모라 호칭 · 제품 위계 · 전면/비전면
  범위 · 내부/외부 언어 경계 · 핵심 지표):
  `docs/PRODUCT_CONTRACT_PARTNER_2026-08-08.md`
- 승계된 구 제품 계약(2026-07-30에 무엇을 왜 내렸는지의 기록, `SUPERSEDED`):
  `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`
- 과거 로컬 저장소 전체 감사(2026-07-30 source snapshot):
  `docs/operations/FULL_REPOSITORY_AUDIT_2026-07-30.md`
- 현재 Supabase successor controller 계약:
  `docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`
- 현재 커뮤니티 production release gate:
  `docs/operations/COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md`
- 제품·디자인: `DESIGN.md`
- 아모라 제품·기술 기준: `docs/AMORA_ENGINE_V2_2026-07-16.md`
- 과거 아모라 V2 운영 릴리스 계획:
  `docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md`
- 과거 업체 공시 브랜치 인수인계:
  `docs/operations/CURRENT_WORKSPACE_HANDOFF_2026-07-20.md`
- 과거 CTO 인계(2026-07-30 소비자 신뢰 감사 · 웨딩코드 · 견적 체크):
  `docs/operations/CTO_TRUST_AND_WEDDINGCODE_HANDOFF_2026-07-30.md`
- 이전 세션 인계(웨딩코드 v0.6 · 오늘 한 마디 · 로컬 dev 띄우는 법 · 깨면 안 되는 불변식 9개):
  `docs/operations/SESSION_HANDOFF_2026-07-29.md`
- **다른 컴퓨터에서 이어받을 때 먼저 읽는 문서**(가짜 가드 5건 · 검증 명령 · 남은 일):
  `docs/operations/SESSION_HANDOFF_2026-07-28.md`
- 상세 작업 기록(가짜 검증 5건 · 변이 테스트 실적 · 검증 함정):
  `docs/operations/WORK_LOG_2026-07-27_28.md`
- 최신 세션 기록(출시 준비 · 위약금 공개 · 발견 결함과 오판):
  `docs/operations/LAUNCH_PREP_SESSION_2026-07-26.md`
- 업체 병합 판정(79쌍 전건 · 근거와 미결 사유):
  `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md`
- **WeddingCode 「오늘 한 마디」 인계**(PR #75 · 머지 전 닫을 M1~M4 · 실행 함정 3종):
  `docs/operations/WEDDINGCODE_SESSION_HANDOFF_2026-07-28.md`
- 업체 공시 실행 기준: `scripts/ingest/README.md`
- 공시 원본 출처·기준 시점(확인 필요 항목 포함):
  `docs/operations/DISCLOSURE_SOURCE_PROVENANCE.md`
- 업체 공시 전수 감사:
  `docs/operations/VENDOR_DISCLOSURE_FULL_SOURCE_AUDIT_2026-07-20.md`
- 업체 공시 고정 8건 실행:
  `docs/operations/VENDOR_DISCLOSURE_FIXED8_EXECUTION_HANDOFF_2026-07-20.md`
- 업체 공시 수용·배포 게이트:
  `docs/operations/VENDOR_DISCLOSURE_ACCEPTANCE_MATRIX_2026-07-18.md`,
  `docs/operations/VENDOR_DISCLOSURE_HOSTED_STAGING_RLS_PROBE.md`,
  `docs/operations/VENDOR_DISCLOSURE_PRODUCTION_BUILD_FENCE.md`
- 모바일: `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`
- WeddingCode: `docs/wedding-code/README.md`
- Storage 운영: `supabase/platform-operations/storage/README.md`

`docs/operations/AMORA_PRODUCTION_RELEASE.md`,
`docs/operations/AMORA_ENGINE_V2_SAFETY_HANDOFF_2026-07-16.md`와 날짜가 더 오래된
release manifest는 과거 릴리스의 증거다. 상단의 superseded 안전 배너를 먼저 읽고
본문을 현재 실행 절차·현재 완료 증거로 사용하지 않는다. 과거 hash-bound 원문이
필요하면 현재 파일을 신뢰하지 말고 해당 Git commit과 historical manifest hash로
복원·검증한다.

## 기술 스택

| 영역 | 현재 기준 |
|---|---|
| 웹 | Next.js 16 App Router, React 19, TypeScript 5.9, Tailwind CSS 4 |
| 모바일 | Expo SDK 54, Expo Router, React Native, TypeScript strict |
| 상태 | Zustand와 서버/API 기반 상태 |
| 데이터 | Supabase PostgreSQL, Auth, Realtime, Storage |
| AI | OpenAI Responses API, GPT-5.6 Luna·Terra만 허용 |
| 배포 | Vercel, EAS Build |
| 패키지 | pnpm workspace + Turborepo |

정확한 버전은 각 `package.json`, `pnpm-lock.yaml`, `apps/mobile/app.json`을 읽어
확인한다. 이 문서의 숫자만 믿고 의존성을 바꾸지 않는다.

## 개발 환경

루트 `package.json`의 `engines`와 `packageManager`를 따른다.

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
Copy-Item apps/web/.env.example apps/web/.env.local
```

`hooks:install`은 `core.hooksPath`를 `.githooks`로 지정한다(컴퓨터마다 한 번).
`pre-push`가 `typecheck·lint·test`를 돌려 깨진 상태의 push를 막는다 — turbo가
캐시하므로 이미 돌려 본 상태면 수 초다. CI가 같은 검사를 하지만 이 저장소의 CI는
집계 잡이 **설계상 항상 빨간불**이라 결과만 보고는 판단할 수 없어 로컬에서 한 번 막는다.
정말 필요할 때만 `HANBANG_SKIP_PREPUSH=1 git push`로 넘긴다.

- 운영 키를 개발 파일에 복사하지 않는다.
- `NEXT_PUBLIC_*` 이외의 키는 브라우저 번들에 포함하지 않는다.
- OpenAI 키, Supabase service-role 키, 사용자 원문, 백업 payload, receipt 원문을
  로그·문서·Git에 남기지 않는다.
- 모바일 환경과 OAuth deep link는 `docs/MOBILE_SETUP.md`를 따른다.

주요 명령:

```powershell
corepack pnpm dev:web
corepack pnpm dev:mobile
corepack pnpm qa:local
corepack pnpm test
corepack pnpm mobile:release-check
```

## 코드 변경 규칙

- 기존 사용자 변경을 보존한다. 범위 밖 파일을 되돌리지 않는다.
- TypeScript에서 `any`, 무검증 type assertion, 클라이언트가 보낸 권한·소유권 값을
  신뢰하지 않는다.
- 사용자·커플·공유/개인 범위는 서버와 RLS에서 다시 확인한다.
- service-role 쓰기는 대상 Supabase URL·project ref·명시적 production confirmation을
  검증한 뒤에만 가능하다.
- 복수 테이블 또는 비용 예약과 사용자 결과가 하나의 의미 단위면 DB 함수와
  트랜잭션으로 원자화한다.
- 비동기 재시도는 안정적인 idempotency key, 획득 토큰, 최대 시도 수와 실패 종료
  상태를 갖는다.
- 오류 응답은 사용자가 복구할 수 있는 문구를 주되 내부 SDK/DB 원문과 비밀값을
  노출하지 않는다.
- UI는 한 화면의 우선 행동을 명확히 하고, 로딩·빈 상태·오류·재시도를 모두
  제공한다.

## 디자인 시스템

- 모든 시각 변경은 `DESIGN.md`가 기준이다.
- 웹·모바일은 Pretendard를 사용한다. 모바일의 예전 Noto/Cormorant 이름은 실제
  Pretendard 파일에 매핑된 호환 alias일 수 있으므로 로더를 확인한다.
- Eucalyptus Ink, Dusty Mauve, Pearl Ivory, Sage 토큰을 사용하고 임의의 핑크·골드
  팔레트를 새로 만들지 않는다.
- 모바일 첫 화면은 5초 안에 “오늘 무엇을 해야 하는지” 보여야 한다.
- 카드 안에 카드를 중첩하지 않고, 고정 버튼은 safe-area·bottom navigation·다른
  FAB와 겹치지 않게 실제 320/375px 화면에서 확인한다.
- AI 추천과 검증된 업체 사실, 광고·협찬 상태를 시각·문구로 분리한다.
- 모바일 내비게이션·화면 계층·업체·아모라 흐름 변경 전에는
  `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`도 읽는다.

## 테스트와 검증

1. 변경한 함수·route·migration에 가장 가까운 테스트를 먼저 RED로 만든다.
2. 수정 후 해당 테스트를 GREEN으로 만든다.
3. 영향 범위에 따라 typecheck, lint, 전체 테스트, production build로 확장한다.
4. UI는 실제 브라우저 또는 실기기에서 작은 모바일·일반 모바일·데스크톱을 확인한다.
5. 운영 전에는 preview/hosted clone 증거와 production-safe read-only probe를 구분한다.

`corepack pnpm qa:local`은 웹·모바일 앱 게이트다. 업체 공시 변경은 추가로
`corepack pnpm ingest:typecheck`, `corepack pnpm test:ingest`,
`corepack pnpm supabase:release:test`, `corepack pnpm supabase:release:fence`를
실행한다. 마이그레이션 SQL은 정적 문자열 테스트만으로 완료하지 않고 PGlite와
hosted PostgreSQL 사후조건도 확인한다.

## Git과 다른 컴퓨터 인수인계

- 작업 시작: `git status --short --branch`, `git fetch --prune origin`, PR/원격 HEAD 확인.
- dirty worktree를 `reset --hard`, `checkout --`, `clean`으로 지우지 않는다.
- 의도한 파일만 stage한다. `git add -A`로 범위를 숨기지 않는다.
- 공유 전에는 현재 HEAD, 원격 HEAD, 테스트 결과, 남은 운영 게이트를 문서화한다.
- 원격 변경은 clean integration branch 또는 명시적 merge/rebase 계획으로 합친다.
- 강제 push는 금지한다.

커밋 제목은 `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:` 중 실제 변경에
맞는 접두사를 사용한다.

## 운영 DB·Storage·배포 규칙

- `supabase db push`를 직접 실행하지 않는다.
- 현재 릴리스 manifest와 컨트롤러가 허용한 `supabase:release:apply` 경로만 사용한다.
- 운영 변경 전에 전역 web/API/Auth/public DB/Storage write fence, DB 백업, Storage
  원본 백업, 복구 검증, rollback artifact를 먼저 확보한다.
- Supabase DB 백업은 Storage 원본 bytes를 포함하지 않는다.
- Storage signed URL은 RLS 정책 변경과 별개로 만료 전까지 유효할 수 있으므로,
  freeze 검증은 정책 수뿐 아니라 토큰 만료 대기와 객체 수 안정성까지 포함한다.
- 운영 실패 시 fence와 release lock을 유지한다. 약한 과거 정책을 자동 복원하지
  않는다.
- PR 병합·Vercel production deploy·카나리는 모든 사전 게이트가 통과한 경우에만
  진행한다.

## 증거 기반 작업 프로토콜

- E: 이번 작업에서 파일·명령·테스트·화면으로 직접 확인한 사실.
- S: 공식 문서나 1차 자료에서 확인한 사실.
- I: E/S에서 나온 추론.
- M: 기억 기반. 최신 상태, 숫자, 비용, 배포·테스트 성공 판정에는 사용하지 않는다.

숫자·가격·법·API 사양·버전·URL·운영 상태는 변할 수 있으므로 직접 확인한다.
작업을 시작할 때 목표, 위험, 완료 조건을 나누고, 위험한 변경은 실패 시나리오와
rollback을 먼저 적는다. 확인하지 못한 항목은 `UNVERIFIED` 또는 남은 게이트로
남긴다.

## 아모라 OpenAI 프로토콜

- `AMORA_OPENAI_ENABLED`는 명시적 `true`일 때만 켜진다.
- 허용 모델은 `gpt-5.6-luna`와 `gpt-5.6-terra`뿐이다. 다른 모델이나 Anthropic
  fallback으로 조용히 우회하지 않는다.
- 일반 상담은 Luna, 계약·위기·반복 수정처럼 오답 비용이 큰 경우에만 Terra를 쓴다.
- 모든 생성 호출은 Responses API, `store:false`, 출력 상한, 자동 provider retry
  0회와 원문 비저장 감사 로그를 유지한다.
- `store:false`를 Zero Data Retention이라고 표현하지 않는다.
- 커플별 베타 상담 한도는 현재 release contract에서 해제하되, 전역 일일 턴과
  USD 비용 상한은 원자적 장부로 유지한다.
- 모델 응답과 도구 실행을 분리한다. 일정·예산은 승인된 도구의 DB 결과를 받은
  뒤에만 성공이라고 말한다.

## 아모라 기억·케어·삭제 프로토콜

- 기준은 `docs/AMORA_ENGINE_V2_2026-07-16.md`다.
- `AMORA_AUXILIARY_MEMORY_ENABLED`, `AMORA_CARE_OUTBOUND_ENABLED`, 삭제 worker와
  AI 원문 retention cron은 각각 별도 안전 게이트가 끝날 때까지 `false`다.
- 기억 동의 기본값은 false이고 소급되지 않는다. 공유 기억은 현재 커플 멤버 모두의
  동의가 필요하다.
- 큐·기억·요약·동의 철회·삭제는 같은 범위의 DB 잠금과 사후 소유권 검증을 쓴다.
- 주민등록번호, 연락처, 이메일, 계좌·카드·비밀번호, 정확한 주소, 건강·성 관련
  민감정보는 결정적 서버 필터로 저장을 막는다.
- 계정 삭제는 DB row, Auth identity, private/public Storage object, 법적 보존,
  notification과 복구 기록을 하나의 saga로 관리한다. 자동 진행은 운영 owner와
  수동 SLA가 없으면 켜지 않는다.

## WeddingCode 프로토콜

- 현재 연구 상태와 공개 경계는 `docs/wedding-code/README.md`를 먼저 읽는다.
- 사람 인지면접·전문가 검토·타당도 검증 전에는 정식 검사, 과학적 유형, 궁합,
  결혼 성공/이혼 예측이라고 말하지 않는다.
- 문항마다 construct, 근거 수준, 대안 해석, 위치 편향, 폐기 기준을 추적한다.
- 질문·선택지·점수·결과 문구 변경은 문서의 exact-version과 함께 검증한다.
- 연구 수집 API가 닫혀 있으면 UI만 열거나 데이터를 우회 저장하지 않는다.
- v4 파일럿(v4.0-tendency)은 (a) 기존 연구 보태기 경로를 v4 판으로 확장하거나(만 19세 이상, 동의, 60일
  삭제, 삭제 코드, `docs/wedding-code/README.md` §4 게이트와 별도 Production 재개 PR을 따름)
  (b) 글자·세기·축 점수·자기 선택·피드백만 받는 소규모 수기 봉투(서면 동의, 만 19세 이상, 보관 60일,
  요청 시 삭제, 자유 의견에 이름·연락처·금액을 적지 말라는 안내)로 한정한다. 문항별 답 70자를
  메일·카카오톡으로 받는 방식은 (a)의 우회이므로 쓰지 않는다.
  - (b)는 바로 위 「우회 저장하지 않는다」에 대한 **이름 붙인 예외**다. 서버·계정·코드 경로 없이 사람이
    서면 동의를 받아 손으로 모으는 봉투만 받는다. 시작하려면 파운더의 승인 기록(대화가 아니라 저장소나
    문서 링크에 남는 것)과 동의서 양식이 먼저 있어야 하고, 동의서에는 만 19세 이상, 보관 60일, 요청 시
    삭제, 자유 의견에 이름·연락처·금액을 적지 말라는 안내가 들어간다. `docs/wedding-code/README.md` §4
    게이트는 Candidate 6.3 연구 수집 API의 재개 조건이라 (b)를 풀어 주지 않고, (b)로 얻은 자료로 그
    게이트가 통과했다고 말하지 않는다.
  - 파일럿 모드 코드는 `apps/web/src/lib/weddingCode/research/` 아래 별도 모듈로 두고 pilot 키가 있을
    때만 동적으로 불러온다. 그 폴더에는 막혀 있는 Candidate 5·6 연구 코드가 이미 있으므로, 파일럿 모듈은
    하위 폴더를 따로 두고 그 연구 코드와 legacy score·report·answers·share·storage를 import하지 않는다.
  - 파일럿 모듈이 운영 번들에 기본 포함되지 않는지와 위 import 금지를 확인하는 가드는 **아직 없다.**
    설계의 PR-7(파일럿 봉투)에서 `scripts/prove-guard.mjs`로 위반을 심어 빨간불을 본 뒤에 추가하며,
    그 가드가 통과하기 전에는 파일럿 모듈을 병합하지 않는다.
  - 나이는 19세로 통일한다(서비스 이용 하한 14세와 다르다).
