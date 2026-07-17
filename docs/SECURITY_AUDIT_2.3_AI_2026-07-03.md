# 보안 감사 2.3 — AI 계열 API 감사 (2026-07-03)

> ⚠️ **역사적 감사 스냅샷 — 현재 운영 기준 아님 (2026-07-16)**
> 이 문서는 Anthropic 런타임과 당시 비용 가드를 감사한 기록이다. 현재 런타임은 OpenAI
> GPT-5.6 Luna·Terra 전용이고, 원자적 턴·비용 예약과 provider-call 장부가 후속 변경됐다.
> 현재 판정에는 `docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md`와
> `docs/operations/AMORA_PROVIDER_COST_LATENCY_POLICY_2026-07-16.md`를 사용한다.

> 대상: Claude(LLM)를 호출해 **Anthropic 토큰 비용이 나가는** 모든 표면.
> 핵심 질문: 무인증/무권한 호출로 비용을 태울 수 있는가, costGuard(비용 가드레일)를 우회할 수 있는가.
> 방법: 4개 공격 각도(비용폭탄 우회·costGuard 견고성·SSRF/인젝션·amora+로깅) 병렬 → 발견별 반박 검증 → **확정 건 감사자 직접 재검증**.

## 종합 등급: ⚠️ 취약 (무인증 비용폭탄 경로 없음 · costGuard는 best-effort라 상한 초과 여지)

- **무인증/무권한 LLM 호출 경로 0건** — 2.3의 핵심 공포("비용 폭탄")는 방어됨. 모든 Claude 호출은 인증 + costGuard(또는 관리자 전용)를 통과해야 도달. `is_admin` 면제는 DB 조회라 위조 불가.
- **모든 Anthropic 호출은 두 경로로만** 나가고 둘 다 `ai_interactions_log`에 기록(감사 래퍼 또는 메인 스트리밍). 숨은 LLM 호출처 없음(스크립트/크론/webhook 0건).
- 확정 결함: **high 1**(costGuard TOCTOU 레이스), **low 1**(첨부 fetch DNS rebinding), **info 1**(ai-comment 비용이 장부 밖 — 관리자 전용이라 무해). 크리티컬 0. 불확실 0. 반박 7.
- **실 재무 노출은 Anthropic 콘솔 월 $30 하드캡이 최종 방어선**(CLAUDE.md) — 앱 레벨 가드가 물러도 지갑은 $30/월 이상 안 샘. 그래서 아래 high도 **출시 차단은 아님**, 단 베타 상한을 키우기 전 최우선 견고화 대상.

---

## LLM 비용 표면별 판정

| 표면 | 등급 | 게이트 |
|---|---|---|
| `chat` POST (메인 스트리밍) | ✅ 견고(게이트) | 인증 401 → persistent rate limit 60/hr → 커플 소유 403 → **costGuard 429**(is_admin DB 면제) → visibility. 첨부 SSRF 가드 존재(아래 L1). 턴마다 `chat_turn` 로깅 → 가드가 최대 비용원을 카운트. |
| `chat/check-couple-conflict` POST | ✅ 견고(게이트) | 인증 401 → rate limit 30/hr → 커플 소유(mismatch 403) → **costGuard**(LLM 호출 前) → cooldown 10분 → race 재확인. mediation LLM도 `chat_turn` 장부 편입 확인. |
| `chat/proactive` GET | ✅ 견고 | **LLM 미호출** — `buildDueMomentCells`·`buildAmoraLifecyclePlan`은 순수 로컬 연산. 무인증 시 `triggered:false`. |
| `community/ai-comment` POST | ⚠️ info(I1) | `verifyAdmin`(403, DB is_admin) → rate limit 30/hr → post당 1개(409). **관리자 전용이라 공격 표면 아님**, 단 비용이 costGuard 장부 밖(아래 I1). |
| sub-LLM (summarize·extract-decision·classify-excavation·amora-profile) | ✅ 게이트 하위 | 전부 `chat/route`의 gated 턴 내부에서만, 메인 스트림 완료 후 실행. 각자 고유 interaction_type으로 로깅. 무인증 경로 없음. |

