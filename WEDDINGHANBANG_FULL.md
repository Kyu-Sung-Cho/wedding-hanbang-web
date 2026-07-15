# 웨딩한방 (hanbang.ai) — 전체 서비스 종합 문서

> ⚠️ **2026-04-28 코드 스냅샷(레거시)**: 아래 AI 제공자·모델·기능·의존성 정보는 당시 상태를 보존한 기록입니다. 현재 전환 브랜치는 OpenAI Responses API(GPT-5.6 Luna·Terra) 전용이며, 운영 활성화 여부는 배포 기록과 `docs/AMORA_OPENAI_MIGRATION_PLAN_2026-07-14.md`를 우선합니다.

> **작성일**: 2026-04-28
> **도메인**: hanbang.ai / www.hanbang.ai
> **저장소**: github.com/Kyu-Sung-Cho/wedding-hanbang-web
> **하나도 빠짐없이** — 운영원칙·기능·페이지·API·DB·디자인·컴플라이언스 전체

---

## 📋 목차

1. [서비스 한 줄 요약 & 미션](#1-서비스-한-줄-요약--미션)
2. [운영 원칙 (6 Principles)](#2-운영-원칙-6-principles)
3. [타겟 사용자](#3-타겟-사용자)
4. [고객이 겪는 4대 문제](#4-고객이-겪는-4대-문제)
5. [핵심 차별화](#5-핵심-차별화)
6. [기술 스택 & Monorepo 구조](#6-기술-스택--monorepo-구조)
7. [디자인 시스템 (Atelier Hub)](#7-디자인-시스템-atelier-hub)
8. [전체 페이지 트리](#8-전체-페이지-트리)
9. [고객(B2C) 기능 상세](#9-고객b2c-기능-상세)
10. [AI 아모라 시스템 상세](#10-ai-아모라-시스템-상세)
11. [커뮤니티 시스템](#11-커뮤니티-시스템)
12. [모바일 앱 (iOS/Android)](#12-모바일-앱-iosandroid)
13. [업체 포털 (B2B)](#13-업체-포털-b2b)
14. [관리자 패널](#14-관리자-패널)
15. [설문조사 시스템](#15-설문조사-시스템)
16. [결제·계약·정산](#16-결제계약정산)
17. [API 라우트 전수 목록](#17-api-라우트-전수-목록)
18. [데이터베이스 스키마 (Supabase)](#18-데이터베이스-스키마-supabase)
19. [인증/보안/RLS](#19-인증보안rls)
20. [상태관리 (Zustand)](#20-상태관리-zustand)
21. [인프라 & 외부 연동](#21-인프라--외부-연동)
22. [컴플라이언스 (AI 기본법, 전자상거래법)](#22-컴플라이언스-ai-기본법-전자상거래법)
23. [수익 모델 & 로드맵](#23-수익-모델--로드맵)
24. [현황 & 남은 작업](#24-현황--남은-작업)

---

## 1. 서비스 한 줄 요약 & 미션

### 한 줄 요약
**AI 웨딩 플래너 "아모라(Amora)"와 함께, 결심부터 정착까지 결혼 준비 0-1 전 과정을 한 곳에서 해결하는 올인원 웨딩 플랫폼.**

### 미션
**한국 결혼 시장의 unique winner — 최고이자 유일한 consumer-side AI 웨딩 플래너.**
결심부터 정착까지 0-1 전 과정을 옆에서 밀착 케어하는 AI "아모라"가 있는 곳. 광고비가 추천을 흔들지 않는 유일한 플랫폼.

### 핵심 가치 제안
- **AI 아모라** — 24시간 전담 웨딩 플래너 (실제 데이터를 읽고 수정하는 진짜 플래너, 챗봇 아님)
- **커뮤니티** — 분기별 동기방 + 후기/Q&A + AI 자동 댓글
- **통합 관리** — 예산/일정/업체/청첩장/축의금/AI 대본 한곳에
- **웹+앱 동기화** — 같은 Supabase 백엔드로 실시간 양방향 sync

---

## 2. 운영 원칙 (6 Principles)

> **모든 의사결정의 기준**. 기능 추가, 광고 수용, vendor 등록, 카피 결정 — 흔들릴 때마다 6개 원칙으로 돌아옴.

### P1. 소비자 trust는 단기 매출보다 항상 우선한다
- 광고비 5배를 제안받아도 추천 알고리즘에 반영하지 않는다.
- 부정적 리뷰 삭제 요청은 vendor 등급·매출과 무관하게 거절한다.
- "이 vendor 추가금 평균보다 30% 높음" 정보는 vendor가 광고주여도 표시한다.
- **Test**: 이 결정이 1년 뒤 reddit/디시/네이트판에 폭로되면 자랑스러운가?

### P2. Depth가 breadth를 이긴다
- "100개의 평범한 기능"이 아니라 "20개의 압도적 기능"을 목표한다.
- 신규 기능 제안 시 첫 질문: "기존 기능 중 아직 압도적이지 않은 게 있는데 이걸 먼저 한 이유는?"
- 모든 기능은 4-axis KPI(coverage·memory·trust·decision) 중 최소 1개 측정 가능한 개선 필수.
- **Test**: 이 기능을 쓴 사용자가 "이건 다른 데서는 못 할 것 같다"고 말하는가?

### P3. Memory가 product의 중심이다
- 신규 기능 제안 시 두 번째 질문: "이 기능이 Memory에 어떤 노드/엣지를 추가하나?"
- Memory에 기여하지 않는 stand-alone 기능은 우선순위 후순위.
- 일회성 답변도 "왜 이걸 물었나"를 Memory에 기록 — 다음 nudge의 재료.
- **구현**: `decision_nodes`, `decision_edges` (2026-04-23 완료)
- **Test**: 이 기능 없이도 다른 챗봇이 같은 답을 줄 수 있는가? → 차별화 0.

### P4. Vendor는 모집하지 않고 자격으로 거른다
- vendor 등록 자격 3가지: 가격 공개 동의 + 추가금 명시 동의 + 공정위 표준약관 사용 동의.
- 등록 후 위반 시 즉시 삭제. 광고주여도 예외 없음.
- "Vendor 5,000개" 자랑하지 않는다. "Vendor 500개, 모두 가격 약속 동의" 자랑한다.
- **Test**: 이 vendor를 등록하고 1년 뒤 사용자가 "추가금 폭탄 맞았다"라고 쓸 가능성?

### P5. 모든 차별화 주장은 숫자로 증명한다
- "추가금을 줄여드립니다" ❌ → "베타 50쌍 평균 추가금 174만원 → 89만원" ✅
- "AI가 정확합니다" ❌ → "추가금 예측 ±20% 이내 정확도 82%" ✅
- 모든 통계엔 출처(기관명+연도) 인라인 표기. 검증 불가 숫자는 사용 금지.
- **Test**: "출처는?"이라고 물었을 때 30초 안에 답할 수 있는가?

### P6. AI 기본법 compliance를 처음부터 내장한다
- AI 기반 서비스임을 사이트에 사전 고지 (`/ai-policy` 페이지).
- 아모라의 모든 답변에 "AI 생성" 표시.
- 위험관리방안 1페이지 문서 작성 및 5년 보관.
- 사람 관리·감독 책임자 지정 (대표).
- `ai_interactions_log` 테이블로 모든 호출 기록 (2026-04-23 완료).

### 충돌 시 우선순위
**P1 (Trust) > P3 (Memory) > P2 (Depth) > P4 (Vendor) > P5 (숫자) > P6 (법)**

### 절대 타협 불가 약속 3개
1. **광고-추천 완전 분리**
2. **Vendor 자격 기준 공개**
3. **Couple Memory는 회사 자산 아니라 커플 자산**

---

## 3. 타겟 사용자

### B2C (예비 부부)
- **주 타겟**: 결혼 6개월~1년 전부터 준비하는 한국 예비 신부·신랑
- **연령**: 20~30대 (특히 2030 맞벌이 커플)
- **상황**:
  - 결혼 결심~상견례 단계 (D-360+)
  - 본격 준비 단계 (D-180~D-60)
  - 마무리 단계 (D-60~D-Day)
  - 결혼 후 정착 단계 (예단·폐백 마무리, 첫 명절)

### B2B (웨딩 업체)
- **스튜디오** (전국 약 1,200개)
- **드레스샵** (전국 약 600개)
- **메이크업샵** (전국 약 400개)
- **예식장**, **한복**, **예물**, **신혼여행**, **꽃장식** 등
- **타겟 사이즈**: 영세~중소 (대형 프랜차이즈는 후순위)

### 미사용자 풀 (사전등록 대상)
- 이메일 사전등록 (`preregistrations`)
- UTM 추적 (web/app/instagram)

---

## 4. 고객이 겪는 4대 문제

### 1) "뭐부터 해야 할지 모르겠어요"
- 결혼 준비 항목만 50여 가지
- 정보는 넘치는데 뭐가 맞는 정보인지 판단 불가
- 순서도 모르고, 빠뜨리는 항목 발생

### 2) "어떤 업체가 좋은지 모르겠어요"
- 전국 웨딩 업체 64%가 가격 미공개
- 블로그 후기는 광고인지 진짜인지 구분 불가
- 발품 팔아도 비교 기준이 없음

### 3) "예산을 어떻게 짜야 할지 모르겠어요"
- 스드메 평균 추가비용 174만원 — 견적과 실제 금액 차이 큼
- 초기 예산 364만원 → 최종 540만원 (평균 48% 초과, 한국소비자원)
- 어디에 얼마를 써야 적정인지 기준 없음

### 4) "시간은 없는데 할 일은 많고, 의견 조율이 어려워요"
- 맞벌이 커플은 함께 방문할 시간 부족
- 둘의 취향·예산 의견 충돌
- 연간 1,505건 결혼 준비 관련 소비자 불만 (2023 소비자원)

---

## 5. 핵심 차별화

| 기존 서비스 | 웨딩한방 |
|-------------|----------|
| 단순 정보 나열 | AI가 직접 데이터 수정·관리 (Tool Use) |
| 업체 광고 중심 | 예산·취향 기반 AI 맞춤 추천 (광고 분리) |
| 고객 OR 업체 한쪽만 | 양면 플랫폼 (고객 + 업체 + 관리자) |
| 웹 OR 앱 따로 | 웹+앱 실시간 동기화 (같은 Supabase) |
| 혼자서 준비 | 커플 연동 + AI 3자 상담 + 갈등 중재 |
| 예산 감으로 관리 | 한국소비자원 시세 기반 예산 관리 |
| 예절은 블로그 검색 | 25파트 체계적 가이드 + AI 연동 |
| 후기는 검색 | 분기별 동기방 + AI 자동 댓글 |
| 단순 검색 | Memory(decision_nodes) 기반 개인화 |

---

## 6. 기술 스택 & Monorepo 구조

### Monorepo (pnpm + Turborepo)

```
wedding-hanbang-web/
├── apps/
│   ├── web/          ← Next.js 16 (hanbang.ai)
│   └── mobile/       ← Expo SDK 54 (iOS/Android, ai.hanbang.wedding)
└── packages/
    ├── shared/       ← 공통 타입, 상수, 유틸
    └── design-tokens/ ← colors / typography / spacing / radius
```

- **Root**: `pnpm@9.15.0` + `turbo@^2.3.0`, Node ≥ 20
- **Workspace**: `@hanbang/web`, `@hanbang/mobile`, `@hanbang/shared`, `@hanbang/design-tokens`

### 웹 (apps/web)
| 레이어 | 기술 | 버전 |
|--------|------|------|
| Framework | Next.js (App Router) | **16.1.6** |
| Language | TypeScript (strict) | 5.9.3 |
| Runtime React | React | 19.2.3 |
| Styling | Tailwind CSS | 4 |
| State | Zustand | ^5.0.11 |
| Auth/DB | Supabase (PostgreSQL + Auth + Realtime + Storage) | @supabase/ssr ^0.8.0, supabase-js ^2.95.3 |
| AI | Anthropic Claude API | @anthropic-ai/sdk ^0.74.0 (Opus 4.7) |
| 결제 | 토스페이먼츠 | @tosspayments/tosspayments-sdk ^2.5.0 |
| 이메일 | Resend | ^6.9.1 |
| Animation | Framer Motion | ^12.34.0 |
| Icons | Lucide React | ^0.563.0 |
| 모니터링 | Sentry (devDependency) | @sentry/nextjs ^10.47.0 |
| 배포 | Vercel | Auto deploy from main |

### 모바일 (apps/mobile)
| 레이어 | 기술 | 비고 |
|--------|------|------|
| Framework | Expo SDK 54 | |
| Navigation | Expo Router 6 | File-based routing |
| Language | TypeScript | |
| Styling | React Native StyleSheet | NativeWind 미사용 |
| Auth | 웹 콜백 브릿지 | 카카오/구글/Apple |
| Storage | AsyncStorage | 2.2.0 |
| Apple Sign In | expo-apple-authentication | ^55.0.13 |
| Bundle ID | `ai.hanbang.wedding` | |
| 빌드 | EAS Build | TestFlight 준비 중 |

### packages/shared
- `src/types/` — 공통 TypeScript 타입 (database, chat, vendor 등)
- `src/constants/` — 카테고리, 가격, 디자인 상수
- `src/utils/` — format, validators

### packages/design-tokens
- `colors.ts` — Atelier Hub 팔레트
- `typography.ts` — 한글 세리프/산세리프 + 영문 Cormorant
- `spacing.ts`, `radius.ts`

### 환경변수 (전체 15개)

**필수**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

**기능별**:
- `RESEND_API_KEY` (이메일, 없으면 silent skip)
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (장소 검색 tool)
- `TOSS_SECRET_KEY`, `NEXT_PUBLIC_TOSS_CLIENT_KEY` (결제)
- `ADMIN_PASSWORD` (관리자 간이 인증)
- `AMORA_SERVICE_USER_ID`, `NEXT_PUBLIC_AMORA_USER_ID` (AI 댓글 작성자)
- `NEXT_PUBLIC_LAUNCH_MODE` (`coming_soon` / `live` 스위치)
- `NEXT_PUBLIC_SITE_URL`
- `NODE_ENV`

---

## 7. 디자인 시스템 (Atelier Hub)

### 컬러 팔레트 (2026-04 기준)

```css
/* Primary — Dusty Rose */
--primary: #795252;
--primary-hover: #946a6a;

/* Secondary — Sage Green (Private 탭/안정감) */
--secondary: #5a6147;
--secondary-container: #dee6c4;

/* Surface — 샴페인 배경 */
--surface: #fcf9f8;
--surface-container-low: #f6f3f2;
--surface-container: #f0eded;
--surface-variant: #e4e2e1;
--surface-container-lowest: #ffffff;

/* Text */
--on-surface: #1b1c1c;
--on-surface-variant: #504444;
--taupe-400: #B5ADA3;

/* Accent */
--gold: #C9A96E;
--outline-variant: #d4c2c2;
```

### 타이포그래피
- **한글 제목**: Noto Serif KR (font-serif-kr) — 우아한 세리프
- **한글 본문**: Noto Sans KR — 가독성 우선
- **영문/숫자**: Cormorant Garamond — 에디토리얼 헤드라인

### 디자인 5원칙
1. **보더 없음** — 카드는 shadow로만 구분 (`shadow-[0_8px_30px_rgb(0,0,0,0.04)]`)
2. **배경 레이어** — 샴페인(#fcf9f8) 위 흰색 카드
3. **여유로운 여백** — luxury = space you don't fill
4. **세리프 제목 + 산세리프 본문** — 에디토리얼 리듬
5. **그라디언트 CTA** — `from-[#795252] to-[#946a6a]` + rose shadow

### 반응형 브레이크포인트
- Mobile: default
- Tablet: `sm: 640px+`
- Desktop: `lg: 1024px+`
- XL: `xl: 1280px+`

### 예외: Vendor 포털
- **다크 프로페셔널 테마** (의도적으로 Atelier 제외) — B2B 사용자에게 "도구"라는 인식

---

## 8. 전체 페이지 트리

### 8.1 웹 (apps/web/src/app) — 60+ 페이지

#### Public / 마케팅
- `/` — 메인 랜딩 (CustomerHero, PainPoints, Solutions, …)
- `/customer` — 별도 URL 유입 추적용 고객 랜딩
- `/business` — B2B 업체 파트너십 랜딩
- `/business_dress` — 드레스샵 전용 (랜딩 + 설문)
- `/business_makeup` — 메이크업샵 전용
- `/business_studio` — 스튜디오 전용
- `/customersurvey` — 고객 사전 설문조사
- `/about` — 서비스 소개
- `/beta` — 베타 테스터 모집
- `/ai-policy` — AI 기본법 사전 고지 페이지
- `/demo` / `/demo/login` — 데모 모드 진입

#### 인증 (auth)
- `/login` — 로그인 (이메일 + 카카오 + 구글 + 데모)
- `/onboarding` — 4단계 온보딩
- `/reset-password` — 비밀번호 재설정
- `/auth/mobile-callback` — 모바일 OAuth 콜백 브릿지

#### 고객 앱 (app) — 인증 필수
- `/dashboard` — 대시보드 (D-day, 진행률, 카테고리)
- `/chat` — AI 아모라 채팅
- `/budget` — 예산 관리
- `/schedule` — 일정 관리
- `/vendors` — 업체 탐색
- `/vendors/[id]` — 업체 상세
- `/vendors/favorites` — 찜한 업체
- `/bookings` — 내 예약
- `/bookings/[id]` — 예약 상세 (계약/결제/서명)
- `/etiquette` — 25파트 예절 가이드
- `/fitting` — AI 드레스 피팅 (Coming Soon)
- `/invitations` — 청첩장 메인
- `/invitations/templates` — 템플릿 갤러리
- `/invitations/[id]/edit` — 청첩장 편집
- `/invitations/[id]/stats` — 조회/RSVP 통계
- `/money` — 축의금 관리
- `/scripts` — AI 대본 (축사/건배사/인사말)
- `/market-prices` — 한국소비자원 시세
- `/settings` — 설정 (프로필, 커플, 알림, 탈퇴)

#### 청첩장 게스트 뷰 (public)
- `/invite/[slug]` — 게스트 청첩장 페이지
- `/guestbook/[slug]` — 게스트북

#### 커뮤니티 (community)
- `/community` — 메인 피드 (Atelier 3-pane)
- `/community/[category]` — 카테고리별 피드
- `/community/post/write` — 글쓰기
- `/community/post/[id]` — 글 상세
- `/community/cohort` — (구) 동기방 진입점
- `/community/cohort/[id]` — 동기방 (채팅·정보판·타임라인 3탭)
- `/community/quick-review` — 퀵 리뷰
- `/community/guestbook` / `/community/guestbook/new` — 방명록
- `/community/my/posts` — 내가 쓴 글
- `/community/my/bookmarks` — 북마크
- `/community/my/upvoted` — 좋아요한 글
- `/community/vendor/[name]` — 업체 태그 페이지

#### 업체 포털 (vendor) — 다크 테마
- `/vendor/login`
- `/vendor/register`
- `/vendor/service` — 업체 서비스 안내
- `/vendor/privacy` — 개인정보처리방침
- `/vendor/terms` — 이용약관
- `/vendor/(portal)/dashboard`
- `/vendor/(portal)/products`
- `/vendor/(portal)/bookings`
- `/vendor/(portal)/contracts`
- `/vendor/(portal)/contracts/templates`
- `/vendor/(portal)/messages`
- `/vendor/(portal)/staff`
- `/vendor/(portal)/timeslots`
- `/vendor/(portal)/profile`
- `/vendor/(portal)/analytics`
- `/vendor/(portal)/settlements`
- `/vendor/(portal)/settings`

#### 관리자 (admin)
- `/admin/login`
- `/admin` — 메가 대시보드 (사전등록·업체·고객·예약·정산·인사이트)

### 8.2 모바일 (apps/mobile/app) — 35+ 페이지

#### Tabs (네비게이션 5탭)
- `/(tabs)/dashboard`
- `/(tabs)/chat`
- `/(tabs)/community`
- `/(tabs)/profile`
- (기타 탭 진입은 dashboard에서)

#### 인증
- `/(auth)/login` — 카카오/구글/Apple/이메일
- `/(auth)/signup`
- `/(auth)/forgot-password`

#### 진입
- `/index` — 스플래시 + 라우팅
- `/onboarding/index` — 6슬라이드 가이드
- `/webview` — 웹 콜백 브릿지

#### 핵심 기능
- `/budget/index`
- `/schedule/index`
- `/vendors/index`, `/vendors/[id]`
- `/bookings/index`
- `/etiquette/index`
- `/market-prices/index`
- `/settings/index`

#### 커뮤니티
- `/community/_layout`
- `/community/post/write`, `/community/post/[id]`
- `/community/cohort/[id]`, `/community/cohort-discovery`
- `/community/guestbook/[slug]`
- `/community/my-posts`, `/community/my-bookmarks`
- `/community/quick-review`

---

## 9. 고객(B2C) 기능 상세

### 9.1 랜딩페이지 (`/`)

| 섹션 | 컴포넌트 | 설명 |
|------|----------|------|
| 히어로 | `Hero.tsx` / `CustomerHero.tsx` | "한방" 골드 그라데이션 + 미리체험 CTA |
| 고충 | `PainPoints.tsx` | 결혼 준비의 어려움 공감 (다크 배경) |
| 솔루션 | `Solutions.tsx` | AI/예산/일정 핵심 |
| 비교 | `Comparison.tsx` | 기존 vs 웨딩한방 비교표 |
| 가상피팅 | `VirtualFitting.tsx` | AI 드레스 피팅 미리보기 |
| 통계 | `Stats.tsx` | 출처 기반 검증된 수치만 |
| 이용방법 | `HowItWorks.tsx` | 4단계 |
| 후기 | `Testimonials.tsx` | |
| CTA | `CTA.tsx` | 사전등록 폼 (`preregistrations`) |
| 스파클 | `SparkleCanvas.tsx` | 캔버스 애니메이션 |

**Coming Soon 모드**: `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`이면 비인증 사용자는 일부 페이지 잠금, "미리 체험" CTA로 안내.

### 9.2 인증 & 온보딩

#### 로그인 (`/login`)
- **이메일/비밀번호** (Supabase Auth)
- **카카오 OAuth** (이메일 미수집, 비즈니스 앱 아님)
- **구글 OAuth**
- **Apple Sign In** (iOS) — Team ID `6RSK726532`, Services ID `ai.hanbang.wedding.web`
- **데모 모드** — 쿠키 `demo_mode=true`, 가상 데이터(김지은, 2026.10.15, 예산 2,500만원)

#### 비밀번호 재설정 (`/reset-password`)
- Resend 발송 → 새 비밀번호 입력

#### 온보딩 (`/onboarding`) — 4단계
1. **역할 선택**: 신부 / 신랑
2. **커플 연동**: 혼자 준비 / 파트너 초대코드 `WH-XXXXXX` 입력
3. **웨딩 정보**: 예식 날짜, 장소, 총 예산
4. **진행 체크리스트**: 이미 완료한 항목 체크 + 비용 입력 (만원→원 변환)

→ `/api/onboarding` 호출 → couples + wedding_journeys + 초기 progress JSONB 생성

### 9.3 대시보드 (`/dashboard`)

#### 에디토리얼 히어로 레이아웃
- 히어로 배너: 그라디언트 + 세리프 환영 메시지
- 2열 스탯: D-day 카드(96px 세리프) + 예산 오버뷰
- 3열 하단: 다가오는 일정 / 빠른 실행 / Spotlight 카드

#### 기능
- **D-day 자동 계산** (대형 숫자 + 그라디언트 텍스트)
- **전체 진행률** (원형 프로그레스, 완료/전체 카테고리)
- **긴급 태스크 알림** — D-day 기준 임박 항목 (URGENT_TASKS 로직)
- **파트너 활동 피드** (Realtime 구독)
- **20개 카테고리 그리드** — 미시작/진행중/완료 (3-state)
- **카테고리 클릭 → 체크리스트 모달**
- **커플 초대 코드 공유** + 클립보드 복사
- **빠른 액션**: 아모라 상담 / 예산 / 일정 바로가기
- **Service Guide 슬라이드** — 첫 방문 시 6슬라이드 (localStorage 1회)

### 9.4 AI 채팅 (`/chat`) — 아모라

> 상세는 [§10. AI 아모라 시스템](#10-ai-아모라-시스템-상세) 참조.

#### 화면 구성
- **상단**: 탭 (`shared` 둘이 함께 / `private` 나만의 1:1)
- **좌측**: 채팅 영역 (메시지 리스트 + 입력)
- **우측**: 정보 패널 (`ChatInfoPanel` — 예산/체크리스트/다가오는 일정 사이드 탭)
- **중재 배너**: 갈등 감지 시 표시
- **새 채팅 banner**: 200개 메시지 임계 도달 시

#### 핵심 기능
- 24시간 실시간 AI 상담 (Claude Opus 4.7, 스트리밍 SSE)
- Tool Use 27개 (예산/일정/업체/예약/시세/장소/견적분석)
- 커플 채팅 갈등 자동 감지 → 중재 모드
- 추천 버튼 (후속 질문 2~3개 제안)
- 첫 입장 시 자동 인사 (`/api/chat/proactive`)
- 업체 카드 / 예절 가이드 카드 / 액션 카드 / 견적분석 카드
- 파일 첨부 (이미지·PDF·Word·Excel, 최대 5개, 5~10MB)
- 드래그앤드롭 업로드
- 새 채팅 시작 (탭별: shared/private 분리 처리)
- 피드백 학습 (👍/👎 + 자유 입력)

#### 멀티 채팅
- 최대 5개 동시 운영
- 200개 메시지 도달 시 새 채팅 권장 배너
- 비공개(private) 탭 — 본인만 보는 1:1 (RLS로 격리)

#### 자동 스크롤 정책 (2026-04-28 개선)
- 사용자가 위로 스크롤한 상태(바닥에서 120px 이상)면 자동 스크롤 정지
- 새 메시지 추가 시는 항상 따라감

### 9.5 예산 관리 (`/budget`)

#### 에디토리얼 레이아웃
- 히어로 배너
- 3열 스탯: TOTAL BUDGET / SPENT / REMAINING
- Budget Breakdown 컬러 세그먼트 바
- 스드메 패키지 섹션
- 기타 카테고리 2열 그리드
- 숨은 비용 + AI Spotlight

#### 20개 카테고리

| 카테고리 | 권장 시작 | 마감 | 기본 배분 |
|----------|-----------|------|-----------|
| 상견례 | D-360 | D-300 | - |
| 예식장 | D-360 | D-270 | 20% |
| 스튜디오 | D-300 | D-150 | 10% |
| 드레스/턱시도 | D-300 | D-120 | - |
| 메이크업 | D-240 | D-60 | - |
| 예물/반지 | D-270 | D-120 | 12% |
| 한복 | D-180 | D-60 | - |
| 예단 | D-180 | D-60 | - |
| 신혼여행 | D-180 | D-30 | 12% |
| 혼수/가전·가구 | D-180 | D-30 | - |
| 신혼집 | D-180 | D-60 | - |
| 청첩장 | D-120 | D-45 | - |
| 본식스냅/영상 | D-120 | D-30 | - |
| 웨딩구두 | D-90 | D-30 | - |
| 부케/꽃장식 | D-90 | D-14 | - |
| 답례품 | D-90 | D-14 | - |
| 사회/축가 | D-90 | D-14 | - |
| 함 | D-60 | D-7 | - |
| 폐백 | D-60 | D-7 | - |
| 예비비 | - | - | - |

> *카테고리는 `wedding_journeys.progress` JSONB 필드 안에 저장됨. 별도 budget_items 테이블 미사용.*

#### 기능
- 카테고리별 예산/지출 인라인 편집 (클릭 → 수정)
- **숨은 비용 경고** — 카테고리별 평균 추가금 ⚠️
- **분담 추적** — 커플 / 신부측 / 신랑측 / 양가
- 자동 초과 감지 (빨강 하이라이트)
- 커스텀 카테고리 추가/삭제
- SDM 패키지 통합 관리 (스튜디오+드레스+메이크업)
- **예약 내역 연동** — `/api/bookings/mine`에서 확정 예약 금액 자동 반영
- **시세 비교 링크** → `/market-prices`

### 9.6 일정 관리 (`/schedule`)

#### 두 가지 보기
1. **타임라인 뷰** — D-180 → D-Day, 카테고리별 체크리스트 펼침
2. **캘린더 뷰** — 월간 달력 + 카테고리 색상 구분

#### 기능
- D-day 기반 자동 체크리스트 (20 카테고리, 132 항목)
- **임박 알림** — 3일/2주/1주 색상 구분
- 다가오는 일정 최대 5개 표시
- 이벤트 CRUD (모달: 날짜/제목/메모/카테고리)
- 카테고리별 상태 변경 (예정/진행중/완료)
- 체크리스트 인라인 토글
- AI가 결혼일 기준 자동 플랜 생성

> 일정은 `progress.__events` JSONB에 저장. 별도 `schedules` 테이블 미사용.

### 9.7 업체 탐색 (`/vendors`)

#### 에디토리얼 카드 그리드
- 히어로 배너
- 3열 스탯: TOTAL / FAVORITES / NEW
- 검색 + 카테고리 필터 pill
- AI 추천 안내 배너 (선호도 미설정 시)
- 에디토리얼 3열 업체 카드
- AI Curation Spotlight

#### 8개 카테고리 탭
전체 / 스튜디오 / 드레스 / 메이크업 / 예식장 / 한복 / 예물 / 신혼여행

#### 검색·필터
- 텍스트 검색 (상호/스타일/지역, 300ms 디바운스)
- 카테고리 필터 pill
- 가격대 필터
- 지역 필터

#### 업체 카드
- AI 추천 배지 (점수: 카테고리 우선순위 +3 / 평점 +1~2 / 추천플래그 +1)
- 예약 가능 배지 (real-time slots)
- 별점 + 리뷰 수
- 위치 + 가격대
- 스타일 태그
- 찜 하트 버튼 (토글)

#### 행동 추적
- `customer_events`, `search_logs`에 검색/클릭/뷰 이벤트 기록 → AI 추천 정밀도 향상

#### 아모라 디렉터 (플로팅)
컨텍스트 기반 메시지 우선순위:
1. 예산 초과 감지 (10점)
2. 찜 3개+ → 비교 제안 (8점)
3. 선호도 미설정 (5점)
4. 카테고리 선택 팁 (3점)
5. 첫 방문 환영 (1점)

### 9.8 업체 상세 (`/vendors/[id]`)

#### 구성
- 갤러리 (포트폴리오 사진, 좋아요 토글)
- 설명, 위치, 연락처
- 상품 카탈로그
- 스태프 프로필
- 예약 가능 시간대 (CatchTable 스타일 3단계: 날짜→시간→상품)
- 리뷰 섹션
- 찜 토글
- 메시지 보내기 (vendor_messages)
- 빈 상태: `NoAvailabilityPanel` (상품/시간/스태프 없을 때)

### 9.9 내 예약 (`/bookings`)

#### 상태 탭
전체 / 확정 / 대기 / 완료 / 취소

#### 예약 진행 흐름 (상태 머신)
```
PENDING_PAYMENT (결제 대기)
  → PAYMENT_HELD (에스크로 보관)
  → CONFIRMED (업체 확인)
  → SERVICE_DATE
  → COMPLETED (구매 확인)
  → SETTLED (정산)

분기:
  REJECTED → REFUNDED
  DISPUTED → RESOLVED_*
```

#### 진행 바 (4단계)
예약 → 계약 → 서명 → 결제

#### 알림
계약 서명 필요 시 "조치 필요" 표시

#### 예약 상세 (`/bookings/[id]`)
계약서 보기, 전자서명, 결제 상태, 영수증

### 9.10 청첩장 (`/invitations`)

#### 메인 (`/invitations`)
- 내 청첩장 목록
- 새 청첩장 만들기

#### 템플릿 (`/invitations/templates`)
- `invitation_templates` 테이블
- 카테고리별 템플릿 갤러리

#### 편집 (`/invitations/[id]/edit`)
- 사진 업로드/정렬 (`/api/invitations/[id]/photos`)
- 본문 편집 (제목, 부제, 일시, 장소, 인사말)
- 스타일/색상 선택
- 게스트북 활성화
- RSVP 활성화
- 계좌번호 관리 (`invitation_accounts` — 신부/신랑 양가)

#### 통계 (`/invitations/[id]/stats`)
- 조회수 (`invitation_visits`)
- RSVP 수 (참석/불참/미정)
- 게스트북 메시지 수

#### 게스트 뷰 (`/invite/[slug]`) — public
- 슬러그 기반 공개 페이지
- 사진 슬라이드
- 일정/지도
- RSVP 폼
- 게스트북 작성
- 계좌번호 복사
- 카카오 공유

#### AI 채팅 사이드 패널
- 청첩장 작성 중 아모라에게 문구 추천 받기

### 9.11 축의금 관리 (`/money`)

#### 기능
- **신부측/신랑측 분리** — 양쪽 따로 입력
- 관계별 입력 (가족/친척/친구/회사)
- CSV 엑셀 내보내기
- 통계: 총액 / 평균 / 최고 / 최저
- 필터 pill (전체/받음/미확인)
- 인라인 추가/수정/삭제

> 데이터: `congratulatory_money` 테이블 (RLS 적용)

### 9.12 AI 대본 (`/scripts`)

#### 타입
- 신부 인사말 / 신랑 인사말
- 신부 부친 축사 / 신랑 부친 축사
- 신부 모친 축사 / 신랑 모친 축사
- 사회자 인사말
- 건배사

#### 기능
- Claude API 스트리밍 생성
- 즐겨찾기 (하트)
- 편집/삭제
- 저장 → `ai_scripts` 테이블

### 9.13 시세 정보 (`/market-prices`)

#### 데이터
- 한국소비자원 11개월 데이터 (2025.4~2026.2)
- 14개 지역별 비교
- 카테고리별 평균 (스드메/드레스/메이크업/예식장)
- 예식장 17개 선택항목 별도
- 성수기 vs 비수기 절약액
- 18개월 트렌드 차트

> 정적 데이터 — `constants/marketPrices.ts`에서 import. API 없음.

### 9.14 예절 가이드 (`/etiquette`) — 25개 파트

#### 주요 파트
1. 처가/시댁 첫인사 예절
2. 상견례 (양가 첫 만남) 예절
3. 예물·예단·함 예절
4. 청첩장 발송 예절
5. 본식 당일 예절
6. 신혼여행 후 인사 예절
7. 폐백 예절
8. 혼수 준비 예절
9. 축의금 예절
10. 결혼 후 첫 명절 예절
… (총 25개 파트, 100+ 섹션)

#### 콘텐츠 유형
- 체크리스트 (완료/미완료 토글, 대시보드 동기화)
- 팁 박스 / 경고 박스
- 대화 예시 (실제 상황별)
- 단계별 가이드
- 일정 추가 (예절 항목 → 캘린더 이벤트)
- 아모라 연동 (가이드 카드로 채팅 진입)

#### 잠금 정책 (Coming Soon 모드)
- 비인증 또는 `LAUNCH_MODE=coming_soon` 시 3번 파트까지 무료, 이상은 잠금
- 사이드바 + 이전/다음 버튼 모두 잠금 체크

### 9.15 AI 드레스 피팅 (`/fitting`) — Coming Soon

미리보기 4단계:
1. 전신 사진 업로드
2. AI 체형 분석
3. 드레스 가상 피팅 (A라인, 머메이드, 엠파이어)
4. 업체 매칭 & 예약

> Decart API 연동 예정. `fitting_requests` 테이블 비활성.

### 9.16 설정 (`/settings`)

#### 프로필
- 이름, 닉네임, 아바타
- 웨딩 날짜, 총 예산 수정

#### 커플 연동
- 초대 코드 표시 + 클립보드 복사
- 파트너 연결 상태
- 파트너 해제

#### 온보딩 재설정
- 웨딩 스타일, 우선순위 등 다시 설정

#### 알림 설정
- 카테고리별 알림 토글 (UI만, 저장 로직 일부 미연결)

#### 비밀번호 변경

#### 계정 삭제
- 사유 선택 (불만족 / 대안 서비스 / 결혼 완료 / 개인정보 / 사용빈도 / 기타)
- → `account_deletions` 기록
- → `auth.admin.deleteUser` 완전 삭제

---

## 10. AI 아모라 시스템 상세

### 10.1 캐릭터 설정
- **이름**: 아모라 (Amora) — 이전 이름 '아리아'에서 2026-03-06 변경
- **역할**: 한국 결혼 준비 전문 AI 플래너
- **톤**: 베테랑 웨딩 플래너 (매뉴얼 안 따름, 관찰자형)
- **모델**: Claude Opus 4.7

### 10.2 심리학 기반 설계 (감정 곡선)
| 단계 | D-day 범위 | 톤 |
|------|-----------|-----|
| 설렘기 | D-180+ | 꿈 함께 그리기 |
| 현실 충돌기 | D-120~180 | 부드러운 대안 제시 |
| 결정 피로기 | D-60~120 | 옵션 줄이기 |
| 마무리 불안기 | D-30~60 | 체크리스트 안심 |
| 최종 카운트다운 | D-14 이하 | 응원 우선 |

### 10.3 갈등 중재 (Mediation)

#### 자동 감지 패턴 (5분 쿨다운)
| ID | weight | 패턴 예시 |
|----|--------|-----------|
| fight | 5 | "싸웠어", "다퉜어", "말 안 해", "헤어지자", "결혼 취소" |
| blame | 4 | "왜 맨날 너만", "나만 양보", "내 말은 안 듣" |
| frustration | 3 | "스트레스", "지쳤어", "포기하고 싶" |
| helplessness | 2 | "어떻게 해야 할지", "막막해" |

#### 중재 프레임
- 양가 갈등 ≠ 관계 문제, = 기대치 차이
- 예산 갈등 본질 = "우리의 미래가 안전한가"
- 신부 예민함 = 완벽주의, 신랑 무관심 = 역할 모름

### 10.4 개인화 학습 (온보딩 5단계)
1. 웨딩 스타일 (미니멀/클래식/화려/자연)
2. 우선순위 3개 (스드메/예식장/예물 등)
3. 예산 성향 (절약/가성비/프리미엄)
4. 하객 규모 (50↓/50-100/100-200/200-300/300↑)
5. 지역

→ `journey.progress.__preferences`에 저장

### 10.5 피드백 학습 시스템 (3 Levels)

#### Level 1: 즉시 학습
같은 세션에서 "그게 아니라" 감지 → 다음 응답에 수정 반영

#### Level 2: 커플별 학습
`chat_feedback`에 저장 → 다음 대화에 반영

#### Level 3: 전역 학습
3명+ 동일 피드백 → 패턴 인식 → 모든 유저 적용

#### 자동 감지 6가지 패턴
- 교정: "아니", "그게 아니라"
- 재시도: "다시 해줘"
- 좌절: "이해를 못하네"
- 부정: "쓸모없", "별로"
- 혼란: 긴 답변 후 "?"
- 이탈: 긴 답변 후 "ㅇㅇ", "ㅋ"

### 10.6 AI Tools (27개 — Tool Use)

| 카테고리 | 도구 | 설명 |
|---------|------|------|
| **여정 수정** | `update_budget` | 총 예산 수정 |
| | `update_wedding_date` | 결혼일 변경 |
| | `update_task_status` | 태스크 상태 변경 |
| | `update_venue` | 예식장 변경 |
| **예산 조회/수정** | `get_budget_summary` | 예산 요약 조회 |
| | `update_category_budget` | 카테고리별 예산 수정 |
| | `add_custom_category` | 커스텀 카테고리 추가 |
| | `delete_category` | 카테고리 삭제 |
| | `reset_category` | 카테고리 초기화 |
| **일정** | `get_schedule_summary` | 일정 요약 |
| | `get_wedding_info` | 웨딩 정보 조회 |
| | `add_schedule_event` | 일정 추가 |
| | `update_schedule_event` | 일정 수정 |
| | `delete_schedule_event` | 일정 삭제 |
| | `toggle_checklist_item` | 체크리스트 토글 |
| | `get_schedule_events` | 일정 조회 |
| **업체** | `search_vendors` | 업체 검색 |
| | `check_vendor_availability` | 가용성 확인 |
| | `recommend_vendors` | 맞춤 추천 |
| | `get_vendor_detail` | 상세 정보 |
| **예약** | `get_available_slots` | 예약 가능 시간 |
| | `create_booking` | 예약 생성 |
| | `get_my_bookings` | 내 예약 조회 |
| | `cancel_booking` | 예약 취소 |
| **시세/외부** | `get_market_price` | 한국소비자원 시세 조회 |
| | `search_nearby_places` | 외부 장소 검색 (네이버 API) |
| | `analyze_quote` | 견적서 분석 (이미지/PDF) |

#### 실행 흐름
- 최대 Tool 라운드: **5회/요청**
- 타임아웃: **60초**
- 결과는 `ToolResult` 객체로 반환 → UI 카드(`ActionCard`/`VendorToolCard`) 렌더링
- 도구 실행 후 `authStore`/`journey` 자동 동기화

### 10.7 아모라 디렉터 (플로팅 컴포넌트)

`/vendors`, `/vendors/[id]` 페이지에 표시되는 컨텍스트 인식 플로팅 디렉터.

#### 카테고리별 팁
- **스튜디오**: 원본 USB / 앨범 추가비
- **드레스**: 속옷 / 글러브 별도
- **메이크업**: 리허설 포함 여부
- **예식장**: 최소보증인원
- **한복**: 혼주 한복 미리
- **예물**: 스타일 먼저
- **신혼여행**: 비수기 20-30% 절약

### 10.8 Memory 시스템 (Moat Wiring)

#### `decision_nodes` 테이블 (2026-04-23 신규)
- 커플 의사결정 노드
- `decision_type`: exploring / considering / decided / scheduled / booked / completed
- `confidence`, `reasoning`, `chosen_value`, `options_considered`
- `stage_tag`: planning_0 / preparation_1 / execution_2 / ceremony_3 / settlement_4
- `source`: chat / manual / import / vendor_booking / schedule / budget / onboarding / community

#### `decision_edges` 테이블
- 노드 간 관계
- `relationship`: depends_on / alternative_to / replaces / budget_shared / after / because_of
- UNIQUE(from_node_id, to_node_id, relationship)

#### `ai_interactions_log` 테이블
- 모든 AI 호출 기록 (AI 기본법 5년 보관 의무)
- `interaction_type`: chat_turn / tool_call / tool_result / amora_director / vendor_recommendation / feedback / community_amora_comment
- `specialist_type`: sangkyeonrye_advisor / contract_reviewer / budget_optimizer / ceremony_coordinator / settlement_companion / general
- 토큰/비용/지연시간/에러 추적
- RLS: 본인 로그 SELECT, INSERT/UPDATE는 service role only

### 10.9 채팅 메시지 스키마 (chat_messages)

| 컬럼 | 의미 |
|------|------|
| `sender_type` | 'bride' / 'groom' / 'ai' |
| `role` | 'user' / 'assistant' / 'system' |
| `visibility` | 'shared' / 'bride_private' / 'groom_private' |
| `target` | 메시지 대상 (예: 'partner', 'ai') |
| `request_id` | 멱등성 키 (2026-04-27 추가) |
| `stage_tag` | 진행 단계 태그 |
| `specialist_type` | 전문가 모드 |
| `metadata` | toolResults, attachments 등 JSONB |

---

## 11. 커뮤니티 시스템

### 11.1 메인 피드 (`/community`)

#### Atelier 3-pane 레이아웃
- **왼쪽 사이드바** (w-72/96): 네비 + 동기방 + 글쓰기 CTA
- **가운데**: Editor's Pick 배너 + 최신 글 피드
- **오른쪽 사이드바** (w-80/96): 인기글 + 위클리 펄스 + 게미피케이션 위젯

#### 기능
- 실시간 업데이트 (Supabase Realtime)
- 카테고리 탭 (7개)
- 정렬 (최신/인기/추천)
- 무한 스크롤
- 검색 (FTS, `community_posts.search_vector`)
- 서비스 배너 (매 10개 글마다)
- 태그 필터

### 11.2 PostCard (에디토리얼)
- 카테고리 뱃지 + 시간
- 세리프 제목 (text-2xl~28px)
- 본문 프리뷰 (line-clamp-2)
- 비용 데이터 (cost_data 있을 시)
- 하단: 아바타 + 닉네임 + 댓글/북마크/공유
- 오른쪽 이미지 (192×192, sm:w-48)

### 11.3 글쓰기 (`/community/post/write`)
- 실시간 자동 저장 (localStorage)
- 이미지/영상 업로드 (최대 5장, MP4/MOV/WebM 50MB)
- 작성/미리보기 탭
- 카테고리 선택
- 태그 입력
- 광고 표시 (일반/협찬/광고)
- 비용 공유 구조화 데이터 (`cost_data` JSONB)

### 11.4 글 상세 (`/community/post/[id]`)
- 투표 (업/다운)
- 북마크
- 댓글 + 대댓글 (Realtime)
- 작성자 정보 (아바타/랭크)
- 신고 기능 (`community_reports`)
- **AI 아모라 댓글** (자동 분석, `community_amora_comment` 타입)
- 서비스 CTA (카테고리별 맞춤)

### 11.5 동기방 (`/community/cohort/[id]`)

#### 분기별 그룹
- 2026년 1분기, 2분기, 3분기, 4분기...
- `cohort_rooms` 테이블에서 자동 배정 (`/api/community/cohort`)

#### 3탭 레이아웃

**채팅 탭** (`cohort_messages`)
- 실시간 메시지 (Supabase Realtime)
- 이미지 첨부 (📎 Paperclip)
- 글 공유 (🔗 Link2) — 커뮤니티 글 카드로 전송
- @ 멤버 멘션 (드롭다운 필터)
- 주제 필터 pill (전체/가격/후기/고민/잡담)
- 아바타 + 닉네임 + 랭크 뱃지

**정보판 탭** (`cohort_contracts`)
- 계약 정보 등록 (업체명, 기본가, 추가금)
- 카테고리별 동기 평균 가격 (5명+ 데이터)
- 전국 평균과 비교

**타임라인 탭** (`cohort_timeline_events`)
- 동기 활동 피드
- 예약/계약/투어 완료 이벤트
- "OO님이 XX 완료!" 메시지

#### `cohort_stats` View
- 동기방 통계 집계 (멤버 수, 평균 가격 등)

### 11.6 Avatar 시스템 (3단계 fallback)
1. 유저 업로드 프로필 사진
2. 이모지 아바타
3. **DiceBear notionists API** — 닉네임 기반 자동 생성 (일관된 캐릭터)

### 11.7 게미피케이션

#### 랭크 (Lv.1~5)
새싹 → 준비중 → 전문가 → 마스터 → 선배

#### 경험치
- 글쓰기 +10
- 댓글 +5
- 업보트 받음 +2
- 출석 (`/api/community/gamification/login`) +N

#### 테이블
- `community_xp_log` — XP 이벤트 로그
- `community_streaks` — 연속 출석
- `community_achievements` — 업적

### 11.8 내 활동
- `/community/my/posts` — 내가 쓴 글
- `/community/my/bookmarks` — 북마크
- `/community/my/upvoted` — 좋아요한 글

### 11.9 Editor's Pick
- `is_weekly_best` 또는 `is_pinned` 글 자동 배너
- 세리프 3~4xl 제목
- 관리자 수동 지정 (주간 자동화 예정)

### 11.10 AI 통합
- 글에 아모라 자동 댓글 (`/api/community/ai-comment`)
- Service CTA (AI 상담 유도)
- Service Banner (피드 중간)
- Spotlight 카드 (우측 사이드바)

### 11.11 온보딩 가이드 슬라이드
- **Service Guide**: 대시보드 첫 방문 시 6슬라이드
- **Community Guide**: 커뮤니티 첫 방문 시 5슬라이드
- 시나리오 기반 (기능 나열 X)
- localStorage 1회만 표시
- 미니 UI 목업 내장

### 11.12 게스트북 (community)
- `/community/guestbook` — 전체 방명록
- `/community/guestbook/new` — 새 방명록 만들기
- `guestbooks`, `guestbook_messages` 테이블

### 11.13 Quick Review (`/community/quick-review`)
- 빠른 후기 작성 폼 (간단 입력 → 자동 카드화)

### 11.14 Vendor 태그 페이지 (`/community/vendor/[name]`)
- 특정 업체에 대한 모든 글 모아보기
- `community_vendor_tags` 테이블

---

## 12. 모바일 앱 (iOS/Android)

### 12.1 핵심 기능 (웹과 실시간 동기화)
- 대시보드
- AI 아모라 채팅
- 예산 관리 (숨은 비용 + 분담 추적)
- 일정 관리 (체크리스트)
- 업체 탐색 + 예약 (CatchTable 스타일)
- 커뮤니티 (피드 + 글 작성)
- 동기방 채팅
- 설정 (파트너 관리)

### 12.2 모바일 전용 기능
- **파트너 메시징** — 신부/신랑 색상 구분
- **카카오/구글/Apple 로그인** (Apple Team ID 6RSK726532)
- **웹 콜백 브릿지 OAuth** (`/auth/mobile-callback` 웹 페이지 + `/webview` 모바일 페이지)
- **Expo Notifications** — 푸시 알림
- **파트너 초대코드** 복사
- **커플 연동**

### 12.3 앱 가이드
- 첫 실행 시 6슬라이드 (FlatList 스와이프)
- AsyncStorage 1회만 표시

### 12.4 Bearer 토큰 호환
- 63개 API가 `createClientFromRequest()` 사용
- Bearer (모바일) + Cookie (웹) 둘 다 지원

### 12.5 미구현
- AI 드레스 피팅 (Coming Soon)
- EAS Build → TestFlight 제출 (준비 중)

---

## 13. 업체 포털 (B2B)

> **다크 프로페셔널 테마** — 의도적으로 Atelier 팔레트 제외

### 13.1 업체 인증

#### `/vendor/login`
- 이메일/비밀번호 (소셜 로그인 제거됨)
- 비밀번호 찾기

#### `/vendor/register` — 3단계 등록

**1단계: 기본 정보**
- 상호명
- 업종 (스튜디오/드레스/메이크업/예식장/한복/예물/신혼여행)
- 대표자명
- 연락처, 이메일, 비밀번호

**2단계: 상세 정보**
- 주소
- 가격대
- 설명
- 스타일 태그

**3단계: 사업자 인증**
- 사업자등록번호 (국세청 진위 확인 가능)
- 사업자등록증 사본 업로드
- 약관 동의 (이용약관 + 개인정보처리방침)

### 13.2 업체 대시보드 (`/vendor/(portal)/dashboard`)

#### 승인 상태 배너
- ✅ 승인됨 — "노출 중" (초록)
- ⏳ 심사 중 — "1~2 영업일" (금색)
- ❌ 거절됨 — 빨간 배너 + 프로필 수정 안내

#### 통계 카드
- 오늘 예약 / 대기 예약 / 이달 조회수 / 평균 별점

#### 오늘 예약 목록
- 시간, 고객명(신부/신랑), 메모, 상태

#### 빠른 액션
- 상품관리 / 시간대관리 / 예약관리(대기 건수)

#### 최근 예약 테이블 (최근 5건)

### 13.3 상품·패키지 관리 (`/vendor/(portal)/products`)
- CRUD
- 필드: 상품명, 설명, 가격, 할인가, 소요시간, 수용인원, 이미지
- 상품별 별도 시간대 설정 가능

### 13.4 시간대 관리 (`/vendor/(portal)/timeslots`)
- 요일별 가용 시간 (월~일, 9시~21시)
- 시간대별 최대 예약 수
- `vendor_timeslots`, `product_timeslots`, `staff_timeslots` 3종

### 13.5 예약 관리 (`/vendor/(portal)/bookings`)

#### 탭
전체 / 확정 / 대기 / 완료 / 취소

#### 수동 예약 추가
- 방문/전화 예약 직접 입력
- 날짜/시간/상품/고객명/연락처/금액/메모

#### 상태 변경 버튼
- 대기 → 확인 / 거절
- 입금 완료 → 서비스 시작
- 서비스 중 → 서비스 완료 (정산 플로우 시작)

#### 수동 예약 태그
시스템 외 예약 구분 표시

### 13.6 계약 관리 (`/vendor/(portal)/contracts`)

#### 계약서 목록
상태별 (초안 / 발송 / 열람 / 서명 / 입금)

#### 계약서 템플릿 (`/contracts/templates`)
- 업체별 양식 생성/수정
- **변수 치환** (고객명, 금액, 날짜 등)
- 웨딩 서비스 기본 약관

#### 전자서명 플로우
1. 템플릿에서 계약서 생성
2. 고객에게 이메일 발송 (Resend)
3. 고객이 온라인 전자서명 (`/api/contracts/[id]/sign`)
4. 입금 추적

#### `standard_contract_clauses` (2026-04-24)
- 표준 계약 조항 라이브러리
- 카테고리: cancel / refund / delivery / service_change / damage / tip / misc
- severity: required / recommended / optional
- 환불 % 명시
- AI가 계약서 검토 시 참조

### 13.7 메시지 (`/vendor/(portal)/messages`)
- 업체-고객 직접 메시징 (`vendor_messages` 테이블)
- 예약 관련 소통

### 13.8 스태프 관리 (`/vendor/(portal)/staff`)
- 팀원 프로필: 이름, 역할, 가용 여부, 사진
- 예약에 스태프 배정
- 스태프별 시간대 (`staff_timeslots`)

### 13.9 분석 (`/vendor/(portal)/analytics`)
- 월간/분기 예약 건수 및 매출 추이
- 고객 인사이트 (선호 스타일, 검색 키워드)
- 경쟁사 벤치마킹
- 데이터 소스: `vendor_daily_stats`, `search_logs`, `customer_events`, `vendor_views`

### 13.10 정산 관리 (`/vendor/(portal)/settlements`)
- 정산 완료 vs 대기 내역
- 주간 정산 (매주 월요일)
- 수수료: **베타 7%, 정규 10%**
- 정산 상세: 예약 금액, 수수료 차감, 지급 금액, 정산일

### 13.11 프로필 (`/vendor/(portal)/profile`)
- 상호명, 업종, 설명, 사진
- 위치, 주소
- 사업자 인증 상태
- 포트폴리오 사진 (`vendor_photos`)

### 13.12 설정 (`/vendor/(portal)/settings`)
- 이메일 알림
- 예약 알림
- 메시지 알림
- 마케팅 수신 동의
- 계정 삭제

### 13.13 약관 페이지
- `/vendor/service` — 서비스 안내
- `/vendor/terms` — 이용약관
- `/vendor/privacy` — 개인정보처리방침

---

## 14. 관리자 패널

### 14.1 인증 (`/admin/login`)
- 별도 관리자 로그인 (고객/업체와 분리)
- `is_admin` 플래그 + `ADMIN_PASSWORD` 환경변수

### 14.2 대시보드 (`/admin`)

#### 핵심 지표
- 총 사전등록 수
- 총 업체 수 (상태별)
- 총 예약 수
- 총 고객 수
- 유입 소스별 통계 (web/app/instagram)

#### 사전등록 관리
- 이메일 목록
- 소스 추적 (web/app/instagram)
- UTM 분석 (utm_source/medium/campaign)
- CSV 내보내기

#### 업체 관리
- 승인 / 거절 / 정지
- 상세 정보 조회
- 상태 모니터링
- 시드 업체 추가 (`/api/admin/seed-vendors`)

#### 고객 관리
- 프로필 조회
- 온보딩 완료 여부
- 파트너 연동 상태
- 활동 추적
- 탈퇴 로그 (`account_deletions`)

#### 예약 관리
- 전체 예약 조회
- 필터 (업체/고객/날짜/상태)
- 수수료 추적
- 상태 개입

#### 정산 관리
- 주간 정산 처리 (매주 월요일)
- 전체 지급 내역
- 분쟁 처리
- 수수료 재계산
- 개별 정산 처리 (`/api/admin/settlements/[id]/process`)

#### 인사이트 (`/api/admin/insights`)
- 고객 여정 퍼널
- 업체 성과 랭킹
- 카테고리 인기도
- 예산 분포
- 지역 분포

#### 관리자 계정 관리 (`/api/admin/admins`)

---

## 15. 설문조사 시스템

### 15.1 고객 설문 (`/customersurvey`)

#### 구조
- 9개 섹션 (Screening → 정보탐색 → 플래너 사용 → 채널 → 기능선호 → 가격 → 관심서비스 → 구매의향 → 인적사항)
- 진행률 표시
- 부적격(screen_out) 응답자 분기
- 임시 저장 + 이어서 작성
- 페이지 이탈 경고
- 키보드 네비게이션 (Enter)
- 완료 시간 추적 (`completion_time_seconds`)

#### 질문 유형
- 단일 선택 (라디오)
- 다중 선택 (체크박스)
- 리커트 척도
- 주관식 (text)
- 연락처 폼

#### 저장
`customer_survey_responses` 테이블 (방어적 ALTER ADD COLUMN 패턴)

### 15.2 B2B 설문 (3종)

#### 페이지
- `/business_studio` — 스튜디오 설문
- `/business_dress` — 드레스샵 설문
- `/business_makeup` — 메이크업샵 설문

#### 공통 컴포넌트
- `B2BSurveyPage` — 통일된 UI
- `B2BNav`, `Hero`, `PainPoints`, `Solutions`, `Comparison`, `Features`, `PartnerTypes`, `CTA`

#### 질문 분리 (2026-03-06 업데이트)
- q7 → q7a (플래너) + q7b (플랫폼)
- q9 → "플래너 비용 부담" + "플랫폼 비용 부담" 분리
- q21_1 — "맞춤 컨설팅 포함"
- `q_survey_feedback` — 마지막 자유 입력

저장: `b2b_survey_responses` 테이블 (`/api/b2b-survey`)

---

## 16. 결제·계약·정산

### 16.1 결제 (토스페이먼츠 V2)

#### 마이그레이션 이력
- 초기: 포트원 (PortOne)
- **2026-03-01: 토스페이먼츠로 전환** (`20260301100000_portone_to_toss.sql`)

#### 방식
- 리다이렉트 방식 (카드/계좌이체/간편결제)
- 결제 확인: `confirmPayment(paymentKey, orderId, amount)` 서버 검증
- 인증: Basic Auth (`secretKey:` Base64)
- 개발 모드: 테스트 키로 실결제 없이 테스트

#### API
| 경로 | 설명 |
|------|------|
| `POST /api/payments/prepare` | 결제 준비 (orderId 생성) |
| `POST /api/payments/complete` | 결제 확인 (Toss confirm) |
| `POST /api/payments/webhook` | 웹훅 수신 (`PAYMENT_STATUS_CHANGED`) |
| `GET /api/payments/[id]` | 결제 상태 조회 |
| `POST /api/payments/[id]/refund` | 환불 처리 (`cancelPayment`) |

### 16.2 계약 워크플로우

```
예약 확정
  → 계약서 자동 생성 (템플릿 + 변수 치환)
  → 고객 이메일 발송 (Resend)
  → 고객 전자서명 (/api/contracts/[id]/sign)
  → 결제 진행
  → 정산 대기열 등록
```

### 16.3 정산

| 항목 | 상세 |
|------|------|
| 주기 | 매주 월요일 |
| 수수료 | 베타 7%, 정규 10% |
| 계산 | 지급액 = 예약 금액 - 수수료 |
| 상태 전이 | `service_completed → settled` |
| 처리 | 관리자 일괄 또는 개별 |

### 16.4 vendor_bookings 실거래 추적 (2026-04-24 신규)

| 컬럼 | 의미 |
|------|------|
| `amount` | 초기 예약 견적 |
| `contracted_amount` | 계약서 확정 금액 |
| `actual_amount` | 실결제 금액 (Give-to-Get 데이터) |
| `user_uploaded_receipt_url` | 유저 업로드 영수증 |
| `contract_signed_at` | 계약 체결 시점 |
| `receipt_verified_at` / `receipt_verified_by` | 영수증 검증 |

→ 추가금 통계 (베타 50쌍 평균 174만원 → 89만원) 산출 기반 데이터.

---

## 17. API 라우트 전수 목록

> **총 88+ 개의 `route.ts`** 파일. 모두 `createClientFromRequest` 또는 `getServiceClient` 사용.

### 17.1 인증 (5)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/callback` | OAuth 콜백 (카카오/구글/Apple) |
| GET | `/api/auth/me` | 현재 사용자 프로필 |
| POST | `/api/auth/signup` | 이메일 회원가입 |
| POST | `/api/auth/forgot-password` | 비밀번호 찾기 |
| DELETE | `/api/auth/delete` | 계정 삭제 |

### 17.2 프로필 & 여정 (3)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/PUT | `/api/profile` | 프로필 조회/수정 |
| POST | `/api/onboarding` | 온보딩 완료 |
| GET/PUT | `/api/journey` | 웨딩 여정 조회/수정 |

### 17.3 커플 (2)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/couple/code` | 초대코드 생성/조회 |
| POST | `/api/couple/link` | 초대코드로 파트너 연동 |

### 17.4 AI 채팅 (4)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/chat` | AI 응답 (SSE 스트리밍 + Tool Use) |
| POST | `/api/chat/messages` | 메시지 DB 저장 |
| POST | `/api/chat/proactive` | 첫 인사 메시지 |
| POST/GET | `/api/chat/feedback` | 피드백 저장/조회 |

### 17.5 예약 (3)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/bookings` | 예약 생성 |
| GET | `/api/bookings/mine` | 내 예약 목록 |
| GET | `/api/bookings/[id]` | 예약 상세 |

### 17.6 계약 (3)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/contracts/templates` | 템플릿 조회 |
| GET | `/api/contracts/[id]` | 계약서 상세 |
| POST | `/api/contracts/[id]/sign` | 전자서명 |

### 17.7 결제 (5)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/payments/prepare` | 결제 준비 |
| POST | `/api/payments/complete` | 결제 확인 |
| POST | `/api/payments/webhook` | 웹훅 |
| GET | `/api/payments/[id]` | 결제 조회 |
| POST | `/api/payments/[id]/refund` | 환불 |

### 17.8 업체 탐색 B2C (4)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/vendors` | 검색/필터 |
| GET | `/api/vendors/[id]` | 상세 |
| GET | `/api/vendors/[id]/photos` | 포트폴리오 |
| GET | `/api/vendors/[id]/staff` | 스태프 |
| GET/POST | `/api/favorites` | 찜 토글 |

### 17.9 일정 & 이벤트 (1)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/api/events` | 이벤트 추적 |

### 17.10 메시지 (2)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/api/messages` | 업체-고객 메시지 |
| GET | `/api/messages/threads` | 스레드 |

### 17.11 청첩장 (11)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/api/invitations` | 청첩장 CRUD |
| GET/PUT/DELETE | `/api/invitations/[id]` | 상세 |
| GET | `/api/invitations/[id]/stats` | 통계 |
| GET/POST | `/api/invitations/[id]/photos` | 사진 |
| POST | `/api/invitations/[id]/photos/upload` | 업로드 |
| POST | `/api/invitations/[id]/photos/reorder` | 순서변경 |
| DELETE | `/api/invitations/photos/[photoId]` | 사진 삭제 |
| GET/PUT | `/api/invitations/[id]/accounts` | 계좌번호 |
| GET/POST | `/api/invitations/[id]/rsvp` | RSVP |
| GET/POST | `/api/invitations/[id]/guestbook` | 게스트북 |
| GET | `/api/invitations/templates` | 템플릿 |
| GET | `/api/invitations/guest/[slug]` | 게스트 뷰 |

### 17.12 축의금 (2)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/api/money` | 축의금 |
| PUT/DELETE | `/api/money/[id]` | 수정/삭제 |

### 17.13 AI 대본 (2)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/api/scripts` | 대본 CRUD |
| PUT/DELETE | `/api/scripts/[id]` | 수정/삭제 |
| POST | `/api/scripts/generate` | 생성 (Claude) |

### 17.14 게스트북 (3)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/api/guestbook` | 게스트북 |
| GET | `/api/guestbook/[slug]` | 게스트북 상세 |
| GET/POST | `/api/guestbook/[slug]/messages` | 메시지 |

### 17.15 설문 (2)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/survey` | 고객 설문 |
| POST | `/api/b2b-survey` | B2B 설문 |

### 17.16 사전등록 (1)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/preregister` | 이메일 사전등록 |

### 17.17 커뮤니티 (22)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET/POST | `/api/community/posts` | 글 CRUD |
| GET/PUT/DELETE | `/api/community/posts/[id]` | 글 상세 |
| POST | `/api/community/posts/[id]/vote` | 투표 |
| POST | `/api/community/posts/[id]/bookmark` | 북마크 |
| POST | `/api/community/posts/[id]/view` | 조회 카운트 |
| POST | `/api/community/posts/[id]/report` | 신고 |
| GET | `/api/community/posts/voted` | 좋아요한 글 |
| GET/POST | `/api/community/comments` | 댓글 |
| PUT/DELETE | `/api/community/comments/[id]` | 댓글 수정/삭제 |
| POST | `/api/community/comments/[id]/vote` | 댓글 투표 |
| GET | `/api/community/search` | FTS 검색 |
| POST | `/api/community/upload` | 이미지/영상 |
| GET | `/api/community/profile` | 프로필 |
| PUT | `/api/community/profile/wedding-date` | 결혼일 갱신 |
| GET | `/api/community/popular-tags` | 인기 태그 |
| GET/POST | `/api/community/vendor-tags` | 업체 태그 |
| GET | `/api/community/vendor-tags/[name]` | 업체 태그 상세 |
| GET/POST | `/api/community/cohort` | 동기방 배정 |
| GET/POST | `/api/community/cohort/[id]/messages` | 메시지 |
| GET/POST | `/api/community/cohort/[id]/contracts` | 계약 정보 |
| GET/POST | `/api/community/cohort/[id]/timeline` | 타임라인 |
| GET/POST | `/api/community/gamification` | XP/랭크 |
| POST | `/api/community/gamification/login` | 출석 |
| POST | `/api/community/ai-comment` | AI 자동 댓글 |

### 17.18 업체 포털 B2B (16+)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/vendor/me` | 내 업체 정보 |
| POST | `/api/vendor/register` | 등록 |
| PUT | `/api/vendor/profile` | 프로필 수정 |
| PUT | `/api/vendor/settings` | 알림 설정 |
| GET/POST | `/api/vendor/products` | 상품 |
| PUT/DELETE | `/api/vendor/products/[id]` | 상품 수정/삭제 |
| GET/POST | `/api/vendor/timeslots` | 시간대 |
| GET | `/api/vendor/bookings` | 예약 목록 |
| PATCH | `/api/vendor/bookings/[id]/status` | 상태 변경 |
| PUT | `/api/vendor/bookings/[id]` | 예약 수정 |
| GET/POST | `/api/vendor/contracts` | 계약서 |
| PUT/DELETE | `/api/vendor/contracts/[id]` | 계약서 수정/삭제 |
| POST | `/api/vendor/contracts/[id]/send` | 발송 |
| GET/POST/PUT/DELETE | `/api/vendor/contracts/templates/[id]` | 템플릿 |
| GET | `/api/vendor/settlements` | 정산 |
| GET | `/api/vendor/analytics` | 분석 |
| GET/POST | `/api/vendor/staff` | 스태프 |

### 17.19 관리자 (11)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/admin/auth` | 관리자 로그인 |
| GET | `/api/admin/registrations` | 사전등록 목록 |
| GET | `/api/admin/vendors` | 업체 목록 |
| PATCH | `/api/admin/vendors/[id]` | 승인/거절/정지 |
| POST | `/api/admin/seed-vendors` | 시드 추가 |
| GET | `/api/admin/customers` | 고객 목록 |
| GET | `/api/admin/bookings` | 예약 목록 |
| GET/POST | `/api/admin/settlements` | 정산 |
| POST | `/api/admin/settlements/[id]/process` | 개별 처리 |
| GET | `/api/admin/insights` | 인사이트 |
| GET/POST | `/api/admin/admins` | 관리자 계정 |

---

## 18. 데이터베이스 스키마 (Supabase)

### 18.1 마이그레이션 이력 (24개)

| 일자 | 파일 | 설명 |
|------|------|------|
| 2026-02-01 | `preregistrations.sql` | 사전등록 |
| 2026-02-05 | `vendor_portal_system.sql` | 업체 포털 |
| 2026-02-10 | `onboarding_couple_chat.sql` | 온보딩/커플/채팅 |
| 2026-02-15 | `fix_rls_recursion.sql` | RLS 재귀 버그 패치 |
| 2026-02-18 | `fix_signup_trigger.sql` | 가입 트리거 수정 |
| 2026-02-20 | `vendor_system.sql` | 업체 시스템 |
| 2026-02-24 | `customer_tracking.sql` | 행동 추적 |
| 2026-02-25 | `admin_role.sql` | 관리자 |
| 2026-03-01 | `contract_payment_system.sql` | 계약/결제 |
| 2026-03-01 | `fix_rls_and_seed.sql` | RLS 수정 + 시드 |
| 2026-03-01 | `schema_improvements.sql` | 스키마 개선 |
| 2026-03-01 | `portone_to_toss.sql` | 토스페이먼츠 전환 |
| 2026-03-02 | `phase3_invitation_ai_script.sql` | 청첩장/AI대본 |
| 2026-03-25 | `community.sql` | 커뮤니티 |
| 2026-03-25 | `gamification.sql` | 게미피케이션 |
| 2026-04-08 | `community_v2.sql` | 동기방 |
| 2026-04-23 | `missing_tables.sql` | chat_feedback/summaries 등 누락 보강 |
| 2026-04-24 | `moat_wiring.sql` | decision_nodes/edges, ai_log, contract_clauses |
| 2026-04-24 | `contract_clauses_seed.sql` | 표준 약관 시드 |
| 2026-04-24 | `preregistrations_beta_fields.sql` | 베타 필드 |
| 2026-04-27 | `chat_request_id_idempotency.sql` | 멱등성 키 |
| 2026-04-27 | `chat_private_visibility.sql` | private 탭 가시성 |
| 2026-04-27 | `chat_view_reset.sql` | 뷰 리셋 |

### 18.2 테이블 카테고리별 전체 목록 (50+)

#### 인증/프로필
- `profiles` — 유저 기본 (baseline schema)
- `community_profiles` — 커뮤니티 전용 (닉네임/랭크/XP)
- `account_deletions` — 탈퇴 사유

#### 커플/여정
- `couples` — 커플 관계 (bride_id, groom_id)
- `wedding_journeys` — 진행 상황
  - `progress.__preferences` — 온보딩 선호도
  - `progress.__events` — 일정 이벤트
  - `progress.{category}` — 카테고리별 예산/지출/체크리스트

#### 채팅 (AI + 커플)
- `chat_messages` — 메시지 (sender_type, role, visibility, request_id, stage_tag, specialist_type)
- `chat_summaries` — 대화 요약
- `chat_feedback` — 피드백 학습

#### Memory & AI 로깅 (2026-04-24)
- `decision_nodes` — 의사결정 노드
- `decision_edges` — 노드 관계
- `ai_interactions_log` — AI 호출 로그 (5년 보관)
- `standard_contract_clauses` — 표준 계약 조항 라이브러리

#### 커뮤니티
- `community_posts` — 게시글 (search_vector 포함)
- `community_comments` — 댓글
- `community_votes` — 투표
- `community_bookmarks` — 북마크
- `community_reports` — 신고
- `community_vendor_tags` — 업체 태그
- `community_xp_log` / `community_streaks` / `community_achievements` — 게미피케이션

#### 동기방
- `cohort_rooms` — 분기별 방
- `cohort_members` — 멤버십
- `cohort_messages` — 채팅
- `cohort_contracts` — 계약 정보
- `cohort_timeline_events` — 타임라인
- `cohort_stats` (View) — 통계

#### 업체
- `vendors` — 업체 (baseline + ALTER 다수)
- `vendor_products` — 상품
- `vendor_photos` / `vendor_images` — 사진
- `vendor_photo_likes` — 사진 좋아요
- `vendor_staff` — 스태프
- `vendor_timeslots`, `product_timeslots`, `staff_timeslots` — 시간대 3종
- `vendor_bookings` — 예약 (amount, contracted_amount, actual_amount, receipt 추적)
- `vendor_contracts` / `vendor_contract_templates` / `contracts` / `contract_templates`
- `vendor_messages` — 업체-고객 메시지
- `vendor_favorites` — 찜
- `vendor_reviews` — 리뷰
- `vendor_views` / `vendor_daily_stats` — 통계
- `vendor_settlements` / `settlements` — 정산
- `payments` — 결제

#### 청첩장
- `invitations`
- `invitation_photos`
- `invitation_accounts` — 신부/신랑 계좌
- `invitation_rsvp`
- `invitation_guestbook`
- `invitation_visits` — 방문 통계
- `invitation_templates` — 템플릿

#### 기타
- `congratulatory_money` — 축의금
- `ai_scripts` — AI 대본
- `customer_events` / `search_logs` — 행동 추적
- `customer_survey_responses` — 고객 설문 (q1~q23, screen_out)
- `b2b_survey_responses` — B2B 설문
- `preregistrations` — 사전등록 (UTM)
- `guestbooks` / `guestbook_messages` — 게스트북
- `customer_insights` — 인사이트
- `fitting_requests` — 드레스 피팅 (Coming Soon)

### 18.3 베이스라인 스키마 분리 이슈
다음 테이블은 `CREATE TABLE` migration이 없고 `ALTER`만 존재 (초기 DB는 별도 baseline SQL 필요):
`profiles`, `vendors`, `vendor_products`, `vendor_bookings`, `vendor_images`, `vendor_favorites`

### 18.4 RLS 적용 테이블 (45+)
거의 모든 사용자 데이터 테이블에 ENABLE ROW LEVEL SECURITY + 정책 적용.

대표 패턴:
- 본인 데이터만 SELECT/INSERT/UPDATE/DELETE
- service_role는 ALL 허용 (서버 사이드 처리용)
- 공개 참조 데이터(예: standard_contract_clauses)는 인증 사용자 SELECT 허용

---

## 19. 인증/보안/RLS

### 19.1 인증 제공자
- **카카오** — 이메일 미수집 (비즈니스 앱 전환 안 함)
- **구글** — 기본
- **Apple Sign In** — iOS 필수, Team ID `6RSK726532`, Services ID `ai.hanbang.wedding.web`
- **이메일/비밀번호** — Supabase Auth 기본

### 19.2 미들웨어 (`middleware.ts`)
- `/(app)/*` — 고객 인증 가드
- `/vendor/*` — 업체 인증 가드
- `/admin/*` — 관리자 인증 가드
- 데모 모드 (`demo_mode=true` 쿠키) 바이패스

### 19.3 보안 레이어
- **RLS** — 전 사용자 테이블 (본인 데이터 격리)
- **Rate limiting** — 채팅 피드백 20/hr 등
- **XSS sanitize** — `utils/sanitize.ts` (regex + DOMPurify)
- **CSRF** — Next.js 기본
- **Headers** — X-Frame-Options, CSP

### 19.4 모바일 호환
- 63개 API가 `createClientFromRequest()` 사용
- Bearer 토큰 (모바일) + Cookie (웹) 동시 지원

### 19.5 데모 모드
- 쿠키 `demo_mode=true`로 인증 우회
- 가상 데이터: 김지은, 2026.10.15, 예산 2,500만원
- 채팅 비활성화 (로그인 유도)
- 샘플 진행률: 상견례/예식장 완료, 스튜디오/드레스 진행 중

---

## 20. 상태관리 (Zustand)

### authStore (`src/stores/authStore.ts`)
| 상태 | 설명 |
|------|------|
| profile | 사용자 프로필 |
| couple | 커플 정보 |
| journey | wedding_journeys (progress JSONB 포함) |
| partner | 파트너 정보 |
| isDemo | 데모 모드 |
| isLoading | 로딩 |

**기능**: 로그인/로그아웃, 프로필 수정, 여정 업데이트 (낙관적 업데이트 + 서버 동기화)

### chatStore (`src/stores/chatStore.ts`)
| 상태 | 설명 |
|------|------|
| messages | 메시지 배열 |
| rooms | 채팅방 (최대 5) |
| activeRoomId | 활성 방 |
| isStreaming | 스트리밍 중 |
| streamingContent | 스트리밍 텍스트 |
| streamingToolResults | 스트리밍 도구 결과 |
| suggestions | 추천 버튼 |
| initialLoadDone | 초기 로드 완료 |

**기능**: 채팅방 CRUD, 메시지 로드/전송, Realtime 구독, Tool 결과 → authStore 동기화, 폴링 safety-net

### onboardingStore
- currentStep / role / coupleAction / partnerInviteCode / progressChecklist

### vendorStore (`src/stores/vendorStore.ts`)
- vendor / products / bookings / isLoading / isInitialized
- 업체 대시보드 전용

### invitationStore (`src/stores/invitationStore.ts`)
- 청첩장 14개 API 호출 통합

### communityStore (`src/stores/communityStore.ts`)
- 게시글/댓글/북마크/투표 통합

---

## 21. 인프라 & 외부 연동

### 21.1 Vercel (웹)
- Production: hanbang.ai
- Preview: 브랜치별 자동 배포
- Root Directory: `apps/web`
- Build: `pnpm --filter web build`
- Custom Domain: hanbang.ai (primary), www → redirect

### 21.2 Supabase
- URL: `https://slrtobkksjmxgzatjyqb.supabase.co`
- Region: Seoul (추정)
- 플랜: Pro ($25/mo)
- 기능: PostgreSQL, Auth (4 providers), Realtime, Storage
- Custom Domain (auth.hanbang.ai) — 미설정

### 21.3 Storage Buckets (예상)
- `community-images`
- `community-videos`
- `vendor-images`
- `invitation-photos`
- `chat-attachments`

### 21.4 Anthropic Claude
- 모델: **Claude Opus 4.7** (`claude-opus-4-7`)
- 기능: Tool Use (27개), Streaming, 1M context
- 최대 Tool 라운드: 5
- 타임아웃: 60초

### 21.5 토스페이먼츠
- @tosspayments/tosspayments-sdk V2
- 리다이렉트 방식
- 에스크로 지원

### 21.6 Resend (이메일)
- 사전등록 확인 메일
- 계약서 발송
- 비밀번호 재설정 (예정)
- 청첩장 발송 (예정)

### 21.7 외부 API (도구)
- **네이버 검색 API** — 장소 검색 (상견례 식당 등)
- **카카오 로컬 API** — 검토 중
- **DiceBear** — `api.dicebear.com/notionists` 자동 아바타

### 21.8 이미지 최적화
- `next.config.ts`: AVIF/WebP, 30일 캐시
- 허용 도메인: `**.supabase.co`, `api.dicebear.com`

### 21.9 모니터링
- Sentry (devDependency, DSN 미연결)
- Vercel Analytics

---

## 22. 컴플라이언스 (AI 기본법, 전자상거래법)

### 22.1 AI 기본법 (2026.1.22 시행)

#### 의무사항
1. **사전 고지** — `/ai-policy` 페이지로 AI 기반 서비스임을 명시
2. **AI 생성 표시** — 아모라의 모든 답변에 표시
3. **위험관리방안** — 1페이지 문서 작성 + 5년 보관
4. **관리·감독 책임자** — 대표 지정
5. **호출 기록** — `ai_interactions_log` 테이블 5년 보관

#### 데이터 보관 정책
- `ai_interactions_log.user_input` / `ai_output` — 5년 보관 (민감정보 포함 가능)
- 90일 이후 raw log → aggregated summary 압축 검토 (Sprint 2)
- 사용자 export/삭제 요청 시 포함

### 22.2 전자상거래법

#### 통신판매중개자 의무
1. 사이트에 "통신판매중개자"임을 명확히 표시
2. "중개자는 통신판매의 당사자가 아닙니다" 고지
3. 판매자(업체) 정보 제공 (상호명/대표자/사업자등록번호/연락처/주소)
4. 분쟁 발생 시 중재 절차 안내
5. 결제 내역 5년 보관

#### 필수 인허가
1. 사업자등록 (통신판매업/전자상거래업)
2. 통신판매업 신고 (관할 시/구청)
3. 에스크로 또는 소비자피해보상보험
4. 개인정보처리방침 공개

### 22.3 개인정보보호법
- 카드정보 직접 수집/저장 금지 (PG사가 처리)
- 개인정보 수집 시 동의 받기
- 사업자 정보(상호명/주소/사업자번호)는 공개 가능
- 대표자 개인 연락처는 동의 없이 공개 금지

### 22.4 공정거래법
- 리뷰 조작 금지
- 광고성 콘텐츠 명확히 표시 ("광고", "제휴")
- 업체 순위/추천 기준 투명 공개
- 특정 업체 부당 우대/차별 금지

---

## 23. 수익 모델 & 로드맵

### 23.1 수익 모델 (3 Phase)

#### Phase 1: 초기 (0~6개월)
- 업체 입점: **무료**
- 거래 수수료: **0%**
- 전략: "초기 파트너" 배지 + 무료 = 마케팅

#### Phase 2: 성장기 (6~12개월)
- 업체 입점: 무료
- 거래 수수료: **3~5%** (업체 부담)
  | 월 거래액 | 수수료 |
  |----------|-------|
  | ~500만원 | 5% |
  | 500만~2,000만원 | 4% |
  | 2,000만원~ | 3% |

#### Phase 3: 안정기 (12개월~)
- 거래 수수료 (3~5%)
- 프리미엄 노출 (월 10~30만원)
- 프리미엄 업체 구독 (월 5~15만원)
- 고객 프리미엄 (월 9,900원) — 아모라 무제한, 독점 할인, VIP 예약

#### 경쟁사 비교
| 플랫폼 | 거래 수수료 | 월 비용 |
|--------|-----------|--------|
| 아이웨딩 | 5~20% | 30~200만원 |
| 웨딩북 | 3~5% | 20~150만원 |
| 더웨딩 | 협의 | 50~300만원 |
| **웨딩한방** | **3~5%** | **무료** |

### 23.2 로드맵

#### Phase 1 (완료) ✅
- 랜딩페이지 (고객/업체)
- 소셜 로그인 + 온보딩
- 대시보드 + AI 채팅 + 예산 + 일정 + 예절 가이드
- 업체 탐색 + 예약 시스템
- 업체 포털 (등록/관리)
- 관리자 대시보드

#### Phase 2 (완료) ✅
- 커플 연동 시스템
- 모바일 청첩장 + 축의금 관리
- 결제 시스템 (토스페이먼츠)
- 한국소비자원 시세 데이터 통합
- 커뮤니티 (Atelier 리디자인)
- 동기방 (분기별)
- 게미피케이션
- AI 피드백 학습
- AI 아모라 심리학 기반 고도화
- 갈등 중재 시스템
- Apple Sign In 전체 설정
- 63개 API Bearer 토큰 호환
- DiceBear 자동 아바타
- 영상 업로드 (MP4 50MB)
- Memory wiring (decision_nodes, ai_interactions_log)

#### Phase 3 (진행 중)
- EAS Build → TestFlight 제출
- 업체 시드 데이터 (서울/경기 100개+)
- AI 드레스 피팅 (Decart API)
- 웹 푸시 알림
- 이메일 알림 시스템
- 청첩장 공개 뷰어 완성

#### Phase 4 (장기)
- Custom Domain (auth.hanbang.ai)
- Editor's Pick 주간 자동 선정 cron
- 모바일 앱 Atelier 디자인 적용
- 고객 프리미엄 구독
- 업체 데이터 분석 리포트 고도화

---

## 24. 현황 & 남은 작업

### 24.1 주요 마일스톤 (2026-04 기준)

✅ **인증** — Apple Sign In + 4 providers
✅ **AI 시스템** — 27 tools + 갈등 중재 + 피드백 학습
✅ **Memory 시스템** — decision_nodes, decision_edges, ai_interactions_log
✅ **커뮤니티 v2** — Atelier 리디자인, 동기방, 게미피케이션
✅ **모바일 앱** — Expo SDK 54, 63개 API Bearer 호환
✅ **결제** — 토스페이먼츠 V2 + 정산 시스템
✅ **계약** — 전자서명 + 표준 조항 라이브러리
✅ **SEO** — sitemap.xml + robots.txt
✅ **AI 컴플라이언스** — `/ai-policy` + `ai_interactions_log`
✅ **70+ 파일 Atelier 팔레트 통일**

### 24.2 출시 Blocker (Bucket A)

| # | 작업 | 상태 |
|---|------|------|
| A1 | `chat_feedback` 테이블 — 마이그레이션 작성 | ✅ 2026-04-23 |
| A2 | `chat_summaries` 테이블 | ✅ 2026-04-23 |
| A3 | `messages` 테이블 또는 `vendor_messages` 매핑 | ⚠️ 확인 필요 |
| A4 | Baseline schema CREATE TABLE 정리 | ⚠️ 분리 이슈 |
| A5 | `vendor_photo_likes` 테이블 | ✅ 2026-04-23 |
| A6 | `community_posts.search_vector` UPDATE trigger | ⚠️ 확인 필요 |

### 24.3 베타 Blocker (Bucket B)

| # | 작업 | 상태 |
|---|------|------|
| B1 | 18개 API try/catch wrapping | 🟡 진행 중 |
| B2 | `/invitations/templates` 시드 SQL | 🟡 |
| B3 | `account_deletions` 처리 명확화 | ✅ 2026-04-23 |
| B4 | `AmoraDirector.hasPreferences` 판단 수정 | 🟡 |
| B5 | `.env.example` 작성 | 🟡 |
| B6 | CLAUDE.md 갱신 (Next.js 16, monorepo) | 🟡 |

### 24.4 완성도 (Bucket C)

- `useInvitationStore` RSVP/guestbook real-time 구독
- Vendor 포털 온보딩 튜토리얼
- 업체 프로필 완성도 바
- 시드 업체 데이터 100개 (서울/경기)
- `/bookings/[id]` 상세 페이지 완성
- Settings 알림 토글 실제 저장 연결
- DiceBear fallback (오프라인 가능한 로컬 generator)

### 24.5 Nice to Have (Bucket D)
- Editor's Pick 주간 자동 선정 cron
- AmoraDirector를 budget/schedule/dashboard에도 확장
- 청첩장 공개 뷰어 고도화
- Sentry DSN 실제 연결
- 페이지별 SEO meta 최적화
- Contract 서명 고객측 UI 진입점 명시

---

## 부록 A. 관리자 자산

- **GitHub**: https://github.com/Kyu-Sung-Cho/wedding-hanbang-web
- **Vercel**: `wedding-hanbang-web` project
- **Supabase**: `slrtobkksjmxgzatjyqb.supabase.co`
- **Apple Developer**: Team `6RSK726532`
- **Bundle ID (모바일)**: `ai.hanbang.wedding`
- **관리자 이메일**: kcho11289@gmail.com

## 부록 B. 컨벤션

### 코딩 컨벤션
- 함수형 컴포넌트만, `export default function ComponentName()`
- 스타일: Tailwind CSS (인라인 style 금지)
- 상태: 서버 데이터는 Supabase Realtime, 로컬은 Zustand
- any 금지, 모든 props 타입 정의
- 네이밍: 컴포넌트 PascalCase, 함수/변수 camelCase
- 에러 처리: try-catch + 사용자 친화적 메시지
- 주석: 한국어로 핵심 로직에만

### 커밋 컨벤션
- `feat:` 새 기능
- `fix:` 버그 수정
- `style:` 디자인/스타일
- `refactor:` 리팩토링
- `docs:` 문서
- `chore:` 설정/패키지

### 디자인 가드레일
- 사용자가 명시적 요청한 디자인은 변경 금지 ("디자인 다 좋은데 디자인은 바꾸지마")
- React 19 + framer-motion 하이드레이션 이슈 → `<div>` + `animate-fade-in` 클래스 사용

---

**문서 끝.**

> 이 문서는 2026-04-28 기준 코드베이스 정적 분석 + 기존 문서(CLAUDE.md, PRINCIPLES.md, PROJECT_STATUS.md, FEATURES.md, FEATURE_AUDIT.md, UPDATE_LOG.md, WEDDINGHANBANG_SERVICE_DOC.md, VENDOR_AND_PAYMENT_STRATEGY.md)를 통합하여 작성됨.
> 모든 페이지 트리·API 라우트·DB 테이블은 실제 파일 시스템에서 확인된 결과.
