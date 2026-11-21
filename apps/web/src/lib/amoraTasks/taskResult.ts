import { AMORA_TASK_COPY, safeAmoraTaskSourceUrl, type AmoraTaskKind } from "@hanbang/shared/amora-tasks";
import { formatWon } from "@/lib/formatWon";
import { hasFinalConsonant } from "@/lib/ai/tools/toolTypes";
import { AMORA_TASK_KIND_SPECS, cleanTaskText, daysBetweenYmd, isValidYmd, addDaysYmd } from "./taskKinds";

/**
 * 맡은 일의 근거(evidence)와 결과 표.
 *
 * - 근거마다 번호가 있다(e 일정, a 할 일, q 견적, b 예산, d 날짜 후보, w 찾은 결과, p 공식 페이지, l 편지, r 답장).
 * - **표의 줄은 근거 번호를 하나 이상 달아야 남는다.** 번호가 없거나 없는 번호면 그 줄을 버린다.
 * - 표는 모든 종류에서 코드가 만든다. 모델은 요약과 다음에 할 일 고르기만 한다.
 * - 찾기가 드는 일의 표: 순위·추천 말이 든 줄은 버리고, 가격은 공식 페이지(p)를 근거로 단 줄에만 남긴다.
 *   아니면 "업체에 확인해 주세요"로 바꾼다(D-85). "확인한 날" 칸은 공식 페이지를 읽은 날이다.
 * - 저장하는 결과에는 업체 주소·도메인·링크를 남기지 않는다(2026-11-22 파운더 결정 4, 갈래 3 의 저장 카드와 같다).
 * - 다음에 할 일은 서버의 틀로 만든 글이다. 대화 입력칸에 채울 뿐이고 반영은 대화의 확인 카드가 한다.
 */

export type TaskEvidenceKind =
  | "event" | "action" | "quote" | "budget" | "date" | "web" | "page" | "letter" | "reply";

export type TaskEvidence = {
  id: string;
  kind: TaskEvidenceKind;
  title: string;
  detail: string;
  url: string | null;
  checkedOn: string;
  date?: string | null;
  facts?: { label: string; value: string }[];
  /** 갈래 3 이 모델용으로 만든 요약(공식 페이지). 네이버 결과의 글은 여기 오지 않는다. */
  modelSummary?: unknown;
  /** 공식 페이지(p)를 읽은 찾은 결과(w)의 번호. 페이지 주소를 남기지 않으므로 이것으로 표의 줄과 잇는다. */
  readFrom?: string;
};

export type TaskResultRow = { cells: string[]; sourceIds: string[] };
export type TaskNextAction = { label: string; prompt: string };

export type TaskResult = {
  summary: string;
  columns: string[];
  rows: TaskResultRow[];
  sources: { id: string; title: string; url: string | null; checkedOn: string }[];
  nextActions: TaskNextAction[];
};

const ID_PREFIX: Record<TaskEvidenceKind, string> = {
  event: "e", action: "a", quote: "q", budget: "b", date: "d", web: "w", page: "p", letter: "l", reply: "r",
};

export const MAX_EVIDENCE = 60;
const MAX_ROWS = 12;

/** 순위·추천·판정 말(I14). 이 말이 든 줄과 요약은 쓰지 않는다. */
export const JUDGEMENT_WORDS = /추천|최고|1위|순위|가성비|베스트|보장|강추|제일 좋|가장 좋|최저가|믿을 만|꼭 가/u;

const PRICE_LIKE = /\d[\d,.]*\s*(?:만\s*)?원/u;

export function nextEvidenceId(existing: readonly TaskEvidence[], kind: TaskEvidenceKind): string {
  const prefix = ID_PREFIX[kind];
  const count = existing.filter((item) => item.id.startsWith(prefix)).length;
  return `${prefix}${count + 1}`;
}

export function addEvidence(
  existing: readonly TaskEvidence[],
  item: Omit<TaskEvidence, "id">,
): TaskEvidence[] {
  if (existing.length >= MAX_EVIDENCE) return [...existing];
  const title = cleanTaskText(item.title, 120) ?? "";
  if (!title) return [...existing];
  return [...existing, {
    ...item,
    id: nextEvidenceId(existing, item.kind),
    title,
    detail: cleanTaskText(item.detail, 300) ?? "",
    url: item.url ? safeAmoraTaskSourceUrl(item.url) : null,
    ...(item.facts
      ? {
          facts: item.facts
            .map((fact) => ({ label: cleanTaskText(fact.label, 40) ?? "", value: cleanTaskText(fact.value, 120) ?? "" }))
            .filter((fact) => fact.label && fact.value)
            .slice(0, 12),
        }
      : {}),
    ...(item.modelSummary !== undefined && JSON.stringify(item.modelSummary ?? null).length <= 2_000
      ? { modelSummary: item.modelSummary }
      : {}),
  }];
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function weekdayLabel(ymd: string): string {
  return WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()] ?? "";
}

