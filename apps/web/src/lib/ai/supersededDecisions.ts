/**
 * 이미 갈아치운 결정을 아모라의 문맥에서 걷어낸다.
 *
 * 커플이 값을 바꾸면 새 값은 `wedding_journeys`에 정확히 반영된다. 문제는 그 옆에
 * 쌓이는 결정 영수증(`decision_nodes`)이다. 영수증에는 `superseded_at`을 세우는 코드가
 * 어디에도 없어서, 예식장을 A홀에서 B홀로 바꿔도 A홀 영수증이 계속 살아 있고, 일정을
 * 3/20에서 3/27로 옮겨도 두 영수증이 다 살아 있다.
 *
 * 그리고 프롬프트는 2주 지난 결정을 **"혹시 아직도..." 톤으로 회상**하라고 지시한다.
 * 그래서 아모라가 사용자가 이미 지운 값을 아직 유효한 것처럼 되묻게 된다 — 기록을
 * 남기는 것 자체는 옳지만, 그것을 현재처럼 말하는 것은 틀린 말이다.
 *
 * 판정 기준은 DB의 플래그가 아니라 **현재 여정 값**이다. 트리거가 제때 돌았는지에
 * 기대지 않고 읽는 시점의 진실과 대조하므로, 영수증이 어떤 경로로 쌓였든 결과가 같다.
 * (근본 수리는 쓰기 시점에 `superseded_at`을 세우는 것이고 그건 마이그레이션이다.
 * 이 필터는 그것과 충돌하지 않는다 — 이미 표시된 행은 읽기 전에 걸러진다.)
 *
 * 기록을 지우지는 않는다. 감사 기록으로서의 영수증은 그대로 남고, 아모라에게 현재처럼
 * 보여주지 않을 뿐이다.
 */

export interface CurrentJourneyFacts {
  /** `wedding_journeys.venue` — 비어 있으면 아직 정한 예식장이 없다. */
  readonly venue: string | null;
  /** `progress.__events`의 현재 일정. 취소된 것은 넣지 않는다. */
  readonly events: ReadonlyArray<{
    readonly id: string;
    readonly date: string;
    readonly title: string;
  }>;
  /**
   * `wedding_journeys.total_budget` (원). 0이나 null이면 아직 정한 총예산이 없다.
   *
   * 없으면 판단하지 않는다 — 0을 "총예산 0원으로 정했다"로 읽으면 사용자가 실제로 한
   * 결정이 전부 지워진다.
   */
  readonly totalBudgetKrw?: number | null;
}

