import { ITEMS21, VERSIONS, parseAnswers } from "./bank";
import type { Answers } from "./types";

export const PREFERENCES21_STORAGE_KEY = "hanbang:wedding-code:preferences21:r1:own-progress";
export const PREFERENCES21_AUTOSAVE_KEY = "hanbang:wedding-code:preferences21:r1:autosave";
export const PREFERENCES21_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const PREFERENCES21_MAX_JSON_LENGTH = 8_192;
export type Preferences21Storage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type Preferences21Versions = Readonly<{
  questionnaireVersion: string;
  interpretationVersion: string;
  displayVersion: string;
}>;
export type Preferences21Progress = Readonly<{
  answers: Answers;
  position: number;
  answerWrittenAt: number;
}>;
export type Preferences21StorageRead =
  | { status: "ready"; progress: Preferences21Progress; notice: string }
  | { status: "empty" | "invalid" | "expired" | "unavailable"; notice: string };

export function isPreferences21PlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function hasPreferences21ExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

export function hasPreferences21Versions(value: unknown): value is Record<string, unknown> & Preferences21Versions {
  return isPreferences21PlainObject(value)
    && value.questionnaireVersion === VERSIONS.questionnaireVersion
    && value.interpretationVersion === VERSIONS.interpretationVersion
    && value.displayVersion === VERSIONS.displayVersion;
}

// JSON.parse가 덮어쓰는 중복 키도 거절한다. 깊이·크기를 먼저 제한하고 원문은 기록하지 않는다.
export function parsePreferences21BoundedJson(raw: string, maxLength = PREFERENCES21_MAX_JSON_LENGTH): unknown {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > maxLength) return null;
  let offset = 0;
  let nodes = 0;
  const whitespace = () => { while (/\s/u.test(raw[offset] ?? "") && offset < raw.length) offset++; };
  const stringToken = (): string => {
    const start = offset;
    if (raw[offset++] !== '"') throw new Error("invalid");
    while (offset < raw.length) {
      const char = raw[offset++];
      if (char === '"') {
        const parsed: unknown = JSON.parse(raw.slice(start, offset));
        if (typeof parsed !== "string") throw new Error("invalid");
        return parsed;
      }
      if (char === "\\") offset++;
    }
    throw new Error("invalid");
  };
  const visit = (depth: number): void => {
    if (depth > 8 || ++nodes > 256) throw new Error("invalid");
    whitespace();
    const char = raw[offset];
    if (char === '"') { stringToken(); return; }
    if (char === "{" || char === "[") {
      const object = char === "{";
      const close = object ? "}" : "]";
      const keys = new Set<string>();
      offset++;
      whitespace();
      if (raw[offset] === close) { offset++; return; }
      let entries = 0;
      while (offset < raw.length) {
        if (++entries > 32) throw new Error("invalid");
        if (object) {
          whitespace();
          const key = stringToken();
          if (keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) throw new Error("invalid");
          keys.add(key);
          whitespace();
          if (raw[offset++] !== ":") throw new Error("invalid");
        }
        visit(depth + 1);
        whitespace();
        if (raw[offset] === close) { offset++; return; }
        if (raw[offset++] !== ",") throw new Error("invalid");
      }
      throw new Error("invalid");
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(raw.slice(offset));
    if (!literal) throw new Error("invalid");
    offset += literal[0].length;
  };
  try {
    visit(0);
    whitespace();
    if (offset !== raw.length) return null;
    return JSON.parse(raw) as unknown;
  } catch { return null; }
}

