# A. 통합 브랜치 예산 화면 / B. 도구 결과 전달 계층

> 2026-08-09 조사. **코드 수정 없음.** 9개 에이전트, 도구 호출 336회.
> ⚠ **이 조사 중 운영 Supabase(`slrtobkksjmxgzatjyqb`)에 읽기 전용 조회가 실행됐다.**
> `pg_proc` / `pg_roles` / `pg_trigger` 조회, 행 수 집계, 존재하지 않는 UUID로 RPC 1회 호출(0행 매칭 no-op).
> 쓰기는 없었다. 이전 리포트들이 "DB 미조회"라고 한 것과 달리 이번엔 실측이 포함됐다.

---

# ⛔ 최우선 — 감사 대상 브랜치가 운영이 아니다

직접 확인한 값이다.

```
$ git rev-list --left-right --count origin/main...HEAD
332     6                                    ← feat/ux-polish-journey-audit 는 main보다 332커밋 뒤

$ git show origin/main:apps/web/src/app/api/chat/route.ts | wc -l
3879                                         ← 감사 브랜치는 1,144줄

$ git ls-tree origin/main apps/web/src/lib/ai/ --name-only | grep -i "claude\|openai"
apps/web/src/lib/ai/auditedOpenAI.ts
apps/web/src/lib/ai/openai.ts                ← claude.ts 는 origin/main 에 없다
```

| | 감사 브랜치 `feat/ux-polish-journey-audit` | 운영 `origin/main` |
|---|---|---|
| AI 제공자 | Anthropic (`@anthropic-ai/sdk`) | **OpenAI Responses API** |
| tool_result 빌더 | `claude.ts` → `buildToolResultContent(id, result)` | `openai.ts` → `buildToolResultInput(callId, result)` → `{type:"function_call_output", call_id, output}` |
| `api/chat/route.ts` | 1,144줄 | 3,879줄 |
| `is_error` 사용 가능 | 가능(SDK가 지원, 안 씀) | **불가능** — OpenAI `function_call_output` 에 그런 필드가 없다 |

**결과: B의 수정 처방 2곳(`claude.ts` `buildToolResultContent`, `route.ts` 직렬화 줄)은 운영에 존재하지 않는 파일·줄을 가리킨다.**

그리고 방향이 뒤집혔다 — 루트 `CLAUDE.md` 가 "OpenAI Responses API"라고 적은 것은 **틀린 게 아니라 main을 정확히 기술한 것**이고, 낡은 것은 브랜치다. 이번 세션의 이전 리포트들(`JOURNEY_CAPABILITY_AUDIT`, `CONTRADICTION_FORENSICS`)도 전부 이 브랜치 기준이므로 **운영 실태와 다를 수 있다.**

**운영에는 이미 실패 신호의 씨앗이 있다.** `lib/ai/placeSearchResultPolicy.ts` 의 `getModelSafeToolOutput(result)` 가
`search_nearby_places` 한 도구에 대해 `{ success: result.success, status: result.success ? "rendered_in_client" : "unavailable" }` 를 모델 페이로드로 만든다.
→ 운영 기준으로 **"모델은 success 를 절대 볼 수 없다"는 한 도구에 대해 명시적으로 거짓**이다.
→ 확산 대상으로는 `is_error` 보다 이 `status: "unavailable"` 패턴이 현실적이다.

---

# A. 통합 브랜치 예산 화면 — 판정: 🔴 EMPTY_REGRESSION

**A-4 먼저**: `.codex-integration-20260806` 은 브랜치 `deploy-trigger`, HEAD `840629c2`, **워킹트리 clean, `origin/main` 과 0/0 완전 동기**.
PR #93(`merge/amora-to-main-20260808`)·#95가 이미 병합됐다. **"병합 예정"이 아니라 병합·푸시 완료된 main 스냅샷**이다.

**A-1. 아무 금액도 입력 안 한 상태에서 렌더되는 것** — 0원도 빈칸도 아니고 **명시적 안내 문구**다.

```
getCategoryBudget: progress[key].budget 없으면 → return 0  (비율 곱셈 없음)
InlineMoneyEdit:   {value > 0 || !emptyLabel ? formatWon(value) : emptyLabel}  → "미입력"
진행바:            {budget > 0 ? "예산 사용률" : "예산 입력 전"}
총예산 미입력:      "연필 버튼을 눌러 총 예산을 입력해주세요" / 잔액 "계산 전"
근거 문구:          "직접 입력하거나 계약 금액으로 확인된 예산만 합산합니다."
유일한 근거 유입구:  href="/price" 링크 카드 — 숫자는 없고 CTA뿐
```

