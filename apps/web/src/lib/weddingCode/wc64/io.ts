// wc64 이어 하기 저장. 이 브라우저(localStorage 등)에만 두고 마지막 저장부터 30일이 지나면 읽지 않는다.
// 서버·주소(해시 포함)·이용 통계로 보내는 경로는 없다. 공유 링크와 해시 코덱은 만들지 않는다.
import { WC64_ITEMS, WC64_ORDER } from "./bank";
import {
  WC64_AUTOSAVE_KEY, WC64_RETENTION_MS, WC64_STORAGE_KEY, WC64_VERSION,
  type Wc64Answers, type Wc64Draft, type Wc64Plan, type Wc64Screen, type Wc64Skipped,
} from "./types";

const MAX_PAYLOAD_LENGTH = 16_000;
const PLANS: readonly Wc64Plan[] = ["yes", "maybe", "none"];
const SCREENS: readonly Wc64Screen[] = ["intro", "plan", "questions", "result"];
const ITEM_IDS = new Set(WC64_ITEMS.map(it => it.id));
const SECTION_IDS = new Set(WC64_ORDER);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isWc64Answers(value: unknown): value is Wc64Answers {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([id, v]) =>
    ITEM_IDS.has(id) && typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5);
}

function isWc64Skipped(value: unknown): value is Wc64Skipped {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([id, v]) => SECTION_IDS.has(id) && typeof v === "boolean");
}

/** 저장 형식 확인. 판이 다르거나 모양이 어긋나면 null(시각 만료는 readWc64Draft 가 본다). */
export function parseWc64Draft(raw: string): Wc64Draft | null {
  if (raw.length > MAX_PAYLOAD_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== WC64_VERSION) return null;
    if (!(value.plan === null || PLANS.includes(value.plan as Wc64Plan))) return null;
    if (!isWc64Answers(value.answers)) return null;
    if (value.skipped !== undefined && !isWc64Skipped(value.skipped)) return null;
    if (typeof value.cursor !== "number" || !Number.isInteger(value.cursor) || value.cursor < 0 || value.cursor > 10_000) return null;
    if (typeof value.screen !== "string" || !SCREENS.includes(value.screen as Wc64Screen)) return null;
    if (!isIsoDate(value.updatedAt)) return null;
    return {
      version: WC64_VERSION,
      plan: value.plan as Wc64Plan | null,
      answers: { ...value.answers },
      skipped: value.skipped ? { ...(value.skipped as Wc64Skipped) } : {},
      cursor: value.cursor,
      screen: value.screen as Wc64Screen,
      updatedAt: value.updatedAt,
    };
  } catch { return null; }
}

/** 새 이어 하기 기록(아직 저장하지 않음) */
export function createWc64Draft(now: number = Date.now()): Wc64Draft {
  return {
    version: WC64_VERSION, plan: null, answers: {}, skipped: {}, cursor: 0, screen: "intro",
    updatedAt: new Date(now).toISOString(),
  };
}

/** 저장해 둔 답을 읽는다. 없음·다른 판·깨진 기록·30일 지남·저장소 예외는 모두 null. */
export function readWc64Draft(storage: Pick<Storage, "getItem">, now: number = Date.now()): Wc64Draft | null {
  try {
    const raw = storage.getItem(WC64_STORAGE_KEY);
    if (!raw) return null;
    const draft = parseWc64Draft(raw);
    if (!draft) return null;
    const age = now - Date.parse(draft.updatedAt);
    if (!Number.isFinite(age) || age < 0 || age >= WC64_RETENTION_MS) return null;
    return draft;
  } catch { return null; }
}

/** 자동 저장이 켜져 있을 때만 쓴다. 꺼져 있거나 형식이 어긋나거나 저장소가 막히면 false. */
export function writeWc64Draft(storage: Pick<Storage, "getItem" | "setItem">, draft: Wc64Draft): boolean {
  try {
    if (!readWc64Autosave(storage)) return false;
    const normalized = parseWc64Draft(JSON.stringify(draft));
    if (!normalized) return false;
    storage.setItem(WC64_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch { return false; }
}

export function clearWc64Draft(storage: Pick<Storage, "getItem" | "removeItem">): boolean {
  try {
    storage.removeItem(WC64_STORAGE_KEY);
    return storage.getItem(WC64_STORAGE_KEY) === null;
  } catch { return false; }
}

/** 자동 저장 설정. 따로 끈 적이 없으면 켜짐, 저장소를 못 읽으면 false. */
export function readWc64Autosave(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(WC64_AUTOSAVE_KEY) !== "off";
  } catch { return false; }
}

/** 자동 저장을 켜고 끈다. 끄면 저장해 둔 답을 바로 지운다. */
export function setWc64Autosave(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, on: boolean): boolean {
  try {
    // 꺼짐을 먼저 남겨 두면 답 삭제가 실패해도 이후 자동 저장은 다시 켜지지 않는다.
    storage.setItem(WC64_AUTOSAVE_KEY, on ? "on" : "off");
    const persisted = storage.getItem(WC64_AUTOSAVE_KEY) === (on ? "on" : "off");
    return on ? persisted : clearWc64Draft(storage) && persisted;
  } catch { return false; }
}
