# 인계 문서 — 2026-08-09~10 감사 세션

> **다른 컴퓨터에서 그대로 이어받기 위한 문서다.**
> 이 세션에서 무엇을 했고, 지금 상태가 어떻고, 다음에 무엇을 해야 하는지 전부 담았다.
> **이 세션에서 코드는 한 줄도 바뀌지 않았다.** 양쪽 워킹 카피 모두 `git status --porcelain -uno` → 0.

---

# 0. 30초 요약

- 5개 조사를 했다. **전부 읽기 전용.** 코드 변경 0, DB 쓰기 0, git 상태 변경 0.
- **가장 큰 발견**: 조사 3건이 잘못된 브랜치를 봤다. `feat/ux-polish-journey-audit`는 `origin/main`보다 **332커밋 뒤처진 사문 브랜치**이고 AI 제공자도 다르다(Anthropic vs OpenAI).
- 4번째 조사부터 운영(`origin/main`) 기준으로 다시 했다.
- **핵심 제품 결론**: 플래너 대체율 약 32%. 그런데 **업체 제휴는 병목이 아니다** — 제휴 없이 70~75%까지 갈 수 있고, 막고 있는 건 전부 자체 코드다.
- **열려 있는 결정 3개**가 있다(§5). 그중 브랜치 처분은 권고까지 나왔으나 **실행하지 않았다.**

---

# 1. 작업 환경 — 다른 컴퓨터에서 세팅

## 리포지토리
```
origin: https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
```

## 디렉터리 구조 (이게 제일 헷갈리는 부분이다)

```
hanbang/                                  ← git 저장소 아님. 그냥 폴더
├─ wedding/                               ← 메인 클론. 현재 feat/ux-polish-journey-audit (사문 브랜치)
│  ├─ .codex-integration-20260806/        ← git worktree. deploy-trigger 브랜치 = origin/main
│  ├─ .codex-amora-20260805/              ← 별도 워킹 카피 (다른 브랜치)
│  ├─ .codex-community-20260805/          ← 별도 워킹 카피
│  ├─ .codex-consumer-qa-20260803/        ← 별도
│  ├─ .codex-handoff-build-20260803-*/    ← 별도
│  ├─ .codex-landing-20260805/            ← 별도
│  ├─ .codex-mobile-20260805/             ← 별도
│  └─ wedding-hanbang-web/                ← 또 다른 사본 (미확인)
└─ 명세/                                  ← git 밖. Claude 채팅용 문서 모음
```

### ⚠ 반드시 알아야 할 함정 3개

**1. `.codex-*` 는 각각 다른 브랜치의 워킹 카피다.**
`wedding/` 루트에서 `grep -r` 하면 **다른 브랜치 코드가 섞여 나온다.**
이 세션에서 실제로 이 함정에 빠져 `.codex-amora-20260805`의 코드를 인용한 적이 있다.
→ **항상 `apps/web/src` 로 범위를 좁혀라.**

**2. `.gitignore` 가 `.codex-*` 를 무시하지 않는다.**
`wedding/`에서 `git add .` 를 치면 **워킹 카피 7개를 통째로 커밋하려 한다.**
절대 하지 마라. 파일을 명시적으로 지정해서 add 할 것.

**3. 운영 코드는 `origin/main` 이다.**
`wedding/` 이 체크아웃한 브랜치가 아니다. 운영 코드를 보려면
`.codex-integration-20260806/`(worktree, origin/main 동기) 을 쓰거나 `git show origin/main:<path>`.

## 새 컴퓨터 세팅 절차

```bash
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git switch main            # 운영 코드

npx pnpm@11.7.0 install    # ⚠ pnpm 은 반드시 11.7.0

cd apps/web
npx vitest run             # 테스트
npx tsc --noEmit           # 타입체크
```

`.codex-*` 워킹 카피는 재현할 필요 없다. 필요하면 `git worktree add`로 만들면 된다.

---

# 2. 이 세션에서 한 일 — 조사 5건

