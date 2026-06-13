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
- **유통 테스트 준비 완료 (2026-06-12)**: `docs/DISTRIBUTION_TEST_KIT_2026-06-12.md`(UTM 링크·운영 수칙·PostHog 퍼널 설정법·기록표) + `docs/KIN_ANSWER_BANK_2026-06-12.md`(유형별 답변 초안 8종) + `docs/DISTRIBUTION_POSTS_READY_2026-06-12.md`(카페 글 2종 복붙용 + 지식iN 8종 완성본, 2026-04 실측 수치·UTM 사전기입). 프로덕션 사전점검: `/check` UTM 보존 리다이렉트 ✅, 예절·시세 비로그인 200 ✅. SEO 입구 3페이지에 개별 메타데이터(title/OG/canonical).
- **다음 단계 (Week 1 마지막 + D8~30)**: ⑤지식iN·카페 정직글 7일 유통 테스트 — **유일하게 남은 Week 1 항목, 사용자 실행 필요** (완성본으로 즉시 시작 가능) → (선택) JSONB 후속: 일정/액션 테이블 분리. 30일차 G1 판정(채널 전환 ≥3%).
- **아모라 비용 가드레일 (2026-06-12)**: 유통 테스트 전 지갑 보호. `lib/ai/costGuard.ts` — ai_interactions_log(chat_turn) DB 카운트 기준 ①커플당 누적 무료 100 ②전역 일일 300(서킷). is_admin만 면제(클라 값 불신), fail-open. 환경변수 조정/긴급 비활성. + Anthropic 콘솔 월 한도 $30 설정(최후 보험). check-couple-conflict의 mediation LLM 호출도 같은 장부에 편입(2차 감사).
- **SEO 공백 해소 = SSR 전환 완료 (2026-06-12)**: 예절·시세 페이지가 클라이언트 렌더라 서버 HTML 본문 0이던 문제 해결. 기존 페이지→`components/app/{etiquette,market-prices}/XxxClient.tsx`로 이동(회귀 0), 서버 page.tsx가 SEO 콘텐츠(`XxxSeoContent.tsx`)+클라이언트 UI 함께 렌더. 둘 다 정적 프리렌더(○), HTML 본문 색인 확인. **남은 SEO 후속(선택)**: 시세 페이지 양산(지역별 랜딩), 구조화 데이터(JSON-LD).
- **출시 전 보안 감사 2라운드 완료·적용 (2026-06-12)**: 채팅·SSR/SEO·가입퍼널·어드민·커플연동·동기방·금전 표면 전수 리뷰. 마이그레이션 2개 **SQL Editor 실행·원격 검증 완료**: `20260612120000`(is_admin 자기승격 트리거 잠금 — 부정승격 피해 0 확인), `20260612130000`(profiles.couple_id/role + couples 슬롯 자가변경 잠금=커플 탈취 차단 / join_couple 기존소속 검사=고아화 차단 / 초대코드 2^48 / community_assign_cohort REVOKE=강제배정 IDOR 차단 — cohort RPC permission denied·초대코드 2^48 원격 확인). 코드: check-couple-conflict 가드 편입, SEO og:image·sitemap, onboarding/money 입력검증, 채팅 에러 마스킹, **Cloudflare Turnstile 봇차단 배선**(signup+forgot-password, 키 미설정 no-op). **안전 확인(미변경)**: auth/delete·money IDOR·bookings·cohort 계약 익명성·upload·search·댓글 소유권·투표 멱등성. **별도(제품 결정)**: under_review 자동숨김(역 grief), comment-vote race, select(*) 과다노출.
- **남은 사용자 작업**: ①**Cloudflare Turnstile 사이트키/시크릿 발급 + Vercel 입력**(코드 배선 완료, 키만 넣으면 활성) ②유통 테스트 게시. **여전히 미검토(출시 비차단)**: AI 코어(toolExecutor 125KB·prompts 86KB·tools 40KB — 인증 채팅 뒤 가드 안), 모바일 앱(apps/mobile 전체).
- **백로그**: `docs/KNOWN_ISSUES_2026-06-10.md` (마이너 15건).

---

# 웨딩한방 웹 (hanbang.ai) — 프로젝트 레퍼런스

> 미션·전략·진행 상황은 위 **📍 현재 상태**와 `docs/`를 본다. 아래는 잘 안 바뀌는 사실 + 컨벤션만.
> **출처 우선 원칙**: 색상·환경변수·DB 스키마·라우트·디렉토리 구조는 아래에 베끼지 않는다 —
> 베껴두면 코드와 어긋난다(드리프트). 항상 실제 소스를 ground truth로 본다.

## 개요·스택
- **무엇**: 한국 AI 웨딩 플래너 "아모라". 모바일 앱(별도 레포, React Native)과 **같은 Supabase 프로젝트** 공유.
- **스택**: Next.js 16 App Router · TypeScript · Tailwind · Zustand · Supabase(PostgreSQL/Auth/Realtime/Storage) · Claude API · Resend. 배포 Vercel.
- **구조**: 모노레포(pnpm + turbo) — `apps/web`(Next.js), `apps/mobile`(Expo), `supabase/`. git 레포 루트는 `wedding/`.

## 진짜 출처 (여기를 본다)
| 알고 싶은 것 | 본다 |
|---|---|
| 색상·디자인 토큰 | `apps/web/src/app/globals.css`, `@hanbang/design-tokens` |
| 환경변수 (전체 목록·설명) | `apps/web/.env.example` |
| DB 스키마·RLS·RPC | `supabase/migrations/` (시간순) |
| 라우트·페이지 구조 | `apps/web/src/app/` (App Router 디렉토리 = 라우트) |
| 시세 데이터 | `apps/web/src/constants/marketPricesData.generated.ts` (자동생성, `npm run update:market-prices`) |
| 폰트 | Noto Serif/Sans KR, Cormorant Garamond (제목·숫자) |

## 코딩 컨벤션
- 함수형 컴포넌트만 (`export default function`). 스타일은 Tailwind만(인라인 style 금지).
- 서버 데이터는 Supabase Realtime, 로컬 상태는 Zustand. `any` 금지, props 타입 필수.
- 네이밍: 컴포넌트 PascalCase, 함수/변수 camelCase, 파일은 컴포넌트 PascalCase·유틸 camelCase.
- 에러는 try-catch + 사용자 친화 메시지(내부 원문 노출 금지). 주석은 한국어로 핵심 로직에만.
- 입력은 시스템 경계에서 검증. 비밀값·`.env`는 절대 커밋 금지.

## 커밋 컨벤션
`feat:` 기능 / `fix:` 버그 / `style:` 디자인 / `refactor:` 리팩토링 / `docs:` 문서 / `chore:` 설정·패키지

## 빌드·검증
커밋 전 `apps/web`에서 `npx tsc --noEmit` + `npx vitest run` + `npx next build` 통과 확인.
마이그레이션은 Supabase CLI 링크가 없어 항상 **SQL Editor 수동 실행** — 새 마이그레이션은 사용자에게 복붙용 SQL로 전달.
