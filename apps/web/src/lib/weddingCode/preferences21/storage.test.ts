import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERSIONS, createEmptyAnswers } from "./bank";
import {
  PREFERENCES21_AUTOSAVE_KEY, PREFERENCES21_RETENTION_MS, PREFERENCES21_STORAGE_KEY,
  clearPreferences21Progress, getPreferences21StorageSnapshot, parsePreferences21BoundedJson, readPreferences21Autosave,
  readPreferences21Progress, setPreferences21Autosave, writePreferences21Progress,
} from "./storage";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
function envelope(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, ...VERSIONS, answers: createEmptyAnswers(), position: 0, answerWrittenAt: NOW, ...overrides };
}

describe("21문항 본인 답 저장 계약", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  it("requires its own explicit opt-in and never inherits older version choices", () => {
    localStorage.setItem("hanbang.wedding-code.v31.autosave", "on");
    expect(readPreferences21Autosave(localStorage)).toBe(false);
    expect(writePreferences21Progress({ answers: createEmptyAnswers(), position: 0 }, { enabled: false, storage: localStorage, now: NOW }).status).toBe("disabled");
    expect(localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBeNull();
    expect(readPreferences21Progress(localStorage, NOW).status).toBe("empty");
  });
  it("round trips all distinct states and keeps only own progress in the new namespace", () => {
    const answers = createEmptyAnswers();
    Object.assign(answers, { Q01: 1, Q02: 2, Q03: 3, Q04: 4, Q05: 5, Q06: "unknown", Q07: "not-applicable", Q08: "skipped" });
    localStorage.setItem("hanbang:wedding-code:likert-alpha.1:draft", "legacy-30");
    const result = writePreferences21Progress({ answers, position: 7 }, { enabled: true, storage: localStorage, now: NOW });
    expect(result.status).toBe("saved");
    expect(readPreferences21Autosave(localStorage)).toBe(true);
    const read = readPreferences21Progress(localStorage, NOW + 1);
    expect(read.status).toBe("ready");
    if (read.status !== "ready") throw new Error("Expected stored progress");
    expect(read.progress).toEqual({ answers, position: 7, answerWrittenAt: NOW });
    expect(localStorage.getItem(PREFERENCES21_STORAGE_KEY)).not.toMatch(/partner|first|second|profile|budget/u);
    expect(clearPreferences21Progress(localStorage).status).toBe("cleared");
    expect(localStorage.getItem("hanbang:wedding-code:likert-alpha.1:draft")).toBe("legacy-30");
  });
  it("does not extend 30 days for rereads, duplicate saves or a position-only write", () => {
    const answers = { ...createEmptyAnswers(), Q01: 5 };
    writePreferences21Progress({ answers, position: 0 }, { enabled: true, storage: localStorage, now: NOW });
    expect(readPreferences21Progress(localStorage, NOW + 500).status).toBe("ready");
    expect(writePreferences21Progress({ answers, position: 8 }, { enabled: true, storage: localStorage, now: NOW + 1000 }).answerWrittenAt).toBe(NOW);
    expect(writePreferences21Progress({ answers, position: 9 }, { enabled: true, storage: localStorage, now: NOW + PREFERENCES21_RETENTION_MS }).answerWrittenAt).toBe(NOW);
    expect(readPreferences21Progress(localStorage, NOW + PREFERENCES21_RETENTION_MS).status).toBe("expired");
    expect(writePreferences21Progress({ answers: { ...answers, Q01: 4 }, position: 0 }, { enabled: true, storage: localStorage, now: NOW + PREFERENCES21_RETENTION_MS }).answerWrittenAt).toBe(NOW + PREFERENCES21_RETENTION_MS);
  });
  it.each([
    [], {}, { ...envelope(), answers: Array(30).fill(5) },
    envelope({ answers: { ...createEmptyAnswers(), Q01: 0 } }), envelope({ answers: { ...createEmptyAnswers(), Q22: 5 } }),
    envelope({ questionnaireVersion: "preferences-20261008-r2" }), envelope({ displayVersion: "future" }),
    envelope({ position: -1 }), envelope({ position: 21 }), envelope({ position: 0.5 }),
    envelope({ answerWrittenAt: NOW + 1 }), envelope({ answerWrittenAt: "2026-10-10" }),
    envelope({ partnerAnswers: createEmptyAnswers() }),
  ])("rejects invalid storage without interpreting it as new answers: %j", (value) => {
    localStorage.setItem(PREFERENCES21_STORAGE_KEY, JSON.stringify(value));
    expect(readPreferences21Progress(localStorage, NOW).status).toBe("invalid");
  });
  it("rejects duplicate/escaped duplicate keys, huge data and malformed JSON", () => {
    const valid = JSON.stringify(envelope());
    for (const raw of [valid.replace('"Q01":null', '"Q01":null,"Q01":5'), valid.replace('"Q01":null', '"Q01":null,"\\u005101":5'), "[".repeat(9000), "{", '{"__proto__":{}}']) {
      localStorage.setItem(PREFERENCES21_STORAGE_KEY, raw);
      expect(readPreferences21Progress(localStorage, NOW).status).toBe("invalid");
    }
    expect(parsePreferences21BoundedJson('{"a":[{"b":"escaped\\\"quote"}]}')).toEqual({ a: [{ b: 'escaped"quote' }] });
  });
  it("keeps autosave off even if deleting a saved answer fails", () => {
    writePreferences21Progress({ answers: createEmptyAnswers(), position: 0 }, { enabled: true, storage: localStorage, now: NOW });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(setPreferences21Autosave(false, localStorage)).toMatchObject({ status: "unavailable", enabled: false });
    expect(localStorage.getItem(PREFERENCES21_AUTOSAVE_KEY)).toBe("off");
    expect(readPreferences21Progress(localStorage, NOW).status).toBe("empty");
    expect(writePreferences21Progress({ answers: createEmptyAnswers(), position: 1 }, { enabled: true, storage: localStorage, now: NOW }).status).toBe("disabled");
  });
  it("rejects a stale tab's first or resumed write without overwriting newer answers", () => {
    const initial = getPreferences21StorageSnapshot(localStorage);
    expect(initial).toBeNull();
    const firstAnswers = { ...createEmptyAnswers(), Q05: 5 };
    expect(writePreferences21Progress({ answers: firstAnswers, position: 4 }, { enabled: true, storage: localStorage, now: NOW, expectedRaw: initial }).status).toBe("saved");
    const current = getPreferences21StorageSnapshot(localStorage);
    expect(writePreferences21Progress({ answers: { ...createEmptyAnswers(), Q05: 1 }, position: 4 }, { enabled: true, storage: localStorage, now: NOW + 1, expectedRaw: initial }).status).toBe("conflict");
    expect(getPreferences21StorageSnapshot(localStorage)).toBe(current);
    const winningAnswers = { ...firstAnswers, Q06: 4 };
    expect(writePreferences21Progress({ answers: winningAnswers, position: 5 }, { enabled: true, storage: localStorage, now: NOW + 2, expectedRaw: current }).status).toBe("saved");
    const winner = getPreferences21StorageSnapshot(localStorage);
    expect(writePreferences21Progress({ answers: firstAnswers, position: 6 }, { enabled: true, storage: localStorage, now: NOW + 3, expectedRaw: current }).status).toBe("conflict");
    expect(getPreferences21StorageSnapshot(localStorage)).toBe(winner);
    const read = readPreferences21Progress(localStorage, NOW + 4);
    if (read.status !== "ready") throw new Error("Expected winning answers");
    expect(read.progress.answers).toEqual(winningAnswers);
  });
  it("does not report an unavailable or oversized snapshot as an empty store", () => {
    localStorage.setItem(PREFERENCES21_STORAGE_KEY, "x".repeat(9000));
    expect(getPreferences21StorageSnapshot(localStorage)).toBeUndefined();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getPreferences21StorageSnapshot(localStorage)).toBeUndefined();
  });
  it("fails with friendly messages when storage is blocked or silently drops a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(writePreferences21Progress({ answers: createEmptyAnswers(), position: 0 }, { enabled: true, storage: localStorage, now: NOW })).toMatchObject({ status: "unavailable", notice: expect.stringContaining("지금 탭") });
    vi.restoreAllMocks();
    const blocked = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(writePreferences21Progress({ answers: createEmptyAnswers(), position: 0 }, { enabled: true, storage: blocked, now: NOW }).status).toBe("unavailable");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readPreferences21Progress(localStorage, NOW).status).toBe("unavailable");
  });
});
