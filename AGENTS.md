## 최상위 규칙
모든 작업은 PRINCIPLES.md의 6개 원칙을 따른다.
충돌 시 우선순위: P1 > P3 > P2 > P4 > P5 > P6.
모든 AI 호출은 ai_interactions_log에 기록되며,
모든 커플 의사결정은 decision_nodes에 기록된다.

---

# 웨딩한방 웹 (hanbang.ai) - Codex 가이드

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
| AI | OpenAI Responses API (GPT-5.6 Luna·Terra) | 전환 브랜치 기준. 운영 활성화는 별도 안전 게이트 |
| Auth | Supabase Auth (카카오, 구글) | 앱과 동일한 인증 |
| 배포 | Vercel | 자동 배포, Edge Functions |
| 이메일 | Resend | 사전등록 확인 메일 |

## 📁 프로젝트 구조

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
│   │   │   ├── Codex.ts        # Codex API 호출
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

앱과 동일한 컬러 팔레트:

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

# Amora AI — OpenAI 전용 런타임. 안전 게이트 통과 후 명시적으로 활성화
AMORA_OPENAI_ENABLED=false
OPENAI_API_KEY=sk-xxx...
OPENAI_AMORA_PRIMARY_MODEL=gpt-5.6-terra
OPENAI_AMORA_FAST_MODEL=gpt-5.6-luna
OPENAI_AMORA_PRIMARY_REASONING_EFFORT=none
OPENAI_AMORA_FAST_REASONING_EFFORT=none

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
2. AI 채팅 (Codex API 연동)
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

Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that does not match DESIGN.md.
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

## Amora OpenAI Staged Migration Protocol

아모라의 OpenAI 전환은 원자적 런타임 교체가 완료될 때까지 단계적으로 취급한다.

- `AMORA_OPENAI_ENABLED`의 기본값은 `false`다. 기반 코드나 환경변수만 추가된 상태를 OpenAI 전환 완료로 보고하지 않는다.
- 허용 모델은 `gpt-5.6-luna`와 `gpt-5.6-terra`뿐이며, 임의의 alias나 다른 모델로 조용히 대체하지 않는다.
- 생성 호출은 `store: false`, 명시적 출력 상한, 자동 재시도 0회, 원문 감사 로그 금지를 유지한다.
- `store: false`를 Zero Data Retention으로 표현하지 않는다. 실제 데이터 보존·처리 지역·DPA·지원 채널은 별도 운영/법적 게이트다.
- 실제 전환 전에는 운영 DB 백업·복구 리허설, canonical 서버 대화 경계, 메시지 멱등성, 위기 응답, 비용 제한, route 통합 테스트를 먼저 통과시킨다.
- OpenAI 키나 원문 대화·첨부 내용은 코드, Git, 로그, 오류 메시지, 문서에 기록하지 않는다.
- 현재 단계와 남은 게이트는 `docs/AMORA_OPENAI_MIGRATION_PLAN_2026-07-14.md`를 기준으로 인수인계한다.

## WeddingCode Additional Fable-Adapted Protocol

전역 Fable식 운영 프로토콜에 더해, 웨딩코드 문항, 점수화, 결과 카피, 커플 비교, 희귀도, 신뢰도 주장 작업을 할 때는
`docs/wedding-code/31_fable_mode_adaptation_protocol_v0.1.md`를 먼저 읽고 따른다.

핵심 규칙:
- 숫자, 가격, 통계, 버전, URL, 인용문, 최신 데이터, 읽지 않은 파일 내용은 기억으로 말하지 않는다. 도구로 확인하거나 `UNVERIFIED`로 표시하거나 생략한다.
- 문항/결과/근거 문서는 초안 → 적대적 검수 → 주장 감사 → 수정 순서로 닫는다.
- "궁합", "결혼 성공", "심리 진단", "과학적으로 입증된 유형"처럼 과장될 수 있는 표현은 금지하고, 검증 가능한 범위의 "준비 방식", "대화 지점", "먼저 맞춰볼 기준"으로만 말한다.
- 코드 반영은 16문항과 scoring/copy gate가 문서에서 통과된 뒤 진행한다.