**A-2. `executeGetBudgetSummary`** — `allocated` 가 **입력값 아니면 `null`**(0도 아님).
`allocated_is_estimate` 는 사라지고 반대 방향 플래그 `allocated_is_set` + `legacy_amount_unclassified` 가 들어갔다.
주석 원문: *"미입력 예산이나 상태를 근거로 금액을 추정하지 않는다."*

**A-3. 공시 실데이터 참조 — 없다. 파일 자체가 삭제됐다.**
`marketPricesData.generated.ts` 는 커밋 `cb1d5404 "feat(web): add evidence-backed vendor price discovery"` 에서 **삭제**됐다.
남은 `constants/marketPrices.ts` 는 껍데기다 — `getCategoryMarketPrice()` 가 **항상 `null`** 을 반환한다.
소비자는 단 1곳(`prompts.ts` 의 `getMarketPriceContext`)이고 그것도 숫자 대신 *"소스 코드에 고정된 과거 시세 숫자를 사용하지 않습니다"* 라는 텍스트를 반환한다.
**예산 화면·예산 도구는 새 공시 파이프라인(`/price`)의 숫자를 한 톨도 읽지 않는다.**

## 판정

추정을 지운 자리에 **근거 있는 숫자는 들어가지 않았다.** 다만 "화면이 비었다"는 절반만 맞다.

- **얻은 것**: 정직성. 0원으로 위장하지 않고 "미입력"/"예산 입력 전"/"계산 전"을 명시하고 근거 문구와 `/price` CTA가 있다.
- **잃은 것**: **콜드스타트에 자동으로 채워지던 숫자.** 첫 진입 시 채워진 값이 0개다. 아모라가 대신 채워주지 않으면 빈 표를 수기로 채워야 한다. **UX 후퇴 맞고 별도 대응이 필요하다.**

**대응 방향**: `/price` 공시 데이터를 예산 카테고리에 **입력값이 아닌 참고치로만** 붙이기
(예: "미입력" 옆에 "공시 중위가 OOO만원(기준일 X) 보기" 보조 라벨). `allocated` 로 승격하면 안 된다.
`budgetReliability.test.ts` 의 금지 정규식(`/\bratio:\s*0\.\d+/`, `not.toContain("CATEGORY_RATIOS")`)에 걸리지 않으므로 테스트 수정 없이 가능.
**작업량 M** — 공시 조회 경로(DB 뷰) 배선 + 예산 카테고리 ↔ 공시 카테고리 매핑이 아직 없다.

**⚠ `budgetReliability.test.ts` 는 전부 소스 문자열 정규식 검사다**(런타임 렌더 검사 아님).
"빈 화면이면 안 된다"는 것은 **하나도 강제하지 않는다.** 이 테스트가 초록이라는 사실만 보고 "신뢰 경계 확보 완료"로 읽으면 UX 공백을 못 본다.

**⚠ 역방향 회귀 위험**: 감사 브랜치에는 이 정직성 수정이 **없다**(`CATEGORY_RATIOS` 8개 파일에 그대로, `marketPricesData.generated.ts` 존재).
→ **이 브랜치를 main에 병합하면 정직성 수정이 되돌아간다.** 병합 전 `budgetReliability.test.ts` 통과 여부 확인 필수(XS). 되돌림 시 복구 M.

---

# B. 도구 결과 전달 계층

## 요약 — 3단계, 순서, 위험

| 단계 | 목표 | 작업량 | 깨질 테스트 | 상태 |
|---|---|---|---|---|
| **1단계** | toolOutput 에 실패를 실음 (`cancelled:false`, `error`) | XS | **0건** | ✅ 착수 가능 (+XS 2건 동봉) |
| **2단계** | 직렬화가 실패를 물리적으로 전달 + 리마인더 조건 축소 | S | **0건** | ✅ 착수 가능 (+prompts.ts 1줄 필수) |
| **3단계** | progressTools 폴백 rowcount 검증 | S | 0~2건 | ⛔ 결정 3건 선행 |

**순서는 1 → 2 → 3 고정.** 역순 불가 근거가 코드에 있다 —
2단계의 `buildToolResultContent(..., { isError: !execResult.success })` 는 1단계가 `success:false` 를 만들어주지 않으면 항상 `false` 로 계산된다.

