# 웨딩한방

**웨딩한방은 결혼 준비의 고민을 아모라와 처음부터 끝까지 이야기하고, 비슷한 시기에
준비하는 사람들의 기록을 함께 보며, 확인한 것만 예산·체크리스트·일정에 남기고 바뀐 내용을 서로에게 알리는 서비스입니다.**

현재 MVP는 모바일 앱의 아모라 핵심 흐름에 집중합니다. 웹은 유입·설명·정책·고객지원과
데스크톱 연속성을 담당하고, 커뮤니티는 실제 경험을 찾고 질문하는 보조 축입니다.
업체·예약·축의금 기능은 저장소에 남아 있어도 현재 MVP의 전면 제품으로 소개하지
않습니다. 아모라는 사용자의 승인 없이 일정·예산을 바꾸거나 검증되지 않은 업체 정보를
확정 사실처럼 말하지 않습니다.

## 저장소 구조

- `apps/web`: Next.js 16 웹 앱, API routes, Vercel 배포 대상
- `apps/mobile`: Expo/React Native 앱, EAS 빌드 대상
- `packages/shared`: 웹·모바일 공유 로직과 타입
- `packages/design-tokens`: 공통 색상·간격 토큰
- `supabase/migrations`: 순서가 고정된 PostgreSQL 마이그레이션
- `supabase/platform-operations`: Supabase Dashboard에서 별도로 적용하는 Storage 작업
- `scripts`: QA, 백업, 릴리스 게이트, 운영 증거 생성 도구
- `docs`: 제품 기준서, 연구 문서, 운영 런북과 검증 증거

## 현재 기준 문서

- 새 컴퓨터·새 LLM의 모델 중립 진입점: `START_HERE.md`
- 현재 모바일 우선 MVP 제품 계약: `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`
- 현재 아모라 개인정보·보안 진행과 production 판정(**구현 미완료 / NO-GO**):
  `docs/operations/AMORA_PRIVACY_SECURITY_WORK_PROGRESS_AND_RELEASE_HANDOFF_2026-08-04.md`
- 아모라 개인정보 경계 목표 아키텍처(**TARGET ARCHITECTURE / 구현 완료 증거 아님**):
  `docs/AMORA_ZERO_LEAK_PRIVACY_SECURITY_ARCHITECTURE_2026-08-04.md`
- 현재 전체 작업 트리·릴리스 인계:
  `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`
- 다른 컴퓨터에서 clone·환경 복원·웹/모바일 연결을 재개하는 환경 복원 상세 보조 인계:
  `docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md`
- 2026-08-02 커뮤니티 설계·후속 전체 구현 상세 보충 인계:
  `docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md`
- 현재 아모라 대화·privacy·retry·기억·위기 안전 기반:
  `docs/AMORA_CONVERSATION_FOUNDATION_2026-08-01.md`
- 현재 아모라 W0~W5 통합 케어 제품 계약:
  `docs/AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30.md`
- 성별 역할을 강제하지 않는 커플 member 전환안(**PLAN, 아직 미구현·미배포**):
  `docs/AMORA_NEUTRAL_COUPLE_MEMBER_MIGRATION_PROPOSAL_2026-08-02.md`
- 선택적 Lazyweb MCP 디자인 조사와 새 컴퓨터 재설치 런북:
  `docs/operations/LAZYWEB_MCP_DESIGN_WORKFLOW_2026-08-02.md`
- 현재 Supabase successor release controller:
  `docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`
- 현재 커뮤니티 production release gate:
  `docs/operations/COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md`
- 제품·디자인: `DESIGN.md`
- 아모라 V2: `docs/AMORA_ENGINE_V2_2026-07-16.md`
- 과거 CTO 인수인계와 2026-07-30 당시 미완료 운영 게이트:
  `docs/operations/CTO_TRUST_AND_WEDDINGCODE_HANDOFF_2026-07-30.md`
- 과거 아모라 운영 릴리스 계획:
  `docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md`
- 과거 업체 공시 작업 인계:
  `docs/operations/CURRENT_WORKSPACE_HANDOFF_2026-07-20.md`
