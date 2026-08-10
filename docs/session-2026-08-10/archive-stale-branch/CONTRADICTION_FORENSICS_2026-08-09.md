# 웨딩한방 — "제품이 서로 다른 말을 하는" 문제 5건 정밀 조사

> **이 문서를 읽는 AI에게**
> 2026-08-09 소스 스냅샷이다. 줄번호는 어긋날 수 있다 — 이 조사에서만 줄번호 오류 8건이 발견되어 교정했다.
> **편집 시에는 줄번호가 아니라 문자열 매칭으로 대상을 특정하라.** (실제 사고 사례: seed-makeup 210행 → 실제 211행)
> 코드는 한 줄도 수정하지 않았다.

| 항목 | 값 |
|---|---|
| 감사일 | 2026-08-09 |
| 대상 | `wedding/` 브랜치 `feat/ux-polish-journey-audit` (HEAD `415c9bbd`) |
| 방법 | 10개 에이전트(조사 5 + 설계 2 + 적대적 반증 3), 도구 호출 504회 |
| 테스트 베이스라인 | **49 파일 / 410 테스트 / 전부 통과 / 31.37초**, `tsc --noEmit` exit 0 |
| 반증 결과 | REFUTED 6건 · RISKY 6건 · PARTIAL 11건 → 본문에 반영 완료 |

---

## ⛔ 착수 전 필수 확인 2건 — 이것부터 답하라

### (1) 이슈 1은 지금 착수하면 안 된다 — 이미 병합된 라인과 정면 충돌

`.codex-integration-20260806` (HEAD `840629c2`, 직전 커밋 `Merge pull request #93 merge/amora-to-main-20260808`)에는
**`CATEGORY_RATIOS`가 웹·모바일·아모라 도구·결과카드에서 전부 제거되어 있다** (grep 0건).
그리고 그 상태를 테스트가 잠그고 있다:

```
.codex-integration-20260806/apps/web/src/components/app/budget/__tests__/budgetReliability.test.ts:40-52
  expect(source).not.toMatch(/\bratio:\s*0\.\d+/)
  expect(source).not.toContain("CATEGORY_RATIOS")
```

즉 **병합된 라인의 해법은 "표를 1벌로 통일"이 아니라 "비율 추정 자체를 제거"** 다.
이 문서의 이슈1 수정안(B를 A값에 맞춤)을 적용하면 통합 시점에 저 테스트가 즉시 빨간불이 되고,
이미 삭제된 코드를 되살리는 방향이 된다.

**결정 필요**: (a) 통합 브랜치의 '비율 추정 제거' 방향을 현재 브랜치로 포팅 / (b) 값 통일.
**둘을 섞으면 안 된다.** 최소한 "표 1벌화" 항목은 이미 다른 방식으로 끝났으므로 재작업 목록에서 빼야 한다.

### (2) 이슈 5는 Vercel 환경변수 확인이 선행되어야 한다

`ALLOW_SEED=true`가 이미 프로덕션에 박혀 있다면, 게이트 반전은
**프로덕션을 연 채로 로컬만 막는 최악의 조합**이 된다. 저장소로는 확인 불가.

---

## 이슈 1. 예산 기본비율표 — 4벌이 아니라 **6벌**

### 확인된 사실

**표는 6벌, 값 기준으로는 3종이다.** (A=E=F 완전 동일)

| # | 소스 | 파일 | 키 | 합계 |
|---|---|---|---|---|
| A | 웹 예산 화면 | `components/app/budget/BudgetContent.tsx:49-70` | 20 | 1.00 |
| B | AI 도구층 | `lib/ai/tools/planningConstants.ts:29-50` | 20 | 1.00 |
| C | 예산 인터뷰 프롬프트(텍스트) | `lib/ai/prompts.ts:885-898` | 13 | 100 |
| D | 업체 추천 | `lib/ai/tools/vendorTools.ts:30-51` | 20 | **1.105 ⚠** |
| E | 모바일 예산 화면 | `apps/mobile/app/budget/index.tsx:42-63` | 20 | 1.00 (=A) |
| **F** | **채팅 예산 미니카드** | **`components/app/chat/ActionCard.tsx:98-103`** | 20 | 1.00 (=A) |

**F는 조사 지시에 없던 것이고 가장 위험하다** — 같은 채팅 말풍선 안에서 B로 계산된 AI 서술과 나란히 렌더된다.

### 20개 카테고리 × 소스 비교 (단위 %p 통일)

| 카테고리 | A/E/F | B | C | D | 최대차 |
|---|---|---|---|---|---|
| meeting | 1 | 1 | — | 1 | 0 |
| venue | 20 | 20 | ⚠ **38** | 20 | **18** |
| studio | ⚠ 10 | ⚠ 9 | ⚠ 6 | ⚠ 9 | 4 |
| dress | 7 | 7 | ⚠ 5 | 7 | 2 |
| makeup | ⚠ 5 | ⚠ 4 | ⚠ 3 | ⚠ 4 | 2 |
| snap | 4 | 4 | 4 | ⚠ 2 | 2 |
| ring | ⚠ 12 | ⚠ 10 | ⚠ 9 | ⚠ 10 | 3 |
| yedan | ⚠ 5 | ⚠ 4 | ⚠ 3 | ⚠ 4 | 2 |
| hanbok | 3 | 3 | ⚠ 2 | 3 | 1 |
| shoes | 1 | 1 | — | 1 | 0 |
| bouquet | 1 | 1 | — | 1 | 0 |
| honeymoon | ⚠ 12 | ⚠ 10 | ⚠ **17** | ⚠ 10 | **7** |
| houseware | ⚠ 7 | ⚠ 6 | ⚠ 10 | ⚠ 5 | 5 |
| **housing** | ⚠ **0** | ⚠ **10** | ⚠ **제외** | ⚠ **20** | **20** |
| invitation | 2 | 2 | ⚠ 1 | ⚠ 1 | 1 |
| gift | 2 | 2 | 2 | ⚠ 1 | 1 |
| mc / ham / pyebaek | 각 1 | 각 1 | — | 각 0.5 | 0.5 |
| reserve | ⚠ 5 | ⚠ 3 | ⚠ 0 (Step8에서 ≥8 강제) | ⚠ 키 없음 | 5 |
| *(jewelry — D 전용)* | — | — | — | 10 | ring 중복 별칭 |

