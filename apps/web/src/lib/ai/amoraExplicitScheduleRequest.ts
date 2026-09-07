import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { AMORA_MAX_QUEUED_ACTIONS, type AmoraQueuedAction } from "@/lib/ai/amoraPendingAction";
import { isValidScheduleYmd } from "@/utils/scheduleEvents";

const CATEGORY_KEYS = new Set(["general", ...CATEGORY_CHECKLISTS
  .map(({ key }) => key).filter(key => key !== "greeting" && key !== "registration")]);
const SCOPE_KEYS = new Set(["shared_commitment", "external_commitment"]);
const MODEL_FIELDS = new Set(["date", "title", "category_key", "schedule_scope", "memo"]);
const DATE_SOURCE = "(?:[0-9]{4}년[ \\t]*[0-9]{1,2}월[ \\t]*[0-9]{1,2}일|[0-9]{4}-[0-9]{2}-[0-9]{2})";
const DATE_FIRST = new RegExp(`^(${DATE_SOURCE})[ \\t]+(.+)$`);
const TITLE_FIRST = new RegExp(`^(.+?)[ \\t]*:[ \\t]*(${DATE_SOURCE})$`);

function parseDate(value: string): string | null {
  const korean = /^([0-9]{4})년[ \t]*([0-9]{1,2})월[ \t]*([0-9]{1,2})일$/.exec(value);
  const date = korean ? `${korean[1]}-${korean[2].padStart(2, "0")}-${korean[3].padStart(2, "0")}` : value;
  return isValidScheduleYmd(date) ? date : null;
}

function isPlainTitle(title: string): boolean {
  // 자유 문장의 일부를 제목으로 삼으면 시간·장소·부정 조건을 버릴 수 있다.
  // 이 보완 경로는 짧은 제목만 받으며, 지원하지 않는 정보는 기존 모델 경로에 남긴다.
  return title.length > 0 && title.length <= 120
    && /^[\p{L}\p{M}\p{N} ()·&/\-]+$/u.test(title)
    && !/(?:[월화수목금토일]요일|(?:열한|열두|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*시|\d\s*\/\s*\d|참석|동행|함께|담당|혼자|둘만|(?:신랑|신부|친구)(?:와|과|만)|안\s*(?:하|해|가|갈|추가|등록)|말아|말자|대신)/.test(title)
    && !/(?:오전|오후|아침|점심|저녁|새벽|밤|정오|자정|시간|메모|장소|주소|에서|까지|부터|이후|이전|외부\s*약속|두\s*사람|공동|공유|개인|나만|상대만|다음|내일|오늘|모레|어제|이번|지난|앞\s*일정|다른\s*날짜|또는|혹은|아니면|취소|삭제|변경|수정|예시|예를|말고|제외|하지\s*마|않|추가해|등록해|확인해|해줘|해주세요|할게|\d\s*(?:년|월|일|시|분|초)|\d{4}-\d{2}-\d{2})/.test(title);
}

function actionKey(date: string, title: string): string {
  return `${date}\n${title}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readUnchangedModelActions(text: string): AmoraQueuedAction[] | null {
  if (text.length > 40000) return null;
  const actions: AmoraQueuedAction[] = [];
  let invalid = false;
  const rest = text.replace(/\[pending_action\]([\s\S]*?)\[\/pending_action\]/g, (_match, payload: string) => {
    try {
      const value: unknown = payload.length <= 4000 ? JSON.parse(payload) : null;
      if (!isRecord(value) || Object.keys(value).sort().join(",") !== "input,tool"
        || typeof value.tool !== "string" || !isRecord(value.input)) invalid = true;
      else actions.push({ tool: value.tool, input: value.input });
    } catch { invalid = true; }
    return "";
  });
  // 기존 추출기가 버리거나 보정한 필드도 복구 판단 전에는 보존해서 검사한다.
  // 불완전/비표준 표식은 여기서 해석하지 않고 기존 추출 경로에만 남긴다.
  if (invalid || actions.length > AMORA_MAX_QUEUED_ACTIONS
    || /pending[\s_-]*action|"(?:tool|input)"\s*:/i.test(rest)) return null;
  return actions;
}

/** 완결된 현재 일정 요청만 기존 개별 승인 큐에 전달한다. */
export function parseExplicitScheduleRequest(
  text: string,
  modelText = "",
): AmoraQueuedAction[] | null {
  if (text.length > 4000 || /[\p{Cf}\p{Zl}\p{Zp}]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) return null;
  const prefix = /^다음 일정(?:\s+([0-9]{1,2})건)?을 모두 (?:추가할 수 있게 순서대로 확인 카드를 만들어(?:줘|주세요)|(?:추가|등록)해(?:줘|주세요))[.。]\s*/.exec(text.trim());
  if (!prefix) return null;
  let list = text.trim().slice(prefix[0].length).trim();
  // 알려진 무정보 접미사 외의 문장은 남겨 두어 아래 전체 항목 검증이 거절하게 한다.
  list = list.replace(/\s*한 건씩 확인할게[.。]?$/, "").trim();
  list = list.replace(/\s*시간과 메모는 지정하지 않을게[.。]?$/, "").trim();
  list = list.replace(/[.。]$/, "");
  const rows = list.split(/,|\r?\n/).map(row => row.trim());
  if (rows.length < 2 || rows.length > AMORA_MAX_QUEUED_ACTIONS
    || (prefix[1] !== undefined && Number(prefix[1]) !== rows.length)) return null;

  const source = new Map<string, { date: string; title: string }>();
  for (const row of rows) {
    const dateFirst = DATE_FIRST.exec(row);
    const titleFirst = dateFirst ? null : TITLE_FIRST.exec(row);
    const date = parseDate(dateFirst?.[1] ?? titleFirst?.[2] ?? "");
    const title = (dateFirst?.[2] ?? titleFirst?.[1] ?? "").trim();
    if (!date || !isPlainTitle(title)) return null;
    const key = actionKey(date, title);
    if (source.has(key)) return null;
    source.set(key, { date, title });
  }

  const modelActions = readUnchangedModelActions(modelText);
  if (modelActions === null) return null;
  const matching = new Map<string, Record<string, unknown>>();
  for (const action of modelActions) {
    const input = action.input;
    if (action.tool !== "add_schedule_event"
      || Object.keys(input).some(key => !MODEL_FIELDS.has(key))
      || typeof input.date !== "string" || typeof input.title !== "string"
      || (input.memo !== undefined && input.memo !== "")
      || (input.category_key !== undefined && (typeof input.category_key !== "string" || !CATEGORY_KEYS.has(input.category_key)))
      || (input.schedule_scope !== undefined && (typeof input.schedule_scope !== "string" || !SCOPE_KEYS.has(input.schedule_scope)))) return null;
    const key = actionKey(input.date, input.title);
    if (!source.has(key) || matching.has(key)) return null;
    matching.set(key, input);
  }
  return [...source].map(([key, input]) => ({ tool: "add_schedule_event", input: { ...(matching.get(key) ?? input) } }));
}
