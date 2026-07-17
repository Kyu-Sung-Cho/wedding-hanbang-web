# 웨딩한방 보수적 전체 평가 계획 (2026-07-03)

> ⚠️ **역사적 감사 스냅샷 — 현재 운영 기준 아님 (2026-07-16)**
> 아래 Fable/Claude/Anthropic 모델, 월 `$30` 콘솔 상한, 비원자 비용 가드 및 당시 완료 판정은
> 2026-07-03~04 시점 기록이다. 현재 아모라 런타임은 OpenAI GPT-5.6 Luna·Terra 전용이며,
> 최신 출시 상태와 비용·DB 게이트는
> `docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md`와
> `docs/operations/AMORA_PROVIDER_COST_LATENCY_POLICY_2026-07-16.md`를 진실원본으로 사용한다.

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
- [x] **3.2 인증 전체 플로우** — 완료 (2026-07-04, 인라인 Fable). **등급: ✅ 견고 (경계 튼튼, low 3건 — 전부 심층방어/컨벤션 개선).**
  경계 요약(견고): ①미들웨어가 보호경로만 auth 체크(무쿠키→/login·/admin→/admin/login, 라이브 307 확인), 실보안 경계는 데이터층 RLS+서버 재검증 ②admin은 이중 확인 — verifyAdmin·admin/auth GET 둘 다 service_role로 `is_admin` DB 조회(미들웨어 통과해도 API가 막음, 라이브: 위조 demo쿠키로 /admin 통과 실패). admin 생성은 ADMIN_PASSWORD(timingSafeEqual)+최초는 count==0·이후는 기존admin 필수 ③회원가입/비번찾기는 하드닝된 서버 라우트 경유(Turnstile+IP/이메일 rate limit+enumeration 무해화, 웹 로그인폼이 `/api/auth/signup`·`/api/auth/forgot-password` 호출 확인) ④비번로그인·OAuth는 클라 SDK(정상 패턴, redirectTo=자기 콜백) ⑤reset는 Supabase PASSWORD_RECOVERY 세션 필요 ⑥계정삭제는 본인 스코프+rate limit+커플 분해 순서 안전(파트너 보존/단독 CASCADE) ⑦me 라우트 `_debug`는 비프로덕션 한정.
  **발견(전부 low, 라이브/코드 재검증):** **L1** 미들웨어 demo 게이트가 미서명 `demo_mode` 쿠키를 신뢰 → shell만 통과(데이터층은 서명검증 `hasSignedDemoSessionFromCookieHeader`라 401·데이터 0, 라이브 확인). 노출 없음, 심층방어 일관성 갭 — 미들웨어도 서명검증 사용 권고. **L2** 콜백/OAuth/reset 에러 원문 노출(callback이 SDK 메시지를 리다이렉트 쿼리로, reset/login이 `오류:${msg}`) — CLAUDE.md "내부원문 노출금지" 위반, 라이브러리 힌트 수준(민감정보 아님). 사용자 친화 메시지 마스킹 권고. **L3** reset-password 리다이렉트 가드가 `startsWith("/")`만 봄 → 프로토콜상대(`//`) 경로가 통과할 구조(오픈리다이렉트 표면). 발동은 유효 recovery 세션+공격자 제공 redirect 파라미터 필요라 좁으나, 가드를 `/`+비`//`로 강화 권고. **I1** me 라우트가 GET에서 프로필/여정 자동생성(side-effect on GET, 자기데이터·멱등이라 무해).
  **교차:** 3.1의 모바일 signup 우회(medium)는 여전히 4.x 대기. 웹 인증 표면 자체 high/medium 0.