**총예산 2,000만원 기준**: A vs B 절대 괴리 합 20%p = **400만원어치 배분 이동**.
신혼집만 0원(화면) vs 200만원(아모라).

### (b) 통합 대상 vs 통합 불가 — **핵심 판정**

**통합해야 하는 것: A = E = F = B 넷.** 목적·분모·단위가 같다. 현재 A/E/F는 일치하고 **B만 홀로 다르다.**
→ **값이 어긋나는 표는 4벌 중 1벌이고, B의 소비자는 함수 1개다** (`toolExecutor.ts:573` `executeGetBudgetSummary`. grep 전수 확인).

**통합 불가 (별개 표)**
- **C** — 분모가 다르다. `prompts.ts:882` 원문: *"모든 % 는 「결혼식 가용 자금」 대비 (= 사용자가 답한 총액, **신혼집 제외**)"*.
  게다가 Step 2~8에서 ±30%p까지 흔드는 **출발점**이지 고정 표가 아니다. 값을 맞추면 설계 의도가 깨진다.
- **D** — 예산 배분표가 아니라 **업체 가격 필터의 fallback 추정치**다.
  `vendorTools.ts:299` `ratio ?? 0.05` → `:300` estimatedBudget → `:330` `.lte("price_min", est*1.3)`.
  카테고리를 하나씩 조회하므로 합계가 100%일 이유가 없다.
  **⚠ 통합하면 깨진다**: `jewelry` 키가 사라지면 `VENDOR_CATEGORY_MAP["예물"]="jewelry"` 경로가 기본값 0.05로 떨어져 예물 추천의 가격 상한이 절반이 된다.

### (a) 호출 그래프

```
A (BudgetContent:49) ──→ getCategoryBudget(:742-752) ──→ 예산 화면 카테고리 카드 금액
                          [budget>0 → normalizeCost(cost) → ratio 3단 폴백]
F (ActionCard:98) ─────→ 채팅 예산 미니카드 금액
E (mobile:42) ─────────→ 모바일 예산 화면 금액
B (planningConstants:29) ─→ toolExecutor:573 executeGetBudgetSummary
                          [hasSetBudget = typeof budget==='number' → 없으면 total*ratio]
                          ──→ toolOutput.categories[].allocated ──→ 아모라 채팅 서술
C (prompts:885) ───────→ LLM 응답 텍스트 ──→ apply_budget_plan ──→ progress[key].budget (DB 저장)
                          ※ 저장 후에는 A/B/E/F 전부 progress를 우선 읽으므로 일관성 회복
D (vendorTools:30) ────→ recommend_vendors 가격 상한 필터 (예산 표시 아님)
```

**⚠ 폴백 사다리 불일치 (별건이지만 같은 증상)**: `toolExecutor.ts:575`는
`typeof p.budget === "number" && Number.isFinite(...)`라 **budget===0을 '설정됨'으로 판정하고 `p.cost`를 아예 보지 않는다.**
화면(`BudgetContent.tsx:743-751`)은 `budget>0 → normalizeCost(cost) → ratio` 3단이다.
**비율만 맞추면 cost 기록형 커플에게는 증상이 남는다.**

### (e) housing git blame — **분기가 아니라 태생부터 4개였다**

| 날짜 | 커밋 | 값 | 성격 |
|---|---|---|---|
| 2026-02-21 | `bf87e1bf` | **0.00(화면) + 0.10(AI) 동시 도입** | **같은 커밋에서 동시 탄생** |
| 2026-03-01 | `f22cdf87` | 0.00 (ActionCard 복제) | 수동 복제 |
| 2026-04-12 | `99748fec4` | 0.00 (모바일 복제) | 수동 복제 |
| 2026-05-07 | `b49b992df` | 0.00 (파일 이동, verbatim) | 무변경 |
| 2026-05-14 | `ee4ffd6a7` | **제외(프롬프트)** | **의도가 커밋에 명시된 유일한 케이스** |
| 2026-06-30 | `f9a4c18a0` | 0.10 파일이동 / **0.20 신규 복제+값변경** | 무설명 스쿼시 |

- `bf87e1bf` diff가 `budget/page.tsx: ratio: 0.00` 과 `toolExecutor.ts: housing: 0.10` 을 **한 diff 안에** 담고 있다.
  두 표를 각각 100%에 맞추다가 다른 해에 도달한 것으로 보인다. **어느 쪽에도 이유가 없다.**
- `ee4ffd6a7` 커밋 본문 (의도 명시): *"housing is treated as a separate financial concern, not part of the 결혼식 예산… Housing question is now gated on user-mentioned total > ~1.5억"*
  → **C의 '제외'는 버그가 아니라 설계다. 건드리지 마라.**
- `f9a4c18a0`는 커밋 메시지가 `fix: sync nickname display across app surfaces`인 대규모 스쿼시인데
  vendorTools 복제 시 값 8개를 함께 바꿨고 합계가 1.00 → 1.105로 깨졌다. **합계 검산이 없었다는 증거.**
  `housing: 0.20`은 의도인지 오타인지 **판정 불가**.

### 사용자가 실제로 겪는 증상

> 총예산 2,000만원을 넣은 커플이 예산 화면에서는 신혼집 0원·예물 240만원을 보는데, 같은 순간 아모라에게 물으면 신혼집 200만원·예물 200만원이라고 답한다.

### (b) 단일 소스 위치 — 결정

**`apps/web/src/constants/budgetRatios.ts` 신규 파일.**
- 근거: `lib/ai/` 아래에 두면 클라이언트 컴포넌트가 서버 전용 코드를 끌어온다. `constants/`는 이미 클라·서버 공용 관례(checklists, hiddenCosts, moments).
- **`@testing-library`가 없어 `BudgetContent`를 렌더/임포트해 검증할 수 없다.** 표를 모듈 로컬 const에서 빼내는 것은 리팩터링 욕심이 아니라 **테스트 앵커를 만드는 최소 비용**이다.
- icon/label은 클라이언트 관심사이므로 분리. 파생 함수(`toRecord`)를 둔다.