| # | 조사 | 대상 브랜치 | 에이전트 | 산출물 |
|---|---|---|---|---|
| 1 | 15단계 역량 감사 | ⚠ 사문 브랜치 | 14 | `docs/JOURNEY_CAPABILITY_AUDIT_2026-08-09.md` |
| 2 | 모순 5건 정밀 조사 | ⚠ 사문 브랜치 | 10 | `docs/CONTRADICTION_FORENSICS_2026-08-09.md` |
| 3 | 도구 결과 전달 계층 | ⚠ 사문 브랜치 | 9 | `docs/TOOL_RESULT_TRANSPORT_2026-08-09.md` |
| 4 | **플래너 대체 가능성 (2차)** | ✅ origin/main | 17 | `docs/PLANNER_*_2026-08-10.md` 3종 + `명세/감사-2026-08-10/` 10파일 |
| 5 | **브랜치 지형 + 재분류** | ✅ origin/main | 7 | `명세/브랜치정리-2026-08-10.md` |

총 57개 에이전트, 도구 호출 약 3,800회.

**⚠ 조사 1~3은 사문 브랜치 기준이다.** 조사 5가 그 발견들을 운영 기준으로 재분류했으니
**조사 1~3을 직접 인용하지 말고 조사 5의 재분류표를 봐라.**

---

# 3. 핵심 발견 — 운영(origin/main) 기준

## 3-1. 제품 상태: 플래너 대체율 32%

7축 × 15단계 = 105셀 판정: **A(완결) 2 / B(부분) 64 / C(표시) 17 / D(부재) 17 / E(봉인) 4**
아모라 30발화 예측: **A 0 / B 13 / C 17**

| 축 | 점수 |
|---|---|
| ③ 비용 통제 | 45 |
| ⑥ 정보 비대칭 | 38 |
| ⑤ 관계 조율 | 33 |
| ① 시점 관리 | 32 |
| ⑦ 정서 지지 | 30 |
| ④ 업체 조율 | 25 |
| ② 의사결정 | **22** ← 가장 중요한데 가장 비어 있다 |

## 3-2. 가장 큰 구멍 5개

1. **결론을 내주는 경로가 0에 가깝다.** `quoteCheck.ts`의 `getMarketMedian`이 `void category; void region; void scope;` 후 **`median: 0` 고정 반환**. 그런데 `/price` 공시 실데이터는 존재하고(`loadPublicPriceCatalog`) 채팅이 읽을 도구만 없다. **분포에서 위치를 보여주는 건 판정이 아니라 대조다.** — M
2. **먼저 연락하는 기능 전부 기본 off + 켜는 조합이 서로를 무력화.** `isAmoraProactiveChatEnabled = ... && !isAmoraTodayOneEnabled()`인데 today-one은 `cell.message`·`checklist`·`script`를 버리고 `일정: ${event.title}`만 쓴다. **켤수록 내용이 사라진다.** — S
3. **스코프 분류기가 흔한 발화를 범위 밖으로 떨어뜨린다.** `WEDDING_CORE_SIGNAL_PATTERN`에 견적·추가금·호칭·시어머니·**남편**·늦었·뭐부터가 없다(신부·신랑은 있는데 남편·아내는 없다). "남편은 무관심하고 나만 다 하고 있어"가 W4로 떨어져 되묻기를 돌려준다. — S
4. **예절·관습 데이터가 0.** `etiquetteData.ts`가 삭제됐고 대체 소스가 없다. 테스트로 부활까지 봉인. — L
5. **왕복이 끊긴다.** 보내는 문장(문의 5문항·증빙 목록)은 잘 만들고 **받는 답을 남길 곳이 없다.** `oral_promises`는 입력만 받고 저장 안 됨. — M

## 3-3. 제휴 없이 도달 가능한 최대치 = 70~75%

**업체 제휴는 병목이 아니다.** 막고 있는 건 넷이고 전부 자체 코드다:
**스코프 분류기 · 기능 플래그 · 도구 게이트 · 스키마 연결.**

## 3-4. 도구 표면의 실제 크기

```
36  tools.ts 선언
24  BETA_DISABLED_TOOL_NAMES 12개 제외
 9  route.ts:2551-2554 가 변경 도구를 모든 턴에서 무조건 제거
```
주석 원문: *"모델은 어떤 턴에도 변경 함수를 직접 받지 않는다."*
→ **②의사결정 22점의 구조적 이유가 여기 있을 수 있다.**

## 3-5. 실패 신호가 모델에 안 간다 (main에도 유효)