---

## 확정 결함

### H1. costGuard TOCTOU 레이스 — 동시 요청이 상한을 넘겨 통과 (high, 코드 레벨 / 실노출은 $30 콘솔캡으로 제한)
- **파일**: `apps/web/src/lib/ai/costGuard.ts:36-85`, `apps/web/src/app/api/chat/route.ts:424·839`
- **공격**: `checkAmoraCostGuard`는 LLM 호출 **전** `ai_interactions_log`의 `chat_turn` 개수를 SELECT count로만 판정(원자적 예약/증가 없음). 현재 턴의 `chat_turn` row는 스트림 종료 **후** `void logAIInteraction`(fire-and-forget, route.ts:839)로 기록. 동시에 도착한 N개 요청은 전부 '증가 전' 동일 카운트를 읽어 모두 `allowed` → 커플 상한(100)·전역 일일 상한(300)을 버스트로 초과.
- **왜 기존 게이트가 못 막나**: 유일한 직렬화 지점 `checkRateLimitPersistent`(route.ts:380)는 키가 `chat:{user.id}`(per-user 60/hr)라 ①커플 단위 미직렬화(2명 = 120/hr > 커플캡 100) ②전역 미직렬화(서로 다른 커플/유저는 300 캡과 안 겹침). costGuard의 fail-open은 이 레이스와 무관.
- **compounding — 턴 vs 호출 그래뉼래러티**: 가드는 "턴 수"를 세지만 한 턴이 tool round 최대 6회(메인 모델) + Haiku sub-LLM 최대 4회 = 실 API 호출 다수. 즉 "커플 100턴"이 실제로는 최대 ~10배 호출을 허용 — 상한이 이중으로 무릅다(레이스 + 그래뉼래러티). (반박 검증: 이 팬아웃은 gated 턴 내부·인증·자기비용이라 별도 취약점은 아니나 H1의 상한 느슨함을 키움.)
- **실 영향 경계**: 인증 필요(신규 무료 커플 1쌍이면 충분). **Anthropic 콘솔 월 $30 하드캡이 실제 지갑 손실을 봉인** → 출시 차단 아님. 단 베타 상한을 올리거나 콘솔캡을 완화하기 전엔 반드시 원자화.
- **수정 방향**: read-then-later-write를 **원자적 DB check-and-increment**로 교체 — service_role RPC가 예약 row INSERT + 증가 후 카운트를 한 트랜잭션에 반환, 커플·전역 캡 초과 시 거부. 스트림 前 호출(현 fire-and-forget 로깅 대신). 전역 캡은 per-user rate limit이 전혀 못 지키므로 원자적 전역 카운터가 핵심. fail-open은 인프라 에러에만 유지.

### L1. 첨부 URL fetch의 DNS rebinding TOCTOU (low)
- **파일**: `apps/web/src/app/api/chat/route.ts:237-308` (`assertSafeRemoteUrl`·`fetchRemoteAttachment`)
- **공격**: 인증 커플 사용자가 `attachments[].url`에 공격자 통제 도메인(짧은 TTL) 입력. `assertSafeRemoteUrl`이 `lookup()`으로 공인 IP 1회 확인·통과시키나(route.ts:255-256), 반환 URL은 **호스트명**을 담고 `fetch(url)`(route.ts:290)이 undici로 DNS를 **독립 재해석** — IP 핀닝 없음. 첫 조회는 공인, fetch 시점엔 사설/링크로컬로 재바인딩 → 내부 GET 도달·존재성 오라클.
- **왜 low로 하향**(주장 medium): ①인증+커플 스코프(무인증 아님) ②**https 강제**(route.ts:239)로 HTTP 전용 IMDS(169.254.169.254) 제외 ③Content-Type이 `image/*` 일치 필수(300-302) ④**blind**(응답은 base64로 Claude에만, 공격자에 원문 미반환) ⑤스트리밍 바이트캡(`readResponseBodyWithLimit`)으로 content-length 위조도 방어. 순 결과 = 인증된 저수율 blind 내부 도달성 프로브.
- **수정 방향**: 검증한 IP에 연결을 핀닝 — `assertSafeRemoteUrl`에서 IP 확정 후 그 리터럴 IP로 연결(undici Agent의 커스텀 connect에서 소켓 주소를 `isPrivateIpAddress`로 재검증), https+redirect:error+content-type는 심층방어로 유지.

