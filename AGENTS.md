## 최상위 규칙
모든 작업은 PRINCIPLES.md의 6개 원칙을 따른다.
충돌 시 우선순위: P1 > P3 > P2 > P4 > P5 > P6.
실제 provider 생성 호출은 감사 래퍼를 거쳐 ai_interactions_log에 기록한다.
decision_nodes는 명시적으로 지원하는 결정 흐름만 기록하며, 모든 사용자 행동을 자동 수집한다고 가정하지 않는다.

## 현재 소스 오브 트루스 (2026-07-14)

> 이 문서에는 초기 단일 웹앱 계획이 역사 기록으로 남아 있다. 현재 상태를 판단할 때는 아래 목록과 실제 코드·패키지 매니페스트를 우선하며, 오래된 계획 블록을 구현 사실로 인용하지 않는다.

- 저장소는 pnpm/Turbo 모노레포다: `apps/web`, `apps/mobile`, `packages/design-tokens`, `packages/shared`, `supabase`, `scripts`.
- 웹은 Next.js `16.2.6`/React `19.2.3`/Tailwind CSS 4, 모바일은 Expo 54/React Native 0.81이다. 정확한 버전은 각 `package.json`과 `pnpm-lock.yaml`이 최종 기준이다.
- 아모라 AI 연동은 OpenAI Responses API다. 일반 상담은 정확히 `gpt-5.6-luna`, 계약·분쟁/안전·반복 교정만 정확히 `gpt-5.6-terra`를 사용하며 reasoning은 코드에서 `none`으로 고정한다. Anthropic/Claude 런타임과 SDK는 제거되었다.
- 현재 베타의 아모라는 조회·정리 중심이다. 일정·예산·준비 상태 수정과 예약 생성·취소 등 모델 기반 쓰기 도구는 서버 확인 토큰과 동시성 계약이 완성될 때까지 하드 비활성이다. 프롬프트의 과거 기능 설명보다 `runtimeToolContract.ts`와 실제 노출 도구 목록이 우선한다.
- OpenAI 키가 없어도 정적 테스트는 가능하지만, 출시는 2026-07-12 검증에 사용한 기존 키의 폐기·인증 거부·사용량 감사를 확인하고 GPT-5.6 Luna/Terra 사용 권한이 있는 회전 키로 스트리밍·도구 후속·PDF·거절·중단·예산 상한을 canary 검증한 뒤에만 가능하다.
- WeddingCode는 candidate.10의 16개 준비 순서 문항을 개인 브라우저에서만 계산한다. 최신 문항·계산·검증 경계는 `docs/wedding-code/63_candidate10_evidence_based_rebuild_2026-07-11.md`가 기준이다. 커플 초대·비교와 익명 응답 수집 API는 보안·동의·보유기간 재설계 전까지 코드에서 하드 비활성이다. 2026-07-14 운영 DB read-only 관찰에서는 response table과 두 legacy RPC가 모두 없고 latest migration이 `20260630233211`이었다. 현재 P0는 이 `absent` 상태를 DB write 없이 재검증해 유지하며, pending 57개를 적용하는 `supabase db push`를 사용하지 않는다. 향후 replay를 위한 051600 creator도 앱 권한·policy 없이 `CHECK (false) NOT VALID`를 같은 transaction에서 설치해 태생부터 fail-closed이며, 141040이 최종 ACL·RPC·constraint 계약을 재확인한다.
- 운영 DB 작업은 `docs/PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md`와 `docs/SUPABASE_REMOTE_OPERATIONS.md`의 write fence·백업·격리 복구 gate를 모두 통과한 뒤에만 한다. 노출된 Supabase CLI login role/PAT를 폐기하고 승인된 non-production ref를 allowlist에 넣기 전에는 원격 Supabase 명령을 실행하지 않는다.
- `RESEARCH_COHORT_APPLICATIONS_ENABLED`와 `ACCOUNT_DELETION_CRON_ENABLED`는 운영 검증 전까지 `false`다. 문서·테스트 통과만으로 접수나 삭제 cron을 열지 않는다.
- EAS의 development·preview·production profile은 모두 저장소 Node 22.13.0과 pnpm 11.7.0을 고정한다. 스토어 빌드는 `mobile:store-release-check`와 실기기 증거가 통과하기 전에는 실행하지 않는다.
- 디자인 의도는 `DESIGN.md`, 공유 토큰은 `packages/design-tokens/src/`, 웹에 실제 적용된 값은 `apps/web/src/app/globals.css`가 기준이다. 충돌하면 실행 코드의 현재 동작을 먼저 확인하고 문서를 함께 동기화한다.
- 저장소 명령은 루트에서 `corepack pnpm ...` 형식을 사용한다. 실제 스크립트는 루트와 각 앱의 `package.json`을 확인한다.