### 최소 변경안

| 파일 | 변경 |
|---|---|
| `constants/budgetRatios.ts` (신규) | 단일 소스 + `estimateCategoryBudget()` 파생 함수 |
| `lib/ai/tools/planningConstants.ts` | `CATEGORY_RATIOS` 8개 값을 A에 맞춤 (studio .09→.10, makeup .04→.05, ring .10→.12, yedan .04→.05, honeymoon .10→.12, houseware .06→.07, **housing .10→.00**, reserve .03→.05). `CATEGORY_LABELS`에 **reserve 라벨 1줄 추가** (현재 없어서 아모라가 예비비를 영문 `reserve`로 부른다 — 별건 버그) |
| `lib/ai/toolExecutor.ts` | 폴백 사다리를 화면과 동일하게 (`budget>0 → normalizeCost(cost) → ratio`). **⚠ 별도 커밋으로** |
| `components/app/budget/BudgetContent.tsx` | 로컬 const → 단일 소스 import (값 무변경) |
| 신규 테스트 | 아래 (d) |

**제외**: ActionCard(F)·모바일(E)은 이미 A와 값이 같아 증상과 무관 → 별건 티켓.
**D(vendorTools)는 통합하지 마라** — jewelry 키 손실로 예물 추천이 깨진다.

### (c) 깨질 테스트

**0건.** `toolExecutor.test.ts:21-47`은 금액을 단언하지만(`:34` total_spent, `:36` venue.allocated 등)
**전부 사용자가 설정한 budget/spent이고, 비율에서 파생된 참고치를 검증하는 단언은 없다.**
→ 현재 비율표를 지키는 테스트가 **0개**다.

**⚠ 부작용 2건 (반증에서 발견)**
1. `toolExecutor` 폴백 교체 시 **budget===0의 의미가 뒤집힌다** — "예단은 안 해요"라고 0을 저장한 사용자에게 없던 참고치가 생긴다.
2. 같은 함수에서 `allocated`만 `normalizeCost`를 타고 `spent`는 원본 `p.cost`를 쓰면
   레거시 만원 단위 커플에게 **"배정 500만원, 지출 50원"** 이 한 응답에 실린다. spent도 같은 커밋에서 통일할 것.

### (d) 변이 테스트 설계

앵커: `estimateCategoryBudget(total, key)` 순수 함수 (DB 무관, mock 불필요).

| # | 주입할 변이 | 반드시 실패해야 하는 테스트 |
|---|---|---|
| 1 | `budgetRatios.ts`의 housing을 0.00 → 0.01 | 합계 불변식 `expect(sum).toBeCloseTo(1, 10)` |
| 2 | planningConstants에 로컬 표 부활 (ring .10) | 화면↔도구 동일성 테스트 (아래 3) |
| 3 | `toolExecutor`가 다른 표를 참조 | **끝단 비교**: 총예산 2,000만 → `get_budget_summary().categories[].allocated` vs `estimateCategoryBudget()` 전 카테고리 일치 |
| 4 | `prompts.ts` Step1에서 venue 38% → 40% | 프롬프트 텍스트 합계 파싱 테스트 (**`#### Step 1` 블록 내부로 범위 제한** — 파일 전역 단언 금지, 이슈2가 같은 파일 하단을 건드린다) |
| 5 | 카테고리 키 1개 삭제 | 키 집합 일치 불변식 (checklists.ts 19키 + reserve) |
| 6 | `vendorTools`에서 jewelry 키 삭제 | **현재 어떤 테스트로도 안 잡힘** ← 새 테스트가 필요한 이유 |

**주의**: `expect(sum).toBe(1)`은 부동소수점 때문에 실패한다. `toBeCloseTo(1, 10)`을 쓸 것.

### 작업량: **S** (단, ⛔확인 (1) 해결 후)

---

## 이슈 2. 조용한 실패

### 확인된 사실 — 위장 메커니즘

**A. `executeGetMarketPrice` (`quoteMarketTools.ts`)**

```ts
:29-30   let displayMessage = "";  let toolOutput = {};
:40-48   case "venue": { ... if (nec) { displayMessage=...; toolOutput=...; } break; }  // ← else 없음
:64-74   dress 동일   :75-85   makeup 동일
:104-105 default: displayMessage = "지원하지 않는 카테고리입니다.";   // toolOutput은 {} 그대로
:108-114 return { toolOutput, success: true,
                  displayMessage: displayMessage || "시세 정보를 조회했습니다." };  // ← 위장 지점
```

| 상황 | 사용자가 보는 것 | success | 모델이 받는 것 |
|---|---|---|---|
| venue/dress/makeup 미발견 | 초록 체크 + **"시세 정보를 조회했습니다."** | true | `{}` |
| 미지원 category | "지원하지 않는 카테고리입니다." | true | `{}` |
| sdm/studio/options 0건 | 헤더만 남은 문자열 | true | `{"packages":[]}` |

**추가 발견(반증)**: `:24` `const scope = (input.scope as "national"|"seoul") ?? "national"` — **런타임 검증이 없다.**
모델이 `scope:"gyeonggi"`를 보내면 total/sdm/options/seasonal 분기에서는 실패가 아니라 **전국 데이터를 경기 데이터인 양 조용히 반환**한다.

**B. `executeCancelBooking` (`bookingTools.ts:848-884`)**

```ts
:860-867  UUID 불일치      → toolOutput:{hidden:true, reason:"invalid_booking_id"},      success:true, displayMessage:""
:877-884  조회 실패/타인   → toolOutput:{hidden:true, reason:"not_found_or_unauthorized"}, success:true, displayMessage:""
```

