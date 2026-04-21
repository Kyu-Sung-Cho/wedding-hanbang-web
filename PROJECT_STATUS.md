# 웨딩한방 (hanbang.ai) — 전체 프로젝트 정리

> **최종 업데이트**: 2026-04-22
> **도메인**: hanbang.ai / www.hanbang.ai
> **저장소**: Kyu-Sung-Cho/wedding-hanbang-web

---

## 📋 목차
1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택](#2-기술-스택)
3. [디자인 시스템](#3-디자인-시스템)
4. [웹 서비스 기능](#4-웹-서비스-기능)
5. [커뮤니티 기능](#5-커뮤니티-기능)
6. [모바일 앱 기능](#6-모바일-앱-기능)
7. [AI 시스템 (아모라)](#7-ai-시스템-아모라)
8. [업체 관리자 포털 (B2B)](#8-업체-관리자-포털-b2b)
9. [백엔드/API](#9-백엔드api)
10. [데이터 모델](#10-데이터-모델)
11. [인증/보안](#11-인증보안)
12. [배포/인프라](#12-배포인프라)
13. [남은 작업](#13-남은-작업)

---

## 1. 프로젝트 개요

**한 줄 요약**: 한국 예비 신부/신랑을 위한 AI 웨딩 플래너 + 커뮤니티 플랫폼

**핵심 가치**:
- **AI 아모라** — 24시간 전담 웨딩 플래너
- **커뮤니티** — 동기방(분기별 방) + 후기/Q&A
- **통합 관리** — 예산/일정/업체/청첩장/축의금 한곳에
- **웹+앱** — 같은 Supabase 백엔드로 실시간 동기화

**타겟**: 결혼 6개월~1년 전부터 준비하는 한국 예비 부부

**비즈니스 모델**:
- B2C: 프리미엄 기능 (AI 상담 무제한, 맞춤 추천)
- B2B: 업체 등록/광고/계약 수수료

---

## 2. 기술 스택

### Monorepo 구조 (pnpm + Turborepo)

```
wedding-hanbang-web/
├── apps/
│   ├── web/          ← Next.js 16 (hanbang.ai)
│   └── mobile/       ← Expo SDK 54 (iOS/Android)
└── packages/
    ├── shared/       ← 공통 타입, 상수
    └── design-tokens/ ← 디자인 토큰
```

### 웹 (apps/web)
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS 4
- **State**: Zustand
- **Auth**: Supabase Auth (카카오, 구글, Apple, 이메일)
- **Backend**: Supabase (PostgreSQL + Realtime + Storage)
- **AI**: Anthropic Claude API (Opus 4.7)
- **Email**: Resend
- **배포**: Vercel (자동 배포)

### 모바일 앱 (apps/mobile)
- **Framework**: Expo SDK 54
- **Navigation**: Expo Router 6
- **Language**: TypeScript
- **Styling**: React Native StyleSheet (NativeWind 제외)
- **Auth**: 웹 콜백 브릿지 패턴 (카카오/구글/Apple)
- **Bundle ID**: `ai.hanbang.wedding`
- **빌드**: EAS Build (TestFlight 준비 중)

---

## 3. 디자인 시스템

### Atelier Hub 에디토리얼 스타일 (2026-04 기준)

#### 컬러 팔레트
```css
/* Primary (Dusty Rose) */
--primary: #795252;
--primary-hover: #946a6a;

/* Secondary (Sage Green) */
--secondary: #5a6147;
--secondary-container: #dee6c4;

/* Surface */
--surface: #fcf9f8;           /* Champagne 배경 */
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

#### 타이포그래피
- **한글 제목**: Noto Serif KR (font-serif-kr) — 세리프, 우아한 느낌
- **한글 본문**: Noto Sans KR — 가독성
- **영문/숫자**: Cormorant Garamond — 에디토리얼 헤드라인

#### 디자인 원칙
1. **보더 없음** — 카드는 shadow로만 구분 (`shadow-[0_8px_30px_rgb(0,0,0,0.04)]`)
2. **배경 레이어** — 샴페인(#fcf9f8) 위 흰색 카드
3. **여유로운 여백** — luxury = space you don't fill
4. **세리프 제목 + 산세리프 본문** — 에디토리얼 리듬
5. **그라디언트 CTA** — `from-[#795252] to-[#946a6a]` + rose shadow

#### 반응형 브레이크포인트
- Mobile: default
- Tablet: sm: 640px+
- Desktop: lg: 1024px+
- XL: xl: 1280px+

---

## 4. 웹 서비스 기능

### 4.1 대시보드 (`/dashboard`)
**에디토리얼 히어로 레이아웃**
- 히어로 배너: 그라디언트 + 세리프 환영 메시지
- 2열 스탯: D-day 카드(96px 세리프) + 예산 오버뷰
- 3열 하단: 다가오는 일정 / 빠른 실행 / Spotlight 카드

**기능**:
- D-day 자동 계산
- 진행률 (완료/전체 카테고리)
- 긴급 태스크 알림 (D-day 기반)
- 파트너 활동 피드 (실시간)
- 카테고리별 진행 상태
- 커플 초대 코드 공유

### 4.2 AI 아모라 채팅 (`/chat`)
**기능**:
- 24시간 실시간 AI 상담
- 데이터 연동 도구 호출 (business tools)
- 커플 채팅 중재 (갈등 자동 감지)
- 글 요약 + 맞춤 추천
- 피드백 학습 시스템 (👍/👎)
- 예절 가이드 링크 카드
- 업체 카드 (search_vendors)
- 상품/시간슬롯 선택 UI
- 예약 생성/취소

**AI 도구 (tools)**:
- `search_vendors` — 업체 검색
- `recommend_vendors` — 맞춤 추천
- `get_vendor_detail` — 상세 정보
- `get_available_slots` — 예약 가능 시간
- `create_booking` — 예약 생성
- `get_my_bookings` — 내 예약 조회
- `cancel_booking` — 예약 취소
- `analyze_quote` — 견적서 분석
- `search_nearby_places` — 외부 장소 검색 (상견례 등)

### 4.3 예산 관리 (`/budget`)
**에디토리얼 레이아웃**
- 히어로 배너
- 3열 스탯: TOTAL BUDGET / SPENT / REMAINING
- Budget Breakdown 컬러 세그먼트 바
- 스드메 패키지 섹션
- 기타 카테고리 2열 그리드
- 숨은 비용 + AI Spotlight

**기능**:
- 20개 카테고리 예산/지출 인라인 편집
- 숨은 비용 경고 (⚠️ 카테고리별 추가금 표시)
- 분담 추적 (커플/신부측/신랑측/양가)
- 자동 초과 감지 (빨강 하이라이트)
- 커스텀 카테고리 추가/삭제
- 시세 비교 링크

### 4.4 일정 관리 (`/schedule`)
**기능**:
- D-day 기반 자동 체크리스트 (20 카테고리, 132 항목)
- 타임라인 뷰 (D-180 → D-Day)
- 캘린더 뷰 (이벤트 표시)
- 긴급 알림 (3일/2주/1주 색상 구분)
- 이벤트 CRUD
- 카테고리별 상태 (예정/진행중/완료)
- 체크리스트 모달

### 4.5 업체 탐색 (`/vendors`)
**에디토리얼 카드 그리드**
- 히어로 배너
- 3열 스탯: TOTAL / FAVORITES / NEW
- 검색 + 카테고리 필터 pill
- AI 추천 안내 배너 (선호도 미설정 시)
- 에디토리얼 3열 업체 카드
- AI Curation Spotlight

**기능**:
- 카테고리 필터 (스튜디오/드레스/메이크업 외)
- 이름/지역 검색 (debounce)
- 찜하기 (즐겨찾기 토글)
- AI 추천 뱃지 (선호도 매칭 TOP 3)
  - 점수: 카테고리 우선순위(+3) / 평점(+1~2) / 추천플래그(+1)
- 예약 가능 뱃지 (real-time slots)
- 아모라 플로팅 디렉터 (컨텍스트 인식)

### 4.6 업체 상세 (`/vendors/[id]`)
**기능**:
- 갤러리, 설명, 위치, 연락처
- 상품 카탈로그
- 스태프 프로필
- 예약 가능 시간대 (CatchTable 스타일 3단계)
- 리뷰 섹션
- 찜 토글
- 메시지 보내기

### 4.7 청첩장 (`/invitations`)
**기능**:
- 템플릿 갤러리 (편집기)
- 사진 업로드/정렬
- 게스트북 + RSVP
- 계좌번호 관리 (축의금)
- 공유 링크 (/i/[slug])
- 통계 (조회수, RSVP 수)

### 4.8 축의금 관리 (`/money`)
**기능**:
- 신부측/신랑측 분리
- 관계별 입력 (가족/친척/친구/회사)
- CSV 엑셀 내보내기
- 통계: 총액/평균/최고/최저
- 필터 pill (전체/받음/미확인)

### 4.9 예절 가이드 (`/etiquette`)
**기능**:
- 25개 주제 (첫인사 → SNS 에티켓)
- D-day 기반 일정 타임라인
- 블록 렌더러 (리스트/다이얼로그/화살표)
- 카테고리별 사이드바
- 검색 기능

### 4.10 AI 대본 (`/scripts`)
**기능**:
- 축사/건배사/인사말 자동 생성 (Claude API)
- 타입별 템플릿
- 즐겨찾기 (하트)
- 편집/삭제

### 4.11 시세 정보 (`/market-prices`)
**기능**:
- 한국소비자원 11개월 데이터 (2025.4~2026.2)
- 14개 지역별 비교
- 카테고리별 평균 (스드메/드레스/메이크업/예식장)
- 예식장 17개 선택항목
- 성수기 vs 비수기 절약액
- 18개월 트렌드 차트

### 4.12 내 예약 (`/bookings`)
**기능**:
- 업체별 예약 리스트
- 상태별 (대기/확정/완료/취소)
- 진행 단계 표시
- 취소 기능

### 4.13 설정 (`/settings`)
**기능**:
- 프로필 (닉네임, 아바타)
- 커플 연동 (초대 코드 생성/입력)
- 온보딩 재설정 (웨딩 스타일 등)
- 알림 설정
- 비밀번호 변경
- 계정 삭제 (사유 수집)

---

## 5. 커뮤니티 기능

### 5.1 메인 피드 (`/community`)
**에디토리얼 레이아웃 (Atelier Hub 1:1)**
- 왼쪽 사이드바 (w-72/96): 네비 + 동기방 + 글쓰기 CTA
- 가운데: Editor's Pick 배너 + 최신 글 피드
- 오른쪽 사이드바 (w-80/96): 인기글 + 위클리 펄스

**기능**:
- 실시간 업데이트 (Supabase Realtime)
- 카테고리 탭 (7개 카테고리)
- 정렬 (최신/인기/추천)
- 무한 스크롤
- 검색
- 서비스 배너 (매 10개 글마다)
- 태그 필터

### 5.2 PostCard 에디토리얼
- 카테고리 뱃지 + 시간
- 세리프 제목 (text-2xl~28px)
- 본문 프리뷰 (line-clamp-2)
- 비용 데이터 (cost_data 있을 시)
- 하단: 아바타 + 닉네임 + 댓글/북마크/공유
- 오른쪽 이미지 (192×192, sm:w-48)

### 5.3 글쓰기 (`/community/post/write`)
**기능**:
- 실시간 자동 저장 (localStorage)
- 이미지/영상 업로드 (최대 5장, MP4/MOV/WebM 50MB)
- 작성/미리보기 탭
- 카테고리 선택
- 태그 입력
- 광고 표시 (일반/협찬/광고)
- 비용 공유 구조화 데이터 (cost_data)

### 5.4 글 상세 (`/community/post/[id]`)
**기능**:
- 투표 (업/다운)
- 북마크
- 댓글 + 대댓글 (Realtime)
- 작성자 정보 (아바타/랭크)
- 신고 기능
- AI 아모라 댓글 (자동 분석)
- 서비스 CTA (카테고리별 맞춤)

### 5.5 동기방 (`/community/cohort/[id]`)
**분기별 그룹** (2026년 1분기, 2분기...)

**3탭 레이아웃**:

**채팅 탭**:
- 실시간 메시지 (Supabase Realtime)
- 이미지 첨부 (📎 Paperclip)
- 글 공유 (🔗 Link2) — 커뮤니티 글 카드로 전송
- @ 멤버 멘션 (드롭다운 필터)
- 주제 필터 pill (전체/가격/후기/고민/잡담)
- 아바타 + 닉네임 + 랭크 뱃지

**정보판 탭**:
- 계약 정보 등록
- 카테고리별 동기 평균 가격 (5명+)
- 전국 평균과 비교
- 업체명 + 기본가 + 추가금

**타임라인 탭**:
- 동기 활동 피드
- 예약/계약/투어 완료 이벤트
- "OO님이 XX 완료!"

### 5.6 Avatar 시스템
- 1순위: 유저 업로드 프로필
- 2순위: 이모지 아바타
- 3순위: DiceBear notionists API 자동 생성 (닉네임 기반, 일관된 캐릭터)

### 5.7 랭크 시스템
- 새싹 (Lv.1) → 준비중 (Lv.2) → 전문가 (Lv.3) → 마스터 (Lv.4) → 선배 (Lv.5)
- 경험치: 글쓰기(+10), 댓글(+5), 업보트 받음(+2)
- 업적 (Achievement) 시스템

### 5.8 내 활동 페이지
- `/community/my/bookmarks` — 북마크한 글
- `/community/my/upvoted` — 좋아요한 글
- `/community/guestbook` — 내 방명록

### 5.9 Editor's Pick
- `is_weekly_best` 또는 `is_pinned` 글 자동 배너 표시
- 세리프 3~4xl 제목
- 관리자 수동 지정 (추후 주간 자동화 예정)

### 5.10 AI 기능 통합
- 글에 아모라 자동 댓글 (가격 분석/팁 제공)
- 서비스 CTA (AI 상담 유도)
- Service Banner (피드 중간)
- Spotlight 카드 (우측 사이드바)

### 5.11 온보딩 가이드
- **Service Guide**: 대시보드 첫 방문 시 6슬라이드
- **Community Guide**: 커뮤니티 첫 방문 시 5슬라이드
- 시나리오 기반 (기능 나열 X)
- localStorage 1회만 표시
- 미니 UI 목업 내장

---

## 6. 모바일 앱 기능

### 6.1 핵심 기능 (웹과 동기화)
- 대시보드
- AI 아모라 채팅
- 예산 관리 (숨은 비용 + 분담 추적)
- 일정 관리 (체크리스트)
- 업체 탐색 + 예약 (CatchTable 스타일)
- 커뮤니티 (피드 + 글 작성)
- 동기방 채팅
- 설정 (파트너 관리)

### 6.2 모바일 전용
- 파트너 메시징 (신부/신랑 색상 구분)
- 카카오/구글/Apple 로그인
- 웹 콜백 브릿지 OAuth
- Expo Notifications (알림)
- 파트너 초대코드 복사
- 커플 연동

### 6.3 앱 가이드
- 첫 실행 시 6슬라이드 (FlatList 스와이프)
- AsyncStorage 1회만 표시

### 6.4 아직 미구현
- AI 드레스 피팅 (coming soon)
- EAS 빌드 → TestFlight 제출 (준비 중)

---

## 7. AI 시스템 (아모라)

### 7.1 캐릭터 설정
- 이름: 아모라
- 역할: 한국 결혼 준비 전문 AI 플래너
- 톤: 베테랑 웨딩 플래너 (매뉴얼 따르지 않음)
- 관찰자형 — 유저가 "말하지 않는 것"에 주목

### 7.2 심리학 기반 설계
**결혼 준비 감정 곡선**:
- D-180+: 설렘기 → 꿈 함께 그리기
- D-120~180: 현실 충돌기 → 부드러운 대안
- D-60~120: 결정 피로기 → 옵션 줄이기
- D-30~60: 마무리 불안기 → 체크리스트 안심
- D-14 이하: 최종 카운트다운 → 응원 우선

**갈등 중재**:
- 양가 갈등 ≠ 관계 문제, = 기대치 차이
- 예산 갈등 본질 = "우리의 미래가 안전한가"
- 신부 예민함 = 완벽주의, 신랑 무관심 = 역할 모름

### 7.3 개인화 학습
**온보딩 설문** (5단계):
1. 웨딩 스타일 (미니멀/클래식/화려/자연)
2. 우선순위 (스드메/예식장/예물 등 3개)
3. 예산 성향 (절약/가성비/프리미엄)
4. 하객 규모 (50↓/50-100/100-200/200-300/300↑)

### 7.4 피드백 학습 시스템
**3가지 레벨**:
1. 즉시 학습: 같은 세션에서 "그게 아니라" 감지 → 수정
2. 커플별 학습: `chat_feedback`에 저장, 다음 대화에 반영
3. 전역 학습: 3명+ 동일 피드백 → 패턴 인식 → 모든 유저 적용

**자동 감지 6가지 패턴**:
- 교정: "아니", "그게 아니라"
- 재시도: "다시 해줘"
- 좌절: "이해를 못하네"
- 부정: "쓸모없", "별로"
- 혼란: 긴 답변 후 "?"
- 이탈: 긴 답변 후 "ㅇㅇ", "ㅋ"

### 7.5 아모라 디렉터 (플로팅)
**컨텍스트 기반 메시지** (우선순위):
- 예산 초과 감지 (10점)
- 찜 3개+ → 비교 제안 (8점)
- 선호도 미설정 (5점)
- 카테고리 선택 팁 (3점)
- 첫 방문 환영 (1점)

**카테고리별 팁**:
- 스튜디오: 원본 USB/앨범 추가비
- 드레스: 속옷/글러브 별도
- 메이크업: 리허설 포함 여부
- 예식장: 최소보증인원
- 한복: 혼주 한복 미리
- 예물: 스타일 먼저
- 신혼여행: 비수기 20-30% 절약

---

## 8. 업체 관리자 포털 (B2B)

**`/vendor/*`** — 다크 프로페셔널 테마 (의도적으로 Atelier 제외)

### 페이지
- `/vendor/login` — 업체 로그인
- `/vendor/register` — 업체 등록
- `/vendor/(portal)/dashboard` — 매출/예약 대시보드
- `/vendor/(portal)/products` — 상품 관리
- `/vendor/(portal)/bookings` — 예약 관리
- `/vendor/(portal)/contracts` — 계약서 관리
- `/vendor/(portal)/messages` — 고객 메시지
- `/vendor/(portal)/profile` — 업체 프로필 편집
- `/vendor/(portal)/analytics` — 분석/통계
- `/vendor/(portal)/settings` — 정산/알림 설정

### 기능
- 상품 CRUD + 이미지
- 시간 슬롯 관리
- 예약 수락/거절
- 계약서 템플릿/전송/서명
- 스태프 프로필 관리
- 고객 메시지 스레드
- 정산 (settlements)
- 프로모션 이미지

---

## 9. 백엔드/API

### 9.1 Next.js API Routes (`apps/web/src/app/api/`)

**인증**:
- `/api/auth/callback` — OAuth 콜백
- `/api/auth/delete` — 계정 삭제

**채팅**:
- `/api/chat` — 스트리밍 AI 응답 + 도구 호출
- `/api/chat/proactive` — 선제적 알림
- `/api/chat/feedback` — 피드백 저장

**커뮤니티**:
- `/api/community/posts` — 글 CRUD
- `/api/community/posts/voted` — 좋아요한 글
- `/api/community/posts/[id]/report` — 신고
- `/api/community/comments` — 댓글
- `/api/community/search` — 검색
- `/api/community/upload` — 이미지/영상
- `/api/community/cohort` — 동기방 배정
- `/api/community/cohort/[id]/messages` — 동기방 채팅
- `/api/community/cohort/[id]/contracts` — 계약 정보
- `/api/community/cohort/[id]/timeline` — 타임라인
- `/api/community/ai-comment` — AI 자동 댓글
- `/api/community/gamification` — XP/랭크
- `/api/community/gamification/login` — 출석

**업체**:
- `/api/vendors` — 업체 목록 (filter/search)
- `/api/vendors/[id]` — 업체 상세
- `/api/vendors/[id]/photos` — 사진
- `/api/favorites` — 찜하기 토글
- `/api/bookings` — 예약 CRUD
- `/api/bookings/mine` — 내 예약

**커플/여정**:
- `/api/couple/code` — 초대 코드 생성
- `/api/couple/link` — 커플 연동
- `/api/journey` — wedding_journeys CRUD

**청첩장**:
- `/api/invitations` — 청첩장 CRUD
- `/api/invitations/[id]/photos` — 사진 업로드
- `/api/invitations/[id]/guestbook` — 방명록
- `/api/invitations/[id]/rsvp` — RSVP
- `/api/invitations/guest/[slug]` — 게스트 뷰
- `/api/invitations/templates` — 템플릿

**그 외**:
- `/api/schedules` — 일정
- `/api/money` — 축의금
- `/api/scripts` — AI 대본
- `/api/events` — 이벤트 추적
- `/api/profile` — 프로필
- `/api/guestbook` — 방명록
- `/api/messages` — 커플 메시지
- `/api/contracts` — 계약서
- `/api/payments` — 결제

**Vendor B2B**:
- `/api/vendor/me` — 내 업체 정보
- `/api/vendor/products` — 상품 관리
- `/api/vendor/bookings` — 예약 관리
- `/api/vendor/contracts` — 계약서
- `/api/vendor/analytics` — 분석
- `/api/vendor/staff` — 스태프
- `/api/vendor/timeslots` — 시간 슬롯
- `/api/vendor/register` — 등록
- `/api/vendor/settlements` — 정산

### 9.2 모바일 호환성
- 63개 API가 `createClientFromRequest()` 사용
- Bearer 토큰 (모바일) + Cookie (웹) 모두 지원

---

## 10. 데이터 모델

### 10.1 주요 Supabase 테이블

**인증/프로필**:
- `profiles` — 유저 기본 프로필
- `community_profiles` — 커뮤니티 전용 (닉네임/랭크/XP)

**커플/여정**:
- `couples` — 커플 관계
- `wedding_journeys` — 진행 상황 (progress JSONB)
  - `progress.__preferences` — 온보딩 선호도
  - `progress.__events` — 이벤트
  - `progress.{category}` — 카테고리별 예산/지출/체크리스트

**채팅**:
- `chat_messages` — AI + 커플 메시지 (sender_type, role)
- `chat_summaries` — 대화 요약
- `chat_feedback` — AI 피드백 학습

**커뮤니티**:
- `community_posts` — 게시글
- `community_comments` — 댓글
- `community_votes` — 투표 (post_id, vote_type)
- `community_bookmarks` — 북마크
- `community_reports` — 신고

**동기방**:
- `cohort_rooms` — 분기별 방
- `cohort_members` — 멤버십
- `cohort_messages` — 채팅
- `cohort_contracts` — 계약 정보
- `cohort_timeline_events` — 타임라인

**업체**:
- `vendors` — 업체 정보
- `vendor_products` — 상품
- `vendor_photos` — 사진
- `vendor_staff` — 스태프
- `vendor_timeslots` — 예약 가능 시간
- `vendor_bookings` — 예약
- `vendor_contracts` — 계약서
- `vendor_favorites` — 찜
- `vendor_reviews` — 리뷰
- `vendor_settlements` — 정산

**청첩장**:
- `invitations` — 청첩장
- `invitation_photos` — 사진
- `invitation_guestbook` — 방명록
- `invitation_rsvp` — RSVP
- `invitation_accounts` — 계좌번호
- `invitation_templates` — 템플릿

**기타**:
- `schedules` — 일정
- `budgets`, `budget_items` — 예산
- `money_records` — 축의금
- `scripts` — AI 대본
- `customer_insights` — 유저 인사이트
- `fitting_requests` — 드레스 피팅
- `preregistrations` — 사전등록

---

## 11. 인증/보안

### 11.1 인증 제공자
- **카카오** — 이메일 제외 (비즈니스 앱 아님)
- **구글** — 기본
- **Apple Sign In** — Team ID 6RSK726532, Services ID `ai.hanbang.wedding.web`
- **이메일/비밀번호** — 기본 Supabase Auth

### 11.2 보안
- RLS (Row Level Security) 전 테이블 적용
- Rate limiting (채팅 피드백 20/hr)
- XSS sanitize (`utils/sanitize.ts` — regex 기반)
- CSRF: Next.js 기본
- Headers: X-Frame-Options, CSP 등

### 11.3 데모 모드
- `/demo` 쿠키로 인증 우회 (내부 테스트용)

---

## 12. 배포/인프라

### 12.1 Vercel (웹)
- Production: hanbang.ai
- Preview: 브랜치별 자동 배포
- Root Directory: `apps/web`
- Build: `pnpm --filter web build`

### 12.2 Supabase
- URL: `https://slrtobkksjmxgzatjyqb.supabase.co`
- Region: Seoul (추정)
- 플랜: Pro ($25/mo)
- Custom Domain: 미설정 (auth.hanbang.ai 계획)

### 12.3 도메인
- hanbang.ai (primary)
- www.hanbang.ai (redirect)

### 12.4 이메일 (Resend)
- 사전등록 확인 메일
- 청첩장 발송 (예정)

### 12.5 이미지 최적화
- `next.config.ts`: AVIF/WebP, 30일 캐시
- 허용 도메인: `**.supabase.co`, `api.dicebear.com`

---

## 13. 남은 작업

### 긴급
- [ ] **Supabase 테이블 생성** (SQL 실행 필요)
  - `chat_feedback`
  - `community_reports`
- [ ] **EAS Build → TestFlight 제출**
- [ ] 실기기 전체 테스트

### 중요
- [ ] 업체 시드 데이터 (최소 서울/경기 주요 100개)
- [ ] 이메일 알림 시스템
- [ ] 청첩장 공개 뷰어 완성
- [ ] 모바일 전체 페이지 반응형 재검증

### 개선
- [ ] Editor's Pick 주간 자동 선정 cron
- [ ] 아모라 디렉터를 budget/schedule 페이지에도 확장
- [ ] 축의금 ↔ 하객명단 연동
- [ ] Sentry DSN 연결
- [ ] SEO 메타 태그 페이지별 최적화
- [ ] 모바일 앱에도 동일한 Atelier 디자인 적용

### 장기
- [ ] Custom Domain (auth.hanbang.ai)
- [ ] AI 드레스 피팅 (Decart API)
- [ ] 결제 (토스페이먼츠)
- [ ] 웹 푸시 알림

---

## 주요 완료 마일스톤 (2026-04)

✅ **Apple Sign In 전체 설정 + 테스트 통과**
✅ **SEO (sitemap.xml + robots.txt)**
✅ **커뮤니티 전체 리디자인** (Atelier Hub)
✅ **63개 API 모바일 Bearer 토큰 호환**
✅ **AI 아모라 심층 고도화** (감정곡선/결정피로/심리학)
✅ **AI 피드백 학습 시스템** (커플별 + 전역)
✅ **온보딩 가이드 슬라이드** (웹 2개 + 앱 1개)
✅ **영상/GIF 업로드** (MP4 50MB)
✅ **동기방 채팅 이미지/글공유/멘션**
✅ **DiceBear 자동 아바타 시스템**
✅ **서비스 전체 Atelier 팔레트 통일** (70+ 파일)
✅ **모바일 반응형 전체 수정**

---

## 연락처/리소스

- **GitHub**: https://github.com/Kyu-Sung-Cho/wedding-hanbang-web
- **Vercel**: wedding-hanbang-web project
- **Supabase**: slrtobkksjmxgzatjyqb.supabase.co
- **Apple Developer**: Team 6RSK726532
- **Expo**: (계정 연결 필요)

---

**관리자 이메일**: kcho11289@gmail.com
