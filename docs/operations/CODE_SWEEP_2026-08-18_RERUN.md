# 코드 스윕 재실행 — 2026-08-18

> **상태:** 결함 2건 수정 완료(각각 RED→GREEN 테스트 첨부) · 판정 3건 뒤집음 ·
> 제품 공백 5건 기록
>
> **대상:** `Kyu-Sung-Cho/wedding-hanbang-web`, base `main` @ `b58a329d`
>
> **승계:** 이 문서는 PR #111(`docs/operations/CODE_SWEEP_FINDINGS_2026-08-18.md`)의
> "10개 가설 전부 이미 안전, 코드 변경 0건" 판정을 **가설로 취급해 다시 공격한**
> 결과다. PR #111을 대체하지 않고, 그 문서의 개별 주장 중 무엇이 살아남고 무엇이
> 틀렸는지 아래에 명시한다.

## 이 재실행이 이전과 다른 점

PR #111은 "테스트가 있다", "여러 겹의 안전장치가 있다"를 근거로 닫았다. 이번에는
각 영역에서 **진입점 → 쓰기 → UI** 순서로 실제 함수를 읽고, 주장된 보호를 깨는
입력을 만들어 봤다. grep 일치는 근거로 쓰지 않았다. 닫힌 것으로 판정한 항목은
"테스트가 존재한다"가 아니라 **그 보호를 담당하는 함수 이름과 그 함수가 막는
구체적 입력**으로 기록했다.

증거 등급은 `AGENTS.md`의 E/S/I/M을 따른다. 아래는 모두 **E**(이번 작업에서 파일·
명령·테스트로 직접 확인)이며, 운영 DB에 접속하지 않았으므로 운영 데이터의 현재
상태에 대한 주장은 하지 않는다.

---

## 1. 고친 결함

### 결함 1 — env가 운영 프로젝트를 잘못 적으면 fence가 운영 service-role 쓰기를 통과시킨다

| 항목 | 내용 |
|---|---|
| 파일 | `apps/web/src/lib/supabase/destinationFence.ts` |
| 함수 | `verifySupabaseServiceDestination` |
| 미러 | `scripts/lib/supabase-service-destination.mjs` · 같은 함수 |
| 영향 | `createAdminClient()`를 쓰는 웹 전 경로 + 미러 fence를 쓰는 운영 스크립트 |
| 심각도 | 높음 — 운영 DB에 확인 절차 없이 service-role 쓰기 |

**왜 통과했는가.** 수정 전 판정은 한 줄이었다.

```ts
if (expectedProjectRef === productionProjectRef && input.access !== "read") {
```

`productionProjectRef`는 `SUPABASE_PRODUCTION_PROJECT_REF`에서 온다. 그런데 목적지를
정하는 `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_EXPECTED_PROJECT_REF`도 **같은 env**가
정한다. 즉 fence는 "여기가 운영인가"를, 목적지를 고른 쪽에게 물어보고 그 대답을 그대로
믿었다. 로컬 모양의 `.env.local`이나 잘못 설정된 배포 env가
`SUPABASE_PRODUCTION_PROJECT_REF`에 **다른 20자 ref**를 적어두면 등식이 깨져,
목적지가 진짜 운영 프로젝트여도 `PRODUCTION_WRITE_CONFIRMATION_REQUIRED`가 뜨지 않았다.

`parseProjectRef`가 값 **누락**은 막는다(`PRODUCTION_REF_INVALID`). 막지 못한 것은
값이 형식상 유효하면서 **틀린** 경우다.

**저장소는 이미 정답을 알고 있었다.** `scripts/ingest/destination.ts`:

```ts
// Repository-owned production identity. Runtime environment variables may add
// checks, but they may never redefine this denylist.
export const REPOSITORY_PRODUCTION_PROJECT_REFS = Object.freeze([
  "slrtobkksjmxgzatjyqb",
] as const);
```

그 주석이 선언한 무효식("런타임 env가 이 목록을 다시 정의할 수는 없다")을 지킨 곳은
**ingest뿐**이었다. `assertRepositoryProductionProjectRef`의 호출부는
`scripts/ingest/load.ts`와 `scripts/ingest/destination.ts` 두 곳이고, 웹 런타임 fence와
scripts 미러 fence는 이 pin을 전혀 보지 않았다.