- [x] **3.3 AI 아모라 채팅** — 완료 (2026-07-04, 인라인 Fable, 방어적 서술). **등급: ✅ 견고 (페르소나 컴플라이언스가 프롬프트에 강하게 인코딩됨, 잔여는 LLM 고유 한계 info 2건).**
  **페르소나 컴플라이언스(전략 리뷰 핵심 우려) — 프롬프트에 명시적 가드레일 확인:** ①정체성: 시스템 프롬프트가 "AI 웨딩 플래너 아모라"·"한국 결혼 준비 전문 AI"로 스스로 AI임을 명시(사람 위장 없음) → "AI 유저 위장 영구 금지" 준수 ②견적: analyze_quote에 "견적 좋고 나쁨 판정하지 마세요, 바가지/위험/안전/점수/등급 표현 금지" 명시, 허용은 사실(미확인 항목+출처 평균가+지역 중위가)+절차(계약 전 질문)만 → "견적·시세 판정 금지" 준수 ③계약: analyze_contract_readiness에 "계약하지 마세요/이 업체 위험해요 업체 상대 권고·단정 금지" 명시 → 6/12 법적리스크 수정과 일치 ④근거 A~F 등급+할루시네이션 방지("DB에 없는 업체 지어내기 금지"·"출처 없는 수치 금지")+법률/의료는 "전문가 상담 권해요".
  **품질/안정성(견고):** 스트리밍=ReadableStream+send() try/catch+AbortController+maxDuration 300s+fetch 타임아웃+MAX_TOOL_ROUNDS 5. 에러처리=내부원문 마스킹(타임아웃/abort→친화 메시지, 원문은 console+logAIInteraction만) — 3.2 L2와 달리 여기선 컨벤션 준수. 저장=멱등 INSERT(unique index+client_request_id, race 안전)·데모 미저장·visibility 격리(shared/bride_private/groom_private, RLS+PRIVATE_MODE 프롬프트 이중). 인증=LLM 호출 전 401(라이브 확인)+coupleId 소유검증+costGuard(H1 원자화됨). proactive는 LLM-free(로컬 lifecycle/momentLoop, anthropic import 0 확인).
  **발견(전부 info, LLM 고유 한계):** **I1** 프롬프트 인젝션 표면 — 시스템 프롬프트에 사용자 제어 데이터(senderName·일정 memo·amoraProfiles·pastDecisions) 임베드. 적대적 사용자가 자기 데이터/메시지로 가드레일 우회 시도 가능하나, 규칙이 시스템 프롬프트 우선순위에 있고 실피해는 자기 커플 세션 국한(RLS 격리, 크로스테넌트 없음). 근본제거 불가·인지대상. **I2** 컴플라이언스가 프롬프트 지시일 뿐 런타임 출력 포스트필터·회귀테스트 없음(prompts.test.ts는 비용 포맷만 커버) — 모델이 드물게 지시 위반 시 금지표현이 샐 수 있음. 저비용 완화: 핵심 금지어 출력 후 경고 로깅. 비차단. high/medium 0.
- [x] **3.4 예산/축의금 (money)** — 완료 (2026-07-04, 인라인 Fable). **등급: ⚠️ 취약 (계산은 정확·축의금 코어 견고, 데이터 저장에 커플 동시수정 유실 구조 잔존 — medium 1).**
  **계산 정확성(견고):** 축의금 통계(총액/신랑/신부/인원/평균) 산술 정확. 예산 계산 — getCategoryBudget(budget>0 → 레거시 cost 정규화 → ratio×총예산 폴백), 총지출/잔여/퍼센트/스드메 합계/분담(payer) 합계 전부 정확, 단위 일관(원 단위 — AI 도구도 원 단위로 기록, formatWon만 만원 표시). AI `apply_budget_plan`은 합계>총예산 차단+잔여 예비비 자동배정+원자 patch. 축의금 CRUD는 2.2 재확인(서버 검증 0~1억 정수·enum·ISO날짜, assertMoneyOwner, rate limit, RLS money_owner 백스톱, couple_id 서버파생).
  **발견 M1(medium, 데이터 유실 구조 — 클라이언트 progress 전체 덮어쓰기 잔존):** 6/11 크리티컬(progress 동시수정 유실)의 수리는 서버측(toolExecutor·bookings·onboarding·amora actions 전부 `apply_journey_progress_patch` 원자 RPC)만 완료. `/api/journey`에 `progress_patch`+`progress_remove_keys` 원자 경로가 이미 구현돼 있으나 **클라이언트는 아무도 안 씀** — BudgetContent(8곳)·ScheduleContent(2)·CategoryChecklistModal(1)·dashboard(1)·EtiquetteClient(1) 총 13곳이 `updateJourney({progress})` = 스테일 스냅샷 전체 덮어쓰기. journey는 Realtime 구독 없음(재fetch는 하드로드/본인 저장 응답/AI 채팅 후 refreshJourney뿐) → 스테일 창=세션 전체. 커플 2인이 각자 페이지를 열어두고 편집하면 나중 저장이 상대 변경(예산·체크리스트·일정 __events·아모라 액션)을 통째로 롤백. 부수: 전체 덮어쓰기는 sanitize 캡(배열 300)으로 `__events` 300개 초과분 조용한 절단 동반. **수정 방향: authStore.updateJourney를 diff→`progress_patch`/`progress_remove_keys` 전송으로 전환(서버 saveProgress와 동일 로직, API 이미 준비됨) — 코드 국소적, 회귀 위험 낮음.** chatStore의 progress 갱신은 updateJourneyLocal(로컬 미러)이라 무관.
  **low 2:** L1 moneyStore가 401/403에서 조용히 localMode 전환 — 세션 만료 시 이후 축의금 입력이 로컬에만 쌓여 새로고침에 소실(경고 없음, 데모용 설계의 오발동). L2 저장 실패 무통보 — moneyStore CRUD·updateJourney가 res non-ok 시 콘솔만(400 검증 거부가 사용자에겐 "그냥 안 됨"). **info 5(기록만):** CSV 쉼표/따옴표 미이스케이프(열 밀림) / money 폼에 side "both" 옵션 부재(타입·CSV엔 존재) / normalizeCost 휴리스틱(<10만원 원단위 실지출 ×10000 오변환 가능성, 레거시 호환) / 채팅 BudgetTab은 cost 폴백·커스텀·hidden 미반영이라 본 페이지와 합계 불일치 가능 / 카테고리 예산 0 설정 불가(0이면 ratio 폴백 복귀)·클라 금액 상한 없음(서버는 유한수만 허용).