function storageOrDefault(storage: Preferences21Storage | null | undefined): Preferences21Storage | null {
  if (storage !== undefined) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

function validNow(now: number): boolean {
  return Number.isSafeInteger(now) && now >= 0;
}

export function readPreferences21Autosave(storage?: Preferences21Storage | null): boolean {
  try { return storageOrDefault(storage)?.getItem(PREFERENCES21_AUTOSAVE_KEY) === "on"; }
  catch { return false; }
}

/** 비교 후 쓰기에만 사용하는 현재 원문이다. UI·로그·다른 저장소로 복사하지 않는다. */
export function getPreferences21StorageSnapshot(storage?: Preferences21Storage | null): string | null | undefined {
  try {
    const port = storageOrDefault(storage);
    if (!port) return undefined;
    const raw = port.getItem(PREFERENCES21_STORAGE_KEY);
    return raw === null || raw.length <= PREFERENCES21_MAX_JSON_LENGTH ? raw : undefined;
  } catch { return undefined; }
}

export function readPreferences21Progress(
  storage?: Preferences21Storage | null,
  now = Date.now(),
): Preferences21StorageRead {
  try {
    const port = storageOrDefault(storage);
    if (!port) return { status: "unavailable", notice: "이 브라우저에서는 이어서 저장하기가 어려워요. 지금 탭에서는 계속 답할 수 있어요." };
    if (port.getItem(PREFERENCES21_AUTOSAVE_KEY) === "off") return { status: "empty", notice: "자동 저장이 꺼져 있어요. 이전 답은 불러오지 않았어요." };
    const raw = port.getItem(PREFERENCES21_STORAGE_KEY);
    if (raw === null) return { status: "empty", notice: "" };
    const value = parsePreferences21BoundedJson(raw);
    if (!isPreferences21PlainObject(value)
      || !hasPreferences21ExactKeys(value, ["schemaVersion", ...Object.keys(VERSIONS), "answers", "position", "answerWrittenAt"])
      || value.schemaVersion !== 1 || !hasPreferences21Versions(value)
      || !Number.isInteger(value.position) || typeof value.position !== "number"
      || value.position < 0 || value.position >= ITEMS21.length
      || typeof value.answerWrittenAt !== "number" || !validNow(value.answerWrittenAt)
      || !validNow(now) || value.answerWrittenAt > now) {
      return { status: "invalid", notice: "저장된 21문항 답의 형식이나 판을 확인하지 못했어요. 새 답을 시작하거나 이 판의 저장만 지울 수 있어요." };
    }
    const answers = parseAnswers(value.answers);
    if (!answers) return { status: "invalid", notice: "저장된 21문항 답을 확인하지 못했어요. 지금 탭에서 새로 답할 수 있어요." };
    if (now - value.answerWrittenAt >= PREFERENCES21_RETENTION_MS) {
      return { status: "expired", notice: "마지막으로 답을 저장한 지 30일이 지나 불러오지 않았어요. 이 판의 저장을 지우거나 새로 답해 주세요." };
    }
    return { status: "ready", progress: { answers, position: value.position, answerWrittenAt: value.answerWrittenAt }, notice: "이 브라우저에 저장한 본인 답을 이어서 볼 수 있어요." };
  } catch {
    return { status: "unavailable", notice: "브라우저에 저장한 답을 읽지 못했어요. 지금 탭에서는 계속 답할 수 있어요." };
  }
}

export function writePreferences21Progress(
  progress: { answers: unknown; position: number },
  options: { enabled: boolean; storage?: Preferences21Storage | null; now?: number; expectedRaw?: string | null },
): { status: "saved" | "disabled" | "invalid" | "unavailable" | "conflict"; notice: string; answerWrittenAt?: number } {
  if (options.enabled !== true) return { status: "disabled", notice: "자동 저장이 꺼져 있어요. 답은 지금 탭에만 남아요." };
  const now = options.now ?? Date.now();
  const answers = parseAnswers(progress.answers);
  if (!answers || !validNow(now) || !Number.isInteger(progress.position)
    || progress.position < 0 || progress.position >= ITEMS21.length) {
    return { status: "invalid", notice: "이번 답의 저장 형식을 확인하지 못했어요. 지금 탭에서는 계속 답할 수 있어요." };
  }
  try {
    const port = storageOrDefault(options.storage);
    if (!port) throw new Error("unavailable");
    const savedChoice = port.getItem(PREFERENCES21_AUTOSAVE_KEY);
    if (savedChoice === "off") return { status: "disabled", notice: "자동 저장이 꺼져 있어요. 다시 저장하려면 저장 허용을 직접 켜 주세요." };
    const previousRaw = port.getItem(PREFERENCES21_STORAGE_KEY);
    if (Object.prototype.hasOwnProperty.call(options, "expectedRaw") && options.expectedRaw !== previousRaw) {
      return { status: "conflict", notice: "다른 탭에서 저장된 답이 바뀌어 덮어쓰지 않았어요. 지금 탭의 답은 유지하며, 저장된 답을 다시 확인한 뒤 이어가 주세요." };
    }
    const previous = previousRaw === null ? null : parsePreferences21BoundedJson(previousRaw);
    const previousAnswers = isPreferences21PlainObject(previous) ? parseAnswers(previous.answers) : null;
    const sameAnswers = isPreferences21PlainObject(previous) && previous.schemaVersion === 1
      && hasPreferences21ExactKeys(previous, ["schemaVersion", ...Object.keys(VERSIONS), "answers", "position", "answerWrittenAt"])
      && hasPreferences21Versions(previous) && previousAnswers !== null
      && typeof previous.answerWrittenAt === "number" && validNow(previous.answerWrittenAt) && previous.answerWrittenAt <= now
      && ITEMS21.every((item) => previousAnswers[item.id] === answers[item.id]);
    const answerWrittenAt = sameAnswers && isPreferences21PlainObject(previous) && typeof previous.answerWrittenAt === "number" ? previous.answerWrittenAt : now;
    const raw = JSON.stringify({ schemaVersion: 1, ...VERSIONS, answers, position: progress.position, answerWrittenAt });
    if (savedChoice !== "on") port.setItem(PREFERENCES21_AUTOSAVE_KEY, "on");
    if (port.getItem(PREFERENCES21_AUTOSAVE_KEY) !== "on") throw new Error("unavailable");
    port.setItem(PREFERENCES21_STORAGE_KEY, raw);
    if (port.getItem(PREFERENCES21_STORAGE_KEY) !== raw) return { status: "conflict", notice: "저장 중 다른 탭의 답이 바뀌었어요. 지금 탭의 답은 유지하며 저장된 답을 다시 확인해 주세요." };
    if (port.getItem(PREFERENCES21_AUTOSAVE_KEY) !== "on") return { status: "disabled", notice: "다른 탭에서 자동 저장을 껐어요. 저장된 답을 다시 불러오지 않고 지금 탭에서만 이어가요." };
    return { status: "saved", notice: "본인 답을 이 브라우저에 저장했어요. 마지막 답 저장부터 30일 동안 이어볼 수 있어요.", answerWrittenAt };
  } catch {
    return { status: "unavailable", notice: "브라우저에 답을 저장하지 못했어요. 지금 탭에서는 계속 답할 수 있어요." };
  }
}

export function clearPreferences21Progress(storage?: Preferences21Storage | null): { status: "cleared" | "unavailable"; notice: string } {
  try {
    const port = storageOrDefault(storage);
    if (!port) throw new Error("unavailable");
    port.removeItem(PREFERENCES21_STORAGE_KEY);
    if (port.getItem(PREFERENCES21_STORAGE_KEY) !== null) throw new Error("unavailable");
    return { status: "cleared", notice: "이 브라우저에 저장한 21문항 본인 답을 지웠어요." };
  } catch { return { status: "unavailable", notice: "저장된 답을 지우지 못했어요. 브라우저 저장 권한을 확인한 뒤 다시 시도해 주세요." }; }
}

export function setPreferences21Autosave(enabled: boolean, storage?: Preferences21Storage | null): { status: "saved" | "unavailable"; enabled: boolean; notice: string } {
  try {
    const port = storageOrDefault(storage);
    if (!port) throw new Error("unavailable");
    const choice = enabled === true ? "on" : "off";
    port.setItem(PREFERENCES21_AUTOSAVE_KEY, choice);
    if (port.getItem(PREFERENCES21_AUTOSAVE_KEY) !== choice) throw new Error("unavailable");
    if (enabled !== true) {
      const cleared = clearPreferences21Progress(port);
      if (cleared.status !== "cleared") return { status: "unavailable", enabled: false, notice: "자동 저장은 껐지만 이전 답을 지우지 못했어요. 이전 답을 다시 불러오지 않으며, 브라우저 저장 권한을 확인한 뒤 삭제를 다시 시도해 주세요." };
    }
    return { status: "saved", enabled: enabled === true, notice: enabled === true ? "이 브라우저에 본인 답을 저장하도록 허용했어요." : "자동 저장을 끄고 이 판의 본인 답을 지웠어요." };
  } catch { return { status: "unavailable", enabled: false, notice: "저장 선택을 브라우저에 남기지 못했어요. 지금 탭에서는 자동 저장을 꺼 두었어요." }; }
}
