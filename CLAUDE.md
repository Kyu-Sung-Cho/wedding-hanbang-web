## 최상위 규칙
모든 작업은 PRINCIPLES.md의 6개 원칙을 따른다.
충돌 시 우선순위: P1 > P3 > P2 > P4 > P5 > P6.
모든 AI 호출은 ai_interactions_log에 기록되며,
모든 커플 의사결정은 decision_nodes에 기록된다.

## 📍 현재 상태 (2026-06-10 기준 — 새 세션은 여기부터)
- **전략 최상위 문서**: `docs/MASTER_BLUEPRINT_2026-06-10.md` (포지셔닝·3층 구조·로드맵). 미션: "웨딩의 '웨'자를 몰라도, 추가금에 안 당하고, 결혼식까지 — AI 친언니 아모라". 부속: STRATEGY_REVIEW / EONNI_OS / COMMUNITY_ENGINE / WINWINWIN_VERDICT / CONSERVATIVE_VIABILITY / MOMENT_CATALOG (전부 docs/, 같은 날짜).
- **구현 완료(커밋 7a172c20)**: 모멘트 루프 v1(moments.ts 12종 + momentLoop + proactive 배선 + log_wedding_event 툴), 라운지 주차 카드·첫 행동 카드, AiCommentBox 부활, 운영자 핀 API, 시세 공개, 페르소나 자동화 킬스위치(기본 off — `COMMUNITY_AGENTS_ENABLED=true`로만 재가동, AI 표시 체계 갖추기 전 금지).
- **확정 결정**: 계약-법률 서비스 금지 / 견적 등기소 보류 / AI 유저 위장·유료 순위 영구 금지 / 업체 기능은 공급 확보 전 숨김 유지.
- **대기 중인 수동 작업**: Supabase SQL Editor에서 마이그레이션 3개 실행 — `20260610090000_quote_check_channel_fields.sql`, `20260610110000_cohort_anonymity_rls.sql` (미실행 상태에서도 앱은 안전), `20260611100000_chat_image_rls_couple_scope.sql` (**보안 핫픽스 — 실행 전까지 타 커플 채팅 이미지 삭제/덮어쓰기 가능, 우선 실행**).
- **백로그**: `docs/KNOWN_ISSUES_2026-06-10.md` (마이너 15건) + 다음 기능 후보: D-1 브리핑 캡처-공유 카드, 동기방 "오늘의 한 질문".

---

# 웨딩한방 웹 (hanbang.ai) - Claude Code 가이드

## 🎯 프로젝트 개요

**한 줄 요약**: 웨딩한방 모바일 앱의 웹 버전 + 마케팅 랜딩페이지. 같은 Supabase 백엔드를 공유하여 앱과 웹 데이터가 실시간 동기화됨.

**도메인**: hanbang.ai (www.hanbang.ai)
**배포**: Vercel
**기존 앱**: React Native CLI (별도 레포)

## 🏗 기술 스택

| 레이어 | 기술 | 이유 |
|--------|------|------|
| Framework | Next.js 14 (App Router) | SSR, API Routes, Vercel 최적화 |
| Language | TypeScript | 타입 안정성 |
| Styling | Tailwind CSS | 빠른 개발, 일관된 디자인 |
| State | Zustand | 앱과 동일한 패턴 |
| Backend/DB | Supabase (기존 프로젝트 공유) | PostgreSQL, Auth, Realtime, Storage |
| AI | Claude API (Anthropic) | 웨딩 AI 플래너 채팅 |
| Auth | Supabase Auth (카카오, 구글) | 앱과 동일한 인증 |
| 배포 | Vercel | 자동 배포, Edge Functions |
| 이메일 | Resend | 사전등록 확인 메일 |

## 📁 프로젝트 구조

```
hanbang-web/
├── CLAUDE.md                    # 이 파일
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
│   │   │   ├── claude.ts        # Claude API 호출
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

## 🎨 디자인 시스템

앱과 동일한 컬러 팔레트 (실제 [globals.css](apps/web/src/app/globals.css) 기준 — 이 문서는 ground truth 아니므로 globals.css 가 항상 우선):

```css
/* Primary - Noir / Atelier */
--noir-800: #1C1917;
--noir-900: #0D0D0F;
--noir-soft: #2D2D33;
--charcoal: #4A4A52;

/* Accent - Atelier Dusty Rose (브랜드 메인 brown) */
--rose-500: #795252;      /* 버튼·헤더 그라데이션 시작 */
--rose-600: #946a6a;      /* 그라데이션 끝 */
--rose-light: #D4AFA0;
--rose-pale: #E8D5CD;

/* 보조 액센트 — Rose Champagne (일부 컴포넌트에서 raw 사용) */
/* #C4967E / #9A6B62 — 새 코드는 가능하면 위 rose-* 토큰 사용 */

/* Background - Warm Ivory */
--ivory-50: #fcf9f8;
--ivory-100: #fcf9f8;
--ivory-200: #f6f3f2;
--ivory-warm: #FAF7F2;
--ivory-deep: #F5F0E8;

/* Taupe */
--taupe-400: #B5ADA3;
--taupe-500: #504444;

/* Sage (secondary) */
--sage-500: #5a6147;

/* Gold */
--gold: #C9A96E;
```

폰트:
- 한글 제목: Noto Serif KR (300, 400, 500)
- 한글 본문: Noto Sans KR (300, 400, 500, 600)
- 영문 제목/숫자: Cormorant Garamond (300, 400, 600)

## 🔑 환경변수 (.env.local)

```
# Supabase (기존 앱과 동일한 프로젝트!)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# Claude AI
ANTHROPIC_API_KEY=sk-ant-xxx...

# Resend (이메일)
RESEND_API_KEY=re_xxx...

# 도메인
NEXT_PUBLIC_SITE_URL=https://hanbang.ai
```

## 🗄 Supabase 공유

모바일 앱과 **같은 Supabase 프로젝트**를 사용합니다.
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

## 🛠 개발 순서 (권장)

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
2. AI 채팅 (Claude API 연동)
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