`hidden:true`는 **의도적 은닉이 맞다** — 커밋 `17629f9b` 본문:
*"fetch 실패 (not found / 다른 couple) 시 fail 대신 hidden=true 로 silent … 진짜 사용자 권한 문제 케이스도 silent — 데모 UX 우선"*

### 프롬프트 계약 관점 — **§2.6은 존재하지 않는다**

`prompts.ts`에 **"실패"라는 단어가 0회**이고 **§ 절 번호 체계 자체가 없다**.
검색어를 오류·에러·반영되지 등으로 넓혀도 동일. `CLAUDE.md`·`AGENTS.md`·`PRINCIPLES.md`·`docs/` 전부 확인.

계약의 정신은 **다른 브랜치**에 구현+테스트로 존재한다:
```
.codex-amora-20260805/  (브랜치 codex/amora-command-decision-design-20260805)
  lib/ai/amoraDemoPersistence.ts:35        "실제 일정에는 아직 저장되지 않았어요"
  api/onboarding/route.ts:1052             "이번 요청에 반영되지 않았어요"
  api/chat/__tests__/routeOpenAIContract.test.ts:4706, 7411-7413   ← 계약 테스트
```

**결정적 사실**: `route.ts:955`가 **`toolOutput`만 직렬화**하고 `claude.ts`가 `is_error`를 쓰지 않는다.
→ **모델은 `success` 필드를 물리적으로 볼 수 없다.**
→ 계약이 있었더라도 지킬 수 없었다. **실패 사실을 `toolOutput`에 넣지 않으면 수정 효과가 0이다.**

### 34개 도구 전수 조사

| 분류 | 개수 | 비고 |
|---|---|---|
| SILENT_SUCCESS | **2** | `get_market_price`, `cancel_booking` (지목 2건이 전부) |
| 쓰기 폴백 무검증 | 11 | `progressTools.ts:33-37` 폴백 UPDATE가 rowcount를 안 봄 → update_task_status·update_category_budget·add_custom_category·reset_category·일정3·toggle_checklist_item·log_wedding_event·아모라 미러링이 전부 "저장했습니다"를 무조건 반환 |
| EMPTY_BUT_HONEST | 8 | 업체·예약 계열 — 결과 0건이지만 "없습니다"라고 명확히 말함 (**문제 아님**) |
| HONEST_FAIL / THROWS | 나머지 | 정상 |

`apply_budget_plan` catch (`toolExecutor.ts:397-400`) 주석 원문:
*"저장 실패해도 예산 적용 자체는 성공으로 처리 — 사용자 흐름 우선"* ← 같은 철학의 흔적.

### 사용자가 실제로 겪는 증상

> 아모라가 "시세 정보를 조회했습니다"라고 하거나 아무 말 없이 넘어가는데, 실제로는 시세를 못 찾았거나 예약 취소가 전혀 실행되지 않아서, 사용자는 취소된 줄 알고 예식일에 그냥 나타난다.

### 최소 변경안 (XS)

| 파일 | 변경 |
|---|---|
| `lib/ai/tools/quoteMarketTools.ts` | ① `:24` 뒤에 scope 검증 2줄 — `if (scope!=="national" && scope!=="seoul") return {…toolOutput:{error:"unsupported_scope"}, success:false, displayMessage:"전국/서울 기준만 제공하고 있어요."}` ② switch 뒤 공통 가드 4줄 — `if (Object.keys(toolOutput).length===0) { toolOutput={error:"market_price_not_found", category, scope, periodId}; displayMessage="…데이터가 없어 조회하지 못했어요." }` ③ 목록형 3분기(sdm/studio/options)에 `if (list.length===0)` 각 2줄 ④ `:112` `success: true` → `success: !("error" in toolOutput)` |
| `lib/ai/tools/bookingTools.ts` | `:861-866`·`:878-883` toolOutput에 **`cancelled:false`** 추가 + `success:false`. `hidden:true`와 `displayMessage:""`는 **유지**(UI 침묵 정책 보존). **핵심은 `cancelled:false`** — 모델이 읽는 유일한 필드다 |

**공통 가드(②)가 else 3벌보다 diff가 1/3이면서 default까지 덮는다.** 카테고리별 한국어 라벨을 잃는 것이 트레이드오프.

**UI 무변화가 코드로 보장된다**: `VendorToolCard.tsx:733` hidden early return이 `:744` `if (!result.success)`보다 앞.
**단 "리스크 0"은 과장** — `chatStore.ts:997`의 `PROGRESS_AFFECTING_TOOLS.has(name) && result.success`에 cancel_booking이 있어(`:187`)
지금은 취소 실패에도 여정 재조회가 돌고 있다. success:false로 바꾸면 그 재조회가 사라진다(무해하지만 커밋 메시지에 남길 것).

### 전체 개선 (별도 사이클, M)

1. `route.ts:955` 직렬화에 실패를 물리적으로 실음 — `JSON.stringify(success ? toolOutput : {ok:false, ...toolOutput})`
2. `route.ts:956-958` 리마인더 조건을 `&& execResult.success`로 좁힘 (**지금은 실패 결과에도 "카드로 표시되니 1~2문장만"이 붙어 실패 고지를 적극적으로 억제한다**)
3. `prompts.ts:1039` `## 도구 사용 핵심 규칙` 하단에 **없는 조항 신설** — *"도구 결과에 `ok:false` 또는 `error`/`cancelled:false`가 있으면, 다른 말을 하기 전에 「그건 아직 반영되지 않았어요」를 먼저 말하세요."*
4. `progressTools.ts:33-37` 폴백에 `.select("couple_id")` → 0행이면 throw. **11개 도구의 "저장했습니다"를 진실하게 만든다**

### 깨질 테스트

**0건.** 문제 분기를 검증하는 케이스가 **아예 없다.**
- `quoteMarketTools.test.ts:9`는 `category:"total"`만 호출 — total 분기는 항상 채워지므로 통과
- `toolExecutor.test.ts:89`는 `confirmed` 없이 호출 → 확인 게이트에서 먼저 반환, UUID 분기 미도달
- `bookingTools.test.ts:386-391`은 정상 취소 경로

