# 웨딩한방 보수적 전체 평가 계획 (2026-07-03)

> **원칙**: "증명되기 전까지는 안 되는 것으로 간주한다."
> 문서에 "완료"라고 적혀 있어도 실제로 빌드·실행·확인되지 않으면 미완으로 평가.
> 한 번에 딱 한 작업만 진행. 각 작업 끝날 때마다 이 파일의 상태를 갱신.

## ⚙️ 운영 규칙 (2026-07-03 사용자 지시)

- **모델은 Fable 5 고정** (`switchModelsOnFlag: false`). Opus로 자동 전환하지 않음.
- **안전장치 플래그에 걸릴 만한 작업은 건너뛴다.** 안전장치를 어기고 Fable로 강행하지 않음.
  걸릴 것 같은 작업(공격/익스플로잇 제작 등으로 오인될 수 있는 것)은 **미리 스킵 → 아래 "스킵 로그"에 무엇을·왜 기록 → 다음 작업으로 진행.**
- 예상 못 한 플래그로 세션이 멈추면, 사용자가 "스킵"이라고만 해주면 즉시 다음 작업으로 넘어감.
- 지금까지 이 평가의 방어적 감사(0.1~2.1)는 플래그 0건 — 대부분 정상 진행 예상.

### 스킵 로그 (플래그 회피로 건너뛴 작업)
| 작업 | 스킵 이유 | 대체 조치 |
|------|-----------|-----------|
| (아직 없음) | | |

## 평가 등급 (모든 작업 공통)

| 등급 | 의미 |
|------|------|
| ✅ 견고 | 동작 확인됨 + 명백한 결함 없음 |
| ⚠️ 취약 | 동작은 하지만 보안/품질/엣지케이스 문제 있음 |
| ❌ 깨짐 | 빌드 실패, 런타임 에러, 또는 핵심 플로우 미동작 |
| 🚫 유령 | 코드/문서만 존재, 실제로 연결 안 된 죽은 기능 |
| ❓ 미확인 | 아직 평가 안 함 (기본값) |

---

## Phase 0 — 작업공간 위생 (코드 보기 전에)

- [x] **0.1 최상위 폴더 정리 상태 점검** — 완료 (2026-07-03). **등급: ⚠️ 취약.**
  - 빈 껍데기 3개 (파일 0개, 순수 쓰레기): `apps/`(6/25 생성, 도구가 잘못된 루트에서 실행된 흔적), `docs/`(빈 폴더), `c:UsersadminDesktop...`(경로 문자열이 폴더명이 된 버그 산물, 2/11)
  - `nul` — 0바이트, `> nul` 리다이렉트가 비-cmd 셸에서 실행돼 생긴 파일 (2/11)
  - **가장 심각**: 최상위 `CLAUDE.md`(2/10)와 `AGENTS.md`(5/11)가 **모노레포 이전의 낡은 가이드** — Next.js 14, 삭제된 기능들, 존재하지 않는 구조를 설명. 매 AI 세션에 로드되어 실제 가이드(`hanbang-web/CLAUDE.md` 6/15, `hanbang-web/AGENTS.md` 7/3)와 충돌. AI가 낡은 지시를 따를 실위험.
  - `reference-landing.html`(2/10) — 레포 안 버전(2/19)보다 낡은 중복
  - `SETUP_GUIDE.md`(2/10) — 초기 셋업 문서, 완전 구식 / `SKILLS_GUIDE.md`(5/7) — 프로젝트와 무관한 개인 스킬 목록
  - **삭제 후보**: 빈 폴더 3개 + nul + reference-landing.html + SETUP_GUIDE.md (전부 안전). CLAUDE.md/AGENTS.md는 삭제 대신 "hanbang-web/을 봐라" 한 줄 포인터로 교체 권장.
- [x] **0.2 문서 vs 실제 코드 대조** — 완료 (2026-07-03). **등급: 코드 ✅ 경향 / 문서 ❌.**
  주장 119건 검증: EXISTS 47 / PARTIAL 43 / 삭제됐는데 문서 미갱신 25 / 유령 2 / 불명 2.
  핵심: FEATURES.md·PROJECT_STATUS.md는 6/11 수술 이전 스냅샷 — 21%가 삭제된 기능을 현재형으로 설명.
  죽은 코드 6건 발견 (랜딩 고아 컴포넌트, ServiceBanner, 모바일 guestbook 화면, /customer 스텁, 게이미피케이션 반쪽, dicebear 잔재).
  상세: `docs/DOC_VS_CODE_AUDIT_2026-07-03.md`

