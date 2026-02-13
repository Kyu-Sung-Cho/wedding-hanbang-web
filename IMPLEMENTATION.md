# 웨딩한방 웹 (hanbang.ai) — 구현 상세 문서

> 마지막 업데이트: 2026-02-12
> 배포 URL: https://hanbang.ai / https://www.hanbang.ai

---

## 목차

1. [프로젝트 개요 및 목적](#1-프로젝트-개요-및-목적)
2. [기술 스택 및 선택 이유](#2-기술-스택-및-선택-이유)
3. [디자인 시스템](#3-디자인-시스템)
4. [프로젝트 구조](#4-프로젝트-구조)
5. [구현된 페이지 상세](#5-구현된-페이지-상세)
6. [컴포넌트 상세](#6-컴포넌트-상세)
7. [상태 관리 (Zustand Stores)](#7-상태-관리-zustand-stores)
8. [AI 채팅 시스템](#8-ai-채팅-시스템)
9. [Supabase 백엔드 연동](#9-supabase-백엔드-연동)
10. [인증 시스템](#10-인증-시스템)
11. [배포 및 인프라](#11-배포-및-인프라)
12. [데이터 모델](#12-데이터-모델)

---

## 1. 프로젝트 개요 및 목적

### 무엇인가?
웨딩한방 웹(hanbang.ai)은 기존 React Native 모바일 앱의 웹 버전입니다. **같은 Supabase 백엔드**를 공유하여 앱과 웹 데이터가 실시간으로 동기화됩니다.

### 왜 만들었는가?
1. **접근성 확대**: 앱 설치 없이 웹 브라우저에서 즉시 사용 가능
2. **마케팅 랜딩페이지**: hanbang.ai 도메인으로 서비스 소개 + 사전등록 유도
3. **크로스 플랫폼**: 커플 중 한 명은 앱, 한 명은 웹으로 같은 데이터에 접근
4. **SEO**: 검색 엔진을 통한 유기적 유입

### 핵심 가치
- **AI 웨딩 플래너**: Claude AI가 적극적으로 먼저 다가가 결혼 준비를 리드
- **올인원**: 예산, 일정, 체크리스트, 업체 탐색, 드레스 피팅까지 한 곳에서
- **커플 동기화**: 신부와 신랑이 실시간으로 같은 데이터를 공유

---

## 2. 기술 스택 및 선택 이유

| 레이어 | 기술 | 버전 | 선택 이유 |
|--------|------|------|----------|
| **프레임워크** | Next.js (App Router) | 16.1.6 | SSR/SSG, API Routes, Vercel 최적화, 파일 기반 라우팅 |
| **언어** | TypeScript | 5.x | 타입 안정성, 개발자 경험, any 금지 원칙 |
| **스타일링** | Tailwind CSS | 4.x | CSS-in-JS 없이 빠른 개발, @theme inline으로 커스텀 토큰 |
| **상태관리** | Zustand | 5.0.11 | 모바일 앱과 동일한 패턴, persist 미들웨어로 로컬 저장 |
| **백엔드/DB** | Supabase | 2.95.3 | 기존 앱과 동일 프로젝트, PostgreSQL, Auth, Realtime, Storage |
| **AI** | Claude API (Anthropic SDK) | 0.74.0 | 웨딩 AI 플래너 채팅, 스트리밍 SSE |
| **애니메이션** | Framer Motion | 12.34.0 | 랜딩페이지 인트로 애니메이션, 부드러운 전환 |
| **아이콘** | Lucide React | 0.563.0 | 일관된 선형 아이콘 세트, 트리셰이킹 |
| **날짜** | date-fns | 4.1.0 | 경량 날짜 유틸리티 |
| **이메일** | Resend | 6.9.2 | 사전등록 확인 이메일 |
| **배포** | Vercel | CLI 50.15.0 | 자동 빌드, Edge 최적화, 커스텀 도메인 |

### 빌드 도구
- **Turbopack**: Next.js 16의 기본 번들러, webpack 대비 빠른 빌드
- **패키지 관리**: npm

---

## 3. 디자인 시스템

### 3.1 컬러 팔레트

모바일 앱과 동일한 "럭셔리 미니멀" 컨셉입니다.

#### Primary — Noir (다크 톤)
```
noir-50:  #F5F5F6   — 매우 밝은 회색
noir-100: #E5E5E7
noir-200: #CCCCD0
noir-300: #A8A8AE
noir-400: #7C7C84
noir-500: #616169
noir-600: #53535A
noir-700: #47474D
noir-800: #1A1A1F   — 메인 텍스트, 다크 배경
noir-900: #0D0D0F   — 가장 어두운 톤
noir-soft: #2D2D33
```
**사용처**: 본문 텍스트(noir-800), 다크 CTA 버튼 배경, 헤딩

#### Accent — Rose Champagne (로즈 골드)
```
rose-50:   #FDF6F3   — 가장 밝은 로즈
rose-100:  #FAEAE3
rose-200:  #F5D5C7
rose-300:  #E8B9A6
rose-400:  #D4AFA0
rose-500:  #C4967E   — 메인 액센트
rose-600:  #9A6B62   — 진한 액센트
rose-700:  #7D554E
rose-800:  #674844
rose-900:  #583F3C
rose-light: #D4AFA0
rose-pale:  #E8D5CD
rose-glow:  rgba(196,150,126,0.15)  — 글로우 배경
```
**사용처**: CTA 버튼, 활성 네비 아이템, 강조 텍스트, 신부 채팅 색상, 프로그레스 바

#### Background — Warm Ivory (따뜻한 아이보리)
```
ivory-50:   #FDFCFA   — 기본 배경
ivory-100:  #FAF8F5   — 카드/입력 배경
ivory-200:  #F5F2ED   — 구분선, 호버
ivory-warm: #FAF7F2
ivory-deep: #F5F0E8
```
**사용처**: 전체 배경(ivory-50), 입력 필드(ivory-50), 구분(ivory-200), 호버 상태

#### Taupe (따뜻한 회색)
```
taupe-300: #C5BEB6
taupe-400: #B5ADA3   — 보조 텍스트
taupe-500: #928980   — 더 진한 보조
taupe-600: #7A726A
taupe-light: #B5ADA3
```
**사용처**: 보조 텍스트, 플레이스홀더, 타임스탬프, 비활성 아이콘

#### 특수 컬러
```
gold:       #C9A96E   — 골드 액센트
gold-light: #DCC9A0   — 밝은 골드
charcoal:   #4A4A52   — 서브 텍스트
platinum:   #E8E4E0   — 보더/구분선
```
**사용처**: 골드(D-Day 그라데이션, 별점), 플래티넘(모든 보더와 구분선)

### 3.2 타이포그래피

#### 한글 제목 — Noto Serif KR
```css
font-family: 'Noto Serif KR', serif;
weights: 200, 300, 400, 500, 600
```
**사용처**: 사이드바 로고 "웨딩한방", 랜딩페이지 히어로 타이틀
**느낌**: 우아하고 세련된 세리프체로 웨딩의 격식을 표현

#### 한글 본문 — Noto Sans KR
```css
font-family: 'Noto Sans KR', sans-serif;
weights: 300, 400, 500, 600, 700
```
**사용처**: 모든 본문 텍스트, 버튼, 네비게이션, 입력 필드
**느낌**: 가독성 높은 기본서체

#### 영문/숫자 — Cormorant Garamond
```css
font-family: 'Cormorant Garamond', serif;
weights: 300, 400, 500, 600 (+ italic)
```
**사용처**: D-Day 숫자, 진행률 퍼센트, 예산 금액, "AI 한 방" 히어로 강조
**느낌**: 럭셔리 패션 브랜드에서 쓰는 클래식 디스플레이 서체

### 3.3 커스텀 애니메이션

```css
orbFloat    — 20초 주기 유기적 떠다니기 (배경 오브)
scrollLine  — 2초 주기 스크롤 힌트 (수직선 확대/축소)
typingBounce — 채팅 타이핑 인디케이터 (점 3개 바운스)
scanLine    — 스캔 라인 효과 (피팅 페이지)
phoneScan   — 모바일 스캔 애니메이션
floatCard   — 카드 부유 효과
```

### 3.4 스크롤바 커스터마이징
- 너비: 6px (기본 대비 가늠)
- 트랙: 투명
- 썸: taupe-400 (#B5ADA3), 호버 시 taupe-500
- 둥근 모서리: 3px

### 3.5 디자인 원칙
- **미니멀 럭셔리**: 과한 장식 없이 여백과 타이포로 고급감 연출
- **따뜻한 톤**: 차가운 순백색 대신 아이보리/로즈 계열로 웨딩 무드
- **일관된 보더**: 모든 카드/구분은 `platinum` (#E8E4E0) 1px 보더
- **둥근 모서리**: 버튼/카드 `rounded-xl`(12px) ~ `rounded-2xl`(16px)
- **그림자 최소화**: 호버 시에만 `hover:shadow-md`, 기본은 보더로 구분

---

## 4. 프로젝트 구조

```
hanbang-web/
├── CLAUDE.md                          # AI 개발 가이드
├── IMPLEMENTATION.md                  # 이 문서
├── next.config.ts                     # Next.js 설정
├── tsconfig.json                      # TypeScript 설정
├── package.json                       # 의존성
├── middleware.ts                      # Next.js 미들웨어 (인증)
│
├── public/                            # 정적 파일
│   ├── fonts/
│   └── images/
│
├── src/
│   ├── app/                           # Next.js App Router 페이지
│   │   ├── layout.tsx                 # 루트 레이아웃 (메타데이터, 폰트)
│   │   ├── page.tsx                   # 랜딩페이지 (/)
│   │   ├── globals.css                # 글로벌 스타일 (@theme, 애니메이션)
│   │   │
│   │   ├── (auth)/                    # 인증 그룹 (보호 없음)
│   │   │   ├── login/page.tsx         # 로그인 (카카오/구글/이메일)
│   │   │   ├── signup/page.tsx        # 회원가입
│   │   │   └── callback/page.tsx      # OAuth 콜백 처리
│   │   │
│   │   ├── (app)/                     # 앱 그룹 (인증 필요)
│   │   │   ├── layout.tsx             # 앱 레이아웃 (사이드바+탑네비+스토어 로드)
│   │   │   ├── dashboard/page.tsx     # 대시보드
│   │   │   ├── chat/page.tsx          # AI 채팅
│   │   │   ├── budget/page.tsx        # 예산 관리
│   │   │   ├── schedule/page.tsx      # 일정 관리
│   │   │   ├── checklist/page.tsx     # 체크리스트/로드맵
│   │   │   ├── fitting/page.tsx       # AI 드레스 피팅
│   │   │   ├── vendors/page.tsx       # 업체 탐색
│   │   │   ├── etiquette/page.tsx     # 예절 가이드
│   │   │   └── settings/page.tsx      # 설정
│   │   │
│   │   ├── (admin)/                   # 관리자 그룹
│   │   │   └── admin/page.tsx         # 사전등록 현황
│   │   │
│   │   └── api/                       # API Routes
│   │       ├── auth/callback/route.ts # OAuth 코드 교환
│   │       ├── chat/route.ts          # AI 채팅 SSE 스트리밍
│   │       ├── preregister/route.ts   # 사전등록 이메일
│   │       └── vendors/route.ts       # 업체 검색
│   │
│   ├── components/
│   │   ├── landing/                   # 랜딩페이지 섹션들
│   │   ├── app/                       # 앱 기능 컴포넌트
│   │   │   ├── chat/                  # 채팅 UI
│   │   │   └── common/               # 사이드바, 탑네비
│   │   └── ui/                        # 공통 UI (Button, Card, Input, Modal)
│   │
│   ├── lib/
│   │   ├── supabase/                  # Supabase 클라이언트 (client/server/middleware)
│   │   ├── ai/                        # Claude AI (claude.ts, prompts.ts)
│   │   ├── services/                  # Supabase CRUD 서비스 레이어
│   │   └── resend.ts                  # 이메일 발송
│   │
│   ├── stores/                        # Zustand 상태 관리
│   ├── types/                         # TypeScript 타입 정의
│   ├── constants/                     # 상수 데이터 (카테고리, 예절 등)
│   └── utils/                         # 유틸리티 (format, validators)
```

---

## 5. 구현된 페이지 상세

### 5.1 랜딩페이지 (`/`)

**목적**: 서비스 소개 + 사전등록/로그인 유도

**구성 섹션**:
1. **Hero** — 전체 화면 히어로. "결혼 준비, 이제 AI 한 방이면 됩니다" 타이틀
   - 배경: 3개의 로즈/골드 그라데이션 오브가 `orbFloat` 애니메이션으로 둥실
   - Framer Motion으로 텍스트 순차 페이드인 (0.2s → 0.4s → 0.6s → 0.8s)
   - CTA: "무료로 시작하기" (다크 버튼 → /login), "기능 둘러보기" (아웃라인 → #features)
   - 스크롤 힌트: "SCROLL" + 수직선 애니메이션
2. **PainPoints** — 결혼 준비의 고충 (정보 과잉, 비용 불투명, 시간 부족)
3. **Solutions** — 웨딩한방의 해결책 (AI 상담, 가격 비교, 일정 관리)
4. **Comparison** — AI 플래너 vs 기존 방식 비교표
5. **VirtualFitting** — AI 드레스 피팅 기능 소개
6. **Stats** — 서비스 수치 (사용자 수, 상담 횟수 등)
7. **HowItWorks** — 사용 방법 3단계
8. **Testimonials** — 사용자 후기
9. **CTA** — 최종 가입 유도
10. **Footer** — 하단 정보
11. **SparkleCanvas** — 전체 배경 파티클 효과

**디자인**: 아이보리 배경 위에 로즈골드/골드 그라데이션 포인트. 세리프체 + 산세리프 조합으로 고급스러운 웨딩 분위기.

---

### 5.2 로그인 (`/login`)

**목적**: 소셜 로그인 + 이메일 로그인

**UI 구조**:
- 좌측: 로즈 → 골드 그라데이션 배경 + 서비스 소개 일러스트 (데스크톱)
- 우측: 로그인 폼
  - "웨딩한방" 로고 (로즈→골드 그라데이션 사각형 + 세리프 텍스트)
  - 소셜 로그인 버튼 2개:
    - 카카오: `#FEE500` 노란 배경 + 카카오 아이콘
    - 구글: 흰 배경 + 구글 아이콘
  - 구분선: "또는"
  - 이메일/비밀번호 입력 필드
  - "로그인" 버튼 (noir-800 배경)
  - "회원가입하기" 링크 → /signup

**인증 플로우**:
1. 소셜 클릭 → Supabase `signInWithOAuth` → 카카오/구글 인증 페이지
2. 인증 완료 → `/callback` 리다이렉트 → 코드 교환 → 세션 생성
3. `/dashboard`로 이동

---

### 5.3 회원가입 (`/signup`)

**목적**: 이메일 기반 신규 가입

**UI**: 로그인과 동일한 레이아웃
- 이메일, 비밀번호, 비밀번호 확인 입력
- 비밀번호 6자 이상 검증
- 비밀번호 불일치 에러 표시 (빨간 텍스트)
- 가입 완료 시 이메일 확인 안내 메시지
- "로그인하기" 링크 → /login

---

### 5.4 대시보드 (`/dashboard`)

**목적**: 결혼 준비 전체 현황을 한눈에 파악

**디자인**: `max-w-6xl` 중앙 정렬, `space-y-6` 수직 간격

**상단 4칸 그리드** (`grid-cols-4`):

| 카드 | 아이콘 | 내용 | 디자인 |
|------|--------|------|--------|
| D-Day | Heart (흰색) | 결혼식까지 남은 일수 + 날짜 | **로즈→골드 그라데이션 배경**, 흰색 텍스트 |
| 전체 진행률 | TrendingUp (로즈) | 퍼센트 + 프로그레스 바 | 흰 카드, 로즈 프로그레스 바 |
| 완료 카테고리 | CheckCircle2 (초록) | 완료 수 / 전체 수 | 흰 카드, "N개 진행중" 보조 텍스트 |
| 예산 사용 | Sparkles (골드) | 사용 금액 / 총 예산 | 흰 카드, 만원 단위 포맷 |

**하단 3칸 그리드** (`lg:grid-cols-3`):

**좌측 2칸 — 카테고리별 현황**:
- 20개 카테고리를 `grid-cols-4` 그리드로 표시
- 각 카테고리:
  - 이모지 버튼 → 클릭 시 `/checklist?open={categoryId}`로 이동
  - 이름 텍스트
  - 상태 뱃지 (완료=초록, 진행중=파랑, 미시작=회색, 스킵=노랑)
  - 액션 버튼 3개:
    - 📅 일정 (CalendarDays) → `/schedule?category={id}`
    - ✅ 완료 (CheckCircle2) → 상태를 "completed"로 변경
    - 🔄 초기화 (RotateCcw) → 완료된 항목을 "not_started"로 되돌림

**우측 1칸**:
1. **오늘 일정** — 오늘 날짜의 스케줄 목록, "전체보기" → /schedule
2. **다가오는 일정** — 7일 이내 미완료 스케줄 (최대 5개)
3. **빠른 액션** — 4개 바로가기 (AI 상담, 예산, 일정, 업체)

---

### 5.5 AI 채팅 (`/chat`)

**목적**: AI 웨딩 플래너와의 대화형 상담

**핵심 철학**: AI가 먼저 다가가서 사용자의 이상적인 웨딩을 끌어내는 **프로액티브 플래너**

**UI 구조**:
```
┌─────────────────────────────────────┐
│ [대화 초기화] 버튼                    │  ← 우측 상단
├─────────────────────────────────────┤
│                                     │
│  AI 플래너 라벨                      │
│  ┌─────────────────────┐           │
│  │ AI 메시지 버블       │           │  ← 좌측, 흰 배경 + 플래티넘 보더
│  └─────────────────────┘           │
│  [버튼1] [버튼2] [버튼3] [버튼4]     │  ← 선택지 버튼
│                                     │
│                      신부 라벨       │
│           ┌──────────────────┐     │
│           │ 사용자 메시지 버블  │     │  ← 우측, 로즈 배경 (신부) 또는 파랑 (신랑)
│           └──────────────────┘     │
│                                     │
│  ✨ ● ● ● (타이핑 인디케이터)        │  ← 로딩 중
│                                     │
├─────────────────────────────────────┤
│ [뭐부터 해야 해?] [예산 현황] [...]   │  ← 빠른 답변 칩
│ ┌──┐ ┌────────────────────┐ ┌──┐  │
│ │신부│ │ 메시지를 입력하세요...│ │➤│  │  ← 입력 영역
│ └──┘ └────────────────────┘ └──┘  │
└─────────────────────────────────────┘
```

**기능 상세**:
- **발신자 구분**: 신부(rose-500), 신랑(blue-500), AI 플래너(taupe-400) 라벨 + 색상 코딩
- **SSE 스트리밍**: 실시간 텍스트 스트리밍으로 타이핑 효과
- **버튼 응답**: AI가 매 응답마다 2~4개 선택지 버튼 + 3~5개 빠른 답변 제공
- **긴급 항목 안내**: D-day 기반으로 마감 임박 카테고리를 AI가 자동 인지
- **실시간 동기화**: Supabase Realtime으로 상대방(커플) 메시지 즉시 수신
- **채팅 기록**: Supabase에 저장되어 앱/웹 어디서든 이어서 대화 가능
- **마크다운 볼드**: `**텍스트**` 파싱하여 `<strong>` 렌더링

**환영 메시지 (첫 진입)**:
```
안녕하세요! 👋 저는 웨딩한방 AI 플래너예요.
함께 최고의 웨딩을 만들어볼까요? ✨
먼저 어떤 분위기의 결혼식을 꿈꾸고 계신지 궁금해요!

[🖤 모던·세련] [🌹 클래식·로맨틱] [🌿 내추럴·가든] [💡 추천해주세요]
```

---

### 5.6 예산 관리 (`/budget`)

**목적**: 결혼 예산을 카테고리별로 계획하고 지출 추적

**UI 구조**:
- **상단 카드** — 총 예산, 사용 금액, 남은 금액, 사용 비율
  - 총 예산 클릭 시 모달로 수정 가능
- **카테고리별 리스트** — 20개 카테고리 각각:
  - 이모지 + 이름 + 예산 설정 + 지출 금액
  - 프로그레스 바 (사용 비율에 따라 색상 변화):
    - 0~60%: 초록
    - 60~80%: 파랑
    - 80~100%: 노랑
    - 100%+: 빨강
  - 확장 시: 개별 지출 항목 목록 + 삭제 기능
  - "지출 추가" 버튼으로 금액/설명/날짜/업체명/메모 입력

**디자인**: 카드 기반 아코디언, 프로그레스 바로 시각적 예산 현황

---

### 5.7 일정 관리 (`/schedule`)

**목적**: 결혼 준비 일정을 캘린더와 리스트로 관리

**두 가지 뷰**:
1. **캘린더 뷰** — 월별 캘린더 + 선택 날짜 상세
   - 일정 있는 날: 로즈 도트 인디케이터
   - 선택된 날: 로즈 배경 원형
   - 좌우 화살표로 월 이동
2. **리스트 뷰** — 시간순 일정 목록

**일정 유형 (5가지)**:
| 유형 | 라벨 | 색상 | 아이콘 |
|------|------|------|--------|
| appointment | 방문 | 파랑 | CalendarCheck |
| deadline | 마감 | 빨강 | AlertCircle |
| reminder | 리마인더 | 노랑 | Bell |
| meeting | 미팅 | 초록 | Users |
| event | 이벤트 | 보라 | PartyPopper |

**일정 추가 모달**: 제목, 카테고리 선택, 유형, 날짜, 시간, 장소, 메모

---

### 5.8 체크리스트/로드맵 (`/checklist`)

**목적**: 20개 카테고리의 세부 체크리스트를 로드맵 형태로 시각화

**UI 구조**:
- **로드맵 노드**: 각 카테고리가 세로로 연결된 노드
  - 원형 노드: 이모지 + 진행 상태에 따른 색상
  - 노드 사이 연결선 (수직)
  - 클릭 시 확장/축소
- **확장된 카테고리**:
  - 체크리스트 아이템: 체크박스 + 제목 + 설명 + AI 팁
  - 진행률 표시 (N/M 완료)
  - 카테고리 정보: 예상 비용, 권장 시기, 흔한 실수, 팁
  - 액션: "완료", "스킵", "초기화"
- **쿼리 파라미터**: `?open=categoryId`로 특정 카테고리 자동 확장

**디자인**: 타임라인 스타일의 세로 로드맵, 노드 간 연결선으로 순서 시각화

---

### 5.9 업체 탐색 (`/vendors`)

**목적**: 웨딩 관련 업체를 카테고리/지역/스타일별로 검색

**UI 구조**:
- **카테고리 탭 (항상 상단 표시)**:
  ```
  [전체] [📸 스튜디오] [👗 드레스] [💄 메이크업] [📦 패키지]
  [📷 본식스냅] [🎬 본식DVD] [👘 한복] [🤵 예복] [💍 예물] [💌 청첩장]
  ```
  - 가로 스크롤 가능
  - 활성 탭: noir-800 배경 + 흰 텍스트
  - 비활성: 흰 배경 + 보더
- **검색 바**: 업체명/키워드 검색
- **필터 패널**: 지역 선택, 스타일 태그 멀티선택
- **결과 카드 그리드** (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`):
  - 썸네일 이미지 (없으면 이모지 플레이스홀더)
  - 업체명 + 카테고리 + 지역
  - 별점 (골드 별 아이콘, null이면 미표시)
  - 가격대
  - 태그 칩 (최대 3개)
- **결과 카운트**: "스튜디오 검색 결과 12건"

---

### 5.10 AI 드레스 피팅 (`/fitting`)

**목적**: AI로 자신의 사진에 드레스를 합성

**UI 구조**:
- **사진 업로드**: 드래그앤드롭 또는 클릭으로 전신 사진 업로드
- **드레스 스타일 선택** (6가지):
  - 👗 A라인 / 💃 머메이드 / 👸 볼가운 / 🎀 티길이 / 🌊 엠파이어 / ✨ 슬립
- **처리 상태**: 프로그레스 바 + "AI가 드레스를 입혀보고 있어요..." 메시지
- **결과**: 합성된 이미지 표시 + 저장/다시하기 버튼
- **피팅 히스토리**: 이전 결과 탭으로 확인
- **사용 제한**: 월 5회 무료 (카운터 표시)

---

### 5.11 예절 가이드 (`/etiquette`)

**목적**: 결혼 관련 예절을 체계적으로 안내

**3단계 네비게이션**:
1. **파트 목록** — 6개 파트 (상견례, 예단, 함/폐백, 본식, 피로연, 신혼여행)
2. **섹션 목록** — 파트 내 세부 섹션
3. **섹션 상세** — 체크리스트 + 팁/경고/대사 스크립트

**디자인**: 카드 그리드 → 상세 뷰 전환, 진행률 추적

---

### 5.12 설정 (`/settings`)

**목적**: 사용자 프로필 및 앱 설정 관리

**설정 항목**:
- 프로필 카드 (이메일, 역할 뱃지, D-Day)
- 결혼식 날짜 설정/변경 (모달)
- 역할 전환 (신부 ↔ 신랑)
- 커플 연동 (초대 코드 생성 / 코드 입력)
- 데이터 초기화 (확인 모달)
- 로그아웃
- 앱 버전 정보

---

### 5.13 관리자 페이지 (`/admin`)

**목적**: 사전등록 현황 모니터링

**보안**: 환경변수 `NEXT_PUBLIC_ADMIN_PASSWORD`로 비밀번호 보호

**UI**:
- 비밀번호 입력 화면
- 인증 후 대시보드:
  - 통계 카드: 총 등록 수, 오늘 등록, 이번 주 등록
  - 등록 테이블: 이메일, 이름, 결혼 날짜, 소스, 등록 일시

---

## 6. 컴포넌트 상세

### 6.1 공통 UI 컴포넌트 (`src/components/ui/`)

#### Button
```typescript
Props: variant ('primary'|'secondary'|'outline'|'ghost'|'danger')
       size ('sm'|'md'|'lg'), fullWidth, loading, disabled
```
- primary: `bg-rose-500 text-white hover:bg-rose-600`
- secondary: `bg-ivory-200 text-noir-800 hover:bg-ivory-100`
- outline: `border-platinum text-noir-800 hover:border-rose-500`
- ghost: `text-noir-800 hover:bg-ivory-100`
- danger: `bg-red-500 text-white`
- 로딩 상태: 스피너 애니메이션 + 텍스트 비활성화

#### Card
```typescript
Props: padding ('none'|'sm'|'md'|'lg'), hover, onClick, className
```
- 기본: `rounded-xl border border-platinum bg-white`
- 호버: `hover:shadow-md transition-shadow`

#### Modal
- 오버레이: `bg-noir-900/50 backdrop-blur-sm`
- 모달 바디: `rounded-2xl bg-white max-w-md`
- 닫기 버튼 + 제목 + 커스텀 콘텐츠

#### Input
- `rounded-xl border-platinum bg-ivory-50`
- 포커스: `border-rose-500 ring-2 ring-rose-500/20`

### 6.2 앱 레이아웃 컴포넌트

#### Sidebar (`src/components/app/common/Sidebar.tsx`)
- 너비: 240px 고정
- 흰 배경 + 우측 플래티넘 보더
- 로고: 로즈→골드 그라데이션 사각형에 "한" + "웨딩한방" 세리프 텍스트
- 9개 네비 아이템 (대시보드, 체크리스트, AI 채팅, 예산, 일정, AI 피팅, 업체, 예절, 설정)
  - 활성: `bg-rose-glow text-rose-500 font-medium`
  - 비활성: `text-charcoal hover:bg-ivory-100`
  - 아이콘: Lucide, 18x18px
- 하단: 로그아웃 버튼 (보더 상단 구분)

#### TopNav (`src/components/app/common/TopNav.tsx`)
- 높이: 64px (h-16)
- 흰 배경 + 하단 플래티넘 보더
- 좌측: 현재 페이지 제목 (lg 사이즈, medium 폰트)
- 우측: D-Day 뱃지 (`bg-rose-glow text-rose-500 rounded-full`)

### 6.3 채팅 컴포넌트

#### ChatBubble
- **AI 메시지** (좌측): 흰 배경 + 플래티넘 보더, 좌하단 덜 둥글게 (`rounded-bl-md`)
- **신부 메시지** (우측): `bg-rose-500 text-white`, 우하단 덜 둥글게
- **신랑 메시지** (우측): `bg-blue-500 text-white`, 우하단 덜 둥글게
- 발신자 라벨: 10px 폰트, 각 sender별 색상
- 타임스탬프: 10px, AI는 taupe-400, 사용자는 white/60

#### ChatInput
- 빠른 답변 칩: `rounded-full border-platinum bg-ivory-50` 가로 나열
- 발신자 아바타: 44x44 원형, 신부(로즈)/신랑(파랑) + "신부"/"신랑" 텍스트
- 텍스트 입력: `rounded-2xl`, 자동 높이 조절 (최대 120px)
- 전송 버튼: 44x44 원형, sender에 따라 로즈/파랑

#### ButtonOptions
- `flex flex-wrap gap-2`로 버튼 나열
- 일반: `border-platinum bg-white` + 호버 시 로즈 보더
- 추천: `border-rose-500 bg-rose-glow text-rose-500`
- 라벨 + 설명 (선택적) 2줄 구성

---

## 7. 상태 관리 (Zustand Stores)

### 7.1 authStore
```typescript
상태: user, session, userRole, isLoading, isInitialized
```
**역할**: Supabase 인증 세션 관리. 앱 레이아웃에서 초기화.

### 7.2 journeyStore (persist)
```typescript
상태: weddingDate, role, categoryStatuses, checklistProgress,
      priorityCategory, isOnboardingComplete, journeyId, coupleId
```
**핵심 메서드**:
- `getDaysUntilWedding()` — D-Day 계산
- `getCategoryProgress(id)` — 카테고리별 체크리스트 완료율
- `getOverallProgress()` — 전체 완료/스킵 비율
- `loadFromServer(coupleId)` — Supabase `wedding_journeys` 테이블에서 로드
- `syncToServer()` — 2초 디바운스로 서버 저장
**데이터 동기화**: 모든 상태 변경 시 `debouncedSync(2000ms)` 호출

### 7.3 chatStore (persist, 최근 50개 메시지만)
```typescript
상태: messages, isLoading, error, context, coupleId, isServerLoaded
```
**핵심 메서드**:
- `sendMessage(text, sender)` — 메시지 전송 + SSE 스트리밍 수신
- `loadFromServer(coupleId)` — 최근 100개 메시지 로드
- `setContext(partial)` — AI 컨텍스트 업데이트

**SSE 파싱 로직**:
1. `{text: "..."}` → 텍스트 스트리밍 (실시간 표시)
2. `{textReplace: "..."}` → 전체 텍스트 교체 (---ACTIONS--- 마커 제거용)
3. `{buttons: [...], quickReplies: [...]}` → 메타데이터 (버튼/빠른답변)
4. `{error: "..."}` → 에러 처리
5. `[DONE]` → 스트림 종료

### 7.4 budgetStore (persist)
```typescript
상태: totalBudget, categoryBudgets, coupleId, isSyncing
```
**핵심 메서드**:
- `setTotalBudget(amount)` — 총 예산 설정
- `addExpense(categoryId, expense)` — 지출 추가
- `deleteExpense(categoryId, expenseId)` — 지출 삭제
- `getTotalSpent()` — 전체 사용 금액 합계
- `getTotalRemaining()` — 남은 예산
**데이터 동기화**: 1.5초 디바운스

### 7.5 scheduleStore (persist)
```typescript
상태: schedules, coupleId, isSyncing
```
**핵심 메서드**:
- `addSchedule(input)` — 일정 추가 (UUID 생성 + 서버 저장)
- `toggleComplete(id)` — 완료 토글
- `getSchedulesByDate(date)` — 날짜별 필터
- `getUpcomingSchedules(limit)` — 다가오는 일정
- `getTodaySchedules()` — 오늘 일정

---

## 8. AI 채팅 시스템

### 8.1 아키텍처

```
[사용자 입력]
    ↓
[chatStore.sendMessage()]
    ↓
[POST /api/chat]  ←  context (weddingDate, role, budget, urgentCategories...)
    ↓
[buildSystemPrompt(context)]  →  동적 시스템 프롬프트 생성
    ↓
[classifyQuery(message)]  →  모델 선택 (Haiku vs Sonnet)
    ↓
[streamClaude()]  →  Anthropic SDK 스트리밍
    ↓
[SSE 스트림]  →  텍스트 청크 + ---ACTIONS--- 파싱
    ↓
[chatStore SSE 파서]  →  메시지 업데이트 + 버튼/빠른답변 표시
    ↓
[Supabase 저장]  →  채팅 기록 영구 보존
```

### 8.2 시스템 프롬프트 전략

**핵심 원칙**: "적극적으로 먼저 다가가세요"
- ❌ "뭐 도와드릴까요?" (수동적)
- ✅ "아직 스드메를 정하지 않으셨네요! 어떤 분위기의 촬영을 원하세요?" (적극적)

**동적 컨텍스트 주입**:
- 결혼식 날짜 + D-Day
- 현재 대화자 (신부/신랑)
- 예산 현황 (총액, 사용액, 잔액)
- 완료/진행중 카테고리
- 긴급 항목 (D-Day 기반 마감 임박/초과 카테고리)
- 아무것도 시작 안 한 경우 → 스타일/예산/지역 파악 질문 유도

**모델 선택**:
| 쿼리 유형 | 모델 | 비용 |
|----------|------|------|
| simple (짧은 질문) | Claude Haiku 4.5 | 저비용 |
| complex, vendor, budget, schedule | Claude Sonnet 4.5 | 중비용 |

### 8.3 ---ACTIONS--- 파싱 시스템

**왜 이 방식인가?**
AI 응답에 구조화된 선택지를 포함시켜야 하지만, 스트리밍 중에는 JSON이 화면에 보이면 안 됩니다.

**서버 처리 방식**:
1. 스트리밍 중 텍스트를 축적하되, **마지막 500자는 버퍼링** (ACTION 블록이 잘리지 않도록)
2. 스트림 종료 후 버퍼에서 `---ACTIONS---` 마커 검색
3. 마커 발견 시:
   - 마커 이전 텍스트 → 일반 텍스트로 전송
   - 마커 이후 JSON → `{buttons: [...], quickReplies: [...]}` 메타데이터 이벤트로 전송
4. 마커가 이미 전송된 텍스트에 포함된 경우:
   - `{textReplace: cleanedText}` 이벤트로 전체 교체

**클라이언트 처리**:
- `textReplace` → fullContent 교체
- `buttons` / `quickReplies` → Message 객체에 메타데이터 추가
- 기존 chatStore 메타데이터 핸들러가 자동 처리

### 8.4 긴급 항목 (D-Day 기반)

**계산 로직** (`chat/page.tsx → getUrgentCategories()`):
```
1. weddingDate에서 D-Day 계산
2. 각 카테고리의 suggestedTiming.latestDaysBefore와 비교
3. D-Day ≤ latestDaysBefore인 카테고리 = 긴급
4. 이미 completed/skipped인 카테고리는 제외
5. latestDaysBefore 내림차순 정렬 (가장 급한 것 먼저)
```

**AI에 전달되는 정보** (각 긴급 카테고리):
- 카테고리 이름, 이모지, 상태
- 체크리스트 진행률 (N/M)
- 기한 초과 여부 (⛔ vs ⏰)
- 다음 미완료 체크리스트 항목

---

## 9. Supabase 백엔드 연동

### 9.1 클라이언트 구분

| 클라이언트 | 파일 | 용도 |
|-----------|------|------|
| 브라우저 | `lib/supabase/client.ts` | Auth, Realtime 구독, 사용자 데이터 읽기 |
| 서버 | `lib/supabase/server.ts` | API Route에서 서비스 역할 키로 데이터 쓰기 |
| 미들웨어 | `lib/supabase/middleware.ts` | 세션 갱신, 인증 체크 |

### 9.2 서비스 레이어 (`lib/services/`)

모든 Supabase CRUD는 서비스 레이어를 통해 추상화됩니다.

| 서비스 | 테이블 | 주요 메서드 |
|--------|--------|------------|
| chatService | chat_messages | getChatMessages, saveChatMessage, clearChatMessages, subscribeToChatMessages |
| journeyService | wedding_journeys | getOrCreateJourney, syncJourney |
| budgetService | budgets, budget_items | getOrCreateBudget, updateTotalBudget, addBudgetItem, deleteBudgetItem |
| scheduleService | schedules | getSchedules, upsertSchedule, toggleScheduleComplete |
| coupleService | couples, profiles | getMyCouple, createCouple, joinCouple |
| vendorService | vendors | searchVendors (필터링/검색) |
| fittingService | fitting_requests | createFittingRequest, getFittingHistory |

### 9.3 실시간 기능 (Realtime)

**채팅 메시지 동기화**:
```typescript
// chat/page.tsx에서 구독
subscribeToChatMessages(coupleId, (newMessage) => {
  // 내가 보낸 메시지가 아닌 경우만 추가
  if (!existing.some(m => m.id === newMessage.id)) {
    addMessage(newMessage);
  }
});
```
- Supabase `postgres_changes` 이벤트 사용
- `INSERT` 이벤트 감지 → 새 메시지 자동 표시
- 신부가 보낸 메시지가 신랑 화면에 즉시 표시 (역도 마찬가지)

### 9.4 데이터 동기화 전략

**로컬 우선 (Local First)**:
1. 모든 상태 변경은 즉시 Zustand (로컬)에 반영
2. 디바운스된 서버 동기화 (1.5~2초 후 Supabase에 저장)
3. 앱 진입 시 서버에서 최신 데이터 로드

**충돌 방지**:
- 디바운스로 짧은 시간 내 다수 변경을 하나의 요청으로 묶음
- `isSyncing` 플래그로 동시 동기화 방지

---

## 10. 인증 시스템

### 10.1 플로우

```
[사용자] → 로그인 페이지 → [카카오/구글 OAuth] 또는 [이메일/비밀번호]
                                    ↓
                          Supabase Auth → OAuth 콜백
                                    ↓
                          /callback → 코드 교환 → 세션 생성
                                    ↓
                          프로필 체크 → couple_id, role 확인
                                    ↓
                          앱 레이아웃 → 모든 스토어 데이터 로드
                                    ↓
                          /dashboard
```

### 10.2 미들웨어 보호

`middleware.ts`에서 `(app)` 그룹 페이지 접근 시 세션 체크:
- 세션 있음 → 통과
- 세션 없음 → `/login`으로 리다이렉트

### 10.3 앱 레이아웃 초기화

`(app)/layout.tsx`에서 인증 후 자동 실행:
1. `supabase.auth.getSession()` → 세션 확인
2. `profiles` 테이블에서 `couple_id`, `role` 조회
3. `role` 설정 → journeyStore
4. 모든 스토어 병렬 로딩:
   - `journeyStore.loadFromServer(coupleId)`
   - `budgetStore.loadFromServer(coupleId)`
   - `scheduleStore.loadFromServer(coupleId)`
   - `chatStore.loadFromServer(coupleId)`

---

## 11. 배포 및 인프라

### 11.1 배포 프로세스

```bash
# 1. 프로덕션 빌드 + Vercel 배포
npx vercel --prod --yes

# 2. 커스텀 도메인 연결 (매 배포마다)
npx vercel alias set <deployment-url> hanbang.ai
npx vercel alias set <deployment-url> www.hanbang.ai
```

### 11.2 환경변수

```
NEXT_PUBLIC_SUPABASE_URL       — Supabase 프로젝트 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY  — Supabase 익명 키
SUPABASE_SERVICE_ROLE_KEY      — Supabase 서비스 역할 키 (서버만)
ANTHROPIC_API_KEY              — Claude AI API 키
RESEND_API_KEY                 — 이메일 서비스 키
NEXT_PUBLIC_SITE_URL           — https://hanbang.ai
NEXT_PUBLIC_ADMIN_PASSWORD     — 관리자 비밀번호 (선택)
```

### 11.3 빌드 설정
- Turbopack 사용 (Next.js 16 기본)
- 정적 페이지: 21개 사전 렌더링
- 동적 API: 4개 (auth callback, chat, preregister, vendors)
- 미들웨어: Proxy 방식

---

## 12. 데이터 모델

### 12.1 20개 웨딩 카테고리

| # | ID | 이름 | 이모지 | 권장 시작 (D-) | 마감 (D-) | 예상 비용 |
|---|-----|------|--------|--------------|----------|----------|
| 1 | first_greeting | 첫인사 | 🤝 | 365 | 180 | 10~30만원 |
| 2 | formal_meeting | 상견례 | 🍽️ | 300 | 120 | 30~50만원 |
| 3 | wedding_hall | 웨딩홀 | 🏛️ | 365 | 180 | 300~800만원 |
| 4 | studio | 스튜디오 | 📸 | 180 | 90 | 100~300만원 |
| 5 | dress | 드레스 | 👗 | 150 | 60 | 50~200만원 |
| 6 | makeup | 메이크업 | 💄 | 120 | 30 | 30~80만원 |
| 7 | snap_dvd | 본식 스냅/DVD | 📷 | 120 | 30 | 50~150만원 |
| 8 | suit | 예복 | 🤵 | 90 | 30 | 30~100만원 |
| 9 | hanbok | 한복 | 👘 | 120 | 60 | 50~200만원 |
| 10 | wedding_nail | 웨딩 네일 | 💅 | 14 | 3 | 5~15만원 |
| 11 | parent_makeup | 혼주 메이크업 | 👩 | 30 | 7 | 10~30만원 |
| 12 | rings | 결혼반지 | 💍 | 90 | 30 | 50~300만원 |
| 13 | gifts | 예물/예단 | 🎁 | 120 | 60 | 100~500만원 |
| 14 | invitation | 청첩장 | 💌 | 60 | 30 | 10~30만원 |
| 15 | ceremony_staff | 주례/사회/축가 | 🎤 | 60 | 14 | 20~50만원 |
| 16 | appliance | 가전 | 🏠 | 90 | 30 | 500~1500만원 |
| 17 | furniture | 가구 | 🛋️ | 90 | 30 | 300~1000만원 |
| 18 | house | 신혼집 | 🏡 | 180 | 60 | 보증금/전세 |
| 19 | honeymoon | 신혼여행 | ✈️ | 90 | 30 | 200~500만원 |
| 20 | return_gift | 답례품 | 🎀 | 30 | 7 | 인당 5천~2만원 |

### 12.2 각 카테고리 데이터 구조

```typescript
{
  id: CategoryId,
  name: string,
  emoji: string,
  description: string,
  order: number,
  suggestedTiming: {
    earliestDaysBefore: number,  // 가장 빨리 시작 권장
    latestDaysBefore: number,    // 마감 (이 이후면 긴급)
  },
  estimatedCost: string,
  checklistItems: [{
    id: string,
    title: string,
    description: string,
    aiTip: string,     // AI가 팁으로 안내
    isRequired: boolean,
    order: number,
  }],
  commonMistakes: string[],
  tips: string[],
}
```

### 12.3 Supabase 테이블 (공유)

모바일 앱과 공유하는 기존 테이블:
- `profiles` — 사용자 프로필 (id, couple_id, role, ...)
- `couples` — 커플 정보 (id, invite_code, ...)
- `wedding_journeys` — 웨딩 여정 (category_statuses, checklist_progress, ...)
- `chat_messages` — 채팅 기록 (couple_id, role, content, metadata, ...)
- `chat_summaries` — 대화 요약
- `schedules` — 일정
- `budgets` — 예산
- `budget_items` — 지출 항목
- `vendors` — 업체 정보
- `fitting_requests` — 피팅 요청

웹 전용:
- `preregistrations` — 사전등록 (email, name, wedding_date, source, utm_*)

---

> **이 문서는 프로젝트의 현재 구현 상태를 반영합니다. 추가 기능 구현 시 업데이트됩니다.**