**따라서 사용자 가설이 그대로 성립했다** — "로컬 모양 env에서 seed/apply를 돌리면
승인된 업체를 운영처럼 보이는 목적지에 쓸 수 있는가?" `/api/admin/price/upload`,
`/api/admin/price/snapshots`, `/api/admin/enrich/[id]` 등 업체·가격 쓰기 라우트는 모두
`getServiceClient()` → `createAdminClient()` → 이 fence를 지난다. 그 fence가 운영을
운영으로 보지 않으면 확인 문자열 없이 통과한다.

**수정.** 두 fence가 repo pin을 함께 본다. 판정을 OR로 넓혔으므로 보호만 늘고, 기존에
통과했던 비운영 목적지의 동작은 바뀌지 않는다.

```ts
const targetsProduction = expectedProjectRef === productionProjectRef
  || REPOSITORY_PRODUCTION_PROJECT_REFS.includes(expectedProjectRef);
if (targetsProduction && input.access !== "read") {
```

`access: "read"`는 그대로 확인 없이 허용한다(읽기 전용 운영 probe를 막지 않는다).

**기존 테스트가 왜 못 잡았는가.** `apps/web/src/lib/supabase/__tests__/destinationFence.test.ts`의
`validInput()`은 기본값이 `productionProjectRef: OTHER_REF`이고, 운영 케이스를 만들 때는
`productionProjectRef: PROJECT_REF`처럼 **env가 "여기가 운영이다"라고 정직하게 말하도록**
바꿨다. `adminDestinationFence.test.ts`도 같다(`SUPABASE_PRODUCTION_PROJECT_REF =
TEST_SUPABASE_PROJECT_REF`). **env가 거짓말하는 케이스가 한 건도 없었다.** 이것이 PR
#111이 "여러 겹의 안전장치"를 본 채로 구멍을 지나친 이유다.

**추가한 테스트.**

- `destinationFence.test.ts` → `repository-pinned production identity` 4건.
  핵심은 목적지를 repo pin 운영 ref로 두고 `productionProjectRef`만 다른 값으로 준 뒤
  `runtime`·`operator-write` 양쪽에서 확인 문자열을 요구하는지 본다.
  수정 전 RED: `expected function to throw an error, but it didn't`.
- `scripts/tests/supabase-service-destination.test.mjs` →
  `repository-pinned production refuses writes when env misstates production`.
  수정 전 RED를 실제로 확인했다(그 한 줄만 임시로 되돌려 `not ok 4` 재현 후 복구).
- 같은 파일 → `the repository production pin is identical in every fence copy`.
  세 사본(`scripts/ingest/destination.ts`, scripts 미러, 웹 fence)의 pin 목록이
  같은지 소스에서 추출해 비교한다. 한 곳만 고치고 나머지를 두는 drift를 막는다.

**남은 한계(UNVERIFIED).** pin은 **현재 알려진 운영 ref 1개**만 담는다. 운영 프로젝트를
새로 만들면 그 ref를 세 곳에 함께 추가해야 하고, 추가하지 않으면 그 프로젝트는 다시
env 신고에만 의존한다. drift 테스트는 사본 간 불일치는 잡지만 "pin이 최신인지"는
잡지 못한다.

---

### 결함 2 — 아모라 행동 수정이 아무것도 저장하지 못했는데 성공으로 보고한다

| 항목 | 내용 |
|---|---|
| 파일 | `apps/web/src/app/api/amora/actions/[id]/route.ts` |
| 함수 | `updateLegacyAmoraAction` (호출부: 같은 파일 `PATCH`) |
| 심각도 | 중간~높음 — 파트너 데이터 손실 + 거짓 성공 보고 |

**왜 문제인가.** 수정 전 코드는 두 가지를 함께 했다.

```ts
const { error: patchError } = await admin.rpc("apply_journey_progress_patch", { ... });

if (patchError) {
  await admin
    .from("wedding_journeys")
    .update({ progress: nextProgress })   // (a) 오래된 전체 스냅샷 덮어쓰기
    .eq("id", journey.id);                // (b) error를 읽지 않는다
}

return updated;                           // (c) 그래서 항상 성공으로 돌아간다
```