## Phase 1 — 기초 체력 (빌드가 되는가)

- [x] **1.1 웹 타입체크 + 린트** — 완료 (2026-07-03). **등급: ✅ 견고.**
  `tsc --noEmit`(strict: true, src 전체 포함) 에러 0 / `eslint .`(next core-web-vitals + typescript 규칙) 442개 파일 검사, 에러 0·경고 0.
  설정 조작 없음 확인: tsconfig strict 모드, exclude는 node_modules뿐, eslint ignore는 빌드 산출물뿐.
- [x] **1.2 웹 프로덕션 빌드** — 완료 (2026-07-03). **등급: ✅ 견고.**
  `next build`(16.2.6 Turbopack) exit 0 — 컴파일 10.5s, TS 14.8s, 정적 페이지 99개 생성, 출력 161줄 전체에 경고/에러 0.
  특이사항 1건(무해): `/wedding/wedding/[[...slug]]`는 중복 경로 방어 리다이렉트(의도적 밴드에이드) — 과거 이중 프리픽스 링크 버그의 흔적. 근본 원인 재발 여부는 5.2 라이브 스모크에서 확인.
- [x] **1.3 웹 테스트 실행** — 완료 (2026-07-03). **등급: ⚠️ 취약 (통과는 완벽, 공백이 큼).**
  `vitest run`: **31파일 269개 전부 통과**, 실패 0 (6/11의 165개에서 증가 — 활발히 유지 중).
  잘 덮인 곳: AI 도구 모듈 6종(toolExecutor는 125KB→22KB+모듈로 분리됨), 아모라(액션/모멘트/견적), costGuard, 커뮤니티 로직 6종, 스토어 2종, sanitize/rateLimit.
  **공백 (보수적 핵심)**: ①API 라우트 **82개 중 테스트 2개**(2.4%) — chat(48KB)·auth·admin·money 전부 무테스트 ②BudgetContent(64KB) 내 예산 계산 로직 ③chatStore(64KB)·moneyStore ④proxy.ts 인증 가드 ⑤UI 전체(단계상 통상적).
- [x] **1.4 모바일 타입체크 + 린트** — 완료 (2026-07-03). **등급: ✅ 견고 (린트 규칙 약점 1건 메모).**
  `tsc --noEmit`(strict) 에러 0 / `eslint .` 62파일 에러 0·경고 0 (no-console 규칙 포함 통과).
  메모: 모바일 eslint에는 react-hooks 규칙(exhaustive-deps 등)이 없음 — 웹 대비 약한 구성. RN 실버그를 잡아주는 규칙이라 추가 권장 (Phase 6 권고에 포함).
- [x] **1.5 의존성·시크릿 감사** — 완료 (2026-07-03). **등급: ⚠️ 취약 (경미 — 4축 중 3축은 사실상 만점).**
  발견 23건: high 3 / medium 1 / low 3 / info 16(대부분 "클린 확인").
  - 시크릿: 커밋 소스에 하드코딩 0건, git 전체 히스토리 유출 0건, 서버 키 클라이언트 노출 0건, 모바일 번들 안전, .gitignore 완벽 — **모범적**
  - 의존성: critical 0. high 3은 전부 devDeps(jsdom/vitest 경유 undici@7.27.2) — 프로덕션 비노출. **실제 배포 경로는 medium 1건뿐**(@sentry/nextjs 경유 @opentelemetry/core CVE-2026-54285)
  - 잔여 조치 항목: ①undici override 한 줄 추가(기존 override가 6.x만 커버) ②Sentry 업데이트 ③**ADMIN_PASSWORD — 4월 감사의 즉시 회전 권고 미이행** (한글 키보드 패턴 여전, Vercel도 동일값이면 위험) ④미사용 DECART_API_KEY revoke ⑤Supabase 프로젝트 URL이 tracked 문서 4곳에 (공개 레포 전환 시 제거)