**위험 판정**
- 1·2단계: 롤백 완전 가능, DB 상태 안 남음, 사용자 카드 렌더 불변
- 3단계: **오탐 0%. 새로 뜨는 실패는 100% 진짜 실패.** 단 발생 건수도 현재 ≈ 0

## B-1. 전달 경로 (감사 브랜치 기준 — 운영은 다름)

```
toolExecutor.executeTool()
  → { toolName, toolInput, toolOutput, success, displayMessage }
route.ts  execResult = await executeTool(...)
route.ts  send({ type:"tool_result", result: execResult })      ← 전체가 SSE로 UI에만
route.ts  toolResults.push(execResult)                          ← chat_messages.metadata 에 저장
route.ts  const outputJson = JSON.stringify(execResult.toolOutput);   ← toolOutput 만
route.ts  const reminder = UI_RENDERED_TOOLS.has(toolUse.name)
            ? "[SYSTEM: 이 결과는 프론트엔드에서 인터랙티브 카드/버튼으로 자동 표시됩니다. …
               간단한 안내 1~2문장만 작성하세요.]" : ""
route.ts  buildToolResultContent(toolUse.id, outputJson + reminder)
claude.ts return { type:"tool_result", tool_use_id, content }   ← is_error 없음
```

| 필드 | 소비처 | 모델 도달 |
|---|---|---|
| `success` | SSE(UI) + `chat_messages.metadata` | **❌ 절대 안 감** |
| `displayMessage` | SSE(UI) + metadata | **❌ 절대 안 감** |
| `toolOutput` | SSE + metadata + **직렬화** | ✅ 감 |
| `toolOutput.hidden` | `VendorToolCard` 의 `if (hiddenOutput?.hidden) return null;` | ✅ 감 (toolOutput 내부라) |

**⚠ 내 이전 진술 정정**: "모델은 실패를 알 수 없다"는 과장이었다.
`cancel_booking` 실패 시 모델은 `{"hidden":true,"reason":"invalid_booking_id"}` 를 받는다 — `reason` 에서 추론할 여지가 있다.
반면 `get_market_price` 미발견은 `{}` 라 **신호가 진짜 0비트**다.
⇒ **1단계(toolOutput 에 싣기)가 2단계 없이도 효과가 있다.**

**리마인더가 예상보다 나쁘다**: `UI_RENDERED_TOOLS` 소속이면 **성공/실패 무관하게** 붙고, 내용이 *"카드로 자동 표시됩니다"*(실패 시 거짓) + *"1~2문장만"*(실패 사유 설명을 예산 밖으로 밀어냄)이다.

**경로 변형**: 스트리밍 단일 경로. 직렬화 지점은 route.ts 전체에서 **정확히 1회**.

## B-2. 실패가 도달하지 않는 지점

**progressTools 폴백 — 영향 도구 정본 13개** (반증에서 3개 추가됨)

| 파일 | 도구 |
|---|---|
| `toolExecutor.ts` | update_task_status, update_category_budget, apply_budget_plan, add_custom_category, delete_category(2경로), reset_category |
| `scheduleTools.ts` | add_schedule_event, update_schedule_event, delete_schedule_event, toggle_checklist_item, log_wedding_event |
| `amoraActionTools.ts` | add_amora_action, update_amora_action |

**실측 호출 빈도** (`ai_interactions_log.metadata.tools_used` 누적):
reset_category 146 / update_category_budget 29 / update_task_status 20 / apply_budget_plan 14 / add_amora_action 14 / … **합계 242 / 전체 447 = 54%**.
**단일 함수 하나가 도구 트래픽의 절반을 쥐고 있다.** 이것이 3단계를 "가장 위험한 변경"으로 만드는 진짜 이유다.

**⚠ 결함 범위가 폴백 전용이 아니다** (반증 발견)
`executeUpdateBudget` · `executeUpdateWeddingDate` · `executeUpdateVenue` 3개는 RPC와 무관하게
`.update({...}).eq("couple_id", ...)` 뒤에 `if (error) throw error;` 만 있고 `.select()` 가 없다.
**폴백을 고쳐도 이 셋은 그대로 남는다.** → 문제를 "쓰기 도구 전반의 rowcount 미검증"으로 재정의할 것(16곳, S).

