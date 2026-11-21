import type { AmoraTaskReviewReason } from "@hanbang/shared/amora-tasks";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { formatWon } from "@/lib/formatWon";
import type { ToolExecutionResult } from "@/types/database.types";
import type { AmoraTaskAdapters } from "./adapters";
import {
  AMORA_TASK_ACTIONS_PER_SLICE,
  AMORA_TASK_LEASE_SECONDS,
  AMORA_TASK_LIMITS,
  amoraTaskGlobalCostCapMicrousd,
  amoraTaskStepReservationMicrousd,
} from "./config";
import { AMORA_TASK_KIND_SPECS, addDaysYmd, cleanTaskText, isValidYmd } from "./taskKinds";
import {
  PLAN_STEP_SCHEMA,
  ORGANIZE_SCHEMA,
  buildOrganizeInput,
  buildOrganizeInstructions,
  buildPlanInput,
  buildPlanInstructions,
  checkTaskSearchQuery,
  validateOrganizeOutput,
  validatePlanStep,
  type TaskModelCall,
  type TaskModelUsage,
} from "./taskModel";
import {
  addEvidence,
  assembleTaskResult,
  budgetDifferenceLabel,
  buildDateCandidateRows,
  buildNextActions,
  buildQuoteRows,
  buildTodoDeadlineRows,
  findDateCandidates,
  matchBudgetCategory,
  quoteTotal,
  safeSummary,
  buildSearchRows,
  type BudgetCategoryLike,
  type QuoteInput,
  type TaskEvidence,
  type TaskResultRow,
} from "./taskResult";
import type { AmoraTaskRow, AmoraTaskStore } from "./taskStore";
import type { AmoraTaskToolContext } from "./taskTools";

/**
 * 맡은 일 일꾼. 크론(`/api/cron/amora-tasks`)과 맡기기 직후의 한 번이 부른다.
 *
 * 한 번에 한 일을 선점해 정해진 걸음 수만큼 나아가고, 걸음마다 진행을 저장한다(선점 토큰이 맞을 때만 저장된다).
 * 다 못 하면 토큰을 돌려주고 쉰다. 다음 차례가 저장된 진행에서 잇는다.
 *
 * 걸음마다 먼저 예약한다. 모델 걸음은 맡은 일 장부(일 하나·커플 하루·서비스 전체 20%)와 전역 지갑
 * (`reserveAmoraTurn` background) 둘 다 지나야 하고, 인터넷 찾기는 맡은 일 장부를 지나야 한다.
 * 하나라도 막히면 그 자리에서 멈추고 "확인해 주세요" 로 둔다.
 */

export class AmoraTaskBudgetError extends Error {
  constructor(readonly reason: string) {
    super(`AMORA_TASK_BUDGET_${reason}`);
    this.name = "AmoraTaskBudgetError";
  }
}

export type AmoraTaskWorkerDeps = {
  store: AmoraTaskStore;
  adapters: AmoraTaskAdapters;
  callModel: TaskModelCall;
  readTool: (name: string, input: Record<string, unknown>, context: AmoraTaskToolContext) => Promise<ToolExecutionResult>;
  loadWeddingContext: (coupleId: string) => Promise<ToolExecutionContext["weddingContext"]>;
  /** 커플 회원 이름. 찾기 거르개(갈래 3 `blockedTerms`)에만 쓰고 진행 기록·모델 입력에는 넣지 않는다. */
  loadCoupleNames: (coupleId: string) => Promise<string[]>;
  reserveGlobalWallet: (coupleId: string, costMicrousd: number) => Promise<boolean>;
  todayYmd: () => string;
  nowMs: () => number;
  env?: NodeJS.ProcessEnv;
};

type TaskProgress = {
  v: 1;
  phase: "gather" | "organize";
  evidence: TaskEvidence[];
  searches: number;
  reads: number;
  readIds: string[];
  queries: string[];
  /** 갈래 3 이 모델용으로 만든 찾기 요약. 네이버 결과의 글은 담지 않는다. */
  searchSummaries: unknown[];
  invalidSteps: number;
  providerErrors: number;
  gatePassed: boolean;
};

const MAX_SEARCHES = 6;
const MAX_READS = 6;
const MAX_ITEMS_PER_SEARCH = 5;
const MAX_PROVIDER_ERRORS = 3;
const RETRY_DELAY_SECONDS = 60;