## Phase 2 — 보안 (보수 평가의 핵심, 기능보다 먼저)

- [x] **2.1 API 인증 감사 A: 관리자·인증 계열** — 완료 (2026-07-03). **등급: ⚠️ 취약 (심각 구멍 없음).**
  23개 라우트 감사. critical/high 확정 0 — 인증 기반 견고(verifyAdmin 16개 전부 적용 + is_admin DB 트리거 이중방어).
  medium 확정 3건(전부 감사자 직접 재검증): C1 시드 4종 프로덕션 환경게이트+멱등성 부재, C2 seed PUT이 실업체 타임슬롯 무차별 개방, C3 onboarding create가 기존 커플 소속 미검사→고아화.
  저심각도 21건(에러 원문 노출·rate limit 부재 등). 안전 확인 38건.
  **감사 방법론 교훈**: 워크플로가 시드 4종 중 1개만 CONFIRMED·3개 REFUTED로 냈으나 직접 확인 결과 4개 동일 결함 공유 — 반박 판정이 "표현 오류"를 걸러낸 것이지 결함 부재가 아니었음. 확정 건 직접 재검증이 필수임을 재확인.
  상세: `docs/SECURITY_AUDIT_2.1_ADMIN_AUTH_2026-07-03.md`
- [ ] **2.2 API 인증 감사 B: 돈 계열** — `api/money`, `api/bookings`, `api/quote`(견적/위약금) 계열. service role 남용, 남의 데이터 접근 가능 여부.
- [ ] **2.3 API 인증 감사 C: AI 계열** — `api/chat`, `api/amora`. 무인증 호출로 Claude API 비용 태울 수 있는지 (비용 폭탄 리스크).
- [ ] **2.4 API 인증 감사 D: 나머지** — `api/community`, `api/vendors`, `api/preregister`, `api/events`, `api/favorites`, `api/messages`, `api/journey`, `api/couple`, `api/survey`, `api/demo`.
- [ ] **2.5 Supabase RLS 정책 점검** — `supabase/` 폴더 + `supabase-migration.sql`의 RLS 정책이 실제 테이블 접근 패턴과 맞는지.

## Phase 3 — 웹 기능 하나씩 (기능당 1작업)

- [ ] **3.1 랜딩페이지 + 사전등록** — `/` 렌더링, preregister 플로우, Resend 이메일 발송 코드.
- [ ] **3.2 인증 전체 플로우** — 로그인/회원가입/OAuth 콜백/reset-password/middleware 가드/온보딩 연결.
- [ ] **3.3 AI 아모라 채팅** — 프롬프트 품질, 스트리밍, 에러 처리, 대화 저장, **AI 페르소나 컴플라이언스 리스크** (전략 리뷰에서 지적된 항목).
- [ ] **3.4 예산/축의금 (money)** — 계산 로직 정확성, 데이터 저장.
- [ ] **3.5 일정 관리 (schedule/journey)** — 캘린더, 타임라인, D-day.
- [ ] **3.6 업체 탐색 + 견적/위약금 진단 (vendors, quote)** — 전략상 "쐐기" 기능이므로 엄격하게.
- [ ] **3.7 커뮤니티** — 동기방, 글/댓글 CRUD, 최근 커밋(댓글 수정, 모바일 반응형)이 실제 동작하는지.
- [ ] **3.8 예약 (bookings)** — TEAM_HANDOFF 문서에 보안 이슈 언급 있음. 특히 엄격하게.
- [ ] **3.9 관리자 페이지** — (admin) 그룹, 접근 제어, 사전등록 현황.
- [ ] **3.10 정적 페이지 + SEO** — about/privacy/terms/ai-policy/beta/demo/customersurvey, robots.ts, sitemap.ts, OG 이미지.

## Phase 4 — 모바일 앱

- [ ] **4.1 모바일 실행 가능 여부** — Expo 시작, 번들 에러 유무.
- [ ] **4.2 인증 브릿지** — 웹 콜백 브릿지 패턴 (카카오/구글/Apple) 코드 점검.
- [ ] **4.3 탭별 기능** — (tabs), bookings, budget, community, etiquette, market-prices, schedule, settings, vendors 중 실제 구현 vs 껍데기 구분.
- [ ] **4.4 웹뷰 의존도** — webview.tsx가 어디에 쓰이는지, 네이티브 구현 vs 웹뷰 래핑 비율.

