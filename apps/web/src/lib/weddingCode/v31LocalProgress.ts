import {
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_TASTES,
  WEDDING_CODE_V31_VERSION,
  type V31Draft,
} from "@/constants/weddingCodeV31";
import { decodeV31Progress, encodeV31 } from "./v31";
import { V31_FULL_INDEXES, V31_PRIORITY_INDEX, getV31ResponseAt, getV31ScreenIndexes, isV31CoreComplete, isV31Flow, isV31FullComplete, type V31Flow } from "./v31Flow";

export const LOCAL_KEY = "hanbang:wedding-code:v3.1:progress";
export const LOCAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * 저장한 뒤 기기 시계가 뒤로 가서(자동 시각 보정, 날짜를 고침) 저장 시각이 지금보다 미래로 보여도 이만큼까지는 멀쩡한 저장으로 읽는다(나이는 음수로 본다).
 * 그보다 먼 미래는 읽지 않는다. 저장 기간을 사실상 늘리는 값이라서다. 이 값을 넘으면 전과 같이 읽을 수 없는 저장(invalid)이다.
 */
export const LOCAL_MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
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
  | { status: "empty" | "invalid" | "expired" | "unavailable"; raw: string | null;
      /** invalid 이면서 형식은 멀쩡한데 저장 시각만 지금보다 하루(LOCAL_MAX_CLOCK_SKEW_MS)를 넘는 미래일 때만 참. 폰 날짜와 시간을 확인하라는 안내의 근거다. */
      clockAhead?: true };
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

/**
 * 저장된 진행에 답이 하나라도 있는가. 소개 화면의 「이 브라우저에 남겨 둔 답이 있어요」 카드는 이 값이 참일 때만 뜬다.
 * 시작 버튼을 누르면 답 없이 위치만 저장되므로(자동 저장은 시작할 때부터 켜진다) 그 기록은 「답」이 아니다.
 * ‘아직 모르겠어요’·‘해당하지 않아요’·‘지금 답하지 않을게요’도 고른 답으로 센다. 결과의 「답을 남긴 질문은 N개」
 * (buildV31Profile.respondedCount)와 같은 셈이다.
 */
export function hasV31ResumableAnswer(snapshot: Pick<V31LocalProgressSnapshot, "draft">): boolean {
  return V31_FULL_INDEXES.some(index => getV31ResponseAt(snapshot.draft, index) !== undefined);
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
      || value.version !== WEDDING_CODE_V31_VERSION || !isTimestamp(value.savedAt)
      || typeof value.answerCode !== "string") return { status: "invalid", raw };
    const draft = decodeV31Progress(value.answerCode);
    // 이전 인덱스는 34개 전체 순서다. 읽을 때만 흐름을 붙이고 저장 시각은 유지한다.
    const flow = value.schema === 1 ? "full" : value.flow;
    if (!draft || !isV31Flow(flow)) return { status: "invalid", raw };
    const position = isLegacyExtraPriorityStep(value, flow) ? { ...value, editing: true } : value;
    if (!validPosition(position, draft, flow)) return { status: "invalid", raw };
    // 저장 시각이 하루를 넘는 미래: 기간을 늘리는 값이라 읽지 않는다. 다른 데는 다 멀쩡한 저장이므로 시계가 원인이라는 표시를 붙인다.
    if (value.savedAt > now + LOCAL_MAX_CLOCK_SKEW_MS) return { status: "invalid", raw, clockAhead: true };
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
