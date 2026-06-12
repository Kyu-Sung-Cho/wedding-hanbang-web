## 최상위 규칙
모든 작업은 PRINCIPLES.md의 6개 원칙을 따른다.
충돌 시 우선순위: P1 > P3 > P2 > P4 > P5 > P6.
모든 AI 호출은 ai_interactions_log에 기록되며,
모든 커플 의사결정은 decision_nodes에 기록된다.

## 📍 현재 상태 (2026-06-11 기준 — 새 세션은 여기부터)
- **전략 최상위 문서**: `docs/MASTER_BLUEPRINT_2026-06-10.md` (포지셔닝·3층 구조·로드맵). 미션: "웨딩의 '웨'자를 몰라도, 추가금에 안 당하고, 결혼식까지 — AI 친언니 아모라". 부속: STRATEGY_REVIEW / EONNI_OS / COMMUNITY_ENGINE / WINWINWIN_VERDICT / CONSERVATIVE_VIABILITY / MOMENT_CATALOG + SESSION_SYNTHESIS_2026-06-11 (전부 docs/).
- **Week 1 수술 완료 (2026-06-11)**: 페르소나 자동화·AI 대본·피팅 스텁·B2B·청첩장·방명록·결제(Toss)·정산·전자계약·벤더포털 **코드 전체 삭제** (커밋 3개, 약 -2.5만 줄, 라우트 213→127). 실데이터 확인(payments·settlements·contracts 0행, 청첩장·방명록 각 2건 테스트) 후 진행. DB 테이블은 보존, 복구는 `pre-surgery` 태그. 예약(bookings)은 방문·상담 예약으로 단순화(취소는 아모라 채팅 cancel_booking). 축의금은 moneyStore/money.types로 분리되어 유지.
- **보안 핫픽스 완료 (2026-06-11)**: signup rate limit + enumeration 차단, chat-image RLS 커플 스코프(마이그레이션), proactive 배선(채팅 진입 시 1회 호출 — 모멘트 루프 활성). ※환불 API 수정은 이후 결제층 삭제로 함께 제거됨.
- **확정 결정**: 계약-법률 서비스 금지 / 견적 등기소 보류 / AI 유저 위장·유료 순위 영구 금지 / 업체 기능은 공급 확보 전 숨김 유지 / 거래 레일은 S1 게이트(업체 인터뷰) 통과 시에만 pre-surgery 태그에서 부활 / **견적·시세에 판정 금지(2026-06-12)**: 점수·등급·안전/위험·가격대분류·추정액 합산은 구성을 모르는 채 정확할 수 없어 제거 — 사실(확인 안 된 항목+출처 있는 평균가+지역 중위가 참고)과 절차(계약 전 질문 스크립트)만 노출. 같은 이유로 Contract Shield의 등급/점수도 재검토 후보.
- **Week 1 잔여분도 완료 (2026-06-11 저녁)**: ①DB 핫픽스 마이그레이션 작성(booking RPC service_role 전용·PII 뷰 8개 DROP·데모 시드 제거) ②Sentry·PostHog 초기화 + 퍼널 이벤트(signup_started/chat_message_sent/quote_check_submitted, UTM은 $pageview 자동) ③예절 가이드 (community) 그룹 이동으로 공개(시세는 이미 공개) ④`/check`→견적 진단 리다이렉트(UTM 보존). ~~키 입력 필요~~ → **완료(2026-06-11 밤)**: Vercel에 `NEXT_PUBLIC_SENTRY_DSN`/`NEXT_PUBLIC_POSTHOG_KEY` 입력 + Redeploy, 프로덕션에서 $pageview·autocapture·web vitals 수신 확인. PostHog: US Cloud, Free 플랜, Session Replay 비활성(채팅 민감정보), 키는 프로젝트 hanbang(ID 465762).
- **JSONB 원자 병합 1차 완료 (2026-06-11)**: progress 전체 덮어쓰기로 인한 커플 동시수정 유실(감사 critical)을 `apply_journey_progress_patch` RPC(변경 키만 DB에서 원자 병합, service_role 전용)로 해소. toolExecutor의 ctx-스냅샷 쓰기 11곳을 `patchJourneyProgress`로 전환(+`saveProgress`는 diff→patch). RPC 미배포 시 기존 방식 폴백이라 무중단. **남은 후속**: ①`__events`/`__amora_actions` 등 배열 키 동시수정의 좁은 경합(완전 해소는 일정/액션 테이블 분리) ②create/cancel_booking 예산동기화 2곳(toolExecutor.ts:2522·2766, fresh-read라 위험 작아 생략).
- **마이그레이션 5개 적용 완료 (2026-06-11 밤)**: quote_check 조건 필드·cohort 익명성 RLS·chat-image 커플 스코프·week1 DB 핫픽스(booking RPC 회수+PII 뷰 8개 DROP+데모 시드 제거)·원자 병합 RPC — Supabase SQL Editor에서 실행, PostgREST 원격 검증으로 확인(PII 뷰 404, 데모 시드 0행, RPC P0002 정상 예외). **감사 critical 4건 프로덕션에서 전부 종결.** 원자 병합도 폴백→RPC 경로로 전환됨.
- **온보딩 상견례 추가 완료 (2026-06-11)**: 온보딩 Step3에 상견례 날짜 질문 추가 → API가 `upsertMomentEvent`로 `progress.__events`에 `momentType:"sanggyeonrye"` 태깅 저장(create·join 양쪽) + decision_nodes 기록. join 시 파트너 journey가 이미 있어도 상견례 이벤트가 없으면 병합(있으면 파트너 데이터 보존). 첫 관계 모멘트(상견례 D-3/D-1/D+1)가 가입 즉시 살아남. 랜딩 허수는 라이브 마케팅 표면(NumbersAnchor 등) 이미 출처 명기 상태로 확인 — `/landing`은 미링크·미색인 보존 페이지라 손대지 않음.
- **테스트 인프라 복구 (2026-06-11 밤)**: 떠돌던 미커밋 테스트 5종(vendorMapper·authStore·checklist·rateLimit·sanitize, 145개) 수리·커밋 + vitest/jsdom 설치 + `npm test`(turbo) 연결 — 어제 감사의 "로컬 typecheck/build 깨짐" 해소, typecheck·build·test 전부 그린. 미사용 @tosspayments/tosspayments-sdk 제거(mammoth는 채팅 docx 추출에 사용 중이라 유지). QA 스크린샷 PNG 115개 정리 + gitignore.
- **견적 진단 정밀화 + 시세 자동화 (2026-06-11 심야)**: ①진단 엔진을 지역별 중위가 비교로 전환(서울 350 vs 경기/인천 230 — 2분법이 경기 정상 견적을 미끼가격으로 오판하던 버그 제거), 결과에 `marketComparatorLabel`로 비교 기준 명시, toolExecutor의 죽은 중복 엔진 218줄 삭제, 회귀 테스트 10개. ②참가격 시세를 price.go.kr AJAX에서 자동 수집하는 `npm run update:market-prices` 파이프라인 구축(`marketPricesData.generated.ts` 재생성, 구조 검증 내장) — 수동 전사가 2026-02 전국 합산을 통째로 오입력했고(원본이 3/27 개정됨) 3·4월 공백도 있었음. 현재 2026년 4월 기준. **시세 갱신은 격월로 스크립트 재실행** (참가격 격월 발표).
- **법적 리스크 감사 + Contract Shield 판정 제거 (2026-06-12)**: 견적 체크 리팩토링 후 전수 감사 — 업체명 노출(공개 표면 제외 확인✅)·표시광고(출처 명기✅)·개인정보(공개 API 요약만✅)·참가격 스크래핑(공공데이터+출처표시, 격월 13회 경량✅). 발견·수정 2건: ①Contract Shield가 "{업체명} 계약은 진행하지 않는 편이 안전해요" 류 업체 상대 부정 문장 생성 → 업체명 제거+문서 확인 상태 사실 서술로 교체, 등급/점수 제거, "진행 가능" 보증성 라벨 제거(분쟁 시 신뢰 리스크) ②실태조사 인용 인과 단정 완화. AI 프롬프트에도 업체 상대 권고·단정 금지 지침.
- **모멘트 lifecycle 통합 = 이미 완료 확인 (2026-06-12)**: proactive 라우트가 `__events`의 momentType 이벤트(상견례 등)+예식일 기반 모멘트를 D-3/D-1/D+1 셀로 계산·발화, dedupe는 유니크 인덱스로 레이스까지 차단 — 추가 작업 불필요. KST 날짜 연산 회귀 테스트 10개 신규(momentLoop.test.ts, 총 165개). 남은 선택지: D+1 답변의 memoryKeys 전용 수집 파이프(현재는 일반 채팅 AI가 처리 — 공백 아님).
- **유통 테스트 준비 완료 (2026-06-12)**: `docs/DISTRIBUTION_TEST_KIT_2026-06-12.md`(UTM 링크·운영 수칙·PostHog 퍼널 설정법·기록표) + `docs/KIN_ANSWER_BANK_2026-06-12.md`(유형별 답변 초안 8종). 프로덕션 사전점검: `/check` UTM 보존 리다이렉트 ✅, 예절·시세 비로그인 200 ✅. SEO 입구 3페이지(예절·시세·견적체크)에 개별 메타데이터(title/OG/canonical) 추가 — 링크 미리보기 개별화.
- **다음 단계 (Week 1 마지막 + D8~30)**: ⑤지식iN·카페 정직글 7일 유통 테스트 — **유일하게 남은 Week 1 항목, 사용자 실행 필요** (키트·답변뱅크로 즉시 시작 가능) → (선택) JSONB 후속: 일정/액션 테이블 분리. 30일차 G1 판정(채널 전환 ≥3%).
- **발견된 SEO 공백 (2026-06-12, D31-60 후보)**: 예절(1,214줄)·시세 페이지가 전부 클라이언트 렌더링이라 **서버 HTML에 본문 0** — 메타데이터는 추가했으나 진짜 색인은 콘텐츠 SSR 전환 필요(서버 컴포넌트로 콘텐츠 정적 렌더 + 인터랙션만 클라이언트 분리). 시세 SEO 양산 전 선행 과제.
- **백로그**: `docs/KNOWN_ISSUES_2026-06-10.md` (마이너 15건).

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