function parseProgress(value: Record<string, unknown>): TaskProgress {
  const evidence = Array.isArray(value.evidence) ? value.evidence as TaskEvidence[] : [];
  const number = (key: string) => (typeof value[key] === "number" && Number.isSafeInteger(value[key]) ? value[key] as number : 0);
  return {
    v: 1,
    phase: value.phase === "organize" ? "organize" : "gather",
    evidence,
    searches: number("searches"),
    reads: number("reads"),
    readIds: Array.isArray(value.readIds) ? value.readIds.filter((id): id is string => typeof id === "string") : [],
    queries: Array.isArray(value.queries) ? value.queries.filter((query): query is string => typeof query === "string").slice(-12) : [],
    searchSummaries: Array.isArray(value.searchSummaries) ? value.searchSummaries.slice(-6) : [],
    invalidSteps: number("invalidSteps"),
    providerErrors: number("providerErrors"),
    gatePassed: value.gatePassed === true,
  };
}

const BUDGET_REASONS: ReadonlySet<string> = new Set([
  "daily_step_limit", "daily_search_limit", "background_budget", "task_step_limit",
]);

export type SliceOutcome =
  | { kind: "done" }
  | { kind: "needs_review"; reason: AmoraTaskReviewReason }
  | { kind: "paused" }
  | { kind: "lost" };

type SliceState = {
  task: AmoraTaskRow;
  leaseToken: string;
  progress: TaskProgress;
  deps: AmoraTaskWorkerDeps;
  pending: TaskModelUsage;
};

/** 지금 단계의 상태. 걸음 함수가 진행을 바꾸므로 그때그때 읽는다(타입 좁히기를 피한다). */
function phaseStatus(state: SliceState): "searching" | "organizing" {
  return state.progress.phase === "organize" ? "organizing" : "searching";
}

async function save(state: SliceState, status: "searching" | "organizing", label: string | null): Promise<boolean> {
  const ok = await state.deps.store.saveProgress({
    taskId: state.task.id,
    leaseToken: state.leaseToken,
    status,
    progress: state.progress as unknown as Record<string, unknown>,
    stepLabel: label,
    inputTokens: state.pending.inputTokens,
    outputTokens: state.pending.outputTokens,
    costMicrousd: state.pending.costMicrousd,
    leaseSeconds: AMORA_TASK_LEASE_SECONDS,
  });
  state.pending = { inputTokens: 0, outputTokens: 0, costMicrousd: 0 };
  return ok;
}

async function review(state: SliceState, reason: AmoraTaskReviewReason, errorCode: string | null = null): Promise<SliceOutcome> {
  if (state.pending.costMicrousd > 0 || state.pending.inputTokens > 0) {
    await save(state, phaseStatus(state), null);
  }
  const ok = await state.deps.store.finish({
    taskId: state.task.id,
    leaseToken: state.leaseToken,
    status: "needs_review",
    reviewReason: reason,
    result: null,
    errorCode,
    stepLabel: "확인이 필요해 멈췄어요",
  });
  return ok ? { kind: "needs_review", reason } : { kind: "lost" };
}

function reserveModelStep(state: SliceState): () => Promise<void> {
  return async () => {
    const env = state.deps.env ?? process.env;
    const cost = amoraTaskStepReservationMicrousd();
    if (cost === null) throw new AmoraTaskBudgetError("background_budget");
    const reservation = await state.deps.store.reserveUsage({
      taskId: state.task.id,
      leaseToken: state.leaseToken,
      usage: "model_step",
      costMicrousd: cost,
      taskCap: AMORA_TASK_LIMITS.taskModelSteps,
      coupleDailyCap: AMORA_TASK_LIMITS.dailyModelSteps,
      globalCostCapMicrousd: amoraTaskGlobalCostCapMicrousd(env),
    });
    if (!reservation.allowed) throw new AmoraTaskBudgetError(reservation.reason ?? "background_budget");
    const wallet = await state.deps.reserveGlobalWallet(state.task.couple_id, cost);
    if (!wallet) throw new AmoraTaskBudgetError("background_budget");
  };
}

async function reserveWebSearch(state: SliceState): Promise<string | null> {
  const reservation = await state.deps.store.reserveUsage({
    taskId: state.task.id,
    leaseToken: state.leaseToken,
    usage: "web_search",
    costMicrousd: 0,
    taskCap: AMORA_TASK_LIMITS.taskWebSearches,
    coupleDailyCap: AMORA_TASK_LIMITS.dailyWebSearches,
    globalCostCapMicrousd: amoraTaskGlobalCostCapMicrousd(state.deps.env ?? process.env),
  });
  return reservation.allowed ? null : reservation.reason ?? "daily_search_limit";
}