- 업체 공시 실행 기준: `scripts/ingest/README.md`
- 업체 공시 적재·속성·아모라 추천 V2: `docs/operations/VENDOR_DISCLOSURE_PIPELINE_V2_2026-07-18.md`
- 업체 공시 전수 감사: `docs/operations/VENDOR_DISCLOSURE_FULL_SOURCE_AUDIT_2026-07-20.md`
- 업체 공시 고정 8건 실행: `docs/operations/VENDOR_DISCLOSURE_FIXED8_EXECUTION_HANDOFF_2026-07-20.md`
- 업체 공시 수용·배포 게이트:
  `docs/operations/VENDOR_DISCLOSURE_ACCEPTANCE_MATRIX_2026-07-18.md`,
  `docs/operations/VENDOR_DISCLOSURE_HOSTED_STAGING_RLS_PROBE.md`,
  `docs/operations/VENDOR_DISCLOSURE_PRODUCTION_BUILD_FENCE.md`
- 모바일: `docs/MOBILE_APP_MASTERPLAN_2026-06-30.md`
- WeddingCode: `docs/wedding-code/README.md`

날짜가 오래된 감사·세션·릴리스 문서는 역사적 증거일 수 있습니다. 실제 완료 여부는
현재 릴리스 문서, Git HEAD, 테스트 결과, GitHub checks와 배포 receipt를 함께 확인해
판정합니다.

## 로컬 시작

필수 버전은 루트 `package.json`의 `engines`와 `packageManager`가 기준입니다.

```powershell
git fetch --prune origin
corepack enable
corepack pnpm install --frozen-lockfile
Copy-Item apps/web/.env.example apps/web/.env.local
```

`apps/web/.env.local`에는 개발용 값만 넣습니다. 운영 키, 서비스 역할 키, 사용자
대화 원문, 백업 payload를 Git에 추가하지 마세요. 모바일 설정은
`docs/MOBILE_SETUP.md`를 따릅니다.

개발 서버:

```powershell
corepack pnpm dev:web
corepack pnpm dev:mobile
```

## 검증

변경한 영역의 단위 테스트를 먼저 실행하고, 공유 전에는 전체 로컬 게이트를
실행합니다.

```powershell
corepack pnpm qa:local
corepack pnpm test
corepack pnpm mobile:release-check
```

`corepack pnpm qa:local`은 웹·모바일 앱 게이트입니다. 업체 공시 변경은 추가로
`corepack pnpm ingest:typecheck`, `corepack pnpm test:ingest`,
`corepack pnpm supabase:release:test`, `corepack pnpm supabase:release:fence`를
실행합니다. 명령이 실제로 성공하지 않았다면 문서나 PR에서 통과했다고 표시하지
않습니다.

## 운영 변경 안전 규칙

- 운영 Supabase에 직접 `db push`하지 않습니다.
- `supabase:release:apply`는 현재 릴리스 문서의 백업, write fence, exact manifest,
  수동 Storage operation, rollback 조건이 모두 준비된 경우에만 사용합니다.
- 운영 DB 백업과 Storage 원본 백업은 별개입니다. 둘 다 복구 검증이 필요합니다.
- 마이그레이션, Vercel production 배포, PR 병합은 모든 사전 게이트가 통과한 뒤에만
  진행합니다.
- 실패 시 성공으로 재분류하지 않습니다. write fence와 릴리스 lock을 유지하고
  receipt에 남은 단계와 복구 방법을 기록합니다.

## 다른 컴퓨터에서 이어가기

먼저 GitHub의 최신 브랜치와 PR을 확인하고, 로컬 변경이 없는지 확인한 다음
fast-forward로 동기화합니다.

```powershell
git status --short --branch
git fetch --prune origin
git pull --ff-only
```

작업 중 변경이 있으면 덮어쓰거나 `reset --hard`하지 마세요. 변경 파일, 현재 HEAD,
원격 HEAD, 실행한 테스트와 남은 운영 게이트를 인수인계 문서에 남긴 뒤 의도한
파일만 커밋·푸시합니다.