`getModelSafeToolOutput`(`lib/ai/placeSearchResultPolicy.ts:185`)은 반환형이 `Record<string, unknown>`이라
**`toolOutput` 자리 하나만 만든다.** `success`를 실을 구조 자체가 없다.
페이로드를 실제로 바꾸는 건 4개 도구 이름뿐이고 나머지는 `return result.toolOutput` 기본 경로.
예외인 `search_nearby_places`는 BETA_DISABLED다.

---

# 4. 다음에 할 일 — 우선순위

## 4-1. 가장 싼 승리 10개 (전부 자체 코드)

**대상은 줄번호가 아니라 문자열로 특정했다.** 이 세션에서 줄번호 오류가 실제 작업 사고로 이어질 뻔했다.

| # | 작업 | 대상 | 양 | 상승 |
|---|---|---|---|---|
| 1 | `WEDDING_CORE_SIGNAL_PATTERN`에 어휘 추가 (견적·추가금·원본·호칭·시어머니·남편·아내·늦었·뭐부터) | `amoraQuestionScope.ts` → `const WEDDING_CORE_SIGNAL_PATTERN =` | XS | C→B |
| 2 | 저장된 커플 문맥을 W0 신호로 인정 | `amoraQuestionScope.ts` → `scope: "W4_out_of_scope"` 직전 | S | **C→A** |
| 3 | `BUDGET_INTENT`에 보증인원·하객·식대 추가 | `amoraToolPolicy.ts` → `const BUDGET_INTENT =` | XS | **B→A** |
| 4 | **없는 능력 약속 제거** (아래 ⚠) | `prompts.ts` / `marketPrices.ts` | XS | 버그 제거 |
| 5 | `update_task_status` enum에 `not_applicable` | `tools.ts` → `enum: ["not_started", "in_progress", "completed"]` | XS | C→B |
| 6 | decision·cohort 범주에 yedan·houseware | `extract-decision.ts` → `ALLOWED_CATEGORIES` | XS | C→B |
| 7 | quote-check·budgetFinder에 `hall` | `quote-check/page.tsx` → `CATEGORY_OPTIONS` | S | C→B |
| 8 | **`get_market_price`를 `/price` 공시에 연결** | `quoteMarketTools.ts` → `status: "migrated_to_published_disclosures"` | **M** | **B→A, 최대** |
| 9 | today-one 카드에 모멘트 본문 싣기 | `todayOne.ts` → `whyNow: whyNow(cell.cellKind, event.title)` | S | **B→A** |
| 10 | `contractShield`에 `restaurant` 추가 | `contractShield.ts` → `\| "other";` 유니온 | S | D→B |

**⚠ 4번은 버그다. 제일 먼저 해도 된다.**
`prompts.ts`의 중재 전략에 `"(도구로 검색)"`·`"(도구로 시뮬레이션)"`이 있고
`marketPrices.ts`의 `getMarketPriceContext`가 `"업체 공시가 검색·추천 도구를 사용하고"`라고 지시한다.
**그 도구들은 BETA_DISABLED다.** `amoraPromptComposer`의 비활성 도구 필터는 줄 안에 도구 *식별자*가 있을 때만 지우는데
이 세 곳은 한국어 산문이라 통과한다. → **제품이 "가장 나쁜 실패"로 규정한 "할 수 없는 일 약속"을 프롬프트 자신이 유발하고 있다.**

## 4-2. 순서 (의존관계)

```
0. 거짓 약속 제거 (XS)          ← 지금
1. 스코프 분류기 (XS+S)         ← 반드시 첫 번째
2. 도구 게이트 (XS)
3. 데이터 채널 /price 연결 (M)  ← 여기까지가 '결론 내기'의 최소 구성
4. 왕복 저장 (XS~M)
5. 배달 — 본문 먼저, 플래그는 그 다음 (S)
6. 예절·관습 축적 (L)           ← 착수는 4와 병행
7. 업체 제휴                    ← 안 해도 70~75%
```

**1단계가 첫째인 이유**: 아래 모든 개선이 채팅에 닿으려면 발화가 W0로 들어와야 한다.
견적 도구를 완벽히 고쳐도 "이 견적 800만원인데 괜찮아"가 W4에서 죽으면 아무 일도 안 일어난다.