export function remainingLabel(todayYmd: string, ymd: string): string {
  const days = daysBetweenYmd(todayYmd, ymd);
  if (days === 0) return "오늘";
  if (days < 0) return "지났어요";
  return `${days}일`;
}

function formatShortDate(ymd: string): string {
  const [, month, day] = ymd.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

// ---------------------------------------------------------------------------
// 할 일과 마감
// ---------------------------------------------------------------------------

export function buildTodoDeadlineRows(evidence: readonly TaskEvidence[], todayYmd: string): TaskResultRow[] {
  const dated = evidence
    .filter((item) => (item.kind === "event" || item.kind === "action") && item.date && isValidYmd(item.date))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const undated = evidence.filter((item) => item.kind === "action" && !item.date);
  return [...dated, ...undated].slice(0, MAX_ROWS).map((item) => ({
    cells: [
      item.title,
      item.date ? formatShortDate(item.date) : item.detail || "정하지 않았어요",
      item.date ? remainingLabel(todayYmd, item.date) : "",
      item.kind === "event" ? "일정" : "할 일",
    ],
    sourceIds: [item.id],
  }));
}

// ---------------------------------------------------------------------------
// 날짜 후보
// ---------------------------------------------------------------------------

export type ScheduleEventLike = { date: string; title: string };

/**
 * 고른 기간 안에서 다른 일정이 없는 날을 모은다. 예식일은 뺀다. 주말만·평일만·아무 날을 고를 수 있다.
 * 계산은 한국 날짜(YYYY-MM-DD)로만 한다. 시각을 만들지 않으므로 UTC 어제 문제가 없다(기억 utc-today-bug-class).
 */
export function findDateCandidates(input: {
  fromDate: string;
  toDate: string;
  prefer: "weekend" | "weekday" | "any";
  events: readonly ScheduleEventLike[];
  weddingDate: string | null;
  limit?: number;
}): { date: string; sameWeek: string[] }[] {
  const busy = new Set(input.events.map((event) => event.date));
  const limit = input.limit ?? 8;
  const picked: { date: string; sameWeek: string[] }[] = [];
  for (let date = input.fromDate; date <= input.toDate && picked.length < limit; date = addDaysYmd(date, 1)) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = day === 0 || day === 6;
    if (input.prefer === "weekend" && !weekend) continue;
    if (input.prefer === "weekday" && weekend) continue;
    if (busy.has(date) || date === input.weddingDate) continue;
    const weekStart = addDaysYmd(date, -day);
    const weekEnd = addDaysYmd(weekStart, 6);
    const sameWeek = input.events
      .filter((event) => event.date >= weekStart && event.date <= weekEnd)
      .map((event) => `${formatShortDate(event.date)} ${event.title}`)
      .slice(0, 3);
    picked.push({ date, sameWeek });
  }
  return picked;
}

export function buildDateCandidateRows(evidence: readonly TaskEvidence[], todayYmd: string): TaskResultRow[] {
  return evidence
    .filter((item) => item.kind === "date" && item.date)
    .slice(0, MAX_ROWS)
    .map((item) => ({
      cells: [formatShortDate(item.date!), weekdayLabel(item.date!), remainingLabel(todayYmd, item.date!), item.detail || "없어요"],
      sourceIds: [item.id],
    }));
}

// ---------------------------------------------------------------------------
// 받은 견적
// ---------------------------------------------------------------------------

export type QuoteInput = { label: string; total_won: number | null; items: { name: string; won: number | null }[] };
export type BudgetCategoryLike = { key: string; label: string; allocated: number; allocated_is_set?: boolean };

export function quoteTotal(quote: QuoteInput): number | null {
  if (typeof quote.total_won === "number") return quote.total_won;
  const amounts = quote.items.map((item) => item.won).filter((won): won is number => typeof won === "number");
  return amounts.length > 0 ? amounts.reduce((sum, won) => sum + won, 0) : null;
}

export function matchBudgetCategory(
  category: string | null,
  categories: readonly BudgetCategoryLike[],
): BudgetCategoryLike | null {
  if (!category) return null;
  const needle = category.replace(/\s+/g, "");
  return categories.find((entry) => entry.key === category)
    ?? categories.find((entry) => entry.label.replace(/\s+/g, "") === needle)
    ?? categories.find((entry) => entry.label.replace(/\s+/g, "").includes(needle))
    ?? null;
}

