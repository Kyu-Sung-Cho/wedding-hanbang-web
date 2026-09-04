/**
 * 아모라가 실제로 반영한(또는 반영하지 못한) 변경을 카드 한 장으로 보여주기 위한 순수 모델.
 *
 * 2026-09-04 소비자 점검: 모바일은 장소 검색 카드만 그리고, 예산·일정·체크리스트 변경의
 * **결과**는 아모라의 산문에만 있었다. 확인 카드는 있어 안전 문제는 아니지만, 무엇이
 * 반영됐는지 사용자가 확인할 표면이 없었다. 웹 `ActionCard` 의 제목·성공/실패 규칙을
 * 최소 형태로 옮긴다(미니 표는 옮기지 않는다).
 *
 * 내부 식별자(UUID, act_/evt_ 접두 id, "ID:" 표기)가 든 문장은 웹과 같은 규칙으로
 * 일반 문구로 바꾼다 — 실행기가 가끔 내부 id 를 그대로 말한다.
 */
export type ToolResultCardTone = "success" | "failure";

export type ToolResultCardModel = {
  toolName: string;
  title: string;
  tone: ToolResultCardTone;
  message: string;
};

type ToolResultLike = {
  toolName: string;
  toolInput?: Record<string, unknown> | null;
  toolOutput?: Record<string, unknown> | null;
  success: boolean;
  displayMessage?: string | null;
};

const TITLES: Record<string, string> = {
  update_budget: "예산 변경",
  update_category_budget: "카테고리 예산 변경",
  add_custom_category: "예산 항목 추가",
  apply_budget_plan: "예산안 적용",
  update_wedding_date: "날짜 변경",
  update_venue: "결혼식장 설정",
  update_task_status: "일정 업데이트",
  toggle_checklist_item: "체크리스트 변경",
  add_schedule_event: "일정 추가",
  update_schedule_event: "일정 변경",
  cancel_schedule_event: "일정 취소",
  restore_schedule_event: "취소 일정 복원",
  add_amora_action: "할 일 저장",
  log_wedding_event: "웨딩 일정 기록",
};

/** 이 앱이 카드로 그리는 도구. 장소 검색은 `PlaceCards` 가 따로 그린다. */
export const TOOL_RESULT_CARD_TOOLS: readonly string[] = Object.keys(TITLES);

const INTERNAL_ID_FAILURE_COPY: Record<string, string> = {
  update_schedule_event:
    "수정할 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.",
  cancel_schedule_event:
    "취소할 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.",
  restore_schedule_event:
    "복원할 취소 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.",
  toggle_checklist_item:
    "변경할 체크리스트 항목을 찾지 못했어요. 진행 현황을 새로 불러온 뒤 다시 선택해 주세요.",
};
const GENERIC_INTERNAL_ID_FAILURE_COPY =
  "요청한 항목을 찾지 못했어요. 목록을 새로 불러온 뒤 다시 시도해 주세요.";
const GENERIC_SUCCESS_COPY = "요청한 작업을 완료했어요.";
const GENERIC_FAILURE_COPY =
  "이 변경은 반영되지 않았어요. 잠시 후 다시 요청하거나 화면에서 직접 바꿔 주세요.";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const ID_LABEL_RE = /\b(?:ID|UUID)\s*:/i;
const PREFIXED_ID_RE = /\b(?:act|booking|evt|msg|req|request|action)[_-][A-Za-z0-9_-]{6,}\b/i;

function containsInternalIdentifier(result: ToolResultLike, message: string): boolean {
  const inputIdentifiers = Object.entries(result.toolInput ?? {})
    .filter(([key, value]) => /(?:^|_)(?:id|uuid)$/i.test(key) && typeof value === "string" && value.length > 0)
    .map(([, value]) => value as string);
  return ID_LABEL_RE.test(message)
    || UUID_RE.test(message)
    || PREFIXED_ID_RE.test(message)
    || inputIdentifiers.some((identifier) => message.includes(identifier));
}

/**
 * 카드로 그릴 수 없으면 null. 호출자는 그때 아무것도 그리지 않는다 — 서버는
 * 카드가 없는 도구의 결과를 산문으로 말하므로 사용자는 답을 받는다.
 */
export function getToolResultCardModel(result: ToolResultLike): ToolResultCardModel | null {
  const title = TITLES[result.toolName];
  if (!title) return null;
  const raw = (result.displayMessage ?? "").trim();
  let message: string;
  if (raw.length === 0) {
    message = result.success ? GENERIC_SUCCESS_COPY : GENERIC_FAILURE_COPY;
  } else if (containsInternalIdentifier(result, raw)) {
    message = result.success
      ? GENERIC_SUCCESS_COPY
      : INTERNAL_ID_FAILURE_COPY[result.toolName] ?? GENERIC_INTERNAL_ID_FAILURE_COPY;
  } else {
    message = raw;
  }
  return {
    toolName: result.toolName,
    title,
    tone: result.success ? "success" : "failure",
    message,
  };
}

/** 같은 실패가 여러 번 온 턴은 한 장만. 웹 ChatSidePanel 이 내용 기준으로 접는 것과 같다. */
export function dedupeToolResultCards(models: ToolResultCardModel[]): ToolResultCardModel[] {
  const seen = new Set<string>();
  const out: ToolResultCardModel[] = [];
  for (const model of models) {
    const key = `${model.toolName}|${model.tone}|${model.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}