## Deploy Configuration (configured by /setup-deploy)

- Platform: Vercel, team `hanbang`, project `wedding-hanbang-web`, root directory `apps/web`
- Production URL: `https://hanbang.ai`
- Deploy workflow: `apps/web/vercel.json`의 `git.deploymentEnabled=false`는 checked-in 의도일 뿐 provider 상태 증거가 아니다. 2026-07-14 read-only Vercel UI에는 Production Environment Branch Tracking이 `Every commit pushed to main will create a Production Deployment`, `Auto-assign Custom Production Domains: Enabled`로 표시됐다. 따라서 `main` merge는 곧 apex 운영 mutation이다. 기본 release는 두 자동 설정을 끄고 별도의 보호된 `release-control`이 staged create·promote를 수행한다. 단, 별도 승인된 DB-zero-diff P0만 Git-integrated hotfix mode를 사용할 수 있으며 exact-SHA Preview·수동 `--match-head-commit`·현재 rollback ID·Production source identity·즉시 apex canary를 merge 전에 고정해야 한다. 어느 mode도 증명되지 않으면 `main` 직접 push·병합과 운영 배포를 금지한다. 로컬 Vercel CLI는 운영 proof를 만들지 않는다.
- Deploy status: controller가 Vercel API의 allowlisted team/project/repository ID, `gitSource` type/repo/ref/SHA, target, state, immutable deployment ID와 alias를 strict schema로 검증한다. 로컬 `inspect` 판독을 증거로 사용하지 않는다.
- Merge method: GitHub merge commit only. 현재 checkout branch에 연결된 PR의 number·`headRefName`·`headRefOid`를 다시 읽고 protected `main` base, local HEAD, clean merge 상태와 일치시킨 뒤 `gh pr merge <current-pr-number> --merge --match-head-commit <candidate-sha>`만 사용한다. 고정 PR 번호, squash, rebase, force-push를 사용하지 않는다.
- Project type: Next.js web app/API와 같은 저장소의 Expo mobile companion
- Post-deploy health check: staged URL과 `https://hanbang.ai/api/health/maintenance`에서 exact SHA, Supabase ref, launch/maintenance/Turnstile boolean을 검사한 뒤 `corepack pnpm qa:live`를 실행한다.

### Custom deploy hooks

- Pre-merge: full-history secret gate, Windows reviewed-launcher contract, `corepack pnpm qa:local`, 독립 코드 승인과 runbook의 candidate-bound 운영 선행 증거가 모두 통과해야 한다.
- Deploy trigger: 기본 staged mode는 provider의 자동 Production deployment와 custom-domain 자동 할당이 모두 꺼졌다는 재검증 뒤 보호된 controller가 exact post-merge SHA를 staged한다. 승인된 P0 Git-integrated mode에서는 두 자동 설정의 활성 상태 자체를 expected contract로 고정하고 merge를 단 한 번의 Production trigger로 취급한다. mode가 섞이거나 provider 상태가 기대와 다르면 중단한다.
- Deploy status: provider API에서 immutable deployment ID와 type/repo/ref/SHA/project/team/target/state를 대조하고, alias의 예상 이전 ID가 바뀌면 중단한다.
- Health check: 기본 mode는 staged URL의 SHA·Supabase ref·기능 상태와 provider alias deployment ID를 검증하고 같은 ID만 promote한다. P0 Git-integrated mode는 Preview에서 candidate SHA를 먼저 검증하고 merge 직후 Production deployment source SHA·alias ID·apex canary를 확인하며, 실패하면 고정한 이전 ID로 즉시 rollback한다. 어느 mode든 설정·SHA·alias 중 하나라도 불명확하면 fail-closed로 중단한다.