export function budgetDifferenceLabel(total: number | null, budget: BudgetCategoryLike | null): string {
  if (total === null) return "합계를 알 수 없어요";
  if (!budget || budget.allocated_is_set === false || !Number.isSafeInteger(budget.allocated) || budget.allocated <= 0) {
    return "예산을 정하지 않았어요";
  }
  const diff = total - budget.allocated;
  if (diff === 0) return "예산과 같아요";
  return diff > 0 ? `예산보다 ${formatWon(diff)} 많아요` : `예산보다 ${formatWon(-diff)} 적어요`;
}

export function buildQuoteRows(evidence: readonly TaskEvidence[]): TaskResultRow[] {
  const budget = evidence.find((item) => item.kind === "budget");
  return evidence
    .filter((item) => item.kind === "quote")
    .slice(0, MAX_ROWS)
    .map((item) => {
      const [totalLabel = "", included = "", difference = ""] = (item.facts ?? []).map((fact) => fact.value);
      return {
        cells: [item.title, totalLabel, included, difference],
        sourceIds: budget ? [item.id, budget.id] : [item.id],
      };
    });
}

// ---------------------------------------------------------------------------
// 찾기가 드는 일: 표는 서버가 짠다(네이버 결과는 모델에게 주지 않는다)
// ---------------------------------------------------------------------------

function priceFrom(page: TaskEvidence | undefined, pattern: RegExp, mustBeWon = true): string {
  const fact = page?.facts?.find((item) => pattern.test(item.label));
  return fact && (!mustBeWon || PRICE_LIKE.test(fact.value)) ? fact.value : AMORA_TASK_COPY.priceUnknown;
}

/**
 * 같은 기준 표를 서버가 짠다(갈래 3 권고). 업체 이름은 네이버 결과(w), 가격은 공식 페이지(p)에서만 온다.
 * 공식 페이지를 읽지 못한 곳의 가격은 "업체에 확인해 주세요"다(D-85). 이름에 순위·추천 말이 든 줄(모음 글)은 뺀다.
 * 마지막 칸은 공식 페이지를 읽은 날이고 도메인은 적지 않는다(2026-11-22 파운더 결정 4). 공식 페이지는 주소가 아니라
 * 읽은 찾은 결과의 번호(readFrom)로 그 줄과 잇는다. 업체 이름(w)을 저장해도 되는지는 네이버의 답을 기다린다.
 */
export function buildSearchRows(
  kind: AmoraTaskKind,
  evidence: readonly TaskEvidence[],
  input: Record<string, unknown>,
): TaskResultRow[] {
  const pages = evidence.filter((item) => item.kind === "page");
  const region = typeof input.region === "string" ? input.region : "";
  const field = typeof input.field === "string" ? input.field : "스드메";
  const rows = evidence
    .filter((item) => item.kind === "web" && !JUDGEMENT_WORDS.test(item.title))
    .map((web) => {
      const page = pages.find((candidate) => candidate.readFrom === web.id);
      const checked = page && isValidYmd(page.checkedOn) ? formatShortDate(page.checkedOn) : "";
      const cells = kind === "hall_candidates"
        ? [web.title, region, priceFrom(page, /식대|식사|1인/u), priceFrom(page, /대관/u), priceFrom(page, /보증/u, false), checked]
        : [web.title, field, region, priceFrom(page, /가격|패키지|촬영|드레스|메이크업|스드메/u), "", checked];
      return { cells, sourceIds: page ? [web.id, page.id] : [web.id], hasPage: page !== undefined };
    });
  return [...rows.filter((row) => row.hasPage), ...rows.filter((row) => !row.hasPage)]
    .slice(0, MAX_ROWS)
    .map(({ cells, sourceIds }) => ({ cells, sourceIds }));
}

/**
 * 끝난 일의 진행 기록에서 찾은 결과(w)의 주소·전화·링크를 지운다(2026-11-22 파운더 결정 4). 링크는 공식 페이지를
 * 읽는 동안에만 필요하다. 확인이 필요해 멈춘 일은 이어 하기(resume)가 같은 진행에서 다시 읽으므로 거기서는 부르지 않는다.
 */
export function withoutSearchAddresses(evidence: readonly TaskEvidence[]): TaskEvidence[] {
  return evidence.map((item) => (item.kind === "web" ? { ...item, url: null, detail: "" } : item));
}

// ---------------------------------------------------------------------------
// 다음에 할 일(서버의 틀)
// ---------------------------------------------------------------------------

export type NextActionType = "add_schedule" | "add_todo" | "draft_inquiry" | "visit_schedule" | "set_category_budget";