- [x] **3.5 일정 관리 (schedule/journey)** — 완료 (2026-07-04, 인라인 Fable). **등급: ✅ 견고 (신규 medium 0 — 데이터 유실 표면은 3.4 M1에 통합, 표시용 시간대 드리프트 low 1).**
  **견고:** 이벤트 모델 `__events` — 카테고리 이벤트는 sourceKey(`category:<key>`)+레이블 폴백 매칭으로 중복 방지 upsert, 모멘트 이벤트는 (momentType,date) 멱등 upsert(momentLoop KST 회귀 테스트 10개 기존). 체크리스트는 mergeChecklist/calculateStatus/getChecklistCounts 유틸 분리+테스트 존재, 상태 파생 일관(웹 UI·AI 도구 동일 유틸 공유). AI scheduleTools 전부 원자 patch·삭제는 destructive confirmation 필수·log_wedding_event 날짜 regex 검증·KST 유틸(ymdInKst) 사용. 임박 계산(마감=예식일−ddayDeadline, 60일 필터, overdue/urgent/soon) 정확. EventFormModal 필수값 검증(제목+날짜), 사이드바 삭제 2단계 확인, CalendarView date-fns 로컬 연산 일관(일정 date 문자열과 정합), 스탯(진행률·D-day·다가오는 일정) 산술 정확.
  **교차(기록만):** ScheduleContent(2곳)·CategoryChecklistModal(1곳)의 `updateJourney({progress})` 전체 덮어쓰기는 3.4 M1에 포함 — __events가 통배열이라 커플 동시 편집 시 일정 유실 표면이 특히 넓음(수리도 M1과 동일: diff→patch 전환).
  **L1(low, 표시 전용):** 시간대 불일치 — D-day 스탯은 `new Date("YYYY-MM-DD")`(UTC 자정 파싱)·upcoming 필터는 `toISOString()`(UTC 오늘) 사용 vs 나머지는 로컬 파싱. KST 기준 결혼식 당일 00~09시에 D-1로 표시되고, 자정~09시엔 어제 일정이 "다가오는 일정"에 잔류. 데이터 영향 0 — `T00:00:00` 로컬 파싱/KST 유틸로 통일 권고. **I1(info):** AI add/update_schedule_event는 날짜 형식 미검증(스키마 의존, log_wedding_event만 검증).
- [x] **3.6 업체 탐색 + 견적/위약금 진단 (vendors, quote)** — 완료 (2026-07-04, 인라인 Fable, 엄격 기준). **등급: ✅ 견고 (판정 금지 원칙이 코드+회귀테스트로 잠겨 있음, 신규 결함 0).**
  **판정 금지 컴플라이언스(핵심 확인):** ①quoteCheck 엔진 — 사실만 출력(확인/미확인 항목·출처 있는 평균가·라벨 명시된 지역 중위가·계약 전 질문), 원칙이 파일 상단 주석에 명문화. ②**회귀 테스트가 금지 필드 11종(score/grade/verdict/priceTier/redFlags/추정액 4종 등) 부활과 평가 단어 5종(위험/안전/바가지/등급/점수)을 명시 차단** — 6/12 결정이 테스트로 잠김. ③지역별 중위가 회귀(서울vs경기/인천 왜곡 방지·5대광역시·기타지역 매핑) 테스트 통과. ④UI(quote-check 페이지)가 "좋다·나쁘다 판단이 아니라 빠진 것 확인" 명시, AI analyze_quote도 동일 엔진 공유(이중 구현 없음). ⑤Contract Shield — 내부 score는 사실 라벨 3종("주요 항목 문서 확인됨/확인 필요 항목 있음/필수 항목 미확인") 분류에만 사용·**출력에 score 미노출**, 제목에 업체명 불포함(업무방해 시비 방지 주석), 법률자문 아님 고지 포함 — 6/12 수정 유지. ⑥보증인원 시뮬레이터 산술 정확(payable=max(참석예상,보증), 손실=빈자리×식대, 시나리오 ±15%/+5%), 권고는 절차형("물어보세요").
  **업체 탐색(견고):** approved만 노출, ai_recommend 유료 순위 제거 유지(캐논 v2 주석), vendorToPublicVendor가 owner PII 스트립, 검색어 escape(cleanPostgrestSearchTerm+like escape), 페이지네이션 클램프(1~1000p/1~100), 카테고리 alias 매핑. 찜은 낙관적 업데이트+실패 롤백.
  **quote-check 라우트:** 2.2 M1/M2 수리 반영 실코드 확인(유저당 첫 언급 멱등·fail-closed·score 0·persistent rate limit 익명 12/h·로그인 40/h), 입력 검증 견고(카테고리/지역 화이트리스트·금액 1~10000만원·sanitize+길이 캡), 익명은 분석만(저장 0). **info 2(기록만):** quote-check catch가 err.message 원문 400 반환(req.json() 파싱 에러 시 라이브러리 힌트 수준 노출 — 3.2 L2와 동류) / contractShield 내부 변수명 score·출력 필드명 riskLevel 잔존(노출 문구는 사실 기반이라 준수, 명칭만 6/12 어휘와 혼동 여지).