---

# 웨딩한방 모노레포 (hanbang.ai) - Codex 가이드

## 🎯 프로젝트 개요

**한 줄 요약**: 웹·모바일 앱과 공유 패키지를 함께 관리하는 웨딩한방 모노레포. 웹과 모바일은 같은 Supabase 백엔드를 사용한다.

**도메인**: hanbang.ai (www.hanbang.ai)
**배포**: Vercel
**모바일 앱**: `apps/mobile` (Expo/React Native, 같은 저장소)

## 🏗 기술 스택

| 레이어 | 기술 | 이유 |
|--------|------|------|
| Framework | Next.js 16.2.6 (App Router) | SSR, Route Handlers, Vercel 배포 |
| Language | TypeScript | 타입 안정성 |
| Styling | Tailwind CSS 4 | 빠른 개발, 일관된 디자인 |
| State | Zustand 5 | 웹·모바일의 로컬 상태 관리 |
| Backend/DB | Supabase (기존 프로젝트 공유) | PostgreSQL, Auth, Realtime, Storage |
| AI | OpenAI Responses API | 웨딩 AI 플래너 채팅 |
| Auth | Supabase Auth (카카오, 구글) | 앱과 동일한 인증 |
| 배포 | Vercel | Next.js 웹 배포 |
| 이메일 | Resend | 사전등록 확인 메일 |

## 📁 폐기된 초기 구조 초안 (현재 구조 아님)

> 아래 트리는 초기 단일 앱 계획의 역사 기록이다. 현재 작업 경로로 사용하지 않는다. 실제 구조는 위의 `현재 소스 오브 트루스`와 `apps/`, `packages/`, `supabase/` 디렉터리에서 확인한다.