(a) `nextProgress`는 이 요청이 함수 시작부(`select("id, progress")`)에서 읽은 스냅샷에
기반한다. CAS도 revision 검사도 없다. RPC가 실패해 이 경로로 오면, 그 사이 파트너가
저장한 예산·일정·체크리스트가 **통째로** 이전 값으로 되돌아간다.

(b)(c) 폴백 UPDATE의 `error`를 destructure조차 하지 않는다. 그래서 RPC와 폴백이
**둘 다** 실패해도 함수는 `updated`를 돌려주고, `PATCH`는 `200 { action }`을 응답한다.
화면과 아모라는 반영됐다고 말하고, DB에는 아무 변화가 없다. 사용자 가설
"success defaults true / 실패한 변경이 성공으로 보인다"가 `toolExecutor.ts`가 아니라
**이 라우트에** 있었다.

**이것은 취향 문제가 아니라 이미 선언된 무효식 위반이다.**
`apps/web/src/lib/ai/tools/progressTools.ts`의 `patchJourneyProgress`에 같은 판단이
주석으로 남아 있고 그대로 지켜지고 있다.

```
 * RPC 오류나 비정상 응답에서는 실패로 닫는다. 호출 시점의 오래된 전체 JSON으로
 * 폴백하면 파트너나 다른 요청이 방금 저장한 값을 지울 수 있기 때문이다.
```

그 무효식을 지키는 회귀 테스트도 이미 있다 —
`apps/web/src/lib/ai/tools/__tests__/progressTools.test.ts`의
"RPC가 임의 오류를 반환하면 오래된 전체 progress로 대체하지 않고 실패한다".
아모라 도구 경로는 닫혔고 **이 HTTP 라우트만 열려 있었다.**

**수정.** 폴백을 없애고 실패로 닫는다(`if (patchError) throw patchError;`).
`PATCH`의 기존 `catch`가 이를 500으로 변환한다. RPC 파라미터
(`p_couple_id`/`p_patch`/`p_remove_keys`)는 `20260611160000_journey_progress_atomic_merge.sql`의
정의와 일치하므로 정상 경로는 그대로 동작한다.

**추가한 테스트.** `apps/web/src/app/api/amora/actions/[id]/__tests__/route.test.ts` 3건.

1. 정상: 원자적 patch로 반영되고 전체 덮어쓰기는 호출되지 않는다.
2. RPC 실패: 전체 덮어쓰기를 하지 않고 500으로 닫는다. **수정 전 RED**(덮어쓰기 발생).
3. RPC + 폴백 둘 다 실패: 200을 돌려주지 않고 `action`을 싣지 않는다.
   **수정 전 RED**(`expected 200 not to be 200`).

**남은 한계.** 이 경로는 전용 `amora_actions` 테이블이 없을 때만 타는 레거시 경로다
(`updateAmoraActionRecord`가 `null`이거나 `isAmoraActionStorageUnavailable`). 운영에서
그 테이블이 존재하는지는 이 작업에서 확인하지 않았다(UNVERIFIED). 다만 결함은 도달
가능성과 무관하게 "실패를 성공으로 보고한다"는 계약 위반이다.

---

## 2. PR #111에서 뒤집은 판정

### 주장 7 "커플 초대 — ✓ WORKING CORRECTLY" → 부분적으로 틀렸다

살아남은 부분: RPC 계약은 실제로 맞다. `join_couple`의 최종 정의는
`20260714160000_harden_amora_privacy_boundaries.sql`의 `join_couple(p_invite_code text,
p_role text)`이고, 호출부(`apps/web/src/app/api/onboarding/route.ts`)가 넘기는 키
이름이 정확히 일치한다. `couples`에는 이 경로가 읽고 쓰는 컬럼
(`invite_code`, `bride_id`, `groom_id`)이 모두 있다. 즉 **온보딩 중 합류는 동작한다.**

