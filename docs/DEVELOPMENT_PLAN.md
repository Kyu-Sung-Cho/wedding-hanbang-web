# 웨딩한방 웹/앱 통합 개발 플랜

> 최종 업데이트: 2026-07-10 (AI 공급자·모델 갱신)
> 개발자: 솔로 (Claude Code 활용)
> 출시 목표: 2026-06-09 (2개월)
> 월 예산: $500

---

## 📦 아키텍처 개요

```
wedding-hanbang/                          ← pnpm + Turborepo 모노레포
│
├── apps/
│   ├── web/                              Next.js 15 (App Router)
│   │   └── Vercel → hanbang.ai           라이브 중
│   └── mobile/                           Expo SDK 54 (Expo Router 6)
│       └── EAS → App Store / Play Store   개발 중
│
├── packages/
│   ├── @hanbang/shared/                  타입/상수/유틸 (웹/앱 공유)
│   └── @hanbang/design-tokens/           브랜드 팔레트 (웹/앱 단일 소스)
│
├── supabase/                             마이그레이션/시드 (웹/앱 공유 DB)
│
└── .github/workflows/ci.yml             타입체크 + 빌드
```

### 기술 스택

| 레이어 | 웹 | 앱 |
|--------|-----|-----|
| 프레임워크 | Next.js 15 | Expo SDK 54 |
| 라우팅 | App Router | Expo Router 6 |
| 스타일링 | Tailwind CSS 4 | React Native StyleSheet |
| 상태 (클라이언트) | Zustand | Zustand |
| 상태 (서버) | fetch + Zustand | TanStack Query (Phase 1 도입) |
| DB/Auth | Supabase (공유) | Supabase (공유) |
| AI | OpenAI GPT-5.6 Luna + Terra | OpenAI Responses API (동일) |
| 에러 추적 | Sentry | Sentry |
| 분석 | PostHog (Phase 2) | PostHog (Phase 2) |
| 빌드/배포 | Vercel | EAS Build + EAS Update |
| CI | GitHub Actions | GitHub Actions |

### 공유 백엔드

```
┌──────────┐   ┌──────────┐
│   Web    │   │  Mobile  │
└─────┬────┘   └────┬─────┘
      │              │
      │   ┌──────────┴──────────┐
      └───┤  Next.js API Routes │  ← 비즈니스 로직 중앙화
          │  (apps/web/api/*)   │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │     Supabase        │  ← DB / Auth / Storage / Realtime
          │  (공유 프로젝트)    │
          └─────────────────────┘
```

앱은 웹의 API Routes를 호출 → 비즈니스 로직 중복 방지, 앱 업데이트 없이 로직 수정 가능.

---

## 🗓 8주 로드맵

### Week 1 — Phase 0: 기반 (✅ 완료)

| 항목 | 상태 |
|------|------|
| pnpm + Turborepo 모노레포 전환 | ✅ |
| apps/web → Vercel 배포 정상 | ✅ |
| apps/mobile Expo SDK 54 초기화 | ✅ |
| @hanbang/design-tokens 패키지 | ✅ |
| @hanbang/shared 스켈레톤 | ✅ |
| Supabase 클라이언트 (앱, SecureStore) | ✅ |
| Sentry 패키지 설치 (웹 + 앱) | ✅ |
| GitHub Actions CI | ✅ |
| 로그인 화면 (카카오/Apple 버튼) | ✅ |
| 카카오 OAuth 연동 | ✅ |
| 4탭 네비 (홈/아모라/커뮤니티/내 정보) | ✅ |
| Apple Developer $99 결제 | ✅ (활성화 대기) |
| Google Play 개발자 계정 | ✅ |

---

### Week 2 — Phase 1a: 핵심 기능 (AI 채팅 + 대시보드)

| 항목 | 설명 |
|------|------|
| **AI 채팅 (아모라)** | GPT-5.6 Terra 스트리밍, 웹 API Route 경유 |
| - 채팅 UI | 메시지 버블, 입력창, 자동 스크롤 |
| - 스트리밍 응답 | 타이핑 효과 (chunk 단위 렌더) |
| - 대화 저장 | Supabase chat_messages 테이블 |
| - 대화 이력 | 이전 대화 불러오기 |
| **대시보드 실데이터** | Supabase 연동 |
| - D-day 카드 | wedding_journeys.wedding_date 기반 |
| - 진행률 | 체크리스트 완료율 계산 |
| - 오늘의 할 일 | 미완료 체크리스트 중 오늘 기한인 것 |
| - 프로필 정보 | profiles 테이블에서 이름/이미지 |
| **Paperlogy 폰트 로드** | 자체 호스팅 WOFF2/TTF 자산 사용 |
| **TanStack Query 도입** | 서버 상태 캐싱/동기화 |