```
hanbang-web/
├── AGENTS.md                    # 이 파일
├── next.config.ts
├── tailwind.config.ts
├── package.json
├── .env.local                   # 환경변수 (git 제외)
│
├── public/
│   ├── fonts/                   # 커스텀 폰트
│   ├── images/                  # 정적 이미지
│   └── og-image.png             # 소셜 공유 이미지
│
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── layout.tsx           # 루트 레이아웃
│   │   ├── page.tsx             # 랜딩페이지 (/)
│   │   ├── globals.css          # 글로벌 스타일
│   │   │
│   │   ├── (auth)/              # 인증 그룹
│   │   │   ├── login/page.tsx   # 로그인
│   │   │   ├── signup/page.tsx  # 회원가입
│   │   │   └── callback/page.tsx # OAuth 콜백
│   │   │
│   │   ├── (app)/               # 로그인 후 앱 기능 그룹
│   │   │   ├── layout.tsx       # 앱 레이아웃 (사이드바/네비)
│   │   │   ├── dashboard/page.tsx    # 대시보드 (홈)
│   │   │   ├── chat/page.tsx         # AI 채팅
│   │   │   ├── budget/page.tsx       # 예산 관리
│   │   │   ├── schedule/page.tsx     # 일정 관리
│   │   │   ├── fitting/page.tsx      # AI 드레스 피팅
│   │   │   ├── vendors/page.tsx      # 업체 탐색
│   │   │   ├── etiquette/page.tsx    # 예절 가이드
│   │   │   └── settings/page.tsx     # 설정
│   │   │
│   │   ├── (admin)/             # 관리자 (사전등록 현황 등)
│   │   │   └── admin/page.tsx
│   │   │
│   │   └── api/                 # API Routes
│   │       ├── auth/callback/route.ts
│   │       ├── chat/route.ts         # AI 채팅 API
│   │       ├── preregister/route.ts  # 사전등록
│   │       └── vendors/route.ts      # 업체 검색
│   │
│   ├── components/
│   │   ├── landing/             # 랜딩페이지 섹션들
│   │   │   ├── Hero.tsx
│   │   │   ├── PainPoints.tsx
│   │   │   ├── Solutions.tsx
│   │   │   ├── Comparison.tsx
│   │   │   ├── VirtualFitting.tsx
│   │   │   ├── Stats.tsx
│   │   │   ├── HowItWorks.tsx
│   │   │   ├── Testimonials.tsx
│   │   │   ├── CTA.tsx
│   │   │   └── SparkleCanvas.tsx
│   │   │
│   │   ├── app/                 # 앱 기능 컴포넌트
│   │   │   ├── chat/
│   │   │   │   ├── ChatBubble.tsx
│   │   │   │   ├── ChatInput.tsx
│   │   │   │   ├── ButtonOptions.tsx
│   │   │   │   └── VendorCard.tsx
│   │   │   ├── budget/
│   │   │   │   ├── BudgetOverview.tsx
│   │   │   │   └── BudgetBar.tsx
│   │   │   ├── schedule/
│   │   │   │   ├── Calendar.tsx
│   │   │   │   └── Timeline.tsx
│   │   │   └── common/
│   │   │       ├── Sidebar.tsx
│   │   │       ├── TopNav.tsx
│   │   │       └── LoadingSpinner.tsx
│   │   │
│   │   └── ui/                  # 공통 UI 컴포넌트
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Input.tsx
│   │       └── Modal.tsx
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts        # 브라우저용 클라이언트
│   │   │   ├── server.ts        # 서버용 클라이언트
│   │   │   └── middleware.ts    # Auth 미들웨어
│   │   ├── ai/
│   │   │   ├── openai.ts       # OpenAI Responses API 호출
│   │   │   └── prompts.ts       # 시스템 프롬프트
│   │   └── resend.ts            # 이메일 발송
│   │
│   ├── stores/                  # Zustand 스토어
│   │   ├── authStore.ts
│   │   ├── chatStore.ts
│   │   ├── budgetStore.ts
│   │   └── scheduleStore.ts
│   │
│   ├── types/
│   │   ├── database.types.ts    # Supabase 생성 타입
│   │   ├── chat.types.ts
│   │   └── vendor.types.ts
│   │
│   ├── constants/
│   │   ├── categories.ts        # 20개 웨딩 카테고리
│   │   ├── prices.ts            # 평균 가격 데이터
│   │   └── design.ts            # 디자인 토큰
│   │
│   └── utils/
│       ├── format.ts            # 가격, 날짜 포맷
│       └── validators.ts        # 입력 검증
│
└── middleware.ts                 # Next.js 미들웨어 (인증 체크)
```

## 🎨 디자인 시스템 출처

현재 디자인 판단은 `DESIGN.md`에서 시작하고, 공유 구현 토큰은 `packages/design-tokens/src/`, 웹 런타임 값은 `apps/web/src/app/globals.css`에서 확인한다.

> 아래 색상·폰트 블록은 초기안 기록이며 현재 적용 기준이 아니다.

초기 컬러 팔레트 기록:

```css
/* Primary - Noir */
--noir-800: #1A1A1F;
--noir-900: #0D0D0F;

/* Accent - Rose Champagne */
--rose-500: #C4967E;
--rose-600: #9A6B62;

/* Background - Warm Ivory */
--ivory-50: #FDFCFA;
--ivory-100: #FAF8F5;
--ivory-200: #F5F2ED;

/* Taupe */
--taupe-400: #B5ADA3;
--taupe-500: #928980;

/* Gold */
--gold: #C9A96E;
```