function toolContext(state: SliceState, weddingContext: ToolExecutionContext["weddingContext"]): AmoraTaskToolContext {
  return { coupleId: state.task.couple_id, taskId: state.task.id, runCount: state.task.run_count, weddingContext };
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** 앱 안 자료로 하는 일의 모으기(모델 없이 한 번에). */
async function gatherFromPlan(state: SliceState): Promise<void> {
  const { task, deps } = state;
  const today = deps.todayYmd();
  const weddingContext = await deps.loadWeddingContext(task.couple_id);
  const context = toolContext(state, weddingContext);
  const input = task.input;
  let evidence = state.progress.evidence;

  if (task.kind === "todo_deadlines") {
    const horizon = typeof input.horizon_days === "number" ? input.horizon_days : 60;
    const events = await deps.readTool("get_schedule_events", { from_date: today, to_date: addDaysYmd(today, horizon) }, context);
    for (const event of Array.isArray(record(events.toolOutput).events) ? record(events.toolOutput).events as unknown[] : []) {
      const item = record(event);
      if (typeof item.title !== "string" || !isValidYmd(item.date)) continue;
      evidence = addEvidence(evidence, {
        kind: "event", title: item.title, detail: typeof item.time === "string" ? item.time : "",
        url: null, checkedOn: today, date: item.date,
      });
    }
    const actions = await deps.readTool("get_amora_actions", { status: "open" }, context);
    for (const action of Array.isArray(record(actions.toolOutput).actions) ? record(actions.toolOutput).actions as unknown[] : []) {
      const item = record(action);
      if (typeof item.title !== "string") continue;
      const due = typeof item.dueDate === "string" ? item.dueDate : "";
      evidence = addEvidence(evidence, {
        kind: "action", title: item.title, detail: isValidYmd(due) ? "" : due,
        url: null, checkedOn: today, date: isValidYmd(due) ? due : null,
      });
    }
  }

  if (task.kind === "date_candidates") {
    const from = String(input.from_date);
    const to = String(input.to_date);
    const events = await deps.readTool("get_schedule_events", { from_date: addDaysYmd(from, -6), to_date: addDaysYmd(to, 6) }, context);
    const list = (Array.isArray(record(events.toolOutput).events) ? record(events.toolOutput).events as unknown[] : [])
      .map(record)
      .filter((item): item is { date: string; title: string } => isValidYmd(item.date) && typeof item.title === "string");
    const prefer = input.prefer === "weekday" || input.prefer === "any" ? input.prefer : "weekend";
    for (const candidate of findDateCandidates({ fromDate: from, toDate: to, prefer, events: list, weddingDate: weddingContext.weddingDate })) {
      evidence = addEvidence(evidence, {
        kind: "date", title: candidate.date, detail: candidate.sameWeek.join(", "),
        url: null, checkedOn: today, date: candidate.date,
      });
    }
  }

  if (task.kind === "quote_compare") {
    const summary = await deps.readTool("get_budget_summary", {}, context);
    const categories = (Array.isArray(record(summary.toolOutput).categories) ? record(summary.toolOutput).categories as unknown[] : [])
      .map(record)
      .filter((item): item is BudgetCategoryLike => typeof item.key === "string" && typeof item.label === "string" && typeof item.allocated === "number");
    const category = typeof input.category === "string" ? input.category : null;
    const matched = matchBudgetCategory(category, categories);
    if (matched) {
      evidence = addEvidence(evidence, {
        kind: "budget", title: `${matched.label} 예산`,
        detail: matched.allocated > 0 && matched.allocated_is_set !== false ? formatWon(matched.allocated) : "정하지 않았어요",
        url: null, checkedOn: today,
      });
    }
    for (const quote of Array.isArray(input.quotes) ? input.quotes as QuoteInput[] : []) {
      const total = quoteTotal(quote);
      const included = quote.items.map((item) => item.name).join(", ");
      evidence = addEvidence(evidence, {
        kind: "quote", title: quote.label, detail: "", url: null, checkedOn: today,
        facts: [
          { label: "합계", value: total === null ? "합계를 알 수 없어요" : formatWon(total) },
          { label: "포함 항목", value: included || "항목을 적지 않았어요" },
          { label: "예산과 차이", value: budgetDifferenceLabel(total, matched) },
        ],
      });
    }
  }

  if (task.kind === "inquiry_letters" && deps.adapters.inquiry) {
    const recipients = Array.isArray(input.recipients) ? input.recipients.filter((name): name is string => typeof name === "string") : [];
    for (const draft of await deps.adapters.inquiry.draftLetters({ coupleId: task.couple_id, recipients })) {
      evidence = addEvidence(evidence, { kind: "letter", title: draft.name, detail: draft.text, url: null, checkedOn: today });
    }
  }

  if (task.kind === "reply_digest" && deps.adapters.inquiry) {
    for (const reply of await deps.adapters.inquiry.listReplies({ coupleId: task.couple_id })) {
      evidence = addEvidence(evidence, {
        kind: "reply", title: reply.name, detail: [reply.time, reply.note].filter(Boolean).join(" "),
        url: null, checkedOn: today, date: reply.date && isValidYmd(reply.date) ? reply.date : null,
      });
    }
  }

  state.progress = { ...state.progress, evidence, phase: "organize" };
}

function serverRows(
  kind: AmoraTaskRow["kind"],
  evidence: readonly TaskEvidence[],
  today: string,
  input: Record<string, unknown>,
): TaskResultRow[] | null {
  switch (kind) {
    case "todo_deadlines": return buildTodoDeadlineRows(evidence, today);
    case "date_candidates": return buildDateCandidateRows(evidence, today);
    case "quote_compare": return buildQuoteRows(evidence);
    case "inquiry_letters":
      return evidence.filter((item) => item.kind === "letter").map((item) => ({ cells: [item.title, item.detail], sourceIds: [item.id] }));
    case "reply_digest":
      return evidence.filter((item) => item.kind === "reply").map((item) => ({
        cells: [item.title, item.date ?? "정하지 않았어요", "", item.detail], sourceIds: [item.id],
      }));
    case "hall_candidates":
    case "sdm_candidates":
      return buildSearchRows(kind, evidence, input);
    default:
      return null;
  }
}

const EMPTY_SUMMARY: Record<AmoraTaskRow["kind"], string> = {
  todo_deadlines: "앞으로 다가오는 일정과 할 일을 날짜 순서로 모았어요.",
  date_candidates: "다른 일정과 겹치지 않는 날을 모았어요.",
  quote_compare: "받은 견적을 같은 항목으로 나눠 모았어요.",
  hall_candidates: "공식 안내에서 확인한 것을 같은 기준으로 모았어요.",
  sdm_candidates: "공식 안내에서 확인한 것을 같은 기준으로 모았어요.",
  inquiry_letters: "업체마다 보낼 문의 글을 써 두었어요. 보내기는 두 분이 직접 해요.",
  reply_digest: "받은 답장의 날짜와 시간을 모았어요.",
};

async function organize(state: SliceState): Promise<SliceOutcome> {
  const { task, deps } = state;
  const today = deps.todayYmd();
  const evidence = state.progress.evidence;
  const builtRows = serverRows(task.kind, evidence, today, task.input) ?? [];
  const columns = AMORA_TASK_KIND_SPECS[task.kind].columns;
  // 표는 모든 종류에서 서버가 짠다. 모델은 요약과 다음에 할 일 고르기만 한다.
  // 찾기 일의 표에는 네이버 칸이 있으므로 모델에게 표를 주지 않는다(약관: 검색 데이터를 AI 입력으로 쓰지 않음).
  const tableForModel = AMORA_TASK_KIND_SPECS[task.kind].needs === "web_search" ? null : { columns, rows: builtRows };
  const response = await deps.callModel({
    instructions: buildOrganizeInstructions(task.kind, true),
    input: buildOrganizeInput(task.input, evidence, tableForModel),
    schemaName: "amora_task_organize_v1",
    schema: ORGANIZE_SCHEMA,
    validate: validateOrganizeOutput,
    coupleId: task.couple_id,
    userId: task.requested_by,
    reserveStep: reserveModelStep(state),
  });
  state.pending = addUsage(state.pending, response.usage);
  const rows = builtRows;
  if (rows.length === 0 && cleanTaskText(response.data.needsInput, 120)) {
    return review(state, "needs_input");
  }
  const result = assembleTaskResult({
    kind: task.kind,
    summary: rows.length === 0
      ? "조건에 맞는 것을 아직 찾지 못했어요. 조건을 바꿔 다시 맡겨 보세요."
      : safeSummary(response.data.summary, EMPTY_SUMMARY[task.kind]),
    rows,
    evidence,
    nextActions: buildNextActions(task.kind, rows, response.data.nextActions, task.input),
  });
  if (!(await save(state, "organizing", "정리를 마쳤어요"))) return { kind: "lost" };
  const ok = await deps.store.finish({
    taskId: task.id,
    leaseToken: state.leaseToken,
    status: "done",
    reviewReason: null,
    result: result as unknown as Record<string, unknown>,
    errorCode: null,
    stepLabel: null,
  });
  return ok ? { kind: "done" } : { kind: "lost" };
}

function addUsage(a: TaskModelUsage, b: TaskModelUsage): TaskModelUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costMicrousd: a.costMicrousd + b.costMicrousd,
  };
}