틀린 부분: **온보딩을 혼자 끝낸 사용자에게는 파트너 코드를 넣을 경로가 없다.**
`POST /api/couple/link`는 검증·레이트리밋·`join_couple` 호출까지 완성돼 있는데,
저장소 전체에서 이 엔드포인트를 부르는 클라이언트가 없다. 현재 유일한 참조는
`apps/web/src/utils/coreMutationTrustBoundary.test.ts`(경로 목록)뿐이다. 코드를 넣는
UI는 웹 `apps/web/src/components/onboarding/CoupleLink.tsx`와 모바일
`apps/mobile/app/onboarding/index.tsx` **온보딩 안에만** 있다. 설정 화면은 자기 코드를
보여주고 복사·재발급만 한다.

→ 결론: 앞으로도 "둘이"를 전면 카피로 올리기 전에, 온보딩 후 합류 진입점을 먼저
연결해야 한다. 이전 제품 판단("invite may be broken — do not say 둘이")은 이유가
달라졌을 뿐 **여전히 유효하다.**

### 주장 4 "운영 쓰기 — ✓ PROTECTED, 여러 겹의 안전장치" → 그 겹이 뚫렸다

결함 1이 정확히 이 주장 안에 있었다. PR #111이 인용한
`verifyRuntimeSupabaseServiceDestination()`와
`REPOSITORY_PRODUCTION_PROJECT_REFS`는 **둘 다 존재하지만 서로 연결돼 있지 않았다.**
두 사실을 나열한 것이 연결을 확인한 것으로 처리됐다.

### 주장 10 "기타 배선/인증/데이터 손실 — ✓ NO ISSUES FOUND" → 결함 2가 여기 있었다

---

## 3. 직접 따라가 "닫혔다"로 확인한 것 (함수 이름 기준)

"테스트가 있다"가 아니라, 그 입력을 막는 함수와 가드를 적는다.

### 완료율이 100%를 넘을 수 있는가 → 넘을 수 없다

- `packages/shared/src/utils/planningChecklist.ts` · `summarizePlanningChecklist`
  → 분모 0일 때 `percent: 0`(나눗셈 안 함). `not_applicable` 카테고리는 `continue`로
  분모·분자에서 함께 빠진다.
- 같은 파일 · `mergePlanningChecklist` → 템플릿에 없는 저장 항목을 `merged`에
  **append**한다. `getPlanningChecklistCounts`의 `total`은 `checklist.length`,
  `done`은 그 배열의 `done` 참 개수다. append는 분모·분자를 함께 늘리므로
  `done ≤ total`이 구조적으로 보장된다.
- `apps/web/src/app/(app)/lounge/page.tsx` · `getProgressSummary`,
  `getChecklistProgress`, 그리고 `progressPercent`/`budgetPercent` 두 곳 모두
  `total > 0` 가드를 갖는다.

### 결혼 날짜가 없을 때 "N일 지남"이 뜨는가 → 뜨지 않는다

- 웹 `apps/web/src/app/(app)/lounge/page.tsx` · `getActiveCategories`
  → `dday === null ? null : dday - category.ddayDeadline`. 렌더 쪽
  `CategoryProgressCard`도 `item.daysUntilDeadline === null`이면 "기본 확인 순서"를 쓴다.
- 모바일 `apps/mobile/app/(tabs)/dashboard.tsx` · `calcUrgentTasks`
  → 첫 줄이 `if (dday === null || dday <= 0) return [];`. 그래서
  `WeddingHomeExperience.tsx`의 "지남" 문구에 도달하는 task 자체가 만들어지지 않는다.
- 모바일 `apps/mobile/src/lib/dashboardExperience.mjs` · `buildDashboardFocus`
  → `if (!weddingDate)`이면 "결혼식 날짜를 알려주세요" setup 카드로 조기 반환.
- 웹 `apps/web/src/lib/amora/lifecycle.ts`
  → 마감 guardrail 블록이 `if (weddingDate && dday !== null && dday > 0)` 안에 있다.
- `apps/web/src/utils/imminentChecklist.ts` ·
  `getImminentCategories` / `getCompletedImminentCategories`
  → 둘 다 `if (!weddingDate) return [];`.