초기 폰트 기록:
- 한글 제목: Noto Serif KR (300, 400, 500)
- 한글 본문: Noto Sans KR (300, 400, 500, 600)
- 영문 제목/숫자: Cormorant Garamond (300, 400, 600)

## 🔑 환경변수 (.env.local)

```
# Supabase (기존 앱과 동일한 프로젝트!)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# OpenAI Responses API
OPENAI_API_KEY=sk-proj-xxx...
OPENAI_AMORA_PRIMARY_MODEL=gpt-5.6-terra
OPENAI_AMORA_FAST_MODEL=gpt-5.6-luna

# Resend (이메일)
RESEND_API_KEY=re_xxx...

# 도메인
NEXT_PUBLIC_SITE_URL=https://hanbang.ai
```

## 🗄 Supabase 공유

모바일 앱과 **같은 Supabase 프로젝트**를 사용합니다.

> 아래 테이블·SQL은 초기 설계 기록이다. 현재 스키마나 실행 지침으로 사용하지 않으며, 실제 구조와 변경 순서는 `supabase/migrations/`, 원격 작업은 검토된 guarded script와 운영 runbook만 따른다.
기존 테이블: profiles, couples, wedding_journeys, chat_messages, chat_summaries, schedules, budgets, budget_items, vendors, customer_insights, fitting_requests

웹 전용 추가 테이블:
```sql
-- 사전등록 (기존 프로토타입에서 이미 있을 수 있음)
CREATE TABLE IF NOT EXISTS preregistrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  wedding_date TEXT,
  source TEXT DEFAULT 'web',  -- 'web', 'app', 'instagram'
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE preregistrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage" ON preregistrations FOR ALL USING (true);
```

## 📐 페이지별 라우팅

| URL | 설명 | 인증 필요 |
|-----|------|----------|
| `/` | 랜딩페이지 | ❌ |
| `/login` | 로그인 | ❌ |
| `/signup` | 회원가입 | ❌ |
| `/dashboard` | 대시보드 | ✅ |
| `/chat` | AI 채팅 | ✅ |
| `/budget` | 예산 관리 | ✅ |
| `/schedule` | 일정 관리 | ✅ |
| `/fitting` | AI 드레스 피팅 | ✅ |
| `/vendors` | 업체 탐색 | ✅ |
| `/etiquette` | 예절 가이드 | ✅ |
| `/settings` | 설정 | ✅ |
| `/admin` | 관리자 (사전등록 현황) | ✅ (admin만) |

## 🔒 인증 플로우

1. 랜딩페이지 → "무료로 시작하기" 클릭
2. `/login` → 카카오 or 구글 소셜 로그인
3. Supabase Auth → OAuth 콜백 → `/callback`
4. 프로필 체크 → 신규면 온보딩, 기존이면 대시보드
5. middleware.ts에서 (app) 그룹 페이지 접근 시 인증 체크

## 🛠 초기 개발 순서 기록 (현재 실행 계획 아님)

> 아래 단계는 초기 구축 계획이다. 현재 우선순위와 완료 상태는 최신 `docs/` 기록과 실제 이슈/코드를 확인한다.

### Phase 1: 기초 셋업 (Day 1)
1. `npx create-next-app@latest hanbang-web --typescript --tailwind --app --src-dir`
2. 폰트, 컬러, 글로벌 스타일 설정
3. Supabase 클라이언트 설정 (기존 프로젝트 키 사용)
4. 환경변수 설정

### Phase 2: 랜딩 + 사전등록 (Day 1-2)
1. 랜딩페이지 컴포넌트로 분리 (기존 HTML → React 컴포넌트)
2. 사전등록 API Route (/api/preregister)
3. Supabase에 이메일 저장
4. Resend로 확인 이메일 발송
5. 관리자 페이지 (등록 현황 확인)

### Phase 3: 인증 (Day 2-3)
1. Supabase Auth 설정 (카카오, 구글)
2. 로그인/회원가입 페이지
3. OAuth 콜백 처리
4. middleware.ts 인증 가드
5. 앱 레이아웃 (사이드바 + 탑네비)