---

### Week 3 — Phase 1b: 일정 + 예산 + 폰트

| 항목 | 설명 |
|------|------|
| **체크리스트/일정** | 읽기 + 체크 (편집은 Phase 2) |
| - 카테고리별 체크리스트 | 127개 항목 (웹과 동일) |
| - 체크 토글 | 낙관적 업데이트 + Supabase 동기화 |
| - 임박 알림 카드 | 7일 내 마감 항목 표시 |
| **예산 읽기** | budgets + budget_items |
| - 총예산/지출/잔여 | 카드 형태로 표시 |
| - 카테고리별 지출 | 리스트 (편집은 Phase 2) |

---

### Week 4 — Phase 2a: 커뮤니티 (읽기)

| 항목 | 설명 |
|------|------|
| **커뮤니티 피드** | 게시글 목록 (5개 게시판) |
| - 카테고리 칩 탭 | 이거 정상이야?/투어후기/꿀팁/AMA/자유 |
| - PostCard 컴포넌트 | 제목/미리보기/좋아요/댓글 수 |
| - 무한 스크롤 | FlatList + 페이지네이션 |
| - 게시글 상세 | 풀스크린, 이미지 갤러리, 댓글 |
| - 좋아요/북마크 | 낙관적 업데이트 |
| **동기방 읽기** | 채팅 메시지 리스트 (Realtime 수신) |

---

### Week 5 — Phase 2b: 커뮤니티 (쓰기) + 동기방

| 항목 | 설명 |
|------|------|
| **게시글 작성** | 풀스크린 에디터 |
| - 카테고리 선택 | 드롭다운 |
| - 광고 표시 모달 | 일반/협찬/광고 필수 선택 |
| - 이미지 업로드 | expo-image-picker + Supabase Storage |
| - 태그 입력 | |
| **댓글 작성** | 대댓글 1단계 |
| **동기방 채팅** | 실시간 송수신 |
| - 메시지 보내기 | Supabase Realtime |
| - 스레드 토픽 필터 | 가격/후기/고민/잡담 |
| **푸시 알림 설정** | expo-notifications + Supabase Edge Function |

---

### Week 6 — Phase 3: 폴리싱 + 추가 기능

| 항목 | 설명 |
|------|------|
| **Apple Sign In** | iOS 심사 필수 (카카오 있으면 Apple도 반드시) |
| **프로필/설정** | 닉네임 수정, 결혼 예정일 변경, 로그아웃, 탈퇴 |
| **딥링크** | hanbang://community/post/[id] 등 |
| **방명록 뷰어** | 웹에서 만든 방명록을 앱에서 보기 (QR 포함) |
| **웹뷰 fallback** | 업체 탐색/드레스 피팅 등 → WebView로 hanbang.ai 열기 |
| **에러 바운더리** | 크래시 시 우아한 fallback UI |
| **로딩 스켈레톤** | 모든 데이터 페칭 화면에 골격 UI |

---

### Week 7 — Phase 4: 앱스토어 준비

| 항목 | 설명 |
|------|------|
| **앱 아이콘** | 1024×1024 (App Store), adaptive icon (Android) |
| **스플래시 스크린** | 브랜드 로고 + #FBF8F2 배경 |
| **앱스토어 스크린샷** | iPhone 6.7" (필수) + 6.1" + iPad (선택) |
| **앱 설명문** | 한국어, 키워드 최적화 |
| **개인정보처리방침** | hanbang.ai/privacy 페이지 |
| **이용약관** | hanbang.ai/terms 페이지 |
| **EAS Build** | iOS .ipa + Android .aab |
| **TestFlight** | 내부 테스트 (본인 + 지인 3-5명) |
| **Google Play 내부 테스트** | 클로즈드 테스트 트랙 |

---

### Week 8 — Phase 5: 심사 + 런칭

| 항목 | 설명 |
|------|------|
| **버그 픽스** | TestFlight 피드백 기반 |
| **성능 최적화** | FlatList 최적화, 이미지 lazy load |
| **App Store Connect 제출** | 심사 평균 24-48시간 |
| **Google Play Console 제출** | 심사 평균 1-3일 |
| **심사 반려 대응** | ATT, IAP, metadata 이슈 즉시 수정 + 재제출 |
| **런칭** | 앱스토어 공개 + 마케팅 시작 |
| **EAS Update 설정** | OTA 업데이트 파이프라인 (심사 없이 JS 배포) |

---

## 📱 앱 V1 스코프 (포함/제외)

### ✅ 포함 (8주 안에 개발)