- [x] **3.7 커뮤니티** — 완료 (2026-07-04, 인라인 Fable). **등급: ✅ 견고 (최근 커밋 실동작 코드+테스트로 확인, 신규 medium 0).**
  **최근 커밋 검증:** ①댓글 수정(c99b0a1d) — CommentItem 편집 UI → store.updateComment → PATCH `/api/community/comments/[id]`(작성자/관리자 403·소프트삭제 수정 차단·sanitizeHtml+5000자 캡) → 재귀 트리 반영+서버 응답 우선, store 테스트 동반. ②댓글 post 격리(2510a2c2) — commentsPostId 가드+realtime filter(post_id=eq)+구독 해제, 테스트 동반. ③동기방 — 낙관적 temp 메시지를 realtime INSERT와 30초 창 매칭으로 치환(중복 방지), 스크롤 컨테이너 격리(과거 사고 주석 문서화), RLS는 2라운드 하드닝 기존 확인.
  **store 로직(견고):** 재귀 댓글 트리 업데이트(수정/삭제/투표), 소프트삭제 반영, 투표/북마크는 서버 카운트 기준 조정, 피드 SWR 캐시(30s fresh/5분 만료)+닉네임 변경 시 무효화. 커뮤니티 로직 테스트 6종 기존 통과. 쓰기 경로 인증은 2.4에서 전수 확인(작성자 403).
  **info 2(기록만):** I1 댓글 삭제 시 comment_count 감소가 read-then-write(비원자, 동시 삭제 시 카운터 ±1 드리프트 — 표시용). I2 realtime INSERT 중복 방지가 최상위 댓글만 검사 — 대댓글은 본인 작성 직후 refetch와 경합 시 일시 중복 렌더 가능(새로고침 해소, 저빈도).
- [x] **3.8 예약 (bookings)** — 완료 (2026-07-04, 인라인 Fable, 엄격 기준). **등급: ✅ 견고 (핸드오프 이슈 전부 해소 확인, 이중 계상 방지 설계 모범적).**
  **TEAM_HANDOFF(6/15) 추적:** 문서의 요구사항(마이그레이션 6종 적용·부킹 이벤트 full UUID 전환·chat 이미지 서명 URL·community 미디어 하드닝)은 이후 커밋·2.2/2.5 감사에서 전부 반영 확인. 잔여 follow-up(린트 정리·Link sweep)은 이미 별도 처리됨(1.1 lint 0).
  **이중 계상 방지(핵심 검증):** ①생성 — 이벤트 id=`evt_booking_<fullUUID>`+sourceKey `booking:<id>`로 멱등(재시도 시 update, spent 가산은 `!existingEvent`일 때만) ②결과(outcome) — `__booking_costs` 원장(부킹별 기여액)으로 delta=실지출−이전기여만 반영(재수정 안전) ③취소 — 원장 기여액 기준 spent 복원+이벤트 제거(레거시 8자 id도 매칭), max(0,) 가드 ④전부 `apply_journey_progress_patch` 원자 patch+RPC 미배포 폴백. bookingTools/outcome 라우트 테스트가 생성·초과·취소·outcome 델타 시나리오 커버.
  **경계 재확인:** create_booking_atomic RPC service-role 전용(2.2), outcome couple 스코프, bookings/mine 죽은 조인 제거 완료(7/4).
  **L1(low, 데이터 의존):** 부킹→예산 동기화의 progress 키가 `vendors.category` 원문 — DB에 슬러그·한글·변형 혼재(vendors API의 CATEGORY_ALIASES 주석이 자인)라 비표준 카테고리 업체 예약 시 spent가 고정 카테고리("studio")가 아닌 커스텀 행("스튜디오"/"wedding_studio")으로 분리 계상될 수 있음. 테스트는 슬러그만 커버. 동기화 시 alias 정규화 권고. **I1(info):** progressSync의 RPC 실패 폴백이 whole-blob 덮어쓰기(폴백 발동 시에만 3.4 M1과 동일 표면 — RPC 배포 완료 상태라 실발동 0 예상).