### Phase 4: 핵심 기능 (Day 3-7)
1. 대시보드 (D-day, 진행률, 카테고리 현황)
2. AI 채팅 (OpenAI Responses API 연동)
3. 예산 관리
4. 일정 관리
5. 업체 탐색

### Phase 5: 고급 기능 (Day 7-10)
1. AI 드레스 피팅 (Decart API)
2. 예절 가이드
3. 커플 연동 (초대 코드)
4. 알림 (웹 푸시)

## 🧪 코딩 컨벤션

- **컴포넌트**: 함수형 컴포넌트만, `export default function ComponentName()`
- **스타일**: Tailwind CSS만 (인라인 style 금지)
- **상태관리**: 서버 데이터는 Supabase Realtime, 로컬 상태는 Zustand
- **타입**: any 금지, 모든 props에 타입 정의
- **네이밍**: 컴포넌트 PascalCase, 함수/변수 camelCase, 파일 PascalCase(컴포넌트) / camelCase(유틸)
- **에러 처리**: try-catch + 사용자 친화적 에러 메시지
- **주석**: 한국어로 핵심 로직에만

## 📝 커밋 컨벤션

```
feat: 새 기능 추가
fix: 버그 수정
style: 디자인/스타일 변경
refactor: 코드 리팩토링
docs: 문서 수정
chore: 설정, 패키지 등
```

## Design System

Read `DESIGN.md` before making visual or UI decisions. Treat it as the design-intent source.
Check `packages/design-tokens/src/` for shared tokens and `apps/web/src/app/globals.css` for values actually applied on web.
If these sources disagree, verify the rendered implementation and update the drift instead of copying an old value from this file.
Do not deviate from an explicit approved direction without user approval.
In QA mode, flag mismatches among `DESIGN.md`, shared tokens, and rendered code.
For mobile product work, also read docs/MOBILE_APP_MASTERPLAN_2026-06-30.md before changing navigation, screen hierarchy, AI flows, vendor flows, or launch-readiness behavior.

## Codex Operating Protocol

이 섹션은 Codex가 이 저장소에서 일할 때 항상 따르는 작업 루프다. 단, system/developer 지시, PRINCIPLES.md, DESIGN.md, 보안/저작권/도구 정책과 충돌하면 더 높은 우선순위의 지시를 따른다.

모든 작업은 Fable 5식 검증 태도를 기본값으로 적용한다. 이것은 모델 설정을 바꾸는 것이 아니라 작업 절차다. 작은 요청은 머릿속 체크리스트로 압축 적용하고, 제품/코드/문서/배포/데이터/AI처럼 틀리면 비용이 큰 작업은 아래 루프를 명시적으로 수행한다.

1. 요청을 먼저 분해한다.
   - 사용자가 명시한 요구사항과 암묵적 성공 기준을 모두 확인한다.
   - 작업 범위, 언어, 검증 기준, 배포/커밋 여부를 구분한다.
   - 애매해도 합리적으로 추론 가능한 경우에는 멈추지 말고 진행한다.
   - 목표, 제약, Definition of Done, 필요한 가정을 먼저 잡는다.

2. Truth Protocol을 지킨다.
   - 중요한 주장은 E/S/I/M으로 구분 가능해야 한다.
   - E: 이번 세션에서 파일·명령·테스트·화면으로 직접 확인.
   - S: 이번 세션에서 공식 문서·원문·신뢰 가능한 출처를 읽어 확인.
   - I: E/S에서 나온 코드 기반 또는 자료 기반 추론.
   - M: 기억 기반. 안정적인 배경 설명에만 쓰고, 숫자·최신 상태·테스트 성공·배포 성공에는 쓰지 않는다.
   - 숫자, 가격, 통계, 버전, URL, 인용문, 최신 데이터, 법/규제, 읽지 않은 파일 내용, 테스트·빌드·배포 성공 여부는 기억으로 말하지 않는다. 직접 확인하거나 `UNVERIFIED`로 표시하거나 생략한다.