**부수 관찰(도달 불가로 판단, 고치지 않음).** 위 두 함수의 가드는 `null`은 막지만
**Invalid Date는 truthy라서 통과**한다. 통과하면 `daysLeft`가 `NaN`이 되고,
`ScheduleContent.tsx`의 D-day 타일은 `dday > 0`·`dday === 0`이 모두 false가 되어
"+NaN"과 "일 지남"을 함께 렌더한다. 호출부 3곳 중
`apps/web/src/components/app/WeeklyCard.tsx`만 `Number.isNaN(...getTime())`으로 걸러
`null`을 넘기고, `ScheduleContent.tsx`(170행)와
`apps/web/src/components/app/chat/panel/UpcomingTab.tsx`(48행)는 걸러내지 않는다.
**그래도 결함으로 올리지 않은 이유:** `wedding_journeys.wedding_date`는
`20260210000000_onboarding_couple_chat.sql`에서 `DATE` 컬럼이라 Postgres가 형식을
보장하고, 데모 저니의 값도 `authStore.ts`의 리터럴 `"2026-10-15"`다. 즉 현재 데이터
흐름으로는 파싱 불가한 값이 들어올 경로를 찾지 못했다. 검증 위치가 세 호출부에
흩어져 있는 비대칭은 남은 하드닝 후보로만 기록한다.

### Anthropic 잔존 경로가 운영에서 발동할 수 있는가 → 없다

- 의존성: `apps/web/package.json`에 `openai`만 있고 `pnpm-lock.yaml`에 `anthropic` /
  `@anthropic-ai` / `claude` 0건.
- 모델 allowlist: `apps/web/src/lib/ai/modelConfig.ts` · `getModel`
  → env 오버라이드가 기대값과 정확히 다르면 **throw**. 따라서
  `OPENAI_AMORA_PRIMARY_MODEL` / `OPENAI_AMORA_FAST_MODEL`로 비허용 모델을 주입할 수 없다.
- 게이트: 같은 파일 · `isAmoraOpenAIEnabled`는 `"true"`만 인정하고,
  `apps/web/src/lib/ai/openai.ts` · `assertOpenAIProviderEnabled`가 fail-closed로 막는다.
  대체 provider 분기가 없다.
- 남아 있는 Anthropic 문자열은 런타임이 아니다: `config/amora-model-pricing.json`과
  `apps/web/src/lib/compliance/ai-log.ts`의 과거 비용 정산용 타입,
  `scripts/lib/local-qa-environment.mjs`가 레거시 키를 `""`로 지우는 코드, 그리고 문서.

### 하드코딩 예산 비율이 남아 있는가 → live 코드에 없다

- `CATEGORY_RATIOS` live 코드 0건. `apps/web/src/lib/weddingBudget.ts`는 상한
  (`MAX_WEDDING_BUDGET_WON`)과 검증만 갖는다.
- `apps/web/src/lib/ai/toolExecutor.ts` · `executeApplyBudgetPlan`은 명시된
  `allocations`만 쓰고, 남은 금액은 비율이 아니라 `reserve`로 넘긴다.
- 모바일 `apps/mobile/app/budget/index.tsx` · `getCatBudget`은 값이 없으면 `0`이다.
- **테스트 사각지대는 기록해 둔다.**
  `apps/web/src/components/app/budget/__tests__/budgetReliability.test.ts`의 비율 금지
  단언은 **6개 소스만** 읽는다. `apps/web/src/lib/ai/prompts.ts`는 그 목록에 없고
  100행에 `context.budget * 0.15`가 있다. 확인한 결과 이것은 **금액을 만들지 않고**
  이미 입력된 카테고리 예산이 총액 대비 큰지 표시하는 프롬프트 문맥 임계값이라
  결함으로 올리지 않았다. 다만 비율 금지 계약이 그 파일을 덮지 않는다는 사실은 남는다.

### toolExecutor에 `success` 기본 true 경로가 있는가 → 없다

- `apps/web/src/lib/ai/toolExecutor.ts` · `failureResult`는 항상 `success: false`.
- `executeMutatingToolWithLedger`의 원장 분기
  (`in_progress` / `uncertain` / `retry_new_operation_blocked` / `stale_attempt` /
  `stale_context`, 그리고 `!== "acquired"` 기타)가 **전부 명시적으로** `failureResult`를
  돌려준다. 기본 성공으로 떨어지는 분기가 없다.
