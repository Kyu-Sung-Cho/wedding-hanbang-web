# 웨딩한방 보수적 전체 평가 계획 (2026-07-03)

> **원칙**: "증명되기 전까지는 안 되는 것으로 간주한다."
> 문서에 "완료"라고 적혀 있어도 실제로 빌드·실행·확인되지 않으면 미완으로 평가.
> 한 번에 딱 한 작업만 진행. 각 작업 끝날 때마다 이 파일의 상태를 갱신.

## ⚙️ 운영 규칙 (2026-07-03 · 2026-07-04 갱신, 사용자 지시)

- **모델은 Fable 5 고정** (`switchModelsOnFlag: false`). Opus로 자동 전환하지 않음. 플래그 시 전환이 아니라 **일시정지** — 그래서 애초에 안 걸리게 하는 게 핵심.
- **Fable 5 폴백 4카테고리** (이걸 유발할 토픽은 과감히 스킵): ①공격적 사이버(익스플로잇·멀웨어·공격툴 제작) ②생물·화학·생명과학 ③증류공격(요약 사고 추출) ④프런티어 LLM 개발(분산학습 인프라·ML 가속기·커널). **안전장치는 "의도적으로 넓음" — 읽는 모든 것(메모리·파일·웹)도 검사.**
- **이 프로젝트 = 자기 앱 방어적 감사라 본질적으로 4카테고리 밖.** 유일한 실질 위험은 ①번인데, 그것도 "제작"이 아니라 **결과 서술 방식** 문제. → **감사 리포트는 방어적으로 쓴다**: "리스크 + 수정 방향" 중심. 단계별 공격 재현 절차(익스플로잇 레시피)·즉시 실행 가능한 페이로드·공격 자동화 코드는 쓰지 않는다. 취약점은 "무엇이·왜 위험한지 + 어떻게 막는지"로 기록(재현 세부는 필요 최소한, "공격 시나리오" 나열 지양).
- **작업 자체가 공격툴 생성을 요구하면**(예: 침투 PoC 스크립트 작성) → 미리 스킵 → 아래 "스킵 로그"에 기록 → 다음 작업. 라이브 프로빙은 **읽기전용·본인 인프라 한정**(PAT/서비스키)이라 계속 허용.
- 예상 못 한 플래그로 세션이 멈추면, 사용자가 "스킵"이라고만 해주면 즉시 다음 작업으로.
- 진행 실적: 0.1~2.5 + H1/M1/M2 + 3.1 전부 플래그 0건 — 방어적 서술 유지 시 정상 진행 예상.

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
- [x] **2.2 API 인증 감사 B: 돈 계열** — 완료 (2026-07-03). **등급: ⚠️ 취약 (돈 코어는 견고, 취약점은 견적 진단 부수 표면).**
  money/bookings 코어(축의금 CRUD·예약 생성/결과)는 IDOR·service-role 오남용에서 깨끗 — couple_id 서버 파생, `assertMoneyOwner`/outcome 이중 스코프, `create_booking_atomic`은 authenticated EXECUTE 회수(service_role 전용), RLS 백스톱. IDOR 각도 발견 0.
  확정 medium 2건(둘 다 `amora/quote-check`, 커플/금전 데이터 아님·감사자 직접 재검증): **M1** vendor_leads 데이터 오염(인증 사용자가 임의 vendorName으로 내부 리드 priority/mention/proof 무검증 조작, admin 클라 RLS 우회 — 내부 운영 테이블 국한, PII·공개 노출 없음). **M2** rate limit IP 키가 X-Forwarded-For 최좌측 신뢰 → 익명 rate limit 우회 + rate_limit_buckets GC 부재로 테이블 블로트(공용 유틸이라 signup 등에도 공유, 단 quote-check 익명 경로는 LLM 비용 0). 불확실 low 2건(인메모리 rate limit 다중 인스턴스 배수·다계정 증폭). 반박 5건.
  죽은 코드: `bookings/mine`의 contracts/payments 조인(결제층 삭제로 0행, 유일 참조처).
  상세: `docs/SECURITY_AUDIT_2.2_MONEY_2026-07-03.md`