/** 찾기 일의 한 걸음. 나아가면 저장 이름을, 다음이 정리면 "organize" 를, 멈춰야 하면 결과를 준다. */
async function searchStep(state: SliceState): Promise<{ label: string } | { outcome: SliceOutcome }> {
  const { task, deps } = state;
  const search = deps.adapters.webSearch;
  if (!search) return { outcome: await review(state, "source_unavailable") };
  const progress = state.progress;
  if (progress.searches >= MAX_SEARCHES || progress.reads >= MAX_READS || progress.invalidSteps >= 2
    || task.model_steps >= AMORA_TASK_LIMITS.taskModelSteps - 1) {
    state.progress = { ...progress, phase: "organize" };
    return { label: "찾은 것을 정리하기 시작했어요" };
  }
  const response = await deps.callModel({
    instructions: buildPlanInstructions(task.kind),
    input: buildPlanInput(task.input, progress.evidence, { searches: progress.searches, reads: progress.reads }, progress.searchSummaries),
    schemaName: "amora_task_plan_v1",
    schema: PLAN_STEP_SCHEMA,
    validate: validatePlanStep,
    coupleId: task.couple_id,
    userId: task.requested_by,
    reserveStep: reserveModelStep(state),
  });
  state.pending = addUsage(state.pending, response.usage);
  task.model_steps += 1;
  const step = response.data;
  const today = deps.todayYmd();

  if (step.action === "finish") {
    state.progress = { ...state.progress, phase: "organize" };
    return { label: "찾은 것을 정리하기 시작했어요" };
  }

  if (step.action === "search") {
    const query = checkTaskSearchQuery(step.query, task.input);
    if (!query || progress.queries.includes(query)) {
      // 검사에 걸리거나 이미 쓴 검색어는 보내지 않는다(같은 검색을 되풀이하면 찾기 횟수만 쓴다).
      state.progress = { ...progress, invalidSteps: progress.invalidSteps + 1 };
      return { label: "검색어를 다시 고르고 있어요" };
    }
    // 커플 이름이 든 낱말은 네이버로 보내지 않는다(갈래 3 blockedTerms). 이름을 못 읽으면 던져서 이번 차례를 쉬고,
    // 찾기 몫도 잡지 않는다. 이름은 이 호출에만 쓰고 진행 기록에 남기지 않는다.
    const blockedTerms = await deps.loadCoupleNames(task.couple_id);
    const denied = await reserveWebSearch(state);
    if (denied) {
      if (progress.evidence.length > 0) {
        state.progress = { ...progress, phase: "organize" };
        return { label: "찾은 것을 정리하기 시작했어요" };
      }
      return { outcome: await review(state, denied === "task_step_limit" ? "task_step_limit" : "daily_search_limit") };
    }
    const userTexts = typeof task.input.request_text === "string" ? [task.input.request_text] : [];
    const found = await search.search({ query, coupleId: task.couple_id, userTexts, blockedTerms });
    if (!found.ok) {
      if (found.reason === "daily_limit") return { outcome: await review(state, "daily_search_limit") };
      if (found.reason === "unavailable") return { outcome: await review(state, "source_unavailable") };
      state.progress = {
        ...progress, searches: progress.searches + 1, invalidSteps: progress.invalidSteps + 1, queries: [...progress.queries, query],
      };
      return { label: "다른 검색어로 찾아보고 있어요" };
    }
    // 네이버 칸(이름·주소·전화·홈페이지)은 서버가 표를 짜는 데만 쓴다. 모델에게는 번호표와 갈래 3 의 요약만 간다.
    let evidence = progress.evidence;
    for (const item of found.items.slice(0, MAX_ITEMS_PER_SEARCH)) {
      if (!item.name) continue;
      if (evidence.some((existing) => existing.kind === "web"
        && ((existing.url && existing.url === item.url) || existing.title === item.name))) continue;
      evidence = addEvidence(evidence, {
        kind: "web", title: item.name, detail: [item.address, item.phone].filter(Boolean).join(" "),
        url: item.url, checkedOn: today,
      });
    }
    state.progress = {
      ...progress, evidence, searches: progress.searches + 1, queries: [...progress.queries, query],
      searchSummaries: [...progress.searchSummaries, found.modelSummary ?? null].slice(-6),
    };
    return { label: `찾아봤어요(${progress.searches + 1}번째)` };
  }

  // read: 찾은 결과(w 번호) 가운데 아직 읽지 않은 것만.
  const target = progress.evidence.find((item) => item.id === step.sourceId && item.kind === "web" && item.url);
  if (!target || progress.readIds.includes(target.id)) {
    state.progress = { ...progress, invalidSteps: progress.invalidSteps + 1 };
    return { label: "읽을 곳을 다시 고르고 있어요" };
  }
  const denied = await reserveWebSearch(state);
  if (denied) {
    state.progress = { ...progress, phase: "organize" };
    return { label: "찾은 것을 정리하기 시작했어요" };
  }
  // 찾은 결과에 있던 주소만 읽는다(갈래 3 이 sourceUrls 밖 주소를 거절한다).
  const sourceUrls = progress.evidence
    .filter((item) => item.kind === "web" && item.url)
    .map((item) => item.url as string);
  const page = await search.readPage({ url: target.url!, coupleId: task.couple_id, sourceUrls });
  const readIds = [...progress.readIds, target.id];
  if (!page.ok) {
    state.progress = { ...progress, readIds, reads: progress.reads + 1 };
    return { label: "공식 안내를 읽지 못해 다른 곳을 보고 있어요" };
  }
  const evidence = addEvidence(progress.evidence, {
    kind: "page", title: page.title || target.title, detail: "", url: page.url, checkedOn: today,
    facts: page.prices.map((price) => ({ label: price.label, value: price.amount })),
    modelSummary: page.modelSummary,
  });
  state.progress = { ...progress, evidence, readIds, reads: progress.reads + 1 };
  return { label: "공식 안내를 읽었어요" };
}

