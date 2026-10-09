import { ITEMS } from "./bank";
import {
  BANK_REVISION, EXPRESSION_VERSION, MEASUREMENT_VERSION, STORAGE_KEY,
  type Answer, type Answers, type Draft, type Rating, type Screen, type Snapshot,
} from "./types";

const MAX_PAYLOAD_LENGTH = 24_000;
const SHARE_KEY = "wc-likert";
export const LIKERT_AUTOSAVE_KEY = `${STORAGE_KEY}:autosave`;
export const LIKERT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// 같은 문항판의 원답을 유지하고 이전 표현판의 설명만 메모리에서 보정한다.
const LEGACY_EXPRESSION_VERSION = "likert-letters-alpha.1";
const PREVIOUS_EXPRESSION_VERSION = "likert-letters-alpha.2";
const ALPHA3_EXPRESSION_VERSION = "likert-letters-alpha.3";
export const EXPRESSION_CORRECTION_NOTICE = "원답은 그대로 유지했어요. T 결과 설명을 ‘합의한 기준 아래 후보 분담을 받아들임’으로, L 결과 설명을 ‘내 이야기를 들어주는 도움을 받고 싶은 마음’으로 고쳤어요. 장면별 도움·쉬기 설명도 문항의 뜻에 맞게 고쳤어요. 누가 후보를 추릴지는 따로 상의해 주세요.";
export const EXPRESSION_ALPHA2_CORRECTION_NOTICE = "원답은 그대로 유지했어요. L 결과 설명을 ‘내 이야기를 들어주는 도움을 받고 싶은 마음’으로 고쳤어요. 장면별 도움·쉬기 설명도 문항의 뜻에 맞게 고쳤어요.";
export const EXPRESSION_ALPHA3_UPDATE_NOTICE = "문항과 원답, 비율과 글자를 정하는 계산은 그대로예요. 결과 문장을 짧게 다듬고 장면별 답의 차이를 더 구체적으로 보여줘요.";
const isCompatibleExpression = (value: unknown) =>
  value === EXPRESSION_VERSION || value === ALPHA3_EXPRESSION_VERSION || value === PREVIOUS_EXPRESSION_VERSION || value === LEGACY_EXPRESSION_VERSION;

function expressionCorrectionNotice(value: unknown): string | undefined {
  if (value === LEGACY_EXPRESSION_VERSION) return EXPRESSION_CORRECTION_NOTICE;
  if (value === PREVIOUS_EXPRESSION_VERSION) return EXPRESSION_ALPHA2_CORRECTION_NOTICE;
  if (value === ALPHA3_EXPRESSION_VERSION) return EXPRESSION_ALPHA3_UPDATE_NOTICE;
  return undefined;
}
type StoragePort = Pick<Storage, "getItem" | "setItem">;
type MutableStoragePort = StoragePort & Pick<Storage, "removeItem">;

export function readLikertAutosave(storage: Pick<Storage, "getItem">): boolean {
  try {
    const own = storage.getItem(LIKERT_AUTOSAVE_KEY);
    if (own === "on" || own === "off") return own === "on";
    return storage.getItem("hanbang.wedding-code.v4.autosave") !== "off"
      && storage.getItem("hanbang.wedding-code.v31.autosave") !== "off";
  } catch { return false; }
}

export function clearLikertDraft(storage: MutableStoragePort): boolean {
  try {
    storage.removeItem(STORAGE_KEY);
    return storage.getItem(STORAGE_KEY) === null;
  } catch { return false; }
}

export function setLikertAutosave(storage: MutableStoragePort, enabled: boolean): boolean {
  try {
    // 꺼짐 설정을 먼저 확인해 두면 답 삭제가 실패해도 이후 자동 저장은 재개하지 않는다.
    storage.setItem(LIKERT_AUTOSAVE_KEY, enabled ? "on" : "off");
    const persisted = storage.getItem(LIKERT_AUTOSAVE_KEY) === (enabled ? "on" : "off");
    return enabled ? persisted : clearLikertDraft(storage) && persisted;
  } catch { return false; }
}
type CompactAnswer = Rating | "u" | "n" | "s";
interface PackedSnapshot { at: string; values: CompactAnswer[] }
interface PackedLink {
  version: string;
  revision: string;
  expression: string;
  first: PackedSnapshot;
  second?: PackedSnapshot;
}