**전체 개선 4항 적용 시에만** `scheduleAndAmoraTools.test.ts:112`, `:181` 2건이 깨진다 (mock에 영향 행 추가, XS).

### 작업량: 최소 **XS** / 전체 개선 포함 **M**

---

## 이슈 3. 상견례 momentType 배선 단절

### 확인된 사실

```
EventFormModal.tsx:35-41   onSave 타입 = { date, title, memo, categoryKey }   ← momentType 전달 경로 자체가 없음
                            (파일 전체 momentType 0건)
momentLoop.ts:126-134      if (!event.momentType) continue;                   ← 태그 없는 이벤트를 버림
```

**⚠ 정정 (반증 REFUTED)**: `database.types.ts:99`에 **`momentType?: string;`이 이미 존재한다**(`:98`에 주석까지).
스키마에는 필드가 있고, **UI 경로로 생성된 이벤트에만 값이 비어 있는 것**이다.

**momentType이 붙는 기존 4경로**

| 경로 | 값 | 조건 |
|---|---|---|
| `api/onboarding/route.ts:96` | `sanggyeonrye` | create 시 상견례 날짜 입력분 |
| `api/onboarding/route.ts:280` | `sanggyeonrye` | join 시 파트너 journey 병합 |
| `api/onboarding/route.ts:426` | `sanggyeonrye` | join 시 병합(2) |
| `lib/ai/tools/scheduleTools.ts:317-366` | `log_wedding_event`의 moment_type enum 8종 | AI 채팅 |

### 자동 매핑 판정 — **안전한 쌍이 0개**

| 카테고리 | 후보 momentType | 판정 |
|---|---|---|
| dress | dress_tour / dress_fitting | **2:1 충돌** |
| venue | (없음) | 계약일에 투어 대본이 발화 |
| invitation | invitation_meeting | 제작 마감일에 모임 체크리스트가 발화 |

→ **자동 매핑 기각.** 케어 발화는 신뢰가 자산이고 오탐 1회 비용이 미발화 1회보다 크다.

### 사용자가 실제로 겪는 증상

> 일정 화면에서 "상견례"를 캘린더에 넣어도 아모라가 D-3/D-1/D+1에 아무 말도 하지 않는다 — 케어는 온보딩 1회와 AI 채팅으로만 살아난다.

### 최소 변경안 — **v1은 "태그 해제 미지원"으로 축소** (반증 권고 반영)

| 파일 | 변경 |
|---|---|
| `components/app/schedule/EventFormModal.tsx` | ① `import { EVENT_MOMENT_TYPES, MOMENTS } from "@/constants/moments"` (라벨 하드코딩 금지 — `moments.ts:379-381`이 정본) ② onSave 타입에 `momentType?: string` ③ `useState("")` ④ **useEffect edit 모드에서 `setMomentType(event.momentType ?? "")`** ⑤ handleSubmit에 `momentType: momentType \|\| undefined` ⑥ 카테고리 select 아래에 select 추가 ("해당 없음" + EVENT_MOMENT_TYPES 8개), 헬퍼 문구 "고르면 3일 전·전날·다음날에 아모라가 먼저 챙겨요" |
| `components/app/schedule/ScheduleContent.tsx` | handleSaveEvent 시그니처에 `momentType?: string`, 일반 분기 newEvent 리터럴에 `momentType: data.momentType,` 한 줄 |
| `utils/scheduleEvents.ts` | upsertCategoryEvent data 타입에 `momentType?: string`, 갱신 경로에 **`momentType: data.momentType ?? existing.momentType,`** |
| `api/onboarding/route.ts:274-276, 421-423` | 병합 가드를 '같은 날짜의 sanggyeonrye'로 좁힘 (아래 ⚠) |
| `utils/__tests__/scheduleEvents.test.ts` (신규) | 3케이스 — 신규 보존 / 갱신 시 유실 없음 / **태그된 이벤트가 buildDueMomentCells에서 D-3 셀을 만든다**(배선 end-to-end 검증) |

**⚠ 반드시 같은 커밋이어야 하는 것 (④와 ⑤)**
⑤만 넣고 ④를 빠뜨리면, `{...e, ...data}`(`ScheduleContent.tsx:259-264`)가 `momentType: undefined`로 덮어
**AI·온보딩이 붙인 태그가 사용자의 단순 메모 수정 저장 한 번으로 사라진다.**
현재는 data에 키 자체가 없어 보존되고 있다 — **이 보호막이 ⑤ 하나로 사라진다.**

**⚠ 새로 열리는 실패 경로 (반증 발견)**
온보딩 병합 가드는 `getEvents(progress).some(e => e.momentType === "sanggyeonrye")` — **날짜 무관**이다.
사용자가 '상견례 장소 답사'에 sanggyeonrye를 직접 붙이면, 나중에 파트너가 코드로 합류할 때
**입력한 진짜 상견례 날짜가 조용히 버려진다.** 지금은 사용자가 태그를 붙일 방법이 없어 발생하지 않던 경로다.

**⚠ 범위 밖 명시 필요**: `apps/mobile/app/schedule/index.tsx:510-520`에 **동일 결함**이 있다.
웹만 고치면 같은 커플이 모바일로 등록한 일정은 여전히 케어가 죽는다.

### 소급 매핑 — **하지 않는다**

판정 재료가 categoryKey/title뿐이고, 과거 날짜 이벤트를 태깅하면 `momentLoop`가 예상치 못한 셀을 만들 위험.

### 깨질 테스트

**0건** (컴포넌트 테스트가 저장소에 하나도 없다). **tsc가 유일한 안전망**이고,
옵셔널 필드 추가는 tsc를 통과하므로 **④ 누락은 tsc도 못 잡는다.**

### 작업량: **S**

---

## 이슈 4. 약관·개인정보 허위 고지

### 확인된 사실 — 실제로 제공하지 않는데 고지 중