- 원자 커밋 결과가 불확실하면 `throw`한다(423행 부근). 주석대로 "provider가 이
  불확실성을 최종 답변으로 바꾸지" 못하게 chat claim을 실패시켜 재생을 가능하게 둔다.
- `hydrateDurableResult`는 저장된 `success`가 boolean이고 `displayMessage`가 string일
  때만 재생하고, 아니면 `TOOL_LEDGER_RESULT_INVALID` 실패로 닫는다.
- 실패 결과는 `apps/web/src/app/api/chat/route.ts` 2868~2883행에서
  `[SERVER_CONFIRMED_ACTION_RESULT]`로 `success` 값과 함께 모델에 다시 주입되고,
  UI는 `ActionCard`가 빨간 X와 실패 문구를 따로 렌더한다.

**빈 `displayMessage`가 실패를 감추는가 → 감출 수 있지만 의도된 동작이고, 도달 경로를
찾지 못했다.** `apps/web/src/components/app/chat/ActionCard.tsx` 646행
`if (!result.success && msg === "") return null;`은 카드를 아예 그리지 않는다.
638~641행 주석이 그 의도를 적어 두었다(같은 실패 카드가 6개 쌓여 화면이 깨져 보였던
사고). `toolExecutor.ts`의 모든 `failureResult` 호출은 비어 있지 않은 리터럴 문구를
넘기고, `getUserFacingDisplayMessage`는 빈 문자열을 새로 만들지 않는다. 따라서 현재
코드에서 "실패인데 문구가 빈" 결과를 만드는 경로는 확인되지 않았다.

### 승인 없이 변경이 반영되는 경로가 있는가 → 확인 범위에서 없다

두 개의 승인 체계가 병존하고, 둘 중 하나를 반드시 지난다.

- 아모라 확정 액션: `PUT /api/amora/shared-actions/[actionId]`가
  `claim_amora_shared_action_application`을 호출하고
  (`20260730102000_amora_shared_action_approval_and_notifications.sql`,
  `policy = 'couple'`이면 수락 수 < `requiredCount`일 때
  `AMORA_SHARED_ACTION_APPROVAL_REQUIRED`), 이어서 chat 라우트가
  `authorize_amora_shared_action_execution`으로 다시 확인한다.
- 수동 UI 편집: `authStore.updateJourney` → `PATCH /api/journey` →
  `submit_couple_plan_change`. 연결된 커플의 high-impact 변경은
  `20260731123000_couple_plan_change_write_boundary.sql`에서 `required_count = 2`.
- 모델이 변경 도구를 직접 부르는 길은 닫혀 있다:
  `apps/web/src/app/api/chat/route.ts`가 노출 도구에서 `isMutatingTool`을 걸러내고,
  들어오면 `MODEL_MUTATION_TOOL_BLOCKED`로 거절한다.
- DB 최종 방어선: 트리거 `enforce_couple_plan_change_write_boundary`가 표식 없는
  high-impact 서비스롤 쓰기를 거절한다. 그래서
  `patch_wedding_settings_atomic`의 직접 UPDATE도 승인 없이는 통과하지 못하고
  `/api/settings/wedding-profile`이 409로 안내한다.
- 클라이언트가 Supabase에 직접 저니를 쓰는 경로는 웹·모바일 모두 없다(모바일은
  Realtime select만).

### 인증·cron·webhook·seed → 이번 범위에서 결함 없음

- cron 7개(`api/cron/**`)는 모두 `process.env.CRON_SECRET`과
  `Authorization: Bearer` 정확 일치를 요구하고, 시크릿이 없으면 401로 **fail-closed**.
- webhook 라우트는 존재하지 않는다(검증 누락 대상 자체가 없음).
- seed API 라우트는 존재하지 않는다. `lib/utils/adminAuth.ts`의 `seedGate()`는
  정의돼 있으나 API 레이어에서 호출되지 않는다.