export interface DecisionForSupersessionCheck {
  readonly category: string;
  readonly title: string;
  readonly chosenValue: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 표기 차이(앞뒤 공백·연속 공백)로 같은 값을 다르다고 보지 않는다. */
function sameText(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return left.trim().replace(/\s+/gu, " ") === right.trim().replace(/\s+/gu, " ");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * "총 예산"을 가리키는 말. 카테고리 예산(스튜디오 300만원)을 총예산과 비교해 지우면
 * 사용자가 실제로 한 결정을 잃는다. 그래서 **총액을 말한다는 표시가 있을 때만** 본다.
 */
const TOTAL_BUDGET_MARKER = /(?:총\s*예산|총예산|전체\s*예산|전체예산)/u;

/**
 * 한국어 금액 표기에서 원 단위 숫자를 읽는다.
 *
 * 실제로 오는 표기: "총 예산 3000만원", "총예산 3,000만 원", "총 예산 30,000,000원",
 * "총 예산 30000000". 읽을 수 없으면 `null` — 그때는 판단하지 않는다.
 */
function parseKrwAmount(text: string): number | null {
  const normalized = text.replace(/,/gu, "");
  // 만원 표기가 먼저다. "3000만원"을 원 단위 3000으로 읽으면 정반대 판정이 나온다.
  const manMatch = /(\d+(?:\.\d+)?)\s*만\s*원?/u.exec(normalized);
  if (manMatch) {
    const value = Number(manMatch[1]) * 10_000;
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  const wonMatch = /(\d{4,})\s*원?/u.exec(normalized);
  if (wonMatch) {
    const value = Number(wonMatch[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

/**
 * 이 예산 결정이 **현재 총예산과 어긋나는가.**
 *
 * 2026-08-22 파운더 지적으로 추가했다: "2달 전에 총예산을 3000만원으로 잡았는데 나중에
 * 5000만원으로 바꿨는데 3000만원이 계속 나오는 경우". 실제로 이 필터에 예산 판정이
 * 없어서 옛 영수증이 그대로 `pastDecisions` 로 들어가고 있었다.
 *
 * 어긋남을 증명할 수 있을 때만 `true`다:
 *   - 결정이 총액을 말한다는 표시가 있고,
 *   - 그 금액을 읽을 수 있고,
 *   - 현재 총예산도 정해져 있고,
 *   - 두 값이 다를 때.
 */
function isSupersededBudgetDecision(
  decision: DecisionForSupersessionCheck,
  current: CurrentJourneyFacts,
): boolean {
  if (decision.category !== "budget") return false;
  const currentTotal = current.totalBudgetKrw;
  if (typeof currentTotal !== "number" || !Number.isFinite(currentTotal) || currentTotal <= 0) {
    return false;
  }
  const chosen = decision.chosenValue;
  const chosenText = isRecord(chosen) && typeof chosen.value === "string" ? chosen.value : "";
  const haystack = [decision.title, chosenText].filter(nonEmpty).join(" ");
  if (!TOTAL_BUDGET_MARKER.test(haystack)) return false;

  const recorded = parseKrwAmount(haystack);
  if (recorded === null) return false;
  return recorded !== currentTotal;
}

/**
 * 이 결정이 현재 여정과 어긋나는가.
 *
 * 어긋남을 증명할 수 있을 때만 `true`다. 판단할 근거가 없으면 남긴다 — 사용자가 실제로
 * 한 결정을 지우는 쪽이, 오래된 결정을 한 번 더 보여주는 쪽보다 나쁘다.
 */
export function isSupersededDecision(
  decision: DecisionForSupersessionCheck,
  current: CurrentJourneyFacts,
): boolean {
  if (!decision || typeof decision !== "object") return false;

  // 온보딩 예식장 기록은 제목 자체가 식장 이름이다. 지금 예식장이 정해져 있고 그 이름과
  // 다르면, 이 기록은 "지금 어디로 하기로 했나"가 아니라 "예전에 어디를 봤나"이다.
  if (decision.category === "venue" && nonEmpty(current.venue)) {
    if (nonEmpty(decision.title) && !sameText(decision.title, current.venue)) {
      return true;
    }
  }

  // 총예산은 바뀌어도 옛 영수증이 그대로 남는다. 예식장과 같은 문제이고, 금액이라
  // 사용자가 더 크게 체감한다(2026-08-22 파운더 지적).
  if (isSupersededBudgetDecision(decision, current)) return true;

  // 일정 영수증은 어느 일정에 대한 것인지(`eventId`)와 확정 직후의 모습(`after`)을 담는다.
  // 그 일정이 지금 없거나 날짜·제목이 달라졌으면 이 영수증은 지나간 판본이다.
  const chosen = decision.chosenValue;
  if (isRecord(chosen) && nonEmpty(chosen.eventId)) {
    const currentEvent = current.events.find((event) => event.id === chosen.eventId);
    if (!currentEvent) return true;

    const after = chosen.after;
    if (!isRecord(after)) return false;
    if (nonEmpty(after.date) && !sameText(after.date, currentEvent.date)) return true;
    if (nonEmpty(after.title) && !sameText(after.title, currentEvent.title)) return true;
  }

  return false;
}

export function dropSupersededDecisions<T extends DecisionForSupersessionCheck>(
  decisions: readonly T[],
  current: CurrentJourneyFacts,
): T[] {
  return decisions.filter((decision) => !isSupersededDecision(decision, current));
}

/**
 * 2026-09-03: 대조할 진실값이 아예 없는 category.
 *
 * `wedding_journeys` 에는 하객 수·예식 형태·시기에 해당하는 열이 없다. 그래서 위
 * `isSupersededDecision` 은 이 category 들을 **영원히 판정하지 못하고**, 방향을
 * 바꿔도 옛 영수증이 계속 "아직 유효한 것"으로 회상된다(운영 decision_nodes 실측:
 * timeline 50행·guestcount 4행·style 1행이 전부 `superseded_at` NULL 로 살아
 * 있고, 한 커플은 timeline 만 37행이었다).
 *
 * 대조값이 없으니 판정 대신 **시간**으로 가른다 — 같은 주제의 마지막 말만 남긴다.
 */
const CATEGORIES_WITHOUT_CURRENT_TRUTH: ReadonlySet<string> = new Set([
  "guestcount",
  "style",
  "timeline",
]);

export interface DecisionForRecencyCheck {
  readonly category: string;
  /** `decision_nodes.visibility`. 공유 결정과 개인 결정을 섞어 지우지 않는다. */
  readonly visibility: string;
  /** `decision_nodes.created_at` (ISO). 읽을 수 없으면 판단하지 않는다. */
  readonly createdAt: string;
  readonly chosenValue: Record<string, unknown> | null;
}

/**
 * 같은 category 안에서도 **다른 주제**인 영수증이 있다. 온보딩은 `timeline` 로
 * 결혼식 날짜(`{wedding_date}`)와 상견례 일정(`{sanggyeonrye_date}`)을 각각
 * 남긴다(apps/web/src/app/api/onboarding/route.ts). category 하나로만 묶으면
 * 상견례 일정을 적었다는 이유로 결혼식 날짜 영수증이 사라진다.
 *
 * 그래서 `chosen_value` 의 **키 모양**까지 묶음 열쇠에 넣는다. 대화에서 추출된
 * 결정은 전부 `{value}` 한 모양이므로(apps/web/src/lib/ai/extract-decision.ts),
 * "하객 180명 → 40명" 같은 방향 전환은 그대로 한 묶음이 된다.
 */
function recencyGroupKey(decision: DecisionForRecencyCheck): string {
  const shape = isRecord(decision.chosenValue)
    ? Object.keys(decision.chosenValue).sort().join(",")
    : "";
  return [decision.visibility, decision.category, shape].join("\u0000");
}

/**
 * 대조할 진실값이 없는 category 는 (visibility, category, 값 모양) 안에서
 * **가장 최근 1건만** 남긴다.
 *
 * DB 는 건드리지 않는다 — 이 파일 머리의 계약 그대로, 영수증은 감사 기록으로
 * 남고 아모라에게 현재처럼 보여주지 않을 뿐이다. 날짜를 읽을 수 없는 행은
 * 판단하지 않고 남긴다(사용자가 한 결정을 지우는 쪽이 더 나쁘다).
 */
export function dropOutdatedTruthlessDecisions<T extends DecisionForRecencyCheck>(
  decisions: readonly T[],
): T[] {
  const isGrouped = (decision: DecisionForRecencyCheck): boolean =>
    CATEGORIES_WITHOUT_CURRENT_TRUTH.has(decision.category)
    && Number.isFinite(Date.parse(decision.createdAt));

  const newestIndexByKey = new Map<string, number>();
  decisions.forEach((decision, index) => {
    if (!isGrouped(decision)) return;
    const key = recencyGroupKey(decision);
    const bestIndex = newestIndexByKey.get(key);
    if (bestIndex === undefined) {
      newestIndexByKey.set(key, index);
      return;
    }
    // 같은 시각이면 먼저 온 것을 남긴다 — 읽기 질의가 최신순이라 그것이 최신이다.
    if (Date.parse(decision.createdAt) > Date.parse(decisions[bestIndex].createdAt)) {
      newestIndexByKey.set(key, index);
    }
  });

  return decisions.filter((decision, index) => {
    if (!isGrouped(decision)) return true;
    return newestIndexByKey.get(recencyGroupKey(decision)) === index;
  });
}