export type SharedState =
  | { kind: "none" }
  | { kind: "invite"; first: Snapshot; notice?: string }
  | { kind: "couple"; first: Snapshot; second: Snapshot; notice?: string }
  | { kind: "invalid" | "unsupported"; notice: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isAnswer(value: unknown): value is Answer {
  if (!isRecord(value)) return false;
  if (value.status === "rated") {
    return typeof value.value === "number" && Number.isInteger(value.value)
      && value.value >= 1 && value.value <= 5 && Object.keys(value).length === 2;
  }
  return (value.status === "unknown" || value.status === "not_applicable" || value.status === "skipped")
    && Object.keys(value).length === 1;
}

export function isAnswers(value: unknown, complete = false): value is Answers {
  if (!isRecord(value)) return false;
  const ids = new Set(ITEMS.map(item => item.id));
  if (Object.entries(value).some(([id, answer]) => !ids.has(id) || !isAnswer(answer))) return false;
  return !complete || ITEMS.every(item => isAnswer(value[item.id]));
}

export function answeredCount(answers: Answers): number {
  return ITEMS.filter(item => isAnswer(answers[item.id])).length;
}

export function isComplete(answers: Answers): boolean {
  return isAnswers(answers, true);
}

export function createDraft(): Draft {
  return {
    version: MEASUREMENT_VERSION, revision: BANK_REVISION,
    expressionVersion: EXPRESSION_VERSION, answers: {}, cursor: 0,
    screen: "intro", updatedAt: new Date().toISOString(),
  };
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function parseDraft(raw: string): Draft | null {
  if (raw.length > MAX_PAYLOAD_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== MEASUREMENT_VERSION
      || value.revision !== BANK_REVISION || !isCompatibleExpression(value.expressionVersion)
      || !isAnswers(value.answers) || !isIsoDate(value.updatedAt)
      || typeof value.cursor !== "number" || !Number.isInteger(value.cursor)
      || value.cursor < 0 || value.cursor >= ITEMS.length
      || typeof value.screen !== "string"
      || !["intro", "questions", "result", "compare"].includes(value.screen)) return null;
    const screen = value.screen as Screen;
    return {
      version: MEASUREMENT_VERSION, revision: BANK_REVISION,
      expressionVersion: EXPRESSION_VERSION, answers: value.answers,
      cursor: value.cursor,
      screen: (screen === "result" || screen === "compare") && !isComplete(value.answers)
        ? "questions" : screen === "compare" ? "result" : screen,
      updatedAt: value.updatedAt,
    };
  } catch { return null; }
}

export function loadDraft(storage: StoragePort, now = Date.now()): { draft: Draft | null; notice: string; expressionNotice?: string } {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { draft: null, notice: "" };
    const draft = parseDraft(raw);
    if (!draft) return { draft: null, notice: "저장된 답의 판을 확인하지 못했어요. 기존 기록은 그대로 두고 새 답을 시작할 수 있어요." };
    const age = now - Date.parse(draft.updatedAt);
    if (!Number.isFinite(now) || age < 0 || age >= LIKERT_RETENTION_MS) return { draft: null,
      notice: "저장된 답의 이용 기간은 마지막 저장부터 30일이에요. 기간이나 저장 시각을 확인하지 못한 기록은 불러오지 않아요. 아래에서 이 개편본의 저장을 지울 수 있어요." };
    const source: unknown = JSON.parse(raw);
    const expressionNotice = isRecord(source) ? expressionCorrectionNotice(source.expressionVersion) : undefined;
    return { draft, notice: "이 브라우저에 남긴 답을 이어서 볼 수 있어요.",
      ...(expressionNotice ? { expressionNotice } : {}) };
  } catch {
    return { draft: null, notice: "이 브라우저에서는 이어서 저장하기가 어려워요. 지금 탭에서는 계속 풀 수 있어요." };
  }
}

export function saveDraft(storage: StoragePort, draft: Draft): { saved: boolean; notice: string } {
  const normalized = parseDraft(JSON.stringify(draft));
  if (!normalized) return { saved: false, notice: "이번 답의 저장 형식을 확인하지 못했어요." };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return { saved: true, notice: "" };
  } catch {
    return { saved: false, notice: "브라우저에 답을 저장하지 못했어요. 지금 탭에서는 계속 풀 수 있어요." };
  }
}