- [x] **3.9 관리자 페이지** — 완료 (2026-07-04, 인라인 Fable). **등급: ✅ 견고 (접근 제어는 2.1·3.2에서 이미 이중 검증 — 신규 결함 0).**
  **접근 제어(재확인):** 대시보드는 클라 게이트(`/api/admin/auth` GET → 401 시 /admin/login)+데이터는 전부 `/api/admin/*`(verifyAdmin 16/16, service_role is_admin DB 조회 — 2.1 전수, 3.2 라이브 위조쿠키 차단 확인). 관리자 생성은 ADMIN_PASSWORD(timingSafeEqual)+기존 admin 필수. 실보안 경계는 서버 — 클라 게이트는 UX용이라 우회해도 데이터 0.
  **사전등록 현황(기능):** /api/admin/registrations — verifyAdmin+service client, total·일별 카운트 산출 정확(전수 조회 기반). 대시보드 탭(신고 처리·업체 승인·고객·예약·인사이트·관리자 관리) 전부 admin API로 배선.
  **잔여(기존 기록 재확인):** 2.1 medium 3건(시드 환경게이트·seed PUT·onboarding 고아화)은 리메디에이션 백로그 유지, ADMIN_PASSWORD 회전은 사용자 작업(1.5). **info 2:** 일별 카운트가 UTC 날짜 버킷(KST 09시 경계 드리프트, 통계 표시용) / registrations 무페이지네이션 select(*) — 베타 규모 무해, select(*) 백로그와 병합.
- [x] **3.10 정적 페이지 + SEO** — 완료 (2026-07-04, 인라인 Fable). **등급: ✅ 견고 (전 페이지 존재·빌드 포함, SEO 폴리시 항목만 info).**
  **확인:** 7페이지 전부 존재+빌드 통과(1.2 정적 99페이지에 포함). about/ai-policy/beta/demo는 개별 metadata 보유. 루트 layout에 metadataBase+기본 OG 설정 → 개별 메타 없는 페이지도 폴백. robots.ts — 비공개 표면(admin/lounge/chat/budget/schedule/settings/bookings/vendors/favorites/demo + /wedding 변형) disallow, sitemap 명시. sitemap.ts — 정적 5페이지+공개 커뮤니티 글만(visibility 필터+under_review 제외 — 비공개 글 유출 없음), 5000개 캡, 쿼리 실패에도 sitemap 생존(try/catch). SEO 입구 3페이지(시세·예절·quote-check) 개별 메타+SSR은 6/12 완료분 유지 확인.
  **info 3(폴리시, 비차단):** privacy/terms("use client", 메타 없음)·customersurvey는 페이지별 title/OG 부재 → 루트 폴백(제네릭 제목으로 색인) / sitemap에 about·privacy·terms·ai-policy·beta 미포함 / robots disallow에 /money 계열 누락(미들웨어 307이 실차단이라 무해).
  **★ Phase 3(웹 기능) 종료: 3.1✅ 3.2✅ 3.3✅ 3.4⚠️ 3.5✅ 3.6✅ 3.7✅ 3.8✅ 3.9✅ 3.10✅ — 유일한 ⚠️는 3.4 M1(클라 progress 전체 덮어쓰기), 리메디에이션 1순위.**

## Phase 4 — 모바일 앱