**5단계 순서 주의**: 플래그부터 켜면 today-one이 proactive를 끄면서
**내용 없는 "일정 열기" 카드만 나가 첫인상을 태운다.** 본문 실은 뒤에 켤 것.

## 4-3. 도구 결과 전달 계층 3단계 (별도 트랙)

조사 3에서 설계했으나 **사문 브랜치(Anthropic) 기준**이었다. **main(OpenAI)으로 재작성 필요(S).**
`claude.ts`·`buildToolResultContent`는 main에 존재하지 않는다.
main의 대응 지점은 `lib/ai/openai.ts`의 `buildToolResultInput` + `route.ts:3495`.
main에 이미 있는 `getModelSafeToolOutput`의 `status:"unavailable"` 패턴을 확산하는 편이 `is_error`보다 현실적이다
(OpenAI `function_call_output`에는 `is_error` 필드가 없다).

---

# 5. 열려 있는 결정 — 이걸 정해야 다음이 진행된다

## 결정 1. `feat/ux-polish-journey-audit` 처분 ← **권고까지 나왔고 실행 안 함**

**권고: 폐기.** 단 "삭제"가 아니라 **태그 보존 + 문서 9건만 반출.**

근거:
- 6커밋 중 5개가 웨딩코드 v0.5 강화인데 main은 그 축을 3단계로 닫았다
  (`ac93c841` API 410 + DB 권한 REVOKE → `84b54e9f` LEGACY_RETIRED.md → `8cfdc5d8` v0.6 교체)
- `WeddingCodeClient.tsx`를 import하는 소스가 **main에 0개**
- 리베이스 시 19파일 충돌, 6커밋 replay로 **30회 이상 수동 해소**, 결과물은 죽은 화면의 카피

**⚠ 실행 전 반드시 알아야 할 것 2개**

1. **이 브랜치는 origin에 없다.** `git ls-remote --heads origin feat/ux-polish-journey-audit` → 결과 없음.
   **로컬이 유일본이다. 태그 푸시 확인 전에 `git branch -D`를 치면 reflog뿐이다.**
2. **진짜 위험은 충돌이 아니라 무충돌이다.**
   `supabase/migrations/20260710110000_wedding_code_atomic_pairing.sql`(+428)은 신규 파일이라
   **충돌 없이 조용히 들어와** main의 07-14 폐기 마이그레이션보다 앞선 타임스탬프로 ledger를 깬다.
   충돌 목록만 보고 검수하면 100% 놓친다. 그리고 이건 "잃으면 안 되는 스키마"가 아니라 **넣으면 안 되는 것**이다 —
   대상 테이블은 `service_role`까지 권한이 회수됐고 파일 주석이 ledger 수정을 명시적으로 금지한다.

절차는 `명세/브랜치정리-2026-08-10.md` §4 참조.

## 결정 2. 운영 env 값 확인 ← **감사 결론이 여기 달려 있다**

리포지토리에 없어 확인 불가. Vercel 대시보드에서 봐야 한다.

```
AMORA_CARE_OUTBOUND_ENABLED
AMORA_PROACTIVE_*
AMORA_TODAY_ONE_*
WEDDING_PAYMENT_LEDGER_ENABLED
```

`.env.example` 기본값은 전부 `false`다. **A 판정 2개와 축① 점수가 이 값에 달려 있다.**

## 결정 3. 이슈 1(예산 비율표) 방향 — **이미 확정됨**

사용자가 "통합 브랜치의 비율 추정 제거 방향으로 확정, 값 통일은 하지 않음"으로 정했다.
main에서 이미 그렇게 됐다(`04f0ea16`이 `CATEGORY_RATIOS` 전량 삭제 + `budgetReliability.test.ts`로 봉인).

**남은 후속**: 추정을 지운 자리에 **근거 있는 숫자가 안 들어갔다**(EMPTY_REGRESSION).
예산 화면은 "미입력"/"예산 입력 전"/"계산 전"만 보여준다. 정직성은 얻고 콜드스타트 숫자를 잃었다.
→ `/price` 공시가를 **`allocated`로 승격하지 말고 참고 라벨로만** 붙이는 작업(M)이 필요하다.

---

# 6. 이 감사가 보증하지 못하는 것