**⚠ 근본 원인은 rowcount가 아니라 에러 오분류**
폴백 진입 조건이 `if (!error && data)` 의 부정이라, RPC가 `P0002 "wedding_journeys row not found"` 로
**실패를 정확히 소리쳤을 때** 코드가 그걸 "RPC 미배포"로 오독해 폴백하고, 폴백도 0행이라 조용히 성공한다.
**실패를 알리도록 설계된 가드가 폴백 때문에 침묵으로 변환되는 구조다.**

## B-3. 3단계 수정안

### 1단계 (XS) — toolOutput 에 실패를 실음

범위: SILENT_SUCCESS 4건 중 **3건만**. `get_amora_actions` 는 제외 — 그건 `isAmoraActionStorageUnavailable` 로
'테이블 미배포(의도된 폴백)'와 '진짜 실패'를 이미 구분하고 있어 성격이 다르다(별 PR).

| 파일 | anchor (문자열 매칭) | 변경 |
|---|---|---|
| `bookingTools.ts` | `toolOutput: { hidden: true, reason: "invalid_booking_id" },` | `cancelled: false` 추가, 다음 줄 `success: true,`→`false`, `displayMessage: "",` 채움 |
| `bookingTools.ts` | `toolOutput: { hidden: true, reason: "not_found_or_unauthorized" },` | 동일. **displayMessage 는 '없음'과 '권한 없음'을 구분하지 말 것** — 구분하면 예약 ID 프로빙 오라클이 된다 |
| `quoteMarketTools.ts` | `displayMessage = "지원하지 않는 카테고리입니다.";` | 같은 블록에 `toolOutput = { error: "unsupported_category", category };` |
| `quoteMarketTools.ts` | `displayMessage: displayMessage \|\| "시세 정보를 조회했습니다.",` | 위의 `success: true,` 를 실패 판정으로 교체 |

**⚠ `success: true,` 문자열로 찾지 마라.** 이 파일에 3곳이 있고 나머지 2곳은 `analyze_quote` 인데
**둘 다 의도된 true 이며 기존 테스트가 잠그고 있다.** 반드시 `toolName: "get_market_price",` 를 포함한 리턴 블록으로 특정할 것.

**반증에서 추가된 필수 2건 (같은 커밋)**
1. `ActionCard.tsx` 의 `function getTitle(toolName: string)` 에 `case "get_market_price": return "시세 조회";` 추가.
   없으면 default `"작업 완료"` 로 떨어져 **「작업 완료 ✕ / 지원하지 않는 카테고리입니다」** 라는 자기모순 카드가 뜬다. `getIcon` 도 동일.
2. 실패 판정을 빈 배열까지 포함하도록 확장 —
   `sdm`/`studio`/`options`/`seasonal` 은 배열이 비어도 `{packages: []}` 로 키를 채워 `Object.keys().length === 1` 이라 통과한다.
   → `Object.values(toolOutput).every(v => v == null || (Array.isArray(v) && v.length === 0))` 추가.

- **깨질 테스트: 0건** (실측 — 관련 3파일 14케이스 전부 그린, 16.12s)
- **사용자 변화**: cancel_booking 은 화면 불변(hidden 유지). get_market_price 만 초록 체크 → 빨간 X + 사유
- **롤백**: 완전 복구. DB 상태 없음
- **같은 커밋**: `toolOutput` 변경과 같은 리터럴 안의 `success` 플립은 **절대 나눌 수 없다**

### 2단계 (S) — 배관이 실패를 물리적으로 전달

**설계 결정: payload 를 본체로, `is_error` 는 추가로. 둘 다.**
- `is_error` 는 1비트. 지금 공백은 1비트가 아니라 **의미**다. `is_error` 만 켜면 모델은 '실패는 아는데 왜인지 모르는' 상태가 되어 같은 도구 반복 호출 루프를 못 막는다
- `is_error` 는 요청 본문에만 존재하고 **어디에도 저장되지 않아 사후 감사 불가**. payload 는 metadata 에 남는다
- Anthropic 공식 권고 자체가 *"set `is_error: true` **and** provide an informative error message"* — 양자택일이 아니다
- **⚠ 단 운영(OpenAI)에는 `is_error` 가 없다.** 운영 적용 시엔 payload 만 유효