/** 선점한 일 하나를 정해진 걸음만큼 나아가게 한다. */
export async function runAmoraTaskSlice(task: AmoraTaskRow, deps: AmoraTaskWorkerDeps, deadlineMs: number): Promise<SliceOutcome> {
  if (!task.lease_token) return { kind: "lost" };
  const state: SliceState = {
    task,
    leaseToken: task.lease_token,
    progress: parseProgress(task.progress),
    deps,
    pending: { inputTokens: 0, outputTokens: 0, costMicrousd: 0 },
  };
  const spec = AMORA_TASK_KIND_SPECS[task.kind];

  try {
    if (!state.progress.gatePassed) {
      if (!task.requested_by) return review(state, "gate_blocked");
      const gateText = [task.title, ...Object.values(task.input).flatMap((value) => (typeof value === "string" ? [value] : []))].join("\n");
      const gate = await deps.adapters.checkGate({ text: gateText, surface: "amora_task_request", userId: task.requested_by, coupleId: task.couple_id });
      if (!gate.allowed) return review(state, "gate_blocked");
      state.progress = { ...state.progress, gatePassed: true };
    }
    if (spec.needs === "web_search" && !deps.adapters.webSearch) return review(state, "source_unavailable");
    if (spec.needs === "inquiry" && !deps.adapters.inquiry) return review(state, "source_unavailable");

    for (let action = 0; action < AMORA_TASK_ACTIONS_PER_SLICE; action += 1) {
      if (deps.nowMs() > deadlineMs) break;
      if (state.progress.phase === "organize") return await organize(state);
      if (spec.needs === "web_search") {
        const step = await searchStep(state);
        if ("outcome" in step) return step.outcome;
        if (!(await save(state, phaseStatus(state), step.label))) {
          return { kind: "lost" };
        }
        continue;
      }
      await gatherFromPlan(state);
      if (!(await save(state, "organizing", "준비 기록을 읽었어요"))) return { kind: "lost" };
    }
    await save(state, phaseStatus(state), null);
    const released = await deps.store.release(task.id, state.leaseToken, 0);
    return released ? { kind: "paused" } : { kind: "lost" };
  } catch (error) {
    if (error instanceof AmoraTaskBudgetError) {
      if (error.reason === "lease_lost") return { kind: "lost" };
      return review(state, BUDGET_REASONS.has(error.reason) ? error.reason as AmoraTaskReviewReason : "background_budget");
    }
    const providerErrors = state.progress.providerErrors + 1;
    console.error("[amora-tasks] step failed", {
      taskId: task.id,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    if (providerErrors >= MAX_PROVIDER_ERRORS) return review(state, "failed", "STEP_FAILED");
    state.progress = { ...state.progress, providerErrors };
    try {
      await save(state, phaseStatus(state), null);
      const released = await deps.store.release(task.id, state.leaseToken, RETRY_DELAY_SECONDS);
      return released ? { kind: "paused" } : { kind: "lost" };
    } catch {
      return { kind: "lost" };
    }
  }
}

export type AmoraTaskWorkerStats = {
  claimed: number;
  done: number;
  needsReview: number;
  paused: number;
  lost: number;
  notified: number;
  notifySkipped: number;
};

/** 시간이 남는 동안 일을 하나씩 선점해 나아가게 하고, 끝난 일의 알림을 보낸다. */
export async function runAmoraTaskWorker(
  deps: AmoraTaskWorkerDeps,
  options: { maxSlices: number; budgetMs: number },
): Promise<AmoraTaskWorkerStats> {
  const stats: AmoraTaskWorkerStats = {
    claimed: 0, done: 0, needsReview: 0, paused: 0, lost: 0, notified: 0, notifySkipped: 0,
  };
  const deadline = deps.nowMs() + options.budgetMs;
  for (let index = 0; index < options.maxSlices && deps.nowMs() < deadline; index += 1) {
    const task = await deps.store.claim(AMORA_TASK_LEASE_SECONDS);
    if (!task) break;
    stats.claimed += 1;
    const outcome = await runAmoraTaskSlice(task, deps, deadline);
    if (outcome.kind === "done") stats.done += 1;
    else if (outcome.kind === "needs_review") stats.needsReview += 1;
    else if (outcome.kind === "paused") stats.paused += 1;
    else stats.lost += 1;
  }
  const notify = await deliverAmoraTaskNotifications(deps, 10);
  stats.notified = notify.sent;
  stats.notifySkipped = notify.skipped;
  return stats;
}

/**
 * 끝난 일의 앱 알림. 갈래 2 의 알림 함수를 **한 번만** 부르고 그 까닭을 기록에 남긴다.
 * 조용한 시간·동의·하루 상한·같은 dedupeKey 는 그 함수가 판단한다(다시 부르지 않는다).
 * 선점(`claim_amora_task_notifications`)과 dedupeKey 가 겹쳐서, 일꾼이 도중에 죽어 다시 잡혀도 두 번 가지 않는다.
 */
export async function deliverAmoraTaskNotifications(
  deps: Pick<AmoraTaskWorkerDeps, "store" | "adapters">,
  limit: number,
): Promise<{ sent: number; skipped: number }> {
  const result = { sent: 0, skipped: 0 };
  const claims = await deps.store.claimNotifications(limit);
  for (const claim of claims) {
    if (!claim.requestedBy) {
      await deps.store.finishNotification(claim.taskId, "skipped", "no_requester");
      result.skipped += 1;
      continue;
    }
    let sent = false;
    let reason = "provider_error";
    try {
      const push = await deps.adapters.sendPush({
        userId: claim.requestedBy,
        kind: "task_done",
        deepLink: "home",
        dedupeKey: `task_done:${claim.taskId}`,
      });
      sent = push.sent === true;
      reason = typeof push.reason === "string" && /^[a-z_]{1,40}$/.test(push.reason) ? push.reason : (sent ? "sent" : "unknown");
    } catch {
      // 계약상 던지지 않지만, 던지면 보내지 않은 것으로 남긴다.
    }
    await deps.store.finishNotification(claim.taskId, sent ? "sent" : "skipped", reason);
    if (sent) result.sent += 1;
    else result.skipped += 1;
  }
  return result;
}