| 기능 | 설명 |
|------|------|
| 카카오 로그인 | ✅ 완료 |
| Apple 로그인 | Week 6 |
| 대시보드 | D-day, 진행률, 오늘의 할 일 |
| AI 채팅 (아모라) | GPT-5.6 Terra 스트리밍, Luna 보조 처리, 대화 저장 |
| 체크리스트/일정 | 읽기 + 체크 |
| 예산 | 읽기 전용 |
| 커뮤니티 피드 | 읽기 + 좋아요 + 북마크 |
| 커뮤니티 글쓰기 | 광고표시 모달 포함 |
| 동기방 | 실시간 채팅 (읽기 + 쓰기) |
| 푸시 알림 | 동기방 메시지, 댓글 |
| 프로필/설정 | 수정, 로그아웃 |
| 방명록 뷰어 | 웹에서 만든 방명록 보기 |

### ❌ 제외 → 웹으로 딥링크 (V2에서 앱 네이티브 구현)

| 기능 | 이유 |
|------|------|
| 드레스 피팅 | 카메라 + AI 복잡 |
| 업체 탐색/예약 | 데이터 많음, 웹이 더 편함 |
| 방명록 생성/편집 | 웹에서 만들고 앱은 뷰어만 |
| 예산 편집 | 읽기만 (웹에서 편집) |
| 예절 가이드 | WebView로 hanbang.ai/etiquette |
| 인앱 결제 | V1에서는 유료 기능 없음 |
| 결혼식 초대장 | 웹 전용 |

---

## 🎨 디자인 시스템

### 브랜드 팔레트 (웹/앱 공유)

```
Eucalyptus Ink:     #36534E (800), #243832 (900)
Dusty Mauve:        #A77B74 (500), #8F6662 (600)
Pearl Ivory (BG):   #FBF8F2 (bg), #F7F1E8 (100), #EFE4D7 (200)
Taupe:              #B7AA9A (400), #635B51 (500)
Sage:               #6D806E
Champagne Taupe:    #B89785
Border:             #E5D8CA
Surface:            #FFFFFF
Text Primary:       #263832
Text Secondary:     #5F5B52
Text Tertiary:      #7D7166
```

### 폰트

| 용도 | 웹 (CSS) | 앱 (RN) |
|------|----------|---------|
| 제목 | Paperlogy | NotoSerifKR_500Medium alias -> Paperlogy |
| 본문/UI | Paperlogy | NotoSansKR_400Regular alias -> Paperlogy |
| 숫자/강조 | Paperlogy | CormorantGaramond_400Regular alias -> Paperlogy |

### 컴포넌트 스타일 규칙 (앱)

```typescript
// 카드
{
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: 28,
  padding: 24,
}

// 버튼 (Primary)
{
  backgroundColor: colors.noir[800],  // #36534E
  borderRadius: 16,
  height: 56,
}

// 버튼 (Secondary)
{
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: 16,
  height: 56,
}

// 카카오 버튼
{
  backgroundColor: "#FEE500",
  borderRadius: 16,
  height: 56,
}
```

---

## 💰 예산 계획

### 현재 비용 (~$110/월)

| 항목 | 비용 | 설명 |
|------|------|------|
| Vercel Hobby | $0 | 무료 |
| Supabase Free | $0 | 유저 500명까지 |
| Sentry Developer | $0 | 월 5k 이벤트 |
| PostHog Free | $0 | 월 1M 이벤트 |
| Resend Free | $0 | 월 3k 이메일 |
| OpenAI API | 사용량 기반 | Terra/Luna 분리, 프로젝트 예산·알림으로 통제 |
| EAS Build | $0 | 월 30회 무료 |
| Apple Developer | $8 | $99/년 |
| Google Play | $0 | 일회성 $25 완료 |
| **합계** | **~$110** | $500 예산 내 |

### 스케일 시 ($500까지)

| 트리거 | 추가 비용 |
|--------|----------|
| 유저 500+ | Supabase Pro $25 |
| 대역폭 초과 | Vercel Pro $20 |
| AI 사용 증가 | OpenAI 사용량 증가 — 일일 앱 가드와 프로젝트 예산으로 제한 |
| Sentry 이벤트 초과 | Sentry Team $26 |

---

## 🔑 계정/키 정보

### Supabase
- URL: `https://slrtobkksjmxgzatjyqb.supabase.co`
- Anon Key: apps/web/.env.local 참조
- Service Role Key: apps/web/.env.local 참조 (절대 클라이언트에 노출 금지)

### 카카오
- 앱 ID: 1381347
- REST API 키: 1a499ef14f83252c6b708c453d9eafc4
- 네이티브 앱 키: 5b5e688bab03b36088187d8634b541cc
- JavaScript 키: 40cd7bb2eacef8519cf7faaf37fbac6d
- ⚠️ account_email: 비즈앱 전환 전까지 사용 불가