**payload 모양 — 비대칭 병합** (성공 시 지금과 바이트 단위 동일 → 성공 대화 재검증 불필요)
```
실패 → { ok: false, ...execResult.toolOutput, failure_message: execResult.displayMessage }
```
키 충돌 확인: `lib/ai` 전체에 `ok` / `failure_message` 키 0건.

| 파일 | anchor | 변경 |
|---|---|---|
| `claude.ts` | `export function buildToolResultContent(` | 3번째 인자 `options?: { isError?: boolean }`, 리턴에 `...(options?.isError ? { is_error: true } : {})` |
| `route.ts` | `const outputJson = JSON.stringify(execResult.toolOutput);` | 비대칭 병합으로 교체 |
| `route.ts` | `const reminder = UI_RENDERED_TOOLS.has(toolUse.name)` | 조건에 `&& execResult.success` 추가 |
| `route.ts` | `toolResultContents.push(buildToolResultContent(toolUse.id, outputJson + reminder));` | `, { isError: !execResult.success }` 추가 |
| **`prompts.ts`** | `## 도구 사용 핵심 규칙` | **반증에서 추가된 필수 항목** ↓ |

**⚠ `is_error` 는 prompts.ts 의 재시도 금지 조항과 정면 충돌한다** (반증 RISKY)
`is_error` 의 문서화된 모델 반응은 *"다른 접근을 시도한다"* 인데, prompts.ts 는 정확히 그것을 금지한다 —
`가능한 슬롯이 전날/다음날에 있어도 자동 변경 금지`, `한 사용자 발화당 cancel_booking 은 최대 한 번만`, `이미 취소한 예약은 같은 세션 동안 재호출 금지`.
2단계는 (a) 길이 압박 제거 (b) is_error 라벨 두 가지로 **동시에 재시도 쪽을 민다.**
→ **같은 릴리스에 한 줄 추가 필수**: *"도구가 실패를 반환하면 같은 도구를 자동 재시도하지 말고, 실패 사유를 사용자에게 말한 뒤 어떻게 할지 물어보세요."*

**⚠ 테스트 함정**: `vitest.config.ts` 가 `environment: "jsdom"` 전역이고,
`claude.ts` 는 모듈 최상단에서 `new Anthropic(...)` 을 실행하는데 SDK 생성자가 브라우저 환경이면 **무조건 throw** 한다.
→ `buildToolResultContent` 단위 테스트 파일 최상단에 **`// @vitest-environment node`** 필수.
현재 claude.ts 를 임포트하는 테스트가 0건이라 아무도 이 지뢰를 밟은 적이 없다.

- **깨질 테스트: 0건.** `api/chat/__tests__/` 디렉토리 자체가 없고 route.ts 를 임포트하는 테스트 0건
- **부작용 4개 각도 전부 무해 확인** (추측 아님, 코드 실측): 캐시(`cache_control` 은 system·tools 에만, messages 에 없음) / 과거 대화(히스토리를 `{role,content}` 평문으로만 재구성, tool_result 복원 안 함) / summarize·amora-profile·extract-decision(toolResults 참조 0건) / 모바일(참조 0건)
- **사용자 변화**: 카드 불변. **아모라의 말**이 변한다. 실패 턴 응답이 길어진다(의도된 변화)
- **같은 커밋**: route.ts 세 줄 + claude.ts 옵션 인자 + prompts.ts 한 줄. 직렬화만 바꾸고 리마인더를 안 좁히면 `{"ok":false,…}` 뒤에 "카드로 표시됩니다" 거짓 단언이 붙어 **지금보다 나쁜 중간 상태**가 된다

### 3단계 (S) — progressTools rowcount 검증

**⛔ 결정 3건 선행 필요. 아래 "선행 결정" 절 참조.**

**핵심 질문 답: 오탐 0%. 새로 뜨는 실패는 100% 진짜 실패다.**

0행 원인 후보 5개를 전부 배제했다.

| 후보 | 판정 |
|---|---|
| 값이 이미 같아서 0행 | ❌ 아니다. Postgres UPDATE 는 WHERE 매칭 행을 반환하며 동일값이어도 `UPDATE 1`. 동일값 스킵 최적화는 없다. 유일한 반례인 BEFORE ROW 트리거 `RETURN NULL` 도 배제 — 라이브 `pg_trigger` 조회 결과 비내부 트리거 2개 모두 RETURN NULL 경로 없음 |
| `.select()` + SELECT RLS 로 0행 | ❌ 발생 불가. 클라이언트가 **service_role** 이고 라이브 실측 `rolbypassrls=true`, `relforcerowsecurity=false`, `journeys_service_role_all FOR ALL TO service_role USING(true)` 정책 존재 |
| 대상 행 부재 | ✅ **진짜 실패. 유일한 실질 원인** |
| RLS 차단 | ✅ 진짜 실패. 단 env 오설정 시에만 |
| 조건 불일치 | ❌ route.ts 403 게이트 통과값이라 불가 |