## Phase 5 — 데이터·운영·공유 코드

- [ ] **5.1 Supabase 스키마-코드 정합성** — 마이그레이션 SQL vs 코드에서 실제 참조하는 테이블/컬럼 대조.
- [ ] **5.2 프로덕션 라이브 스모크** — hanbang.ai 실제 접속, 주요 페이지 응답, 콘솔 에러.
- [ ] **5.3 packages/shared + design-tokens 실효성** — 실제로 양쪽 앱이 import하는지, 아니면 유령 패키지인지.

## Phase 6 — 종합

- [ ] **6.1 종합 성적표** — 기능별 등급표 + 리스크 랭킹 (치명/높음/중간/낮음) + "지금 당장 고쳐야 할 것 Top 5" + "죽은 코드 정리 목록".

---

## 진행 기록

| 날짜 | 작업 | 결과 요약 |
|------|------|-----------|
| 2026-07-03 | 계획 수립 | 총 26개 작업으로 분할 |
| 2026-07-03 | 0.1 작업공간 위생 | ⚠️ 취약 — 쓰레기 6건 + 낡은 CLAUDE.md/AGENTS.md가 AI를 오도 중 |
| 2026-07-03 | 0.1 후속 정리 | ✅ 완료 — 쓰레기 6건 삭제, CLAUDE.md/AGENTS.md는 hanbang-web/ 포인터로 교체. 남은 것: SKILLS_GUIDE.md(무해), .claude/, hanbang-web/ |
| 2026-07-03 | 0.2 문서 vs 코드 대조 | 코드 ✅ 경향 / 문서 ❌ — 주장 119건 중 39%만 완전 일치, 21%는 삭제된 기능. 상세 리포트 별도 저장 |
| 2026-07-03 | 0.2 후속: 경고 배너 | ✅ FEATURES/PROJECT_STATUS/FEATURE_AUDIT 상단에 "수술 이전 스냅샷" 배너 3개 추가 |
| 2026-07-03 | 1.1 웹 타입체크+린트 | ✅ 견고 — tsc strict 에러 0, eslint 442파일 에러 0·경고 0 (설정 조작 없음 확인) |
| 2026-07-03 | 1.2 웹 프로덕션 빌드 | ✅ 견고 — exit 0, 정적 99페이지, 경고 0. /wedding/wedding 중복경로 방어 리다이렉트 1건 메모 |
| 2026-07-03 | 1.3 웹 테스트 | ⚠️ — 269/269 통과(실패 0)지만 API 라우트 82개 중 테스트 2개, 예산 계산·chatStore·인증 가드 무테스트 |
| 2026-07-03 | 1.4 모바일 타입체크+린트 | ✅ 견고 — tsc strict 에러 0, eslint 62파일 0·0. react-hooks 린트 규칙 부재만 메모 |
| 2026-07-03 | 1.5 의존성·시크릿 감사 | ⚠️ 경미 — 시크릿/히스토리 완전 클린, critical 0. 잔여: undici override, Sentry 업데이트, ADMIN_PASSWORD 회전(4월 권고 미이행), DECART 키 revoke |
| 2026-07-03 | 1.5 후속: 패치 적용 | ✅ audit 8→1건 — undici 7.28.0 override 추가, Sentry 10.48→10.63(루트+web 중복 선언 둘 다). 잔존 1건은 Sentry 경유 otel(상류 릴리스 대기, 수용 리스크로 기록). ⚠️ 교훈: 전역 pnpm 9.15가 lockfile을 오염시킴(override 소실) — **이 레포는 반드시 `npx pnpm@11.7.0`로 실행** (packageManager 필드 기준) |
| 2026-07-03 | 2.1 API 인증 감사 A | ⚠️ 취약 — critical/high 0(인증 견고). medium 3(시드 환경게이트/멱등성, seed PUT 무차별, onboarding 고아화). 저심각 21. 상세 리포트 별도 |
