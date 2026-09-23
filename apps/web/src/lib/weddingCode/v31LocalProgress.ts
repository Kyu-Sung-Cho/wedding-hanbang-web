import {
  WEDDING_CODE_V31_QUESTIONS,
  WEDDING_CODE_V31_TASTES,
  WEDDING_CODE_V31_VERSION,
  type V31Draft,
} from "@/constants/weddingCodeV31";
import { decodeV31Progress, encodeV31 } from "./v31";

export const LOCAL_KEY = "hanbang:wedding-code:v3.1:progress";
export const LOCAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOCAL_SCHEMA = 1;
export type V31ProgressStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type V31LocalProgressSnapshot = {
  draft: V31Draft;
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
const SNAPSHOT_KEYS = ["draft", "index", "screen", "editing", "needsPriorityReview"] as const;
const ENVELOPE_KEYS = ["schema", "version", "savedAt", "answerCode", "index", "screen", "editing", "needsPriorityReview"] as const;

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
function isComplete(draft: V31Draft): boolean {
  return WEDDING_CODE_V31_QUESTIONS.every((question) => draft.answers[question.id] !== undefined)
    && WEDDING_CODE_V31_TASTES.every((taste) => draft.tastes[taste.key] !== undefined)
    && draft.avoidances !== undefined && draft.priorities !== undefined && draft.spending !== undefined;
}
function validPosition(value: Record<string, unknown>, draft: V31Draft): boolean {
  if (typeof value.index !== "number" || !Number.isInteger(value.index) || value.index < 0 || value.index >= QUESTION_COUNT
    || (value.screen !== "questions" && value.screen !== "result")
    || typeof value.editing !== "boolean" || typeof value.needsPriorityReview !== "boolean") return false;
  return value.screen !== "result" || (!value.editing && !value.needsPriorityReview && isComplete(draft));
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
    if (!isRecord(value) || !exactKeys(value, ENVELOPE_KEYS) || value.schema !== LOCAL_SCHEMA
      || value.version !== WEDDING_CODE_V31_VERSION || !isTimestamp(value.savedAt) || value.savedAt > now
      || typeof value.answerCode !== "string") return { status: "invalid", raw };
    const draft = decodeV31Progress(value.answerCode);
    if (!draft || !validPosition(value, draft)) return { status: "invalid", raw };
    if (now - value.savedAt >= LOCAL_TTL_MS) return { status: "expired", raw };
    return {
      status: "ready", raw, savedAt: value.savedAt,
      snapshot: {
        draft, index: value.index as number, screen: value.screen as V31LocalProgressSnapshot["screen"],
        editing: value.editing as boolean, needsPriorityReview: value.needsPriorityReview as boolean,
      },
    };
  } catch { return { status: "invalid", raw }; }
}

/** 호출자는 직접 작성하거나 본인이 이어하기로 선택한 답만 넘긴다. 받은 결과·공유 동의는 저장하지 않는다. */
export function writeV31LocalProgress(storage: V31ProgressStorage, snapshot: V31LocalProgressSnapshot, expectedRaw: string | null, now = Date.now()): V31LocalProgressWrite {
  let raw: string;
  try {
    if (!isTimestamp(now) || (expectedRaw !== null && typeof expectedRaw !== "string")
      || !isRecord(snapshot) || !exactKeys(snapshot, SNAPSHOT_KEYS)) return { status: "invalid" };
    const answerCode = encodeV31(snapshot.draft);
    if (!validPosition(snapshot, snapshot.draft)) return { status: "invalid" };
    raw = JSON.stringify({
      schema: LOCAL_SCHEMA, version: WEDDING_CODE_V31_VERSION, savedAt: now, answerCode,
      index: snapshot.index, screen: snapshot.screen, editing: snapshot.editing, needsPriorityReview: snapshot.needsPriorityReview,
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
