import { describe, expect, it } from "vitest";
import { V40_STORAGE } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V42_VERSION } from "@/constants/weddingCodeV42";
import type { HistoryEntry, StorageLike } from "../v40/types";
import { V41_STORAGE } from "../v41/storage";
import { WEDDING_CODE_V42_BANK } from "./bank";
import { V42_STORAGE, appendHistory, clearHistory, clearProgress, createExtraPort, readAutosavePreference, readHistory, readProgress, writeAutosavePreference, writeProgress } from "./storage";

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe("v4.2 저장 분리", () => {
  it("진행 봉투에는 v4.2 태그를 쓰고 v4.1·v4.0·v3.1의 답과 기록을 만지지 않는다", () => {
    const memory = new MemoryStorage();
    memory.setItem(V40_STORAGE.progressKey, "old-v40-progress");
    memory.setItem(V40_STORAGE.historyKey, "old-v40-history");
    memory.setItem(V40_STORAGE.legacyV31ProgressKey, "old-v31-progress");
    memory.setItem(V40_STORAGE.autosaveKey, "on");
    memory.setItem(V41_STORAGE.progressKey, "old-v41-progress");
    memory.setItem(V41_STORAGE.historyKey, "old-v41-history");
    memory.setItem(V41_STORAGE.letterGuessKey, "old-v41-letter");
    const snapshot = { formBit: 0 as const, responses: {}, screen: "questions" as const, cursor: 0, skippedReviewDone: false };
    expect(writeProgress(memory, WEDDING_CODE_V42_BANK, snapshot, null, 1000).status).toBe("saved");
    expect(JSON.parse(memory.getItem(V42_STORAGE.progressKey) ?? "null").version).toBe(WEDDING_CODE_V42_VERSION);
    expect(readProgress(memory, WEDDING_CODE_V42_BANK, 1001).status).toBe("ready");
    expect(clearProgress(memory).status).toBe("cleared");
    expect(clearHistory(memory).status).toBe("cleared");
    expect(writeAutosavePreference(memory, "off").status).toBe("saved");
    expect(memory.getItem(V40_STORAGE.progressKey)).toBe("old-v40-progress");
    expect(memory.getItem(V40_STORAGE.historyKey)).toBe("old-v40-history");
    expect(memory.getItem(V40_STORAGE.legacyV31ProgressKey)).toBe("old-v31-progress");
    expect(memory.getItem(V40_STORAGE.autosaveKey)).toBe("on");
    expect(memory.getItem(V41_STORAGE.progressKey)).toBe("old-v41-progress");
    expect(memory.getItem(V41_STORAGE.historyKey)).toBe("old-v41-history");
    expect(memory.getItem(V41_STORAGE.letterGuessKey)).toBe("old-v41-letter");
  });

  it.each(["v4.0-tendency", "v4.1-depth"])("%s의 저장 봉투는 새 판 답으로 읽지 않는다", (version) => {
    const memory = new MemoryStorage();
    memory.setItem(V42_STORAGE.progressKey, JSON.stringify({ schema: 1, version, savedAt: 1000, formBit: 0, answers: ".".repeat(68), screen: "questions", cursor: 0, skippedReviewDone: false }));
    expect(readProgress(memory, WEDDING_CODE_V42_BANK, 1001).status).toBe("invalid");
  });

  it("지난 결과 기록도 v4.2 봉투로만 저장하고 이전 판 기록을 합치지 않는다", () => {
    const memory = new MemoryStorage();
    memory.setItem(V40_STORAGE.historyKey, "old-v40-history");
    memory.setItem(V41_STORAGE.historyKey, "old-v41-history");
    const entry: HistoryEntry = {
      at: 1000,
      formBit: 0,
      axes: [
        { letter: "V", band: "lean", provisional: false },
        { letter: "W", band: "lean", provisional: false },
        { letter: "U", band: "lean", provisional: false },
        { letter: "H", band: "lean", provisional: false },
      ],
    };
    expect(readHistory(memory, 1001).status).toBe("empty");
    expect(appendHistory(memory, entry, 1001).status).toBe("saved");
    expect(JSON.parse(memory.getItem(V42_STORAGE.historyKey) ?? "null").version).toBe(WEDDING_CODE_V42_VERSION);
    expect(readHistory(memory, 1001)).toEqual({ status: "ready", entries: [entry] });
    expect(clearHistory(memory).status).toBe("cleared");
    expect(memory.getItem(V40_STORAGE.historyKey)).toBe("old-v40-history");
    expect(memory.getItem(V41_STORAGE.historyKey)).toBe("old-v41-history");
  });

  it("글자 고르기 포트도 별도 키와 새 판 봉투를 쓴다", () => {
    const memory = new MemoryStorage();
    const port = createExtraPort(memory, "letterGuess", { honorAutosave: true });
    const oldEnvelope = JSON.stringify({ schema: 1, version: "v4.0-tendency", savedAt: 1000, formBit: 0, guess: "V---" });
    expect(port.write(oldEnvelope)).toBe("saved");
    expect(JSON.parse(memory.getItem(V42_STORAGE.letterGuessKey) ?? "null").version).toBe(WEDDING_CODE_V42_VERSION);
    expect(memory.getItem(V40_STORAGE.letterGuessKey)).toBeNull();
    expect(port.read()).toEqual({ ok: true, raw: oldEnvelope });
  });

  it.each([V41_STORAGE.autosaveKey, V40_STORAGE.autosaveKey, V40_STORAGE.legacyV31AutosaveKey])("이전 판 %s의 끄기는 새 판 키가 없는 첫 선호에만 반영한다", (previousKey) => {
    const memory = new MemoryStorage();
    memory.setItem(previousKey, "off");
    memory.setItem(V40_STORAGE.progressKey, "old-progress");
    expect(readAutosavePreference(memory)).toBe("off");
    expect(writeAutosavePreference(memory, "on").status).toBe("saved");
    expect(readAutosavePreference(memory)).toBe("on");
    expect(memory.getItem(V40_STORAGE.progressKey)).toBe("old-progress");
    expect(memory.getItem(previousKey)).toBe("off");
  });

  it("새 판 선호가 있으면 이전 판의 켜기와 끄기가 이를 바꾸지 않는다", () => {
    const memory = new MemoryStorage();
    memory.setItem(V41_STORAGE.autosaveKey, "on");
    memory.setItem(V40_STORAGE.autosaveKey, "off");
    memory.setItem(V40_STORAGE.legacyV31AutosaveKey, "off");
    memory.setItem(V42_STORAGE.autosaveKey, "off");
    expect(readAutosavePreference(memory)).toBe("off");
    memory.setItem(V42_STORAGE.autosaveKey, "on");
    expect(readAutosavePreference(memory)).toBe("on");
    memory.setItem(V42_STORAGE.autosaveKey, "invalid-existing-preference");
    expect(readAutosavePreference(memory)).toBe("on");
  });
});