**발생 건수 예측 ≈ 0** (라이브 실측)
- **RPC 는 배포돼 있다** — `pg_proc` 에 `apply_journey_progress_patch` 존재, `has_function_privilege('service_role','EXECUTE')=true`, PostgREST 실호출로 `P0002` 정상 예외 확인. **폴백은 상시 경로가 아니다**
- couples 55 / wedding_journeys 50 / **journey 없는 커플 5개** — 전부 2026-02-19 생성, **연결된 profiles 0개, chat_messages 0건** → 403 게이트를 통과할 사용자가 존재하지 않는다
- 트래픽: 누적 1,640턴 / 최근 30일 176턴 / **최근 7일 24턴** / 30일 활성 커플 5쌍

**⚠ 진짜로 남는 위험은 재생성기다**
`api/onboarding/route.ts` 의 journey insert 가 실패해도 `console.error` 만 찍고 **온보딩은 성공으로 계속 진행한다.**
한 번 실패하면 사용자는 "온보딩 완료" 상태로 커플에 연결되고 이후 모든 progress 쓰기가 세션 내내 거짓 성공한다.
**3단계는 증상 노출이지 치료가 아니다.** 근본 치료는 이 insert 실패를 온보딩 실패로 승격하거나 journey lazy-create.

**구현 (문자열 매칭)**

| anchor | 변경 |
|---|---|
| `const { data, error } = await admin.rpc("apply_journey_progress_patch", {` 직후 `if (!error && data) {` | **에러 분류 추가** — 폴백은 함수 미배포(`PGRST202`/`42883`)일 때만. P0002 는 즉시 throw. **이게 근본 치료** |
| `const { error: fallbackError } = await admin` | `.select("couple_id")` 추가 + `count === 0` 이면 throw |
| throw 메시지 | `JOURNEY_PROGRESS_NOT_APPLIED` 같은 **무식별 상수 코드**. couple_id·SQL 원문 금지 — `executeTool` catch 가 `toolOutput: { error: String(err) }` 로 감싸 **모델 컨텍스트와 chat_messages.metadata 에 영구 저장**한다 |

**⚠ `count !== 1` 로 쓰지 마라.** `couple_id` 에 UNIQUE 제약이 없다(인덱스만). 중복 시 rowcount 2 를 실패로 판정하면 그게 자작 오탐이다. **`count === 0`** 으로.

**⚠ `.select("couple_id")` 를 쓰고 `{count:"exact"}` 는 버려라** (반증 RISKY — 가장 중요한 지적)
계획이 자기 안에서 두 구현을 동시에 권했는데, 테스트 픽스처 `FakeQuery` 의 `update(payload)` 는 인자 1개만 받고 `count` 필드를 만들지 않는다.
→ `{count:"exact"}` + `count === 0` 으로 구현하면 테스트에서 `undefined === 0` → false → **새 가드가 한 번도 실행되지 않은 채 통과한다.**
이건 `MEMORY.md` 에 기록된 *"내가 만든 안전장치의 테스트를 내가 써서 재현율 0%도 초록불"* 패턴과 정확히 같은 형태다.
→ **구현 후 일부러 가드를 깨뜨려 테스트가 빨개지는지 확인하는 절차를 반드시 넣을 것.**

**⚠ 3단계가 효과 없는 도구 2개** (반증 REFUTED — 13개 예측이 틀렸다)
`add_amora_action` / `update_amora_action` 은 `mirrorAmoraActionToProgress` 가 `saveProgress` 를 try/catch 로 감싸고
`console.warn` 만 찍어 **3단계가 던지는 throw 를 그 자리에서 삼킨다.** 그 뒤 조건 없이 `success:true` 를 리턴한다.
→ 목록을 **11개로 정정**하거나 mirror catch 를 함께 손볼 것(후자는 별 PR).

