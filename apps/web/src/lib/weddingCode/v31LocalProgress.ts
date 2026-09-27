import {
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_TASTES,
  WEDDING_CODE_V31_VERSION,
  type V31Draft,
} from "@/constants/weddingCodeV31";
import { decodeV31Progress, encodeV31 } from "./v31";
import { V31_PRIORITY_INDEX, getV31ScreenIndexes, isV31CoreComplete, isV31Flow, isV31FullComplete, type V31Flow } from "./v31Flow";

export const LOCAL_KEY = "hanbang:wedding-code:v3.1:progress";
export const LOCAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOCAL_SCHEMA = 2;
/** 저장 기록과 현재 진행을 함께 지우는 버튼. 처리방침 제3조가 이 이름으로 부른다. */
export const V31_CLEAR_LOCAL_LABEL = "이 브라우저의 답 지우기";
export type V31ProgressStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type V31LocalProgressSnapshot = {
  draft: V31Draft;
  flow: V31Flow;
  index: number;
  screen: "questions" | "result";
  editing: boolean;
  needsPriorityReview: boolean;
};
export type V31LocalProgressRead =
  | { status: "ready"; snapshot: V31LocalProgressSnapshot; savedAt: number; raw: string }
  | { status: "empty" | "invalid" | "expired" | "unavailable"; raw: string | null };
export type V31LocalProgressWrite = { status: "saved"; raw: string }
  | { status: "conflict" | "unavailable" | "invalid" };

const MAX_ENVELOPE_LENGTH = 2048;
const QUESTION_COUNT = WEDDING_CODE_V31_QUESTIONS.length + WEDDING_CODE_V31_TASTES.length + 3;
const SNAPSHOT_KEYS = ["draft", "flow", "index", "screen", "editing", "needsPriorityReview"] as const;
const LEGACY_ENVELOPE_KEYS = ["schema", "version", "savedAt", "answerCode", "index", "screen", "editing", "needsPriorityReview"] as const;
const ENVELOPE_KEYS = [...LEGACY_ENVELOPE_KEYS, "flow"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function validPosition(value: Record<string, unknown>, draft: V31Draft, flow: V31Flow): boolean {
  if (typeof value.index !== "number" || !Number.isInteger(value.index) || value.index < 0 || value.index >= QUESTION_COUNT
    || (value.screen !== "questions" && value.screen !== "result")
    || typeof value.editing !== "boolean" || typeof value.needsPriorityReview !== "boolean") return false;
  if (value.screen === "questions") return value.editing || getV31ScreenIndexes(flow).includes(value.index);
  return !value.editing && !value.needsPriorityReview && (flow === "full" ? isV31FullComplete(draft) : isV31CoreComplete(draft));
}
/**
 * 우선순위를 선택 흐름 끝에서 묻던 때 저장한 자리. 이제 선택 흐름에는 그 화면이 없으므로
 * 버리지 않고 그 한 문항을 고치는 화면으로 이어 준다. 새로 저장할 때는 이 자리를 받지 않는다.
 */
function isLegacyExtraPriorityStep(value: Record<string, unknown>, flow: V31Flow): boolean {
  return flow === "extra" && value.screen === "questions" && value.editing === false && value.index === V31_PRIORITY_INDEX;
}

/** 읽기만으로 저장 기간을 연장하거나 다른 탭의 값을 지우지 않는다. */
export function readV31LocalProgress(storage: V31ProgressStorage, now = Date.now()): V31LocalProgressRead {
  let raw: string | null;
  try { raw = storage.getItem(LOCAL_KEY); }
  catch { return { status: "unavailable", raw: null }; }
  if (!isTimestamp(now)) return { status: "invalid", raw };
  if (raw === null) return { status: "empty", raw };
  if (raw.length > MAX_ENVELOPE_LENGTH) return { status: "invalid", raw };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || (value.schema !== 1 && value.schema !== LOCAL_SCHEMA)
      || !exactKeys(value, value.schema === 1 ? LEGACY_ENVELOPE_KEYS : ENVELOPE_KEYS)
      || value.version !== WEDDING_CODE_V31_VERSION || !isTimestamp(value.savedAt) || value.savedAt > now
      || typeof value.answerCode !== "string") return { status: "invalid", raw };
    const draft = decodeV31Progress(value.answerCode);
    // 이전 인덱스는 34개 전체 순서다. 읽을 때만 흐름을 붙이고 저장 시각은 유지한다.
    const flow = value.schema === 1 ? "full" : value.flow;
    if (!draft || !isV31Flow(flow)) return { status: "invalid", raw };
    const position = isLegacyExtraPriorityStep(value, flow) ? { ...value, editing: true } : value;
    if (!validPosition(position, draft, flow)) return { status: "invalid", raw };
    if (now - value.savedAt >= LOCAL_TTL_MS) return { status: "expired", raw };
    return {
      status: "ready", raw, savedAt: value.savedAt,
      snapshot: {
        draft, flow, index: position.index as number, screen: position.screen as V31LocalProgressSnapshot["screen"],
        editing: position.editing as boolean, needsPriorityReview: position.needsPriorityReview as boolean,
      },
    };
  } catch { return { status: "invalid", raw }; }
}

/** 호출자는 직접 작성하거나 본인이 이어하기로 선택한 답만 넘긴다. 받은 결과·공유 동의는 저장하지 않는다. */
export function writeV31LocalProgress(storage: V31ProgressStorage, snapshot: V31LocalProgressSnapshot, expectedRaw: string | null, now = Date.now()): V31LocalProgressWrite {
  let raw: string;
  try {
    if (!isTimestamp(now) || (expectedRaw !== null && typeof expectedRaw !== "string")
      || !isRecord(snapshot) || !exactKeys(snapshot, SNAPSHOT_KEYS) || !isV31Flow(snapshot.flow)) return { status: "invalid" };
    const answerCode = encodeV31(snapshot.draft);
    if (!validPosition(snapshot, snapshot.draft, snapshot.flow)) return { status: "invalid" };
    raw = JSON.stringify({
      schema: LOCAL_SCHEMA, version: WEDDING_CODE_V31_VERSION, savedAt: now, answerCode,
      flow: snapshot.flow, index: snapshot.index, screen: snapshot.screen, editing: snapshot.editing, needsPriorityReview: snapshot.needsPriorityReview,
    });
    if (raw.length > MAX_ENVELOPE_LENGTH) return { status: "invalid" };
  } catch { return { status: "invalid" }; }
  try {
    if (storage.getItem(LOCAL_KEY) !== expectedRaw) return { status: "conflict" };
    storage.setItem(LOCAL_KEY, raw);
    return { status: "saved", raw };
  } catch { return { status: "unavailable" }; }
}
export function clearV31LocalProgress(storage: V31ProgressStorage): { status: "cleared" | "unavailable" } {
  try {
    storage.removeItem(LOCAL_KEY);
    return { status: "cleared" };
  } catch { return { status: "unavailable" }; }
}