### I1. ai-comment의 Haiku 비용이 costGuard 장부 밖 (info — 관리자 전용, 무해)
- **파일**: `apps/web/src/app/api/community/ai-comment/route.ts:131`
- **사실**: 실제 Haiku 호출(max 300)을 하나 `interaction_type='community_amora_comment'`로 기록 → costGuard의 `chat_turn` 카운트(전역 300·커플 100)에 **미편입**. 즉 이 비용은 지갑 가드 사각지대.
- **왜 무해**: `verifyAdmin`(403, DB is_admin, 위조 불가) + rate limit + post당 1개로 게이트 → 익명/일반 유저 도달 불가. 관리자 계정 탈취 시에만 문제, 그때도 콘솔 $30캡이 방어.
- **수정 방향(선택, 심층방어)**: costGuard 전역 카운트를 `chat_turn`뿐 아니라 모든 과금 interaction_type 포함으로 확장하거나, 과금 호출에 공통 `is_billable` 태그를 두고 그걸로 카운트 — 새 LLM 표면이 조용히 캡을 빠져나가지 않도록.

## 반박된 발견 (기록)
- sub-LLM 팬아웃이 "게이트 밖에서 계속 청구" → **REFUTED**: sub-LLM은 gated 턴 내부·인증·자기비용, 각자 로깅됨. 상한 초과 후 무한청구 아님(H1의 상한 느슨함으로 흡수).
- MAX_TOOL_ROUNDS 증폭(1턴 6호출) → **REFUTED(별도 취약점 아님)**: 사실이나 인증·턴당 유한·자기비용. H1에 context로 편입.
- check-couple-conflict 인메모리 rate limit이 서버리스 배수 우회 → **REFUTED**: rate limit은 빈도 스로틀이지 비용캡 아님. 실 비용캡은 costGuard(같은 장부 공유).
- DOCX 압축비 무가드 → **REFUTED**: 토큰비용 이슈 아님 + 바이트캡 존재.
- fail-open 카운트 쿼리 강제 무력화 → **REFUTED**: 거대 페이로드로 카운트 쿼리 방해 불가.

---

## 사후 보정 (2026-07-04 자체 검토)
2.3 스코프 "api/amora" 중 **비-LLM 라우트 `api/amora/actions` GET·POST·PATCH를 당시 미감사**(LLM 비용 표면만 봄). 사후 직접 검증 결과 ✅ 견고: auth 401 → coupleId 서버파생(profiles) → 리포지토리 write가 `.eq("couple_id",coupleId).eq("id",id)` 이중 스코프(actionRepository.ts:170-171), RLS는 커플 SELECT·service만 write(`20260615100000`). IDOR 없음. 신규 결함 아님.

## 감사 방법론 메모
- 워크플로 15 에이전트(Opus), 발견 11건 → 확정 4(중복 병합 시 실 3: high 1·low 1·info 1)·불확실 0·반박 7. 토큰 ~109만.
- **확정 3건 전부 감사자 직접 재검증**: costGuard.ts + route.ts:424/839(TOCTOU), route.ts:237-308(SSRF), ai-comment.ts:131(장부). 반박 7건도 근거 확인.
- 확정 건은 이 감사에서 **기록만**(2.1·2.2 동일 정책). 수정은 별도 패스/Phase 6 "Top 5". H1은 Top 5 유력 후보.