export function createSnapshot(answers: Answers): Snapshot {
  if (!isComplete(answers)) throw new Error("Incomplete answers");
  const copied: Answers = {};
  for (const item of ITEMS) copied[item.id] = { ...answers[item.id] };
  return {
    version: MEASUREMENT_VERSION, revision: BANK_REVISION,
    expressionVersion: EXPRESSION_VERSION, answers: copied,
    createdAt: new Date().toISOString(),
  };
}

function pack(snapshot: Snapshot): PackedSnapshot | null {
  if (snapshot.version !== MEASUREMENT_VERSION || snapshot.revision !== BANK_REVISION
    || snapshot.expressionVersion !== EXPRESSION_VERSION || !isIsoDate(snapshot.createdAt)
    || !isComplete(snapshot.answers)) return null;
  return {
    at: snapshot.createdAt,
    values: ITEMS.map(item => {
      const answer = snapshot.answers[item.id];
      return answer.status === "rated" ? answer.value : answer.status === "unknown" ? "u"
        : answer.status === "not_applicable" ? "n" : "s";
    }),
  };
}

function unpack(value: unknown): Snapshot | null {
  if (!isRecord(value) || !isIsoDate(value.at) || !Array.isArray(value.values)
    || value.values.length !== ITEMS.length) return null;
  const answers: Answers = {};
  for (let index = 0; index < ITEMS.length; index++) {
    const encoded: unknown = value.values[index];
    let answer: Answer;
    if (typeof encoded === "number" && Number.isInteger(encoded) && encoded >= 1 && encoded <= 5) {
      answer = { status: "rated", value: encoded as Rating };
    } else if (encoded === "u") answer = { status: "unknown" };
    else if (encoded === "n") answer = { status: "not_applicable" };
    else if (encoded === "s") answer = { status: "skipped" };
    else return null;
    answers[ITEMS[index].id] = answer;
  }
  return { version: MEASUREMENT_VERSION, revision: BANK_REVISION,
    expressionVersion: EXPRESSION_VERSION, answers, createdAt: value.at };
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid fragment");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

export function buildShareUrl(origin: string, first: Snapshot, second?: Snapshot): string | null {
  try {
    const base = new URL(origin);
    if (base.protocol !== "http:" && base.protocol !== "https:") return null;
    const packedFirst = pack(first);
    const packedSecond = second ? pack(second) : undefined;
    if (!packedFirst || (second && !packedSecond)) return null;
    const payload: PackedLink = {
      version: MEASUREMENT_VERSION, revision: BANK_REVISION, expression: EXPRESSION_VERSION,
      first: packedFirst, ...(packedSecond ? { second: packedSecond } : {}),
    };
    const encoded = encodeBase64Url(JSON.stringify(payload));
    if (encoded.length > MAX_PAYLOAD_LENGTH) return null;
    return `${base.origin}/wedding-code#${SHARE_KEY}=${encoded}`;
  } catch { return null; }
}

export function readShareFragment(hash: string): SharedState {
  if (!hash || hash === "#") return { kind: "none" };
  if (hash.length > MAX_PAYLOAD_LENGTH + 32) return { kind: "invalid", notice: "이 링크는 길이가 너무 길어 답을 확인할 수 없어요." };
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!params.has(SHARE_KEY)) return { kind: "unsupported", notice: "다른 판의 링크예요. 이 개편본에서 답을 바꿔 해석하지 않아요. 원래 받은 주소에서 확인해 주세요." };
  if (params.getAll(SHARE_KEY).length !== 1) return { kind: "invalid", notice: "링크의 답 형식을 확인하지 못했어요." };
  try {
    const value: unknown = JSON.parse(decodeBase64Url(params.get(SHARE_KEY) ?? ""));
    if (!isRecord(value)) throw new Error("Invalid payload");
    if (value.version !== MEASUREMENT_VERSION || value.revision !== BANK_REVISION
      || !isCompatibleExpression(value.expression)) return { kind: "unsupported", notice: "문항이나 결과의 판이 다른 링크예요. 이 판의 답으로 바꿔 읽지 않아요." };
    const first = unpack(value.first);
    const second = value.second === undefined ? undefined : unpack(value.second);
    if (!first || (value.second !== undefined && !second)) throw new Error("Invalid answers");
    const notice = expressionCorrectionNotice(value.expression);
    const correction = notice ? { notice } : {};
    return second ? { kind: "couple", first, second, ...correction } : { kind: "invite", first, ...correction };
  } catch { return { kind: "invalid", notice: "링크의 답을 읽지 못했어요. 주소가 끝까지 복사됐는지 확인해 주세요." }; }
}