**출력단 강제 장치는 `amoraTrustClaims`의 삭제형 필터 7종뿐이고,
양성 행동을 강제·검사하는 장치는 0개다. 업체명 출력 필터는 아예 없다(grep 0건).**

→ 105셀·30발화의 "사용자가 손에 쥐는 것" 서술 **전체가 프롬프트 준수 가정 위에 있다.**
"업체 이름 0개"라는 낙관도, "확인 질문을 준다"는 낙관도 코드가 보증하지 않는다.
**런타임 측정 없이는 알 수 없다.**

---

# 7. 미확인 목록 (통합)

| 항목 | 왜 못 했나 | 무엇이 달라지나 |
|---|---|---|
| 운영 Vercel env 실값 | 리포지토리에 없음 | **A 판정 2개, 축①·③ 점수** |
| 모델의 프롬프트 준수율 | 런타임 미실행 | §6 전체 |
| 부산·대전 공시 데이터 보유 여부 | 운영 DB 조회 필요 | 지역 질문 답변 가능 여부 |
| 모바일 스토어 등록 상태 | `app.json`/`eas.json`까지만 확인 | 모바일 판정 실효성 |
| 커뮤니티 화면 클라이언트 로그인 가드 | `post/write` 외 미확인 | 커뮤니티 접근성 |
| 커밋 단위 리베이스 정확한 충돌 횟수 | `merge-tree`는 머지 시뮬레이션 | 결정 1의 비용 추정 |
| `wedding-hanbang-web/` 디렉터리 정체 | 조사 안 함 | 디스크 정리 |

---

# 8. 세션 중 발견된 방법론 함정 — 반복하지 말 것

1. **워킹 카피 오염** — `wedding/` 루트 `grep -r`이 `.codex-*`를 긁는다. 실제로 당했다.
2. **줄번호 드리프트** — 조사 2에서 8건, 조사 4에서 6건 발견. **편집은 문자열 매칭으로.**
3. **자가 검증 맹점** — 조사 3의 테스트 설계에서 `{count:"exact"}`로 구현하면
   테스트 픽스처가 `count`를 안 만들어 **가드가 한 번도 실행 안 된 채 초록불**이 되는 걸 반증이 잡았다.
   **안전장치를 넣으면 일부러 깨뜨려 빨개지는지 확인할 것.**
4. **잘못된 브랜치** — 조사 3건이 사문 브랜치를 봤다. **작업 전 `git rev-list --left-right --count origin/main...HEAD` 확인.**
5. **낙관 편향** — 조사 4의 A 등급 3건이 반증에서 전부 깎였다. **적대적 반증 에이전트를 반드시 넣을 것.**

---

# 9. 문서 지도

## 운영 기준 (믿어도 됨)
| 문서 | 내용 |
|---|---|
| `docs/HANDOFF_2026-08-10_SESSION.md` | **이 문서** |
| `docs/PLANNER_REPLACEMENT_AUDIT_2026-08-10.md` | 2차 감사 종합 |
| `docs/PLANNER_AUDIT_MATRIX_2026-08-10.md` | 105셀 |
| `docs/PLANNER_AUDIT_DETAIL_2026-08-10.md` | 시뮬·30발화·관계·데이터·모바일 |
| `docs/session-2026-08-10/브랜치정리.md` | 브랜치 지형 + 재분류 28건 + 처분 권고 |
| `docs/session-2026-08-10/감사-*/` | Claude 채팅용 분할본 (0~9번) |

## ⚠ 사문 브랜치 기준 (직접 인용 금지)
`JOURNEY_CAPABILITY_AUDIT_2026-08-09.md` / `CONTRADICTION_FORENSICS_2026-08-09.md` / `TOOL_RESULT_TRANSPORT_2026-08-09.md`
→ 이 셋의 발견은 `브랜치정리.md` §2의 재분류표(28건)를 보고 판단할 것.

## 작업 루프
사용자는 **Claude(채팅) ↔ Claude Code** 왕복으로 개발한다.
Claude가 프롬프트를 쓰고 → Claude Code가 실행하고 → 결과를 Claude에 다시 넣는다.
→ **Claude에 넣을 때는 `감사-2026-08-10/0-읽는순서.md` → `1-종합판정.md` → `8-미확인목록.md` 순.**
8번을 빼면 이미 교정된 오류를 다시 물고 간다.
