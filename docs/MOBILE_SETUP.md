# 웨딩한방 모바일 앱 셋업 가이드

> Phase 0 완료 상태에서 **본인 폰에 앱 실행**까지의 단계

## 1. 로컬 실행 (Expo Go)

### 1-1. iPhone 에 Expo Go 설치
- App Store → "Expo Go" 검색 → 설치 → 로그인 필요 없음 (체험은 무료)

### 1-2. 환경변수 파일 생성
```bash
cd apps/mobile
cp .env.example .env.local
```

`.env.local` 에 다음 값 채우기 (웹 `.env.local` 과 같은 Supabase 프로젝트):
```
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
EXPO_PUBLIC_SITE_URL=https://hanbang.ai
```
> ⚠️ `EXPO_PUBLIC_*` 만 클라이언트 번들에 포함됨. 시크릿(service role 등)은 절대 넣지 말 것.

### 1-3. 개발 서버 실행
모노레포 루트에서:
```bash
pnpm dev:mobile
```
또는 `apps/mobile`에서 직접:
```bash
cd apps/mobile
pnpm dev
```

Metro 번들러가 뜨고 QR 코드가 터미널에 출력됩니다.

### 1-4. 폰에서 스캔
- **iPhone**: 기본 카메라 앱으로 터미널 QR 스캔 → "Expo Go에서 열기"
- **Android**: Expo Go 앱 내 "Scan QR code"

같은 Wi-Fi에 연결돼 있어야 합니다. 다르면 Metro를 `--tunnel` 모드로:
```bash
pnpm dev -- --tunnel
```

---

## 2. Apple Developer 가입 (⚠️ 2개월 데드라인 기준 오늘 바로)

1. https://developer.apple.com/programs/enroll/
2. Apple ID 로그인 → **Enroll**
3. **Individual** 선택 (개인 개발자 — 빠름)
4. 주소/전화번호 입력
5. **$99 USD 결제** (연간)
6. 활성화까지 **1~3 영업일** 소요
7. 활성화되면 "Member Center" 접속 가능

**활성화 후 필요한 정보** (제가 Week 2에 물어볼 것):
- Team ID (Membership 페이지에 있음)
- Apple ID 이메일

---

## 3. Google Play 개발자 계정 (완료됨)

활성화 확인:
- https://play.google.com/console 접속 → 대시보드 보이면 OK

---

## 4. 카카오 개발자 앱 설정 (Week 2에 진행)

현재는 웹용 카카오 OAuth만 활성화돼 있을 겁니다. 앱용 플랫폼 추가는 Week 2에 제가 단계별로 안내할 예정:

**미리 확인해두실 것:**
1. https://developers.kakao.com/console/app 접속
2. 기존 "웨딩한방" 앱 선택 (또는 생성)
3. **앱 키** 섹션에서 다음 3개 기록:
   - REST API 키
   - 네이티브 앱 키 (Android/iOS 용)
   - JavaScript 키 (웹 용, 이미 쓰고 있을 것)
4. 이 값들을 나중에 공유해주시면 됩니다 (앱 키는 공개되어도 안전함)

---

## 5. EAS (Expo Application Services) 설정 (Week 4-5)

스토어 빌드/제출은 EAS CLI로 합니다. 지금은 설치만:

```bash
npm install -g eas-cli
eas login        # Expo 계정 필요 (무료)
```

본인이 지금 할 것:
1. https://expo.dev/signup → 무료 계정 생성
2. 터미널에서 `eas login`
3. 로그인되면 끝 (프로젝트 연결은 제가 Week 4에 진행)

---

## 6. 폴더 구조 설명

```
apps/mobile/
├── app/                        Expo Router 파일 기반 라우트
│   ├── _layout.tsx            루트 레이아웃 (Sentry init, SafeArea)
│   ├── index.tsx              세션 체크 → 리다이렉트
│   ├── (auth)/                인증 그룹
│   │   ├── _layout.tsx
│   │   └── login.tsx          카카오/Apple 로그인
│   └── (tabs)/                탭 네비 그룹
│       ├── _layout.tsx        하단 4개 탭
│       ├── dashboard.tsx      홈
│       ├── chat.tsx           AI 아모라
│       ├── community.tsx      커뮤니티
│       └── profile.tsx        내 정보
│
├── src/
│   ├── lib/
│   │   ├── supabase.ts        Supabase 클라이언트 (SecureStore)
│   │   └── sentry.ts          Sentry 초기화
│   └── components/            공용 UI 컴포넌트 (나중에)
│
├── assets/                    아이콘/스플래시 이미지
├── global.css                 NativeWind 전역 CSS
├── tailwind.config.js         브랜드 팔레트 (디자인 토큰 import)
├── metro.config.js            모노레포 대응 Metro 설정
├── babel.config.js            NativeWind + Reanimated
├── app.json                   Expo 앱 설정 (bundle ID, scheme)
├── tsconfig.json              @/* 경로 alias
└── package.json               @hanbang/mobile
```

---

## 7. 다음 단계 (Phase 1 미리보기)

- [ ] 카카오 OAuth (네이티브)
- [ ] Apple Sign In (iOS 심사 필수)
- [ ] AI 채팅 (공급자 중립 SSE + OpenAI Responses API) 화면
- [ ] 대시보드 실제 데이터 연결 (Supabase)
- [ ] 체크리스트/일정 화면
- [ ] TanStack Query 도입 (서버 상태)
- [ ] Noto 폰트 로드
- [ ] Sentry DSN 연결
- [ ] PostHog 연결