| 위치 | 문구 | 실제 |
|---|---|---|
| `terms/page.tsx:70` | 모바일 청첩장, AI 대본 생성 | 테이블 8종 DROP (`20260704131000`) |
| `terms/page.tsx:80-86` (제6조) | 토스페이먼츠 결제·환불·5년 보관 | `@tosspayments` 의존성 0, 결제 라우트 0 |
| `terms/page.tsx:118` | AI 상호작용 5년 보관 | `redact_old_ai_interactions` **호출부 0건** = 사실상 무기한 |
| `terms/page.tsx:127` | 탈퇴 시 즉시 삭제 | `account_deletions`에 이메일·사유 보관 |
| `privacy/page.tsx:45` | 청첩장 정보(**계좌번호**) | `invitation_accounts` DROP. **계좌번호 수집 경로 0건** |
| `privacy/page.tsx:44` | 프로필 사진 | ⚠ 아래 |
| `privacy/page.tsx:141-144` | 이용 내역 확인 | 내보내기 기능 부재 |
| `privacy/page.tsx:153` | 관리자 접속 기록 보관 | 감사 로그 테이블 0건 |
| `ai-policy/page.tsx:61,71` | 대화 기록 언제든 삭제 | 삭제 UI 없음 |

### 고지에 없는데 실제로 수집 중 — **더 심각한 쪽**

휴대폰 번호(`profiles.phone`) · 예약 시 신랑·신부 이름·연락처 · 채팅 첨부 이미지·문서 · 견적 진단 입력값 ·
설문 응답 · 사전등록 · 탈퇴 이력 · AI 대화 요약 · AI 추론 커플 프로필 · 의사결정 기록 · 행동 이벤트 · 검색어 ·
**PostHog / Sentry / Cloudflare 위탁**

**반증에서 추가로 발견 (전수가 아니었다)**
- `api/chat/feedback/route.ts:95-107` — **`correction`(사용자 자유 서술) + `message_content`(AI 답변 원문 사본)**
- `api/community/cohort/[id]/contracts/route.ts:149-158` — **`vendor_name` + `base_price`/`extra_price` + `notes`(1000자)** = 실제 계약 금액·업체명·메모. **축의금보다 민감도가 높은데 고지 어디에도 없다**
- `api/messages/route.ts:42,77` — `vendor_messages` 본문
- `wedding_code_responses`, `vendor_leads`

### ⚠ 문구를 지우면 오히려 나빠지는 것 3건 (반증 RISKY)

1. **약관 제3조(통신판매중개자 지위)** — 전자상거래법 제20조 대응 **면책 고지**다.
   "중개하지 않는다"로 바꾸면, 실제로는 상담 예약 접수 + 신랑·신부 이름·연락처 업체 전달이라는 중개 행위가
   코드에 살아 있는 상태에서(`api/bookings/route.ts:119-122`) **면책만 사라진다** — 책임 범위를 넓히는 방향.
   → 삭제 대신 1항에 "현재 대금 수납·결제 중개를 하지 않으며 중개 범위는 정보 제공과 예약 접수에 한정" 추가.
2. **"관리자 접속 기록 보관" 삭제** — 개인정보 **안전성 확보조치 의무** 영역이다. 지우면 미이행을 문서로 확정하는 결과.
3. **"AI 로그 5년" → "90일"** — redact 호출부가 0건이라 현재 무기한. 90일로 고치면 **구현보다 강한 새 허위 고지**.

### ⚠ '프로필 사진' 삭제 금지 (반증 PARTIAL)

웹 UI는 이모지 6개만 제공하지만 **서버 계약은 이미지 URL을 명시 허용**한다:
`api/community/profile/route.ts:177` `isImageUrl = /^https?:\/\//i.test(...)`,
`:180` 에러 문구가 *"이모지 또는 **안전한 이미지 URL만** 사용할 수 있습니다"*.
동기방은 실제로 `<img src={m.avatar_url}>`로 렌더한다(`cohort/[id]/page.tsx:1165-1168`).
→ 삭제하면 **서버가 여전히 받는 항목이 미고지가 된다.**

### 사용자가 실제로 겪는 증상

> 약관은 있지도 않은 청첩장·결제 서비스를 제공한다고 하고, 정작 지금 수집 중인 휴대폰 번호·채팅 첨부 파일·동기방 계약 금액은 어디에도 적혀 있지 않다.

### 최소 변경안 — **4a / 4b로 쪼갤 것** (반증 권고)

**4a (사실 정정, 법률 자문 불요, 즉시)** — 삭제: 청첩장·AI 대본·토스페이먼츠 조항·계좌번호.
정정: 이용 내역 확인, 대화 기록 삭제 문구. 추가: 휴대폰·예약 연락처·채팅 첨부·견적 진단·설문·사전등록·PostHog/Sentry/Cloudflare 위탁·chat_feedback·cohort_contracts·vendor_messages.
**+ `.env.example:61-64`의 TOSS 키 슬롯 제거** (안 하면 "결제 안 한다"는 약관과 "결제 키 받는다"는 템플릿이 다시 어긋난다).

**4b (법적 포지션, 자문 블로킹)** — 제3조 재정의, 국외이전 조항 신설, 만14세, 파기 절차, AI 로그 보관기간 수치.

**범위 밖으로 뺄 것**: "웨딩 플래너 → 파트너" 라벨 교체. 수정안에 terms 2곳만 들어 있는데 **실제로는 18곳**이고
랜딩 h1·메타데이터는 여전히 '플래너'다. 별도 XS 스윕 티켓으로.

### 깨질 테스트: **0건** (순수 텍스트, terms/privacy 테스트 0건)

### 작업량: 4a **S** / 4b **M** (자문 리드타임 별도)

---

## 이슈 5. seed 라우트

### 확인된 사실 — seedGate 진리표

```ts
// lib/utils/adminAuth.ts:16-26
const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
if (isProd && process.env.ALLOW_SEED !== "true") return 403;
return null;
```

| 환경 | NODE_ENV | VERCEL_ENV | isProd | ALLOW_SEED 없을 때 |
|---|---|---|---|---|
| Vercel 프로덕션 | production | production | true | 차단 |
| **Vercel 프리뷰** | **production** | preview | **true** | **차단** |
| **로컬 `next dev`** | **development** | (없음) | **false** | **통과 ← 유일한 노출** |
| 로컬 build&start | production | (없음) | true | 차단 |

