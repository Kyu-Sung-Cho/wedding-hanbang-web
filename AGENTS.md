# 웨딩한방 저장소 작업 규칙

## 최상위 원칙

- 모든 제품 판단은 `PRINCIPLES.md`의 여섯 원칙을 따른다. 충돌 시 우선순위는
  P1 > P3 > P2 > P4 > P5 > P6이다.
- 시각·UI 판단 전에는 `DESIGN.md`를 읽는다.
- AI 호출은 `ai_interactions_log`, 커플의 확정 의사결정은 `decision_nodes`에
  기록한다. 모델의 문장만으로 저장 성공을 간주하지 않는다.
- 테스트, 빌드, DB 적용, 배포, 백업, 복구는 실제 증거가 있을 때만 완료로
  보고한다.
- 날짜가 오래된 문서는 역사적 증거일 수 있다. 상단 상태 문구와 아래의 현재 기준
  문서를 먼저 확인한다.

## 프로젝트 개요

웨딩한방은 한국 예비부부가 일정, 예산, 업체, 커뮤니티 정보와 커플 의사결정을
한곳에서 관리하는 소비자 웹·모바일 서비스다. 아모라는 사용자의 조건과 선택을
기억하고, 근거를 구분하며, 승인된 행동만 실행하는 OpenAI 기반 결혼 준비
동반자다.

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

- 제품·디자인: `DESIGN.md`
- 아모라 제품·기술 기준: `docs/AMORA_ENGINE_V2_2026-07-16.md`
- 현행 운영 릴리스:
  `docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md`
- 현재 인수인계:
  `docs/operations/CURRENT_WORKSPACE_HANDOFF_2026-07-20.md`
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
- 웹·모바일은 Paperlogy를 사용한다. 모바일의 예전 Noto/Cormorant 이름은 실제
  Paperlogy 파일에 매핑된 호환 alias일 수 있으므로 로더를 확인한다.
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