- [x] **4.1 모바일 실행 가능 여부** — 완료 (2026-07-04, 인라인 Fable). **등급: ✅ 견고.** tsc strict 0(1.4)+eslint 0에 더해 `npx expo export --platform android` **exit 0 — Metro 번들 성공(Hermes 8.64MB), 번들 에러 0**. 모듈 해석·임포트 전부 유효 확인. (실기기/에뮬레이터 스모크는 이 머신 환경 부재로 미수행 — 정적 최강 프록시인 export로 대체.)
- [x] **4.2 인증 브릿지** — 완료 (2026-07-04, 인라인 Fable). **등급: ⚠️ 취약 (3.1에서 이관된 medium 1 확정 + 동류 1 신규).**
  **M1(medium, 3.1 이관 확정+확장):** `app/(auth)/signup.tsx:117` `supabase.auth.signUp()` 직접 호출 — 웹 `/api/auth/signup`의 Turnstile·IP/이메일 rate limit·enumeration 마스킹 전부 우회. **신규: `forgot-password.tsx:124`도 `resetPasswordForEmail` 직접 호출**(동일 우회 — 단 Supabase 내장 이메일 rate limit이 일부 완화, enumeration은 Supabase가 자체 무해화). 수정 방향: 모바일 가입/비번찾기를 웹 하드닝 라우트 경유로 전환(비로그인이라 Bearer 불가 → 라우트가 anon 허용+Turnstile 모바일 site key 배선 필요).
  **견고:** OAuth 브릿지 = Supabase 공식 Expo 패턴 — 웹 `auth/mobile-callback`이 해시 fragment 토큰(서버 미전송)을 `hanbang://` 딥링크로 전달, 앱이 setSession. kakao scope 필터(account_email 제거) 이중 방어. `apiFetch` = Bearer 토큰+내부 경로만 허용(`//` 차단)+401 시 강제 재로그인 — 인증 후 호출은 전부 웹 하드닝 API 경유. **I1(info):** 딥링크 커스텀 스킴 기반 토큰 전달은 플랫폼 고유 표면(스킴 선점 앱) — Android App Links/iOS Universal Links 검증 도입으로 완화 가능(출시 전 권장, 현 단계 비차단).
- [x] **4.3 탭별 기능** — 완료 (2026-07-04, 인라인 Fable). **등급: ⚠️ 취약 (실구현 충실, 시세 데이터 드리프트 medium 1).**
  **실구현 vs 껍데기:** 껍데기 0 — 전 화면 실구현(총 17k 줄 네이티브). dashboard(1358)·schedule(1352)·bookings(1287)·community(1124)·settings(1123)·vendors(1018)·cohort(1002)·onboarding(965, 웹 /api/onboarding 경유)·budget(653)·chat(272, 웹 chat API+realtime) 전부 웹 API(Bearer) 또는 RLS 스코프 supabase 직접 조회로 배선. **모바일 budget 저장은 `progress_patch` 원자 경로 사용 — 웹(3.4 M1)보다 우수, 웹 수리의 실증 사례.**
  **M2(medium, 신규):** `market-prices` 화면이 하드코딩 가격표+출처 라벨 "2024 기재부 기준" — 웹의 참가격(한국소비자원) 자동생성 데이터와 별개·불일치·격월 갱신 파이프라인 밖. "출처 있는 평균가만 노출" 제품 원칙(6/12)과 어긋나는 미검증 범위 표기. 수정 방향: 웹 데이터 소스 공유(packages/shared 결정과 병합) 또는 웹뷰 전환(예절과 동일 패턴), 최소한 출처 라벨 정정.
- [x] **4.4 웹뷰 의존도** — 완료 (2026-07-04, 인라인 Fable). **등급: ✅ 견고.** 웹뷰 사용 1곳뿐(etiquette → `/webview?url=https://hanbang.ai/etiquette` 리다이렉트) — 나머지 전부 네이티브. webview.tsx는 https+hanbang.ai(서브도메인 포함) 허용목록·자격증명 제거·2048자 캡·외부 열기는 https/mailto/tel만 — 오픈 웹뷰 표면 없음.

## Phase 5 — 데이터·운영·공유 코드

- [x] **5.1 Supabase 스키마-코드 정합성** — 완료 (2026-07-04, 인라인 Fable). **등급: ⚠️ 취약 (모바일 동기방 입장 깨짐 확정 1건 + 재현성 갭).**
  **대조 결과:** 코드 참조 테이블 전수 vs 마이그레이션 DDL — DROP된 테이블(7/4 정리 8종) 참조 **0건**(정리 검증). 코드 호출 RPC 14종 중 13종 마이그레이션 정의 확인. cohort_stats는 뷰(security_invoker, 6/10 수정)로 정상.
  **F1(기능 깨짐, 모바일 — 4.3 등급 정정 사유):** `apps/mobile/app/community/cohort-discovery.tsx:247` 동기방 입장이 `cohort_members` **클라 직접 INSERT** — 6/15 하드닝(`20260615090000`: authenticated INSERT REVOKE + 서버전용 트리거 42501)과 충돌해 **입장이 무반응 실패**(console.error만, 사용자 안내 없음). +258행 `increment_cohort_member_count` RPC는 **어떤 마이그레이션에도 정의 없음**(유령 호출, 결과 미확인이라 조용히 무시됨). 웹은 auto-assign API(service-role) 경유라 정상 — 모바일만 하드닝 이전 패턴 잔존. 수정 방향: 모바일 입장을 웹 API 경유로 전환+유령 RPC 제거. **모바일 출시 전 필수.**
  **F2(재현성, 운영):** 마이그레이션 디렉토리가 완전한 스키마 소스가 아님 — 초기 코어 테이블(profiles·vendors·vendor_products·vendor_bookings·vendor_favorites·favorites 등)은 대시보드 시대 유산으로 CREATE 없이 ALTER/RLS만 존재(`20260220` 헤더가 "기존 테이블"로 자인, DIAGNOSE_EXISTING_TABLES.sql 존재). 프로덕션 정합성은 라이브 검증들로 확인되나 새 환경 재구성 불가 — baseline 마이그레이션 생성 권고(비긴급).