**⚠ 앞선 감사(`JOURNEY_CAPABILITY_AUDIT_2026-08-09.md`)의 "프리뷰·로컬에서 열려 있다"는 틀렸다.**
Vercel은 프리뷰에서도 `next build`를 돌리므로 `NODE_ENV=production`이다. 실제 노출은 **로컬 dev 하나.**

### 위험 크기를 결정하는 사실

```
apps/web/.env.local:2   NEXT_PUBLIC_SUPABASE_URL=https://slrtobkksjmxgzatjyqb.supabase.co   ← 운영 프로젝트
apps/web/package.json:6 "dev": "npx next dev"                                              → NODE_ENV=development
apps/web/vercel.json    env 블록 없음                                                       (프리뷰 전용 DB 장치 부재)
```

→ **로컬 개발 서버가 운영 Supabase에 직결돼 있고, 그 환경에서만 게이트가 열려 있다.**

### 삽입 규모 (독립 재계산으로 검증됨)

**업체 77곳 / 상품 245개 / 타임슬롯 6,867행**, 전부 `status:'approved'` · `owner_id: null`, **멱등성 없음(재실행 시 중복 누적)**.
실존 브랜드명 사용 확인(예: Vera Wang).

`20260705090000_hide_seed_vendors.sql:16`은 **1회성 UPDATE**라 이후 INSERT에는 무효.

### 사용자가 실제로 겪는 증상

> 관리자 세션 하나로 로컬에서 `/api/admin/seed-*`를 호출하면 창작 업체 77곳이 운영 DB에 승인 상태로 들어가, 예비부부가 실존하지 않는 업체를 실제 업체로 보고 예약을 시도한다.

### 최소 변경안 (XS) — (a)+(c), 총 6줄

| 파일 | 변경 |
|---|---|
| `lib/utils/adminAuth.ts` | `isProd` 계산 삭제, `if (process.env.ALLOW_SEED !== "true") return 403;`로 반전 (**환경 무관 기본 차단**) |
| `api/admin/seed-venues/route.ts:136` | `status:"approved"` → `"pending"` |
| `api/admin/seed-studios/route.ts:212` | 동일 |
| `api/admin/seed-makeup/route.ts:**211**` | 동일 — ⚠ **210행이 아니다**(210은 `ai_recommend: true`). 문자열 매칭으로 특정할 것 |
| `api/admin/seed-vendors/route.ts:267` | 동일 |
| `.env.example` | ALLOW_SEED 주석 3줄. ⚠ **`turbo.json:52, :129`에 ALLOW_SEED가 이미 선언되어 있다**(수정안의 "없다"는 사실오류) |

**⚠ PUT 핸들러는 건드리지 마라 (반증 RISKY)**
POST가 pending을 넣는데 PUT은 `.eq("status","approved")`로 잡으므로 **영구 0건 매칭**이 된다.
거기에 `.is("owner_id", null)`까지 더하면 교집합이 확실히 공집합. **"고쳐진 것처럼 보이는 죽은 코드".**
→ 선택지: ① PUT 핸들러 삭제(호출자 0개, 약 110줄) 또는 ② 이번 범위 제외.

**⚠ (a) 단독은 실질 방어가 아니다** — `.env.local`에 `ALLOW_SEED=true` 한 줄이면 원복된다.
같은 XS 범위에서 한 줄 더 권장:
```ts
if (process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("slrtobkksjmxgzatjyqb")) return 403;  // 운영 DB면 무조건 차단
```

**별건 티켓 (필수)**: `.env.local`을 스테이징 프로젝트로 전환. 운영 ref는 배포 환경변수로만 주입.
게이트 반전은 문 하나에 자물쇠를 더한 것이고, **로컬이 운영 DB에 직결된 구조는 88개 API 라우트 전부에 해당한다.**

### 오염 확인 SQL (읽기 전용)

```sql
-- 1. 시드 의심 업체 분포
SELECT status, COUNT(*) FROM vendors WHERE owner_id IS NULL GROUP BY status;

-- 2. 연쇄 자식 행
SELECT 'products' t, COUNT(*) FROM vendor_products p JOIN vendors v ON v.id=p.vendor_id WHERE v.owner_id IS NULL
UNION ALL SELECT 'timeslots', COUNT(*) FROM vendor_timeslots ts JOIN vendors v ON v.id=ts.vendor_id WHERE v.owner_id IS NULL
UNION ALL SELECT 'staff', COUNT(*) FROM vendor_staff s JOIN vendors v ON v.id=s.vendor_id WHERE v.owner_id IS NULL;

-- 3. ⚠ 삭제 전 필수 — 실사용 데이터가 물려 있는가
SELECT 'bookings' t, COUNT(*) FROM vendor_bookings b JOIN vendors v ON v.id=b.vendor_id WHERE v.owner_id IS NULL
UNION ALL SELECT 'favorites', COUNT(*) FROM vendor_favorites f JOIN vendors v ON v.id=f.vendor_id WHERE v.owner_id IS NULL
UNION ALL SELECT 'reviews', COUNT(*) FROM vendor_reviews r JOIN vendors v ON v.id=r.vendor_id WHERE v.owner_id IS NULL;
```
**3번이 0이 아니면 단순 삭제는 위험하다.**

### 후속 DB 방어 (별도 사이클, 게이트 필요)

```sql
ALTER TABLE vendors ADD CONSTRAINT no_approved_without_owner
  CHECK (NOT (status = 'approved' AND owner_id IS NULL));
```
⚠ 도입 시 `20260514000000_demo_vendor_seed.sql`·`20260514010000_demo_vendor_full_set.sql` 두 데모 마이그레이션이
같은 배치에서 무력화되어야 한다(안 그러면 신규 환경 재생 실패).

### 깨질 테스트: **0건** (seedGate 테스트 0건). 단 **테스트 추가 비용이 5건 중 가장 싸다(순수 함수, XS)**