**⚠ `apply_budget_plan` 부분 쓰기** (반증 RISKY)
순서가 ① `total_budget` UPDATE(이것도 rowcount 미검증) → ② 인메모리 `ctx.weddingContext.budget` 갱신 → ③ `patchJourneyProgress` 다.
③에서 throw 하면 전체 실패로 보고되는데 ②는 이미 반영돼 있어 **같은 턴의 후속 도구가 저장되지 않은 예산을 사실로 읽는다.**
→ ①에도 같은 검증을 **같은 커밋**에 넣어 먼저 실패시킬 것.

**⚠ 파괴적 확인 뒤의 무정보 실패** (반증 RISKY)
`delete_category`/`reset_category`/`delete_schedule_event` 는 확인 게이트를 **통과한 뒤** 실패한다.
사용자는 "네, 삭제해주세요"라고 답했는데 돌아오는 건 **"처리 중 오류가 발생했습니다."** 뿐이다.
게다가 `String(err)` 는 postgrest 에러 객체에 대해 **`"[object Object]"`** 를 만든다 →
모델이 받는 payload 는 `{"ok":false,"error":"[object Object]","failure_message":"처리 중 오류가 발생했습니다."}` = **2단계의 이득이 3단계 실패에서는 발현되지 않는다.**
→ 최소한 `err instanceof Error ? err.message : "unknown_error"` 로 바꾸는 것을 3단계 임계경로로 승격할 것(XS).

**참고**: 계획이 "필수 조건"이라 못박은 *DB 에러 원문 유출* 은 **실재하지 않는다**(반증 REFUTED).
postgrest-js 2.103.0 은 에러를 평범한 객체로 만들고 `String(err)` 는 `"[object Object]"` 가 된다. 제약조건명·테이블명은 나가지 않는다.

- **깨질 테스트**: `.select()` 방식이면 `scheduleAndAmoraTools.test.ts` 2건(mock 에 영향 행 추가, XS)
- **롤백**: 코드 revert. DB 상태 없음
- **판정: SAFE_WITH_MITIGATION**

## B-4. 프롬프트 계약 포팅

`.codex-amora-20260805`(브랜치 `codex/amora-command-decision-design-20260805`, HEAD `da71d5cc`) — **main 도 통합 브랜치도 아닌 제3 브랜치**다.
거기 계약은 **프롬프트 조항이 아니라 서버가 만드는 문구 + 계약 테스트**로 구현돼 있다.

```
lib/ai/amoraDemoPersistence.ts   "참고로 체험 상담이라 말씀하신 결혼 날짜는 실제 일정에는 아직 저장되지 않았어요."
api/onboarding/route.ts          "입력한 준비 현황과 결혼식 선호는 이번 요청에 반영되지 않았어요. 계획 변경이 결정된 뒤 다시 입력해주세요."
components/.../PendingAmoraActionCard.tsx   "내 확인 N/M · 아직 반영되지 않았어요. 적용 요청 전까지 취소할 수 있어요."
api/chat/__tests__/routeOpenAIContract.test.ts   expect(...).toContain("실제 일정에는 아직 저장되지 않았어요")
components/onboarding/__tests__/onboardingReliability.test.ts   expect(onboardingPage).toContain("아직 계획에는 반영되지 않았어요")
```

**§2.6 이라는 번호는 어디에도 없다.** 두 워킹 카피의 `prompts.ts`, `CLAUDE.md`, `AGENTS.md`, `PRINCIPLES.md`, `docs/` 전부 확인.

**순서 의존 (코드 레벨)**: 현재 브랜치 `route.ts` 는 `JSON.stringify(execResult.toolOutput)` 만 보내므로
**모델 입력에 실패 신호가 물리적으로 없다.** 프롬프트에 "실패를 먼저 말하라"를 넣어도 모델이 참조할 사실이 없다.
→ **2단계(배관) 없이 프롬프트 조항만 넣으면 지킬 수 없는 공약이다.**

**⚠ 포팅 전 확인**: 그 계약 문구가 **main 에도 존재하는지** 먼저 확인해야 한다. 제3 브랜치의 계약이 운영 계약이 아닐 수 있다.

## B-5. 검증 설계

**전역 테스트** — `success === true && displayMessage.trim() === ""` 금지.
런타임 순회보다 **소스 문자열 정적 검사**를 권장(`prompts.test.ts` 선례, `budgetReliability.test.ts` 도 같은 방식).
런타임 방식은 34개 도구 전부에 supabase mock 이 필요해 비용이 크다.