- [x] **2.3 API 인증 감사 C: AI 계열** — 완료 (2026-07-03). **등급: ⚠️ 취약 (무인증 비용폭탄 경로 없음, costGuard는 best-effort).**
  **무인증/무권한 LLM 호출 경로 0건** — 2.3의 핵심 공포는 방어됨. 모든 Anthropic 호출은 두 경로(감사 래퍼/메인 스트리밍)로만 나가고 둘 다 로깅, 인증+costGuard(또는 관리자 전용) 통과 필수. is_admin 면제는 DB 조회라 위조 불가. proactive는 LLM 미호출(순수 로컬).
  확정(감사자 직접 재검증): **H1(high, 코드레벨)** costGuard TOCTOU 레이스 — 가드가 chat_turn 카운트를 SELECT로 읽고 현재 턴은 fire-and-forget으로 後기록 → 동시요청이 커플100·전역300 상한 초과. 전역캡은 per-user rate limit이 못 지킴. **단 Anthropic 콘솔 월 $30 하드캡이 실 지갑손실 봉인 → 출시 차단 아님, 베타상한 키우기 전 최우선 원자화.** **L1(low)** 첨부 fetch DNS rebinding TOCTOU(인증·blind·https강제로 저수율). **I1(info)** ai-comment 비용이 costGuard 장부 밖(관리자 전용이라 무해). 반박 7.
  compounding: 가드가 "턴"을 세나 1턴이 tool round 6 + Haiku sub 4 = 실 API 최대 ~10배 → 상한이 이중으로 느슨(레이스+그래뉼래러티).
  상세: `docs/SECURITY_AUDIT_2.3_AI_2026-07-03.md`
- [x] **2.4 API 인증 감사 D: 나머지** — 완료 (2026-07-03, 인라인 Fable). **등급: ✅ 견고 (2.x 첫 견고).**
  신규 확정 결함 0. "나머지" 표면은 확립된 안전 패턴을 일관되게 따름: ①공개 쓰기(preregister·survey·demo)는 Turnstile+rate limit+검증, demo는 서명 쿠키만 발급(데이터 미노출) ②인증 커플-데이터(journey·couple·events·favorites)는 couple_id를 body 아닌 profiles에서 서버 파생·스코프 ③messages는 senderType/customerId 서버 결정(클라 무시) ④vendors는 공개 읽기+user 스코프 좋아요 ⑤community 쓰기(comments/posts edit·delete)는 author_id 소유권 403, cohort/투표/미디어는 round-2 하드닝. 교차 이슈는 기존 M2(XFF IP rate limit)뿐 — 공개 표면은 Turnstile이 실 게이트라 영향 제한. 상세: `docs/SECURITY_AUDIT_2.4_REST_2026-07-03.md`
- [x] **2.5 Supabase RLS 정책 점검** — 완료 (2026-07-03, 인라인 Fable). **등급: ✅ 견고 (핵심 민감 테이블 모범적).**
  70개 테이블 RLS enable. 민감 데이터 모범적: profiles/couples/journeys는 anon+authenticated 권한 REVOKE + 컬럼 가드 트리거(couple_id/role/is_admin/bride/groom 직접변경 잠금, 멤버십은 join_couple RPC만) + SECURITY DEFINER 헬퍼(재귀 회피). chat_messages/decision_nodes는 커플+visibility 격리(파트너가 상대 개인채팅 못 봄). ai_interactions_log는 user_id 소유자만 SELECT·service만 쓰기. RLS enable+정책없음(deny all) 사례 0.
  발견: **L1(low)** 삭제된 청첩장/방명록 테이블이 과permissive RLS(USING/CHECK true) 잔존 — 라이브 위험 아니나 정리(DROP) 권고, 죽은 코드(0.2)와 병합. **I1(info)** community_profiles/achievements 공개 SELECT는 by-design. 신규 라이브 결함 0. 정적 마이그레이션 리뷰(CLI 링크 없어 라이브 프로빙 미수행). 상세: `docs/SECURITY_AUDIT_2.5_RLS_2026-07-03.md`

**★ Phase 2(보안) 종료**: 2.1⚠️→2.2⚠️→2.3⚠️→2.4✅→2.5✅. 크리티컬 0. 리메디에이션 우선순위 = ~~H1 costGuard 원자화~~(**완전 종결 2026-07-04**) > ~~M1/M2 quote-check·XFF~~(**완전 종결 2026-07-04**) > ~~죽은 테이블/코드 정리~~(**핵심 종결 2026-07-04** — 잔여: packages/shared 결정, etiquetteData 번들 분리, 2.1 medium 3건).