- `verifyAdmin`은 세션 사용자 id로 `profiles.is_admin`을 조회한다. 하드코딩 비밀번호
  폴백이나 "env 미설정이면 통과" 분기가 없다. `/api/admin/auth`의 `ADMIN_PASSWORD`
  비교는 `timingSafeEqual` 기반이고 미설정 시 500이다.
- 변경 라우트가 body/query의 `coupleId`를 **권한 주체로** 신뢰하는 사례는 찾지 못했다.
  `/api/money`는 `profile.couple_id !== coupleId`면 403, chat 계열은
  `verifyCoupleOwnership`, 결제는 `resolvePaymentScope`가 `couples`의 슬롯까지 재확인한다.

### 라망 전주가 서울 카드에 섞이는가 → 현재 main에서는 안 섞인다

- `apps/web/src/lib/price/vendorIdentity.ts` · `vendorIdentityKey`
  → `isSameNameDifferentBusiness(category, canonical)`이 참이면 `slug:${vendorSlug}`를
  키로 쓴다. `SAME_NAME_DIFFERENT_BUSINESS`에 `"studio|라망"`이 있으므로 서울 행과
  전주 행은 서로 다른 slug 키를 갖고 절대 합쳐지지 않는다.
- 병합은 `apps/web/src/lib/price/publicListData.ts`(카탈로그 적재)에서 일어나고 지역
  필터는 그 뒤 `apps/web/src/lib/price/catalog.ts` · `filterPriceCatalog`에서 걸린다.
  즉 **병합이 먼저다.** 다만 지역을 고르면 `offersInRegion`이 `offer.regionCode`로
  오퍼를 잘라내므로, 설령 합쳐진 카드라도 다른 지역 가격이 그 지역 요약에 들어가지
  않는다.
- 주의할 일반형: `vendorIdentityKey`는 **지역을 입력으로 받지 않는다**(의도된 설계 —
  같은 브랜드의 다지역 표기를 합치기 위함). 따라서 `SAME_NAME_DIFFERENT_BUSINESS`나
  `VENDOR_BRANCHES`에 **등재되지 않은** 동명이업 쌍은 한 카드로 합쳐질 수 있다.
  이것은 코드 결함이 아니라 아래 "미결 37쌍" 데이터 문제다.

---

## 4. 남은 제품 공백 (고치지 않았다)

1. **3-질문 예식장 경로가 구현돼 있지 않다.** 지역·하객 수·식대 상한 3문항과 마지막
   보기 「아직 모름」, 공시가 range 1개 + 위약금 원문 카드, 승인 후 반영 —
   이 흐름의 진입점이 없다. `"아직 모름"` 문자열이 `apps/` 전체에 **0건**이다.
   즉 "이미 쓰인 UI의 작은 배선 누락"이 아니라 미구현이므로 이번 스윕에서 만들지
   않았다.
2. **today 화면이 없다.** 웹 `apps/web/src/app/(app)/`에 `today` 디렉터리가 없고
   모바일 `apps/mobile/app/`에도 없다. 첫 화면은 여전히 대시보드
   (웹 `lounge`/`dashboard`, 모바일 `(tabs)/dashboard`)이고, 잠긴 3-질문 경로가 아니다.
3. **아모라는 아직 도구 허브다.** `apps/web/src/lib/ai/tools.ts`에 도구 정의가 36개다.
   "3개 답을 저장된 기록으로 남기고, 그 조건의 공시가와 위약금 원문을 보여주고,
   사용자가 누른 것만 남긴다"는 좁은 계약과는 거리가 있다.
4. **업체 미결 37쌍.** `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md`가
   "분리 유지 18쌍, 미결 37쌍"이라고 적고, 일반 웹 검색으로는 닫을 수 없어 공식 채널
   재조사가 필요하다고 남겼다. 공식 채널 증거 없이 병합하지 않았다.
5. **`VERIFIED_VENDOR_IDENTITY_BY_SLUG`가 main에서 사라졌다.** `04f0ea16`
   ("chore(wip): preserve integrated 2026-07-31 snapshot")에는 있었고 현재 main의
   live 코드에는 없다. 남은 것은 테스트·문서 주석뿐이다
   (`scripts/tests/disclosure-count-consistency.test.mjs:140`,
   `apps/web/src/lib/vendors/__tests__/publicVendorPriceData.test.ts:527`).
   그 결과 서울 `라망`과 서울 `라망스튜디오`는 지금 **분리된 두 카드**다(과잉 분리).
   PR #110의 범위이므로 이 브랜치에서 건드리지 않았다.