### Apple Developer
- 등록 유형: Individual
- 주문번호: W1537509591
- Team ID: 활성화 후 확인 예정

### 앱 식별자
- Bundle ID (iOS): `ai.hanbang.wedding`
- Package name (Android): `ai.hanbang.wedding`
- Scheme (딥링크): `hanbang://`
- 앱 이름: 웨딩한방 / Wedding Hanbang

---

## 📐 앱 화면 구조

```
app/
├── _layout.tsx              루트 (SafeArea + Sentry)
├── index.tsx                세션 체크 → 리다이렉트
│
├── (auth)/
│   ├── _layout.tsx
│   └── login.tsx            카카오/Apple 로그인
│
├── (tabs)/
│   ├── _layout.tsx          하단 4탭
│   ├── dashboard.tsx        홈 (D-day, 진행률, 할 일)
│   ├── chat.tsx             AI 아모라 채팅
│   ├── community.tsx        커뮤니티 피드
│   └── profile.tsx          내 정보/설정
│
├── chat/
│   └── [id].tsx             대화 상세 (스트리밍)
│
├── community/
│   ├── post/[id].tsx        게시글 상세
│   ├── post/write.tsx       글쓰기
│   ├── cohort/[id].tsx      동기방 채팅
│   └── guestbook/[slug].tsx 방명록 뷰어
│
├── schedule/
│   └── index.tsx            체크리스트/일정
│
├── budget/
│   └── index.tsx            예산 (읽기)
│
└── webview.tsx              웹 fallback (업체탐색/피팅/예절 등)
```

---

## ⚠️ 알려진 제약/결정

| 항목 | 결정 | 이유 |
|------|------|------|
| NativeWind v4 | **사용 안 함** | pnpm + SDK 54에서 className 무시 버그 |
| 스타일링 | StyleSheet + design-tokens | 안정적, 디버깅 쉬움 |
| 카카오 이메일 | scope에서 제외 | 비즈앱 아니라 권한 없음 |
| API 호출 | 웹 API Routes 경유 | 비즈니스 로직 중앙화 |
| 오프라인 | V1에서 미지원 | 유저 1,000 이후 검토 |
| i18n | V1에서 한국어만 | 해외 한인 유입 시 추가 |
| 인앱 결제 | V1에서 없음 | 유료화 결정 시 RevenueCat |

---

## 🚀 런칭 후 로드맵 (V2)

### 유저 1,000명 달성 후

| 항목 | 설명 |
|------|------|
| Sentry 코드 연결 | DSN 입력 + source maps |
| PostHog 분석 | 유저 행동 추적 |
| 오프라인 지원 | TanStack Query persist |
| 드레스 피팅 (앱) | expo-camera + AI |
| 예산 편집 (앱) | 풀 CRUD |
| 업체 탐색 (앱) | 네이티브 화면 |

### 유저 5,000명 달성 후

| 항목 | 설명 |
|------|------|
| API Gateway 분리 | Hono + Cloudflare Workers |
| PowerSync | 오프라인 양방향 동기화 |
| RevenueCat | 인앱 결제/구독 |
| i18n | 영어/일본어 |
| E2E 테스트 | Playwright (웹) + Maestro (앱) |

### 유저 10,000명 달성 후

| 항목 | 설명 |
|------|------|
| 관리자 대시보드 분리 | apps/admin |
| Storybook | 컴포넌트 카탈로그 |
| 시각적 회귀 테스트 | Chromatic |
| Terraform | 인프라 코드화 |
| 다국어 | next-intl + i18next |

---

## 📝 개발 규칙

### 코드 컨벤션

- **웹 컴포넌트**: 함수형, `export default function ComponentName()`
- **앱 컴포넌트**: 함수형, StyleSheet.create + design-tokens
- **타입**: any 금지, 모든 props에 타입 정의
- **네이밍**: PascalCase (컴포넌트), camelCase (함수/변수)
- **에러 처리**: try-catch + 사용자 친화적 메시지
- **주석**: 한국어, 핵심 로직에만

### 커밋 컨벤션

```
feat(web):     웹 새 기능
feat(mobile):  앱 새 기능
fix(web):      웹 버그
fix(mobile):   앱 버그
style:         디자인/스타일
refactor:      리팩토링
chore:         설정/패키지
docs:          문서
```

### PR 규칙

- 1,000줄 이상 PR 지양
- UI 변경 시 스크린샷 첨부
- 타입체크 통과 필수
- 웹 빌드 성공 필수

---

*이 문서는 개발 진행에 따라 업데이트됩니다.*
