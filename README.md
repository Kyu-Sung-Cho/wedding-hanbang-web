# 웨딩한방

웨딩한방은 한국 예비부부가 일정, 예산, 업체, 커뮤니티 정보와 커플 의사결정을
한곳에서 관리하도록 돕는 웹·모바일 서비스입니다. 아모라는 OpenAI 기반의 결혼
준비 동반자이며, 사용자의 승인 없이 일정·예산을 바꾸거나 검증되지 않은 업체
정보를 확정 사실처럼 말하지 않는 것을 제품 원칙으로 둡니다.

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

- 제품·디자인: `DESIGN.md`
- 아모라 V2: `docs/AMORA_ENGINE_V2_2026-07-16.md`
- 현재 운영 릴리스: `docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md`
- 다른 컴퓨터 인수인계: `docs/operations/CURRENT_WORKSPACE_HANDOFF_2026-07-17.md`
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

`pnpm qa:local`은 웹 typecheck·lint·tests·production build와 모바일
readiness·tests·typecheck·lint·bundle export를 포함합니다. 명령이 실제로 성공하지
않았다면 문서나 PR에서 통과했다고 표시하지 않습니다.

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
