import { describe, expect, it } from "vitest";
import { V40_STORAGE } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V41_VERSION } from "@/constants/weddingCodeV41";
import type { StorageLike } from "../v40/types";
import { WEDDING_CODE_V41_BANK } from "./bank";
import { V41_STORAGE, clearHistory, clearProgress, createExtraPort, readAutosavePreference, readProgress, writeAutosavePreference, writeProgress } from "./storage";

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe("v4.1 저장 분리", () => {
  it("진행 봉투에는 v4.1 태그를 쓰고 v4.0과 v3.1 키를 만지지 않는다", () => {
    const memory = new MemoryStorage();
    memory.setItem(V40_STORAGE.progressKey, "old-v40-progress");
    memory.setItem(V40_STORAGE.historyKey, "old-v40-history");
    memory.setItem(V40_STORAGE.legacyV31ProgressKey, "old-v31-progress");
    memory.setItem(V40_STORAGE.autosaveKey, "on");
    const snapshot = { formBit: 0 as const, responses: {}, screen: "questions" as const, cursor: 0, skippedReviewDone: false };
    expect(writeProgress(memory, WEDDING_CODE_V41_BANK, snapshot, null, 1000).status).toBe("saved");
    expect(JSON.parse(memory.getItem(V41_STORAGE.progressKey) ?? "null").version).toBe(WEDDING_CODE_V41_VERSION);
    expect(readProgress(memory, WEDDING_CODE_V41_BANK, 1001).status).toBe("ready");
    expect(clearProgress(memory).status).toBe("cleared");
    expect(clearHistory(memory).status).toBe("cleared");
    expect(writeAutosavePreference(memory, "off").status).toBe("saved");
    expect(memory.getItem(V40_STORAGE.progressKey)).toBe("old-v40-progress");
    expect(memory.getItem(V40_STORAGE.historyKey)).toBe("old-v40-history");
    expect(memory.getItem(V40_STORAGE.legacyV31ProgressKey)).toBe("old-v31-progress");
    expect(memory.getItem(V40_STORAGE.autosaveKey)).toBe("on");
  });

  it("잘못된 판의 저장 봉투는 새 판 답으로 읽지 않는다", () => {
    const memory = new MemoryStorage();
    memory.setItem(V41_STORAGE.progressKey, JSON.stringify({ schema: 1, version: "v4.0-tendency", savedAt: 1000, formBit: 0, answers: ".".repeat(68), screen: "questions", cursor: 0, skippedReviewDone: false }));
    expect(readProgress(memory, WEDDING_CODE_V41_BANK, 1001).status).toBe("invalid");
  });

  it("글자 고르기 포트도 별도 키와 새 판 봉투를 쓴다", () => {
    const memory = new MemoryStorage();
    const port = createExtraPort(memory, "letterGuess", { honorAutosave: true });
    const oldEnvelope = JSON.stringify({ schema: 1, version: "v4.0-tendency", savedAt: 1000, formBit: 0, guess: "V---" });
    expect(port.write(oldEnvelope)).toBe("saved");
    expect(JSON.parse(memory.getItem(V41_STORAGE.letterGuessKey) ?? "null").version).toBe(WEDDING_CODE_V41_VERSION);
    expect(memory.getItem(V40_STORAGE.letterGuessKey)).toBeNull();
    expect(port.read()).toEqual({ ok: true, raw: oldEnvelope });
  });

  it("이전 판의 자동 저장 끄기만 새 판의 첫 선호에 반영한다", () => {
    const memory = new MemoryStorage();
    memory.setItem(V40_STORAGE.autosaveKey, "off");
    memory.setItem(V40_STORAGE.progressKey, "old-progress");
    expect(readAutosavePreference(memory)).toBe("off");
    expect(writeAutosavePreference(memory, "on").status).toBe("saved");
    expect(readAutosavePreference(memory)).toBe("on");
    expect(memory.getItem(V40_STORAGE.progressKey)).toBe("old-progress");
    expect(memory.getItem(V40_STORAGE.autosaveKey)).toBe("off");
  });
});