- [x] **5.2 프로덕션 라이브 스모크** — 완료 (2026-07-04, 인라인 Fable, 읽기전용 GET). **등급: ✅ 견고.**
  12개 표면 전부 정상: `/`→307→`/wedding`(200, SSR 294KB+타이틀 렌더), `/beta`·`/login`·`/about` 200, SEO 입구 3페이지(시세·예절·quote-check) 200+**개별 타이틀 SSR 확인**("한국소비자원 참가격 기준" 등), robots.txt·sitemap.xml 200, 보호 경로 `/wedding/lounge`→307 login·`/admin`→307 admin/login(미들웨어 정상). 콘솔 에러는 브라우저 부재로 이 회차 미확인 — 단 Sentry 라이브 연결(6/11)로 런타임 에러 관측 체계 존재. info: `/wedding` 첫 응답 3.4s(콜드 샘플 1회, 이후 표면 0.4~0.7s — 관측만).
- [x] **5.3 packages/shared + design-tokens 실효성** — 완료 (2026-07-04, 인라인 Fable). **등급: shared 🚫 유령 / design-tokens ✅ 실사용.**
  `@hanbang/design-tokens`: 모바일 34개 파일 실사용(웹은 globals.css 체계 — 설계상 분리). `packages/shared`(constants/types/utils): **워크스페이스 전체 임포트 0 — 유령 확정**(7/4 훑기 재확인). 모바일이 웹 상수를 복붙 중이라 4.3 M2(시세 하드코딩 드리프트)의 근원 — "배선 or 삭제" 결정 필요, 배선 시 시세 데이터 공유가 첫 후보.

## Phase 6 — 종합