**계약 테스트** — `route.ts`(1,144줄, 테스트 0건)를 통째로 테스트하는 대신
**`buildToolResultPayload(execResult)` 순수 함수를 2단계에서 추출**해 그것만 테스트한다. 그 추출을 2단계 수정안에 포함할 것.

**변이 테스트 — 되돌렸을 때 그 테스트만 깨지는가**

| 변이 | 반드시 깨져야 할 테스트 | 다른 것도 깨지나 |
|---|---|---|
| 2단계 payload 에서 `ok:false` 제거 | 계약 테스트 | 아니오 |
| 1단계 `cancelled:false` 제거 | bookingTools 신규 2케이스 | 아니오 |
| 3단계 `.select()` 제거 | scheduleAndAmoraTools 2케이스 | 아니오 |
| 리마인더 조건에서 `&& success` 제거 | **현재 어떤 테스트로도 안 잡힘** ← 새 테스트 필요 이유 |
| `is_error` 를 `isError` 로 오타 | **tsc 통과, 런타임 무시** ← `as ContentBlockParam` 캐스팅 때문. 눈으로 대조할 것 |
| `{count:"exact"}` 로 구현 | **거짓 초록** ← 위 ⚠ 참조 |

---

# 지금 바로 착수 가능 vs 선행 결정 필요

## ✅ 지금 바로 착수 가능

| 항목 | 작업량 |
|---|---|
| **1단계** (+ `ActionCard.getTitle`/`getIcon` case 추가 + 빈 배열 판정 확장, 같은 커밋) | XS |
| **2단계** (+ `prompts.ts` 재시도 금지 한 줄, 같은 커밋. `// @vitest-environment node` 필수) | S |
| 감사 브랜치에서 `npx vitest run` 으로 `budgetReliability.test.ts` 통과 여부 확인 → A-2 역회귀 위험 즉시 판정 | XS |
| `seedGate()` 진리표 테스트 (이전 조사 항목, 순수 함수) | XS |

1단계와 3단계는 파일이 겹치지 않아 **병렬 진행 가능**.

## ⛔ 결정·확인이 선행되어야 하는 것

| # | 결정 | 왜 |
|---|---|---|
| 1 | **어느 브랜치를 고칠 것인가** | 감사 브랜치는 main보다 332커밋 뒤, 운영은 OpenAI. B의 수정 지점 2곳이 운영에 존재하지 않는다. 운영 대상이면 `main` 의 `route.ts`(3,879줄)와 `lib/ai/openai.ts` 를 다시 읽고 재작성해야 한다 (재조사 S) |
| 2 | **`feat/ux-polish-journey-audit` 의 처분** | 이 브랜치엔 `CATEGORY_RATIOS` 와 `marketPricesData.generated.ts` 가 살아 있다. 병합하면 정직성 수정이 되돌아간다. 리베이스인가 폐기인가 — 파운더 결정 |
| 3 | **3단계 구현 형태** | `.select("couple_id")` 로 확정할 것. `{count:"exact"}` 는 테스트를 거짓 초록으로 만든다 |
| 4 | **`executeTool` catch 문구 개선을 3단계에 포함할지** | 안 하면 3단계 가치가 "거짓 성공 → 무정보 실패"에 그치고 2단계 이득도 발현 안 됨 |
| 5 | **`add_amora_action`/`update_amora_action` 처리** | mirror catch 가 throw 를 삼켜 주 경로는 안 고쳐진다. 11개로 정정할지, mirror 를 손볼지 |
| 6 | **실패 신호 전달 방식(운영 기준)** | OpenAI 엔 `is_error` 가 없다. main 에 이미 있는 `getModelSafeToolOutput` 의 `status:"unavailable"` 패턴을 확산할지 결정 (S) |
| 7 | **A 대응 — 공시 참고치 배선** | `/price` 에 발행된 공시 데이터가 몇 건인지 [미확인]. 커버리지 확인 후 M |

## 미확인

- `/price` 에 실제 발행된 공시 데이터 건수 — 운영 DB 조회 필요
- `.codex-amora-20260805` 계약 문구가 **main 에도 존재하는지**
- 통합 브랜치 테스트 실행 안 함 — 그 워킹 카피의 `node_modules` 설치 상태 미확인이라 `npx vitest run` 이 설치를 유발할 위험
- `apps/mobile` 예산 화면 미입력 렌더 직접 확인 안 함