## Phase 3 — 웹 기능 하나씩 (기능당 1작업)

- [x] **3.1 랜딩페이지 + 사전등록** — 완료 (2026-07-04, 인라인 Fable). **등급: ✅ 견고 (라이브 검증 포함, medium 1건은 4.x 모바일로 이관).**
  라이브 프로빙(읽기전용, 프로덕션): `/`→307→`/wedding`(200, 커뮤니티 렌더 확인) / `/beta` 200(폼·베타카운터 렌더, 배포 JS 청크에 Turnstile 위젯 코드+`sitekey:i`(=NEXT_PUBLIC_TURNSTILE_SITE_KEY) 실렌더 확인 — **6/12 "키만 넣으면" 잔여작업이 실제로 배선 완료됨**) / 토큰없는 preregister·signup POST 둘 다 400 봇확인(무부작용 차단) / Resend `hanbang.ai` 도메인 **verified**(ap-northeast-1) / anon으로 preregistrations 직접 SELECT = `[]`(RLS service-only 격리 확인). preregister 코드 견고: 이메일 정규화·body 크기 가드·IP+이메일 이중 rate limit(Gmail 별칭 정규화)·UNIQUE 이메일·UTM 캡처·중복 시 beta 업그레이드 경로·이메일 발송 fire-and-forget(실패 무해)·에러 원문 미노출. 
  **발견 M1(medium, 모바일 — 4.2/4.3에서 처리): 모바일 `app/(auth)/signup.tsx:117`이 웹 `/api/auth/signup`을 우회하고 `supabase.auth.signUp()` 직접 호출 → Turnstile·IP/이메일 rate limit·enumeration 마스킹 전부 우회**(웹은 generateLink+Resend로 enumeration 차단, 모바일은 client SDK라 방어선 밖). 프로덕션 auth.users는 6/12 이후 email 17건 전원 정상, OAuth 신규 0 — 실피해 흔적 없음. **웹 표면 자체는 결함 0.** L1(info): preregister는 UTM을 `new URL(request.url).searchParams`에서만 읽는데 폼이 쿼리 없이 POST → 실제 UTM 캡처 0건(with_utm=0/3 프로덕션 확인). 유통 테스트 전 body로 UTM 전달하거나 Referer 파싱 권고(비차단).
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
| 2026-07-03 | 2.2 API 인증 감사 B(돈) | ⚠️ 취약 — 돈 코어(money/bookings) IDOR·service-role 깨끗. 확정 medium 2(vendor_leads 오염, XFF rate limit 우회 — 둘 다 quote-check, 커플/금전 데이터 아님). bookings/mine에 죽은 contracts/payments 조인. 상세 리포트 별도 |
| 2026-07-03 | 2.3 API 인증 감사 C(AI) | ⚠️ 취약 — 무인증 비용폭탄 경로 0(모든 LLM 호출 인증+costGuard, is_admin DB검증). 확정 high 1(costGuard TOCTOU 레이스 — 상한 초과, 단 콘솔 $30캡이 봉인)·low 1(첨부 DNS rebinding)·info 1(ai-comment 장부밖, 관리자전용). 상세 리포트 별도 |
| 2026-07-03 | 2.4 API 인증 감사 D(나머지) | ✅ 견고 — 인라인 Fable. 신규 결함 0. 공개쓰기 Turnstile+검증, 인증 라우트 couple_id 서버파생, messages 서버결정, vendors 공개읽기, community 소유권 403. 교차이슈는 기존 M2뿐. 상세 리포트 별도 |
| 2026-07-03 | 2.5 Supabase RLS 점검 | ✅ 견고 — 인라인 Fable. 민감 테이블 모범적(권한 REVOKE+컬럼가드 트리거+visibility 격리+ai_log 소유자만). L1 죽은 청첩장/방명록 테이블 과permissive(정리 권고)·I1 community 공개읽기 by-design. 신규 라이브 결함 0. **Phase 2 종료.** 상세 리포트 별도 |
| 2026-07-04 | 전체 코드 품질 훑기 | 인라인 Fable. 위생 상위권(`as any`·TODO 0). 신규 4건: ①packages/shared 유령(import 0, 모바일은 웹 상수 복붙 중) ②etiquetteData 103KB가 채팅 클라 번들에 포함 ③mockVendors 배열 2/3 죽은 데이터 ④engines.pnpm>=9가 lockfile 오염 사고 경로 방치. H1/M2/죽은코드 전부 미수리 재확인 |
| 2026-07-04 | H1 후속: costGuard 원자화 + pnpm 가드 | `reserve_amora_turn` RPC 신설(카운터 테이블 FOR UPDATE 원자 체크+예약, 첫 접근 시 ai_interactions_log에서 시드 — 기존 사용량 유지, 거부는 미소모, 잠금순서 global→couple 고정). `reserveAmoraTurn()`: chat 라우트는 가드 지점에서 예약, conflict 라우트는 파트너 메시지마다 호출되므로 앞단은 읽기전용 유지·mediation LLM 직전만 예약. RPC 미배포 시 기존 읽기전용 폴백(무중단). 테스트 +9(278 통과)·tsc 0·build 그린. 마이그레이션 `20260704120000`은 같은 날 적용 완료(아래 행). ② engines.pnpm `>=11.7.0` + `.npmrc engine-strict=true` — 구버전 pnpm 설치 하드 차단 |
| 2026-07-04 | M1/M2 후속: quote-check·rate limit 수리 | **M1**: vendor_leads 반영을 유저당 (name,category) 첫 언급 1회로 멱등화(amora_quote_checks 사전조회, fail-closed) + priority_score 가중 0·proof_count 불변·기존 source 미덮어씀 — 신규 리드는 status='raw'·score 0로만 기록. **M2**: `getClientIp()` 신설(x-real-ip 우선, XFF는 최우측만 — 최좌측 스푸핑 차단), rateLimitKey+Turnstile 4개 라우트(signup·forgot·survey·preregister) 중복 제거 통합. `check_rate_limit`에 기회적 GC(호출 2%에서 만료+1일 행 DELETE, `20260704130000`) — **Management API 적용+원격 검증**(allow/거부/GC설치 확인, 테스트 키 정리). 테스트 +2(280 통과) |
| 2026-07-04 | 죽은 코드/테이블 정리 | ①`bookings/mine` contracts/payments 조인 삭제(0행 테이블·소비처 미사용 확인) ②ServiceBanner.tsx 고아 삭제 ③모바일 guestbook 화면 2개 삭제 ④mockVendors.ts→vendorFields.ts(미사용 mock 배열 431줄 삭제, 실사용 타입/필드정의/헬퍼만 유지) ⑤죽은 테이블 8개 DROP(`20260704131000`: invitation 7종+ai_scripts — 코드참조 0·외부FK 0·테스트 잔재만 프로덕션 확인 후, **적용+원격 검증**: 잔존 0·congratulatory_money 무사·anon 방명록 스팸 404). `/customer`는 의도적 리다이렉트(스텁 아님)로 판단 유지. 웹/모바일 tsc 0·테스트 280·빌드 그린 |
| 2026-07-04 | H1 마이그레이션 적용 + 원격 검증 | 사용자가 PAT 제공(`apps/web/.env.local`의 `SUPABASE_ACCESS_TOKEN`, gitignore 확인) → **Management API로 직접 실행**(SQL Editor와 동일 경로, 201). 원격 검증 6종 전부 통과: ①null인자→invalid_args ②카운터 테이블 존재 ③anon RPC 401 ④anon 테이블 401 ⑤allow 경로 실예약(couple/global 카운터 1 생성) ⑥count=100 세팅 후 재예약→couple_quota 거부. 테스트 흔적은 삭제(다음 실예약 때 로그에서 자동 재시드, 잔여 0). **H1 완전 종결.** 이후 마이그레이션은 Claude가 직접 실행+검증 가능 (CLAUDE.md 규칙 갱신) |
| 2026-07-04 | 3.1 랜딩+사전등록 | ✅ 견고 — 인라인 Fable, 라이브 프로빙 포함. `/`→`/wedding` 리다이렉트·`/beta` 폼·베타카운터 정상, 배포 JS에 Turnstile 위젯 실렌더(6/12 잔여 배선 완료 확인), Resend 도메인 verified, anon preregistrations SELECT 격리. preregister 코드 견고(이중 rate limit·이메일 정규화·enumeration 무해). **발견: 모바일 signup이 웹 방어 라우트 우회(supabase.auth.signUp 직접, medium — 4.x로 이관)**, preregister UTM 캡처 0건(폼이 쿼리 미전달, info). 웹 표면 결함 0. 프로덕션 auth.users 실피해 흔적 없음 |