3. 난이도에 맞게 힘을 조절한다.
   - 간단한 질문은 짧고 직접 답한다.
   - 일반 작업은 짧게 맥락을 확인하고 바로 실행한 뒤 검증한다.
   - 버그, 배포, 데이터, 결제, 인증, AI, 모바일/웹 연동처럼 틀리면 큰 문제인 작업은 원인 분석과 회귀 검증까지 한다.
   - 중요한 설계·카피·제품 판단은 바로 하나로 확정하지 않고 2-3개 후보 또는 대안을 검토한 뒤 선택 이유를 남긴다.

4. 말보다 실행을 우선한다.
   - 사용자가 구현, 점검, 수정, 배포, 정리를 요청하면 제안만 하지 말고 가능한 범위에서 실제로 한다.
   - 산출물은 바로 사용할 수 있게 만든다. 코드나 문서에 생략 표시를 남기지 않는다.
   - 기존 코드 스타일과 프로젝트 구조를 우선한다.

5. 적대적 검수를 통과시킨다.
   - 위험한 변경 전후에는 "이게 어떻게 실패할 수 있나"를 먼저 본다.
   - 사용자 trust, 데이터 무결성, 보안, 과장 카피, AI 환각, 모바일/웹 불일치, 배포 리스크를 우선 의심한다.
   - 주장이 들어간 문서·카피·리포트는 근거와 표현 범위를 함께 확인한다.

6. 검증은 생략하지 않는다.
   - 코드 변경 후 관련 테스트를 먼저 돌리고, 위험도가 있으면 typecheck, lint, 전체 테스트, build, QA까지 확장한다.
   - UI/UX 변경은 실제 화면에서 깨질 가능성을 확인한다.
   - 날짜, 버전, 배포 상태, 최신 정보처럼 변할 수 있는 내용은 도구로 확인한다.
   - 검증하지 못한 항목은 완료로 말하지 않고, 남은 리스크로 분리한다.

7. 확실한 것과 추정을 구분한다.
   - 확인한 사실, 코드 기반 추론, 아직 불확실한 내용을 섞어 말하지 않는다.
   - 배포/커밋/테스트는 실제로 성공한 경우에만 완료라고 말한다.
   - 모르는 내용은 모른다고 말하고, 가장 안전한 확인 방법을 제시하거나 직접 확인한다.

8. 보고는 한국어로 간결하게 한다.
   - 사용자의 말투에 맞춰 자연스럽게 답하되, 사실성과 정확성을 우선한다.
   - 긴 설명보다 원인, 수정, 검증, 남은 리스크를 우선한다.
   - 실수했으면 한 문장으로 인정하고 바로 고친다.

## WeddingCode Additional Fable-Adapted Protocol

전역 Fable식 운영 프로토콜에 더해, 웨딩코드 문항, 점수화, 결과 카피, 커플 비교, 희귀도, 신뢰도 주장 작업을 할 때는
`docs/wedding-code/31_fable_mode_adaptation_protocol_v0.1.md`를 먼저 읽고 따른다.

핵심 규칙:
- 숫자, 가격, 통계, 버전, URL, 인용문, 최신 데이터, 읽지 않은 파일 내용은 기억으로 말하지 않는다. 도구로 확인하거나 `UNVERIFIED`로 표시하거나 생략한다.
- 문항/결과/근거 문서는 초안 → 적대적 검수 → 주장 감사 → 수정 순서로 닫는다.
- "궁합", "결혼 성공", "심리 진단", "과학적으로 입증된 유형"처럼 과장될 수 있는 표현은 금지하고, 검증 가능한 범위의 "준비 방식", "대화 지점", "먼저 맞춰볼 기준"으로만 말한다.
- 코드 반영은 16문항과 scoring/copy gate가 문서에서 통과된 뒤 진행한다.