- [x] **6.1 종합 성적표** — 완료 (2026-07-04, 인라인 Fable). **상세: `docs/EVALUATION_FINAL_REPORT_2026-07-04.md`.**
  요약: **치명 0 · 높음 0 · 중간 5**(M-W1 웹 progress 덮어쓰기 / F-M3 모바일 동기방 깨짐 / M-M1 모바일 인증 우회 / M-M2 모바일 시세 하드코딩 / C1~C3 관리자 시드). 웹=출시 유지 가능, 모바일=출시 전 3건 필수 수리(전부 "웹은 고쳤는데 모바일이 이전 패턴" 동기화 부채). Top5와 죽은 코드 목록은 리포트 참조.
  **★ 전체 26개 작업 완료 — 평가 종결 (2026-07-04).**

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
| 2026-07-04 | 3.2 인증 전체 플로우 | ✅ 견고 — 인라인 Fable, 라이브 프로빙. 경계 튼튼: 미들웨어+RLS+admin 이중 is_admin 재검증(위조 demo쿠키로 /admin 통과 실패), 가입/비번찾기 하드닝 라우트, 삭제 본인스코프. low 3: L1 미들웨어 미서명 demo쿠키 신뢰(shell만·데이터 401 확인, 심층방어 갭)·L2 콜백/reset 에러원문 노출(컨벤션 위반)·L3 reset 리다이렉트 가드 `//` 통과 구조(오픈리다이렉트 표면). 웹 인증 high/medium 0. 모바일 signup 우회(medium)는 4.x 대기 |
| 2026-07-04 | 3.3 AI 아모라 채팅 | ✅ 견고 — 인라인 Fable, 방어적 서술. **페르소나 컴플라이언스가 프롬프트에 명시 인코딩**(AI 정체성 명시·견적 판정금지·업체 상대권고 금지·근거 A~F+할루시네이션 방지) = 전략/6.12 법적수정과 일치. 스트리밍/에러마스킹(컨벤션 준수)/멱등저장/visibility 격리/LLM전 401 견고. proactive LLM-free 확인. info 2: I1 프롬프트 인젝션 표면(LLM 고유, 자기세션 국한)·I2 런타임 출력 포스트필터·컴플라이언스 회귀테스트 부재(프롬프트 지시만). high/medium 0 |
| 2026-07-04 | 3.4 예산/축의금 | ⚠️ 취약 — 인라인 Fable. 계산 전부 정확(단위 일관·합계 검증), 축의금 CRUD 견고 재확인. **M1: 클라 13곳 progress 전체 덮어쓰기 잔존(6/11 크리티컬의 클라측 절반 미수리)** — /api/journey patch 경로는 준비됐으나 클라 미배선, Realtime 미구독이라 커플 동시편집 시 상대/AI 변경 롤백 가능. low 2(moneyStore 조용한 localMode 전환·저장실패 무통보), info 5. 수리 방향: updateJourney diff→patch 전환(국소적) |
| 2026-07-04 | 3.5 일정 관리 | ✅ 견고 — 인라인 Fable. 이벤트 upsert 중복방지(sourceKey)·모멘트 멱등·체크리스트 유틸 공유(웹=AI)·AI 도구 원자 patch+삭제 확인 필수·임박 계산 정확. 신규 medium 0(덮어쓰기는 3.4 M1에 통합, __events 통배열이라 일정 표면이 특히 넓음). low 1: D-day 스탯·upcoming 필터만 UTC 파싱(KST 00~09시 표시 드리프트, 데이터 영향 0) |
| 2026-07-04 | 3.6 업체+견적/위약금 진단 | ✅ 견고 — 인라인 Fable, 엄격 기준. **판정 금지가 회귀 테스트로 잠김**(금지 필드 11종+평가 단어 5종 명시 차단, 지역 중위가 왜곡 회귀 포함). UI·AI 단일 엔진 공유. Contract Shield 내부 score 미노출·사실 라벨만·업체명 제목 제외. 업체는 approved만+유료순위 제거 유지+PII 스트립. quote-check M1/M2 수리 실코드 확인. 신규 결함 0, info 2 |
| 2026-07-04 | 3.7 커뮤니티 | ✅ 견고 — 최근 커밋(댓글 수정·post 격리) 실동작 코드+테스트 확인, 동기방 낙관적 메시지+realtime 조정 견고. info 2(댓글 카운터 비원자, 대댓글 realtime 일시 중복 가능) |
| 2026-07-04 | 3.8 예약 | ✅ 견고 — 이중 계상 방지 모범적(__booking_costs 원장+멱등 이벤트+원자 patch), 핸드오프 이슈 전부 해소. low 1(vendor category 원문 키 → 비표준 카테고리 분리 계상 가능) |
| 2026-07-04 | 3.9 관리자 | ✅ 견고 — 서버 경계(verifyAdmin 16/16) 위 배선 정상, 사전등록 현황 정확. info 2(UTC 일별 버킷, 무페이지네이션) |
| 2026-07-04 | 3.10 정적+SEO | ✅ 견고 — 7페이지 전부 존재, robots/sitemap 비공개 격리 정상. info 3(privacy/terms 개별 메타 부재 등). **★Phase 3 종료 — 유일 ⚠️는 3.4 M1** |
| 2026-07-04 | 4.1~4.4 모바일 전체 | 4.1✅(expo export android 번들 성공, 에러 0) 4.2⚠️(signup+forgot 직접 SDK — 웹 하드닝 우회 medium, OAuth 브릿지·apiFetch는 견고) 4.3⚠️(껍데기 0·전 화면 실구현, 모바일 budget은 원자 patch로 웹보다 우수. **M2: 시세 화면 하드코딩+출처 라벨 부정확** — 참가격 데이터와 불일치) 4.4✅(웹뷰 1곳뿐, https+hanbang.ai 허용목록). **★Phase 4 종료** |
| 2026-07-04 | 5.1 스키마-코드 정합성 | ⚠️ — DROP 테이블 참조 0(정리 검증)·RPC 13/14 정의 확인. **F1: 모바일 동기방 입장 깨짐 확정**(클라 INSERT vs 6/15 하드닝 충돌+유령 RPC increment_cohort_member_count). F2: 초기 코어 테이블 CREATE 부재(재현성 갭, baseline 권고) |
| 2026-07-04 | 5.2 라이브 스모크 | ✅ — 12개 표면 정상(SSR 타이틀 렌더·보호경로 307·robots/sitemap). /wedding 콜드 3.4s 관측만 |
| 2026-07-04 | 5.3 공유 패키지 | shared 🚫 유령(임포트 0, 시세 드리프트의 근원) / design-tokens ✅ 모바일 34파일 실사용 |
| 2026-07-04 | 6.1 종합 성적표 | **★ 전체 26개 작업 완료.** 치명 0·높음 0·중간 5. 웹=출시 유지 가능, 모바일=출시 전 3건 필수 수리. 상세: EVALUATION_FINAL_REPORT_2026-07-04.md |