### 작업량: **XS**

---

## 수정 순서 — 의존관계 기준

```
R0  이슈5 (XS)          ← 즉시, 단독. 전제: Vercel ALLOW_SEED 부재 확인
     ↓
R1  이슈2 최소 2건 (XS) ← 독립. 파일 충돌 0
     ↓
R2  이슈1 (S)           ← ⛔ 방향 재판정 후. 커밋 분리: 파일생성+테스트 → 값통일 → 폴백사다리
     ↓
R3  이슈4a (S)          ← 이슈5 확정 후 (아래 강제 의존)
     ↓
R4  이슈3 (S)           ← 이슈4a 후 (아래 강제 의존)
     ↓
R5  이슈4b (M) / 이슈2 전체개선 (M)   ← 자문·별도 사이클
```

**파일 충돌 0건. DB 마이그레이션 0건. 배포 순서 제약 0건. 롤백은 코드 되돌리기로 끝난다.**

### 강제 선후관계 3건 (역순 시 실제로 깨짐)

| 순서 | 이유 |
|---|---|
| **5 → 4** | 이슈4는 "approved 업체 0건이라 실질 중개가 없다"는 사실 위에서 약관 제3조를 축소한다. 5를 안 잠근 채 4를 랜딩하면 **시드 1회로 창작 업체 77곳이 부활하는 순간 새로 고친 약관이 반대 방향으로 거짓이 된다.** |
| **4 → 3** | 이슈3은 케어 발화(Resend 이메일) 대상을 늘리는 변경인데, **'일정 기반 안부·알림 발송' 목적 고지가 아직 처리방침에 없다.** 고지 없이 발송 표면을 넓히면 미고지 처리 항목이 하나 더 는다. |
| **5(a) → 5(c)** | 게이트 반전을 status 변경보다 먼저. 역순이면 게이트가 열린 채로 status만 바뀌어 **"오염은 계속되는데 눈에 안 보이는"** 최악의 조합. |

### 이슈 내부 — 반드시 같은 커밋

- **이슈3**: EventFormModal ④(edit 모드 복원) + ⑤(제출) — ⑤만 넣으면 기존 태그가 사라진다
- **이슈5**: status→pending + PUT 처리 — 둘이 서로를 무효화한다
- **이슈1**: 폴백 사다리 + spent의 normalizeCost 통일 — 한쪽만 하면 지금보다 나빠진다
- **이슈2 전체개선**: route.ts 직렬화 → 리마인더 조건 → prompts.ts 조항 (역순이면 지킬 수 없는 공약)

### 반드시 별도 커밋

**이슈1의 폴백 사다리 교체**를 값 통일과 같은 커밋에 넣지 마라.
두 변경이 동시에 들어가면 사용자가 보는 숫자가 **두 가지 이유로 동시에 바뀌어** 클레임 원인 분리가 불가능해진다.

### 피해 성격 재분류 (반증 권고)

| 분류 | 이슈 |
|---|---|
| **오늘 실현 중인 피해** | **이슈1 하나뿐** (빈도 높음, 예산 대화마다) |
| 잠재·조건부 피해 | 이슈2(예약 0건이라 현재 노출 0) · 이슈5(approved 0건) |
| 기능 부재 | 이슈3 (틀린 정보가 아니라 없는 기능) |
| 출시 게이트 | 이슈4 (사용자 피해가 아니라 기관 리스크) |

이슈2·5는 XS라 어차피 먼저 나가지만, **"지금 당장 사용자가 다치고 있다"로 과장하지 말 것.**

---

## 테스트 커버리지 현황

| 지점 | 테스트 |
|---|---|
| `src/components/**` 전체 | **0건** (저장소에 컴포넌트 테스트가 하나도 없다) |
| terms / privacy / ai-policy | 0건 |
| seedGate | 0건 |
| `api/chat/route.ts` | 0건 |
| `executeRecommendVendors` | 0건 |
| 비율에서 파생된 참고치 금액 | 0건 |

**테스트 추가 우선순위 (커버리지 대비 위험)**
1. 이슈3 배선 end-to-end (`utils/scheduleEvents.ts` + `momentLoop` 순수 함수 조합) — **XS**
2. `seedGate()` 진리표 — **XS** (env만 읽는 순수 함수, 투자 효율 최고)
3. quoteMarketTools 미발견 분기 + cancel_booking UUID/not_found — **XS**
4. `success===true && displayMessage.trim()===""` 조합 금지 전역 테스트 — **S**
5. 법적 고지 문자열 잠금 (`prompts.test.ts` 방식) — **XS**

**테스트로 못 잡는 것**: BudgetContent·ActionCard의 비율 값, EventFormModal edit 모드 momentType 보존,
법적 고지와 구현의 어긋남 — 셋 다 수동 확인이 유일한 수단이다.

---

## 미확인

| 항목 | 왜 |
|---|---|
| Vercel 환경변수 `ALLOW_SEED` | 저장소로 확인 불가. **이슈5 착수 전 필수** |
| 운영 DB의 `vendors.status` 실제 분포 | 읽기 전용 감사 |
| `vendorTools`의 `housing: 0.20` 의도 | 무설명 스쿼시 커밋 `f9a4c18a0`. 의도인지 오타인지 판정 불가 |
| `ai-policy:53` "사람의 감독 체계" 실체 | 상시 감독 체계 확인 불가 |
| `.codex-integration-20260806`의 병합 예정 시점 | 이슈1 방향 결정에 필요 |

## 이 조사에서 발견된 줄번호 오류 (편집 시 주의)

`seed-makeup` 210→**211** · `hide_seed_vendors.sql` :19→**:16**, :6→**:4** ·
`database.types.ts` momentType 부재 주장→**:99에 실재** · `toolExecutor` 인용 다수 2~3행 드리프트 ·
`vendor_portal_system.sql` :44-53→**:43-52** · `demo_vendor_seed.sql` :19-43→**:17-40**

**→ 편집은 줄번호가 아니라 문자열 매칭으로 대상을 특정하라.**