### 추가로 기록해 둘 정직성 공백 (결함으로 올리지 않음)

- `apps/web/src/components/price/PriceExplorer.tsx` 705행은 모든 사용자에게
  "업체를 누르면 취소 위약금·환불 규정 원문까지 그대로 볼 수 있어요"라고 말한다.
  그런데 `apps/web/src/app/price/vendor/[slug]/page.tsx` 528행은
  `policies.length > 0`일 때만 그 섹션을 그리고, 없으면 **아무 문장도 없이 사라진다.**
  제품 락이 요구하는 「이 경로는 샵별 위약금 없음」 같은 정직한 문장이 없다.
  다만 `apps/web/src/lib/vendors/publicVendorPriceData.ts` 530~533행 주석이 이 위험을
  **이미 알고 기록**하고 있고(뷰가 드롭되거나 GRANT가 회수되면 위약금이 조용히
  사라진다), 대응으로 서버 로그(`reportPolicyLoadFailure`)와 `pnpm audit:production`
  정기 확인을 선택했다. 의도된 트레이드오프이므로 UX를 임의로 바꾸지 않고 소유자
  판단 대상으로 남긴다.
- 모바일 하단 탭 라벨이 `홈 | 아모라 | 커뮤니티 | 내 정보`다
  (`apps/mobile/app/(tabs)/_layout.tsx`). `CLAUDE.md`의 제품 계약은 네 번째를
  「마이」로 적는다. 안전·정확성 문제가 아니라 카피 불일치이므로 바꾸지 않았다.

---

## 5. in-flight PR

#107(ingest), #108(/price UX), #109(identity report), #110(라망 서울 slug 병합),
#111(이 문서가 재검토한 스윕 노트) 모두 **손대지 않았다.** 회귀를 증명한 것이 없다.
#110은 위 공백 5번과 같은 대상을 다루므로, 병합 순서에서 이 브랜치와 충돌하지 않는다
(이 브랜치는 `vendorIdentity.ts`를 수정하지 않았다).

---

## 6. 검증 증거

| 항목 | 결과 |
|---|---|
| 결함 1 웹 fence | 수정 전 RED(`expected function to throw an error, but it didn't`) → 수정 후 GREEN |
| 결함 1 scripts 미러 | 해당 한 줄만 임시 되돌려 `not ok 4` 재현 확인 → 복구 후 8/8 통과 |
| 결함 2 라우트 | 수정 전 RED 2건(스냅샷 덮어쓰기 발생 / 실패에도 200) → 수정 후 3/3 통과 |
| `pnpm lint` | 통과 (2/2 태스크) |
| `pnpm typecheck` | 통과 (4/4 패키지: shared, design-tokens, web, mobile) |
| `pnpm test` | 통과 — web 633 파일 / 6283건 전부 통과, repo node 테스트 862건·276건 fail 0 (13m16s) |

`pnpm test` 로그에 `amora action update failed: { code: 'XX000', ... }` 같은 줄이 보이는
것은 실패가 아니라, 결함 2의 새 테스트가 **의도적으로** RPC 실패를 주입해 라우트가
실패로 닫히는지 확인할 때 남는 서버 로그다.

**환경 주의.** 루트의 `typecheck`·`test`는 내부에서 bare `pnpm`을 다시 호출한다. 이
VM의 기본 PATH에서는 그 bare `pnpm`이 전역 10.33.3으로 해석돼
`ERR_PNPM_UNSUPPORTED_ENGINE`으로 즉시 실패한다(코드 문제가 아니다).
`corepack enable --install-directory <dir>`로 11.7.0 shim을 PATH 앞에 두면 정상 실행된다.

운영 DB·Storage·배포는 이 작업에서 건드리지 않았다. 따라서 운영 적용·배포에 대한
완료 주장은 하지 않는다.