export const NEXT_ACTION_TYPES_BY_KIND: Readonly<Record<AmoraTaskKind, readonly NextActionType[]>> = Object.freeze({
  todo_deadlines: ["add_schedule", "add_todo"],
  date_candidates: ["add_schedule"],
  quote_compare: ["set_category_budget"],
  hall_candidates: ["draft_inquiry", "visit_schedule"],
  sdm_candidates: ["draft_inquiry", "visit_schedule"],
  inquiry_letters: ["visit_schedule"],
  reply_digest: ["add_schedule"],
});

function nextActionFor(
  kind: AmoraTaskKind,
  type: NextActionType,
  row: TaskResultRow,
  input: Record<string, unknown>,
): TaskNextAction | null {
  const name = cleanTaskText(row.cells[0], 40);
  if (!name) return null;
  switch (type) {
    case "add_schedule": {
      if (kind === "date_candidates") {
        const purpose = typeof input.purpose === "string" ? input.purpose : "약속";
        return { label: "일정에 넣기", prompt: `${name}에 ${purpose} 일정을 넣어 줘` };
      }
      const when = cleanTaskText(row.cells[1], 20);
      return when && /월 \d+일/u.test(when)
        ? { label: "일정에 넣기", prompt: `${name} 일정을 ${when}로 넣어 줘` }
        : null;
    }
    case "add_todo":
      return { label: "할 일로 넣기", prompt: `${name}${hasFinalConsonant(name) ? "을" : "를"} 함께 할 일에 넣어 줘` };
    case "draft_inquiry":
      return { label: "문의 글 쓰기", prompt: `${name}에 보낼 문의 글을 써 줘` };
    case "visit_schedule":
      return { label: "상담 일정 넣기", prompt: `${name} 상담 일정을 넣고 싶어` };
    case "set_category_budget": {
      const category = typeof input.category === "string" ? input.category : null;
      const total = cleanTaskText(row.cells[1], 20);
      return category && total ? { label: "예산에 적기", prompt: `${category} 예산을 ${total}으로 바꿔 줘` } : null;
    }
    default:
      return null;
  }
}

/** 모델이 고른 (종류, 줄 번호)를 서버의 틀로 바꾼다. 고른 것이 없거나 틀리면 앞쪽 줄로 하나를 만든다. */
export function buildNextActions(
  kind: AmoraTaskKind,
  rows: readonly TaskResultRow[],
  choices: unknown,
  input: Record<string, unknown>,
): TaskNextAction[] {
  const allowed = new Set(NEXT_ACTION_TYPES_BY_KIND[kind]);
  const picked: TaskNextAction[] = [];
  const seen = new Set<string>();
  const push = (type: NextActionType, rowIndex: number) => {
    const row = rows[rowIndex];
    if (!row || !allowed.has(type)) return;
    const action = nextActionFor(kind, type, row, input);
    if (!action || seen.has(action.prompt)) return;
    seen.add(action.prompt);
    picked.push(action);
  };
  if (Array.isArray(choices)) {
    for (const choice of choices.slice(0, 3)) {
      if (!choice || typeof choice !== "object") continue;
      const record = choice as { type?: unknown; row?: unknown };
      if (typeof record.type === "string" && Number.isSafeInteger(record.row)) {
        push(record.type as NextActionType, record.row as number);
      }
    }
  }
  if (picked.length === 0 && rows.length > 0) push(NEXT_ACTION_TYPES_BY_KIND[kind][0], 0);
  return picked.slice(0, 3);
}

// ---------------------------------------------------------------------------
// 결과 묶기
// ---------------------------------------------------------------------------

export function safeSummary(value: unknown, fallback: string): string {
  const summary = cleanTaskText(value, 400);
  if (!summary || JUDGEMENT_WORDS.test(summary)) return fallback;
  return summary;
}

export function assembleTaskResult(input: {
  kind: AmoraTaskKind;
  summary: string;
  rows: readonly TaskResultRow[];
  evidence: readonly TaskEvidence[];
  nextActions: readonly TaskNextAction[];
}): TaskResult {
  const cited = new Set(input.rows.flatMap((row) => row.sourceIds));
  // 찾은 결과(w)의 링크는 네이버 지역 결과의 link 라서 저장하는 출처에 남기지 않는다(2026-11-22 파운더 결정 4,
  // 검색 API 특약 1.3·1.4). 공식 페이지(p)는 처음부터 주소 없이 남기고, 앱 안 자료에는 주소가 없다.
  const sources = input.evidence
    .filter((item) => cited.has(item.id))
    .map((item) => ({ id: item.id, title: item.title, url: item.kind === "web" ? null : item.url, checkedOn: item.checkedOn }));
  return {
    summary: input.summary,
    columns: [...AMORA_TASK_KIND_SPECS[input.kind].columns],
    rows: input.rows.map((row) => ({ cells: [...row.cells], sourceIds: [...row.sourceIds] })),
    sources,
    nextActions: [...input.nextActions],
  };
}
