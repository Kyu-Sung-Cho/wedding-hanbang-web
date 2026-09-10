import type { ToolExecutionResult } from "@/types/database.types";
import { inspectScheduleEvents } from "@/utils/scheduleEvents";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";
import { CATEGORY_LABELS } from "./tools/planningConstants";
import { isCustomBudgetCategoryKey } from "./budgetCustomCategories";

type BudgetField = "total_budget" | "total_allocated" | "unallocated" | "total_spent";

export interface CurrentStoredStateRequest {
  budgetFields: BudgetField[];
  taskTitles: string[] | null;
  scheduleTitles: string[] | null;
}

const BUDGET_FIELDS: Record<string, BudgetField> = {
  "총예산": "total_budget",
  "총 예산": "total_budget",
  "항목별 배정 합계": "total_allocated",
  "배정 합계": "total_allocated",
  "미배정액": "unallocated",
  "미배정 금액": "unallocated",
  "기록 지출": "total_spent",
  "기록된 지출": "total_spent",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const CURRENT_SINGLE_SCHEDULE_FORMS = [
  /^(.{1,500}?) 일정(?:은|이) 지금 몇 월 며칠 몇 시로 저장되어 (?:있어|있나요)\?\s*변경하지 말고 날짜와 시간만 (?:알려줘|알려주세요)[.!]?$/,
  /^(.{1,500}?) 일정 지금 언제야\?\s*저장된 날짜와 시간만 (?:알려줘|알려주세요)[.!]?$/,
  /^(.{1,500}?) 일정의 현재 날짜와 시간을 (?:알려줘|알려주세요)\.\s*변경하지 마[.!]?$/,
  /^(.{1,500}?) 일정이 언제로 저장돼 있어\?\s*수정하지 말고 (?:알려줘|알려주세요)[.!]?$/,
];

// 제목 자리에 들어온 추가 요청을 이름으로 오인해 일부 답만 확정하지 않는다.
function hasAdditionalRequestInTitle(title: string): boolean {
  return /[.!?]|(?:알려|보여|정리해|검색해|추천해|저장해|바꿔|수정해|삭제해|추가해|올려|내려|늘려|줄여)\s*(?:줘|주세요|주고|주시고)|(?:정리|검색|추천|저장|변경|수정|삭제|추가)(?:하고|한 뒤)|(?:담당자|완료 기준|장소|메모|비용)\s*(?:및|와|과|도)(?:\s|$)|(?:이|라)면/.test(title);
}

/** 저장 금지 + 현재값 + 지원하는 조회 항목으로 완결된 요청만 선택한다. */
export function assessCurrentStoredStateRequest(userText: string): CurrentStoredStateRequest | null {
  if (userText.length > 2_000) return null;
  // 현재 저장값을 우선하라는 끝 문장만 분리한다. 과거 조회·비교 요청은 계속 제외한다.
  const text = userText.trim().replace(/\s*과거 대화보다 지금 저장된 값을 기준으로 답해줘[.!]?$/, "");
  if (/[\r\n"'“”‘’`]|개인|나만|지난|예전|과거|비교|가정|만약/.test(text)) return null;
  const naturalSchedule = CURRENT_SINGLE_SCHEDULE_FORMS
    .map(pattern => pattern.exec(text)).find(match => match !== null);
  if (naturalSchedule) {
    const title = naturalSchedule[1].trim();
    if (hasAdditionalRequestInTitle(title)) return null;
    return { budgetFields: [], taskTitles: null, scheduleTitles: [title] };
  }
  const prefix = /^(?:(?:어떤 것도|아무것도)\s*)?(?:(?:(?:변경|수정)하거나\s*)?저장하지|저장하거나\s*(?:변경|수정)하지)\s*말고\s*현재\s*(?:실제\s*)?/;
  if (!prefix.test(text)) return null;
  let fields = text.replace(prefix, "");
  fields = fields.replace(/^기록만\s*확인해줘[.!]\s*/, "");
  fields = fields.replace(/^저장된\s*(?:값|상태)(?:만|을|를)?\s*(?:알려줘|보여줘)[.!]\s*/, "");
  fields = fields.replace(/^저장된\s*/, "");
  const suffix = /(?:을|를|만)?\s*(?:짧게\s*)?(?:정리해줘|알려줘|보여줘)[.!?]?$/;
  if (!suffix.test(fields)) return null;
  fields = fields.replace(suffix, "").trim();
  if (/(?:저장|추가|삭제|변경|수정|승인|완료|검색|추천|조회|비교|설명)해\s*줘|바꿔\s*줘|(?:이|라)면/.test(fields)) return null;
  const request: CurrentStoredStateRequest = { budgetFields: [], taskTitles: null, scheduleTitles: null };
  for (const raw of fields.split(/\s*[,/]\s*/)) {
    const field = raw.trim();
    if (Object.hasOwn(BUDGET_FIELDS, field)) {
      request.budgetFields.push(BUDGET_FIELDS[field]);
    } else if (field === "예산") {
      request.budgetFields.push(...Object.values(BUDGET_FIELDS));
    } else if (/^(?:공유\s*)?할\s*일$/.test(field)) {
      if (request.taskTitles !== null) return null;
      request.taskTitles = [];
    } else if (field === "일정") {
      if (request.scheduleTitles !== null) return null;
      request.scheduleTitles = [];
    } else {
      const taskAndSchedule = /^(.{1,500})의 완료 (?:여부|상태)(?:와\s+|\s+및\s+)(.{1,500}?)(?: 일정)?의 날짜와 시간$/.exec(field);
      if (taskAndSchedule) {
        if (request.taskTitles !== null || request.scheduleTitles !== null) return null;
        if (hasAdditionalRequestInTitle(taskAndSchedule[1]) || hasAdditionalRequestInTitle(taskAndSchedule[2])) return null;
        request.taskTitles = [taskAndSchedule[1]];
        request.scheduleTitles = [taskAndSchedule[2]];
        continue;
      }
      const tasks = /^(.{1,500})의 완료 (?:여부|상태)$/.exec(field);
      const schedule = /^(.{1,500}?)(?: 일정)?의 날짜와 시간$/.exec(field);
      if (tasks && hasAdditionalRequestInTitle(tasks[1]) || schedule && hasAdditionalRequestInTitle(schedule[1])) return null;
      if (tasks && request.taskTitles === null) request.taskTitles = [tasks[1]];
      else if (schedule && request.scheduleTitles === null) request.scheduleTitles = [schedule[1]];
      else return null;
    }
  }
  request.budgetFields = [...new Set(request.budgetFields)];
  return request.budgetFields.length || request.taskTitles !== null || request.scheduleTitles !== null ? request : null;
}

export function getRequiredCurrentStoredStateReads(request: CurrentStoredStateRequest): Array<{
  tool: "get_budget_summary" | "get_amora_actions";
  input: Record<string, unknown>;
}> {
  const reads: ReturnType<typeof getRequiredCurrentStoredStateReads> = [];
  if (request.budgetFields.length > 0) reads.push({ tool: "get_budget_summary", input: {} });
  if (request.taskTitles !== null) reads.push({ tool: "get_amora_actions", input: { status: "all" } });
  return reads;
}

function latestRead(results: readonly ToolExecutionResult[], name: string): ToolExecutionResult | undefined {
  return results.findLast(result => result.toolName === name);
}

const displayTitle = (value: string) => value.replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 500)
  .replace(/[<>\[\]]/g, character => ({ "<": "＜", ">": "＞", "[": "［", "]": "］" })[character]!);
const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const validAmount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const BUDGET_LABELS: Record<BudgetField, string> = {
  total_budget: "총예산", total_allocated: "항목별 배정 합계", unallocated: "미배정액", total_spent: "기록 지출",
};

/** 모델 산문은 입력으로 받지 않는다. 같은 요청의 서버 조회 근거만 최종 본문으로 만든다. */
export function formatCurrentStoredStateSummary(input: {
  request: CurrentStoredStateRequest;
  sourceRevision: number | null;
  canonicalProgress: unknown;
  toolResults: readonly ToolExecutionResult[];
}): string {
  const { request, toolResults } = input;
  const hasRevision = typeof input.sourceRevision === "number" && Number.isSafeInteger(input.sourceRevision) && input.sourceRevision >= 0;
  const progress = isRecord(input.canonicalProgress) ? input.canonicalProgress : null;
  const lines: string[] = [];
  const budgetResult = latestRead(toolResults, "get_budget_summary");
  const hiddenKeys = progress && Array.isArray(progress.__hidden) ? progress.__hidden : [];
  const rawBudgetRows = progress ? Object.entries(progress).filter(([key]) =>
    isCustomBudgetCategoryKey(key) || (Object.hasOwn(CATEGORY_LABELS, key) && !hiddenKeys.includes(key))) : [];
  // 정규화 상한을 넘긴 원본에서 누락된 항목을 0원으로 확정하지 않는다.
  const budgetShapeComplete = progress !== null && Object.keys(progress).length <= 100
    && Object.keys(progress).every(key => key.length <= 120)
    && (progress.__hidden === undefined || (Array.isArray(progress.__hidden)
      && progress.__hidden.length <= 100 && progress.__hidden.every(key => typeof key === "string")))
    && rawBudgetRows.every(([key, value]) => isRecord(value)
      && Object.keys(value).length <= 100 && Object.keys(value).every(key => key.length <= 120)
      && (!isCustomBudgetCategoryKey(key) || (typeof value.label === "string" && value.label.slice(0, 1_000).trim().length > 0))
      && ["budget", "spent"].every(key => !Object.hasOwn(value, key) || isValidWeddingWonAmount(value[key])));
  const budget = hasRevision && budgetShapeComplete && budgetResult?.success ? budgetResult.toolOutput : null;
  for (const field of request.budgetFields) {
    const value = budget?.[field];
    const confirmed = validAmount(value) && (field === "unallocated" || value >= 0)
      && (field !== "total_budget" || value > 0)
      && (field !== "total_spent" || budget?.recorded_spend_basis === "explicit_spent_only");
    lines.push(`- ${BUDGET_LABELS[field]}: ${confirmed ? won(value) : "확인 불가"}`);
  }
  if (request.taskTitles !== null) {
    const result = latestRead(toolResults, "get_amora_actions");
    const output = result?.toolOutput;
    const actions = output && Array.isArray(output.actions) ? output.actions : [];
    const complete = hasRevision && result?.success === true && result.toolInput.status === "all"
      && output?.source === "table" && output.truncated === false && output.count === actions.length
      && actions.every(action => isRecord(action) && typeof action.title === "string"
        && typeof action.id === "string" && ["open", "done", "dismissed"].includes(String(action.status)))
      && new Set(actions.map(action => isRecord(action) ? action.id : null)).size === actions.length;
    const rows = actions.filter(isRecord);
    if (!complete) {
      lines.push("- 공유 할 일 완료 여부: 확인 불가");
    } else if (request.taskTitles.length === 0) {
      if (rows.length === 0) lines.push("- 공유 할 일: 이번 조회에서 확인된 항목이 없습니다.");
      for (const action of rows.slice(0, 10)) {
        lines.push(rows.filter(row => row.title === action.title).length === 1
          ? actionLine(action) : `- ${displayTitle(String(action.title))}: 동명 할 일의 완료 여부 확인 필요`);
      }
      if (rows.length > 10) lines.push("- 공유 할 일: 일부만 표시했습니다. 전체 목록은 할 일 화면에서 확인해 주세요.");
    } else {
      for (const expression of request.taskTitles) {
        // 제목 안의 '과/와'를 임의로 쪼개지 않고 실제 제목과 연결어가 전체를 덮어야 한다.
        let remaining = expression;
        const matched: Record<string, unknown>[] = [];
        while (remaining && matched.length < 10) {
          const candidates = rows.filter(row => typeof row.title === "string"
            && (remaining === row.title || remaining.startsWith(`${row.title}과 `)
              || remaining.startsWith(`${row.title}와 `) || remaining.startsWith(`${row.title} 및 `)));
          if (candidates.length !== 1) break;
          const action = candidates[0];
          matched.push(action);
          remaining = remaining.slice(String(action.title).length).replace(/^(?:과|와| 및)\s+/, "");
        }
        if (remaining || matched.length === 0) lines.push(`- ${displayTitle(expression)}: 완료 여부 확인 불가`);
        else lines.push(...matched.map(actionLine));
      }
    }
  }
  if (request.scheduleTitles !== null) {
    const inspection = progress ? inspectScheduleEvents(progress) : null;
    const complete = hasRevision && inspection && !inspection.malformedContainer
      && inspection.rejectedCount === 0 && inspection.truncatedCount === 0;
    if (request.scheduleTitles.length === 0) {
      lines.push("- 일정: 날짜·시간을 확인할 일정의 제목을 알려주세요.");
    } else {
      for (const title of request.scheduleTitles) {
        const events = complete ? inspection.events.filter(event => event.title === title) : [];
        if (events.length !== 1) {
          lines.push(`- ${displayTitle(title)} 일정: 날짜·시간 확인 불가`);
        } else {
          const event = events[0];
          const status = event.status === "cancelled" ? " (취소됨)" : event.status === "completed" ? " (완료됨)" : "";
          lines.push(`- ${displayTitle(title)} 일정: ${event.date} ${event.time ?? "시간 확인 필요"}${status}`);
        }
      }
    }
  }
  return ["이번 요청에서 확인한 저장 상태예요.", ...lines].join("\n");
}

function actionLine(action: Record<string, unknown>): string {
  const status = action.status === "done" ? "완료" : action.status === "open" ? "미완료" : "제외됨";
  return `- ${displayTitle(String(action.title))}: ${status}`;
}
