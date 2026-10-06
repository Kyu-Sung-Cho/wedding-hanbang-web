/** v4.1 저장소는 v4.0의 검증 로직을 별도 키와 정확한 봉투 판으로 사용한다. */
import { V40_STORAGE, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V41_VERSION } from "@/constants/weddingCodeV41";
import * as old from "../v40/storage";
import type { Bank, HistoryEntry, ProgressSnapshot, StorageLike } from "../v40/types";
import type { ExtraKey, ExtraPort, ExtraPortOptions } from "../v40/storage";

export const V41_STORAGE = {
  progressKey: "hanbang:wedding-code:v4.1:progress",
  historyKey: "hanbang:wedding-code:v4.1:history",
  letterGuessKey: "hanbang:wedding-code:v4.1:letter-guess",
  autosaveKey: "hanbang.wedding-code.v4.1.autosave",
} as const;

const keyMap: Readonly<Record<string, string>> = {
  [V40_STORAGE.progressKey]: V41_STORAGE.progressKey,
  [V40_STORAGE.historyKey]: V41_STORAGE.historyKey,
  [V40_STORAGE.letterGuessKey]: V41_STORAGE.letterGuessKey,
  [V40_STORAGE.autosaveKey]: V41_STORAGE.autosaveKey,
};

const isEnvelope = (key: string): boolean => key === V40_STORAGE.progressKey || key === V40_STORAGE.historyKey || key === V40_STORAGE.letterGuessKey;

/** 저장 원문의 판 태그만 바꾼다. 예상하지 못한 값은 파서가 거절할 형태로 내고 원본은 건드리지 않는다. */
function virtualEnvelope(raw: string, from: string, to: string): string {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return raw;
    const record = value as Record<string, unknown>;
    if (record.version !== from) return JSON.stringify({ ...record, version: "unsupported-edition" });
    return JSON.stringify({ ...record, version: to });
  } catch {
    return raw;
  }
}

/** v4.0 내부 함수에는 가상 v4.0 봉투만 보이고, 실제 브라우저에는 v4.1 봉투만 남는다. */
function isolated(storage: StorageLike): StorageLike {
  const map = (key: string): string => {
    const target = keyMap[key];
    if (target) return target;
    // 이전 판의 진행과 기록은 읽거나 지우지 않는다. 자동 저장의 off 선호만 아래에서 읽는다.
    if (key === V40_STORAGE.legacyV31ProgressKey) return "hanbang:wedding-code:v4.1:unused-legacy-progress";
    if (key === V40_STORAGE.legacyV31AutosaveKey) return "hanbang.wedding-code.v4.1.unused-legacy-autosave";
    throw new Error("지원하지 않는 웨딩코드 저장 키");
  };
  return {
    getItem(key) {
      if (key === V40_STORAGE.legacyV31AutosaveKey) {
        // 이전 판에서 끄기를 골랐다면 새 판도 첫 방문 때 저장을 켜지 않는다.
        return storage.getItem(V40_STORAGE.autosaveKey) === "off" || storage.getItem(V40_STORAGE.legacyV31AutosaveKey) === "off" ? "off" : null;
      }
      const raw = storage.getItem(map(key));
      return raw !== null && isEnvelope(key) ? virtualEnvelope(raw, WEDDING_CODE_V41_VERSION, WEDDING_CODE_V40_VERSION) : raw;
    },
    setItem(key, value) {
      storage.setItem(map(key), isEnvelope(key) ? virtualEnvelope(value, WEDDING_CODE_V40_VERSION, WEDDING_CODE_V41_VERSION) : value);
    },
    removeItem(key) {
      storage.removeItem(map(key));
    },
  };
}

export const browserStorage = old.browserStorage;
export const encodeProgressAnswers = old.encodeProgressAnswers;
export const decodeProgressAnswers = old.decodeProgressAnswers;
export const readProgress = (storage: StorageLike, bank: Bank, now?: number) => old.readProgress(isolated(storage), bank, now);
export const writeProgress = (storage: StorageLike, bank: Bank, snapshot: ProgressSnapshot, expectedRaw: string | null, now?: number) => old.writeProgress(isolated(storage), bank, snapshot, expectedRaw, now);
export const clearProgress = (storage: StorageLike) => old.clearProgress(isolated(storage));
export const readHistory = (storage: StorageLike, now?: number) => old.readHistory(isolated(storage), now);
export const appendHistory = (storage: StorageLike, entry: HistoryEntry, now?: number) => old.appendHistory(isolated(storage), entry, now);
export const clearHistory = (storage: StorageLike) => old.clearHistory(isolated(storage));
export const purgeExpired = (storage: StorageLike, bank: Bank, now?: number) => old.purgeExpired(isolated(storage), bank, now);
export const readAutosavePreference = (storage: StorageLike) => old.readAutosavePreference(isolated(storage));
export const writeAutosavePreference = (storage: StorageLike, preference: "on" | "off") => old.writeAutosavePreference(isolated(storage), preference);
export const createExtraPort = (handle: StorageLike | null, key: ExtraKey, options: ExtraPortOptions): ExtraPort =>
  old.createExtraPort(handle === null ? null : isolated(handle), key, {
    ...options,
    prefHandle: options.prefHandle === undefined ? undefined : options.prefHandle === null ? null : isolated(options.prefHandle),
  });
// 새 판에서는 이전 판 진행을 표시하지 않는다. 사용자는 각 판의 주소에서 그 답을 이어 볼 수 있다.
export const probeLegacyV31Progress = (): { readonly present: false; readonly savedAt: null } => ({ present: false, savedAt: null });
