import { describe, expect, it } from "vitest";
import {
  clearWc64Draft, createWc64Draft, parseWc64Draft, readWc64Autosave, readWc64Draft, setWc64Autosave,
  writeWc64Draft,
} from "./io";
import {
  WC64_AUTOSAVE_KEY, WC64_RETENTION_MS, WC64_STORAGE_KEY, WC64_VERSION, type Wc64Draft,
} from "./types";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? (this.map.get(k) as string) : null }
  setItem(k: string, v: string) { this.map.set(k, String(v)) }
  removeItem(k: string) { this.map.delete(k) }
}

const throwing = {
  getItem(): string | null { throw new Error("blocked") },
  setItem(): void { throw new Error("blocked") },
  removeItem(): void { throw new Error("blocked") },
};

const T0 = Date.parse("2026-10-16T00:00:00.000Z");
const draft = (over: Partial<Wc64Draft> = {}): Wc64Draft => ({
  ...createWc64Draft(T0), plan: "yes", answers: { "PLAN-A1": 4, K1: 2, "FAMILY-A1": 0 }, cursor: 3, screen: "questions", ...over,
});

describe("wc64 이어 하기 저장", () => {
  it("저장한 답을 그대로 읽는다", () => {
    const s = new MemoryStorage();
    expect(writeWc64Draft(s, draft())).toBe(true);
    const got = readWc64Draft(s, T0 + 1000);
    expect(got).toEqual({ ...draft(), skipped: {} });
    expect(got?.version).toBe(WC64_VERSION);
  });

  it("30일이 지나면 null, 그 전에는 읽는다", () => {
    const s = new MemoryStorage();
    writeWc64Draft(s, draft());
    expect(WC64_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(readWc64Draft(s, T0 + WC64_RETENTION_MS - 1)).not.toBeNull();
    expect(readWc64Draft(s, T0 + WC64_RETENTION_MS)).toBeNull();
    expect(readWc64Draft(s, T0 - 1)).toBeNull(); // 미래 시각 기록
  });

  it("다른 판의 기록은 거절한다", () => {
    const s = new MemoryStorage();
    s.setItem(WC64_STORAGE_KEY, JSON.stringify({ ...draft(), version: "v6-draft-2026-10-16" }));
    expect(readWc64Draft(s, T0)).toBeNull();
    expect(writeWc64Draft(s, { ...draft(), version: "wc64-r0" as typeof WC64_VERSION })).toBe(false);
  });

  it("깨진 JSON 과 어긋난 모양은 거절한다", () => {
    const s = new MemoryStorage();
    s.setItem(WC64_STORAGE_KEY, "{not json");
    expect(readWc64Draft(s, T0)).toBeNull();
    const bad = [
      { answers: { "PLAN-A1": 6 } },
      { answers: { "PLAN-A1": 2.5 } },
      { answers: { "NOPE-1": 3 } },
      { plan: "later" },
      { screen: "compare" },
      { cursor: -1 },
      { updatedAt: "2026-10-16" },
      { skipped: { NOPE: true } },
    ];
    for (const over of bad) expect(parseWc64Draft(JSON.stringify({ ...draft(), ...over }))).toBeNull();
    expect(parseWc64Draft("x".repeat(20_000))).toBeNull();
    expect(parseWc64Draft(JSON.stringify([]))).toBeNull();
  });

  it("저장소가 예외를 내면 false·null 로 답한다", () => {
    expect(writeWc64Draft(throwing, draft())).toBe(false);
    expect(readWc64Draft(throwing, T0)).toBeNull();
    expect(clearWc64Draft(throwing)).toBe(false);
    expect(setWc64Autosave(throwing, true)).toBe(false);
    expect(setWc64Autosave(throwing, false)).toBe(false);
    expect(readWc64Autosave(throwing)).toBe(false);
  });

  it("자동 저장을 끄면 저장해 둔 답을 바로 지우고, 그 뒤에는 쓰지 않는다", () => {
    const s = new MemoryStorage();
    expect(readWc64Autosave(s)).toBe(true); // 처음에는 켜짐
    writeWc64Draft(s, draft());
    expect(s.getItem(WC64_STORAGE_KEY)).not.toBeNull();
    expect(setWc64Autosave(s, false)).toBe(true);
    expect(s.getItem(WC64_STORAGE_KEY)).toBeNull();
    expect(s.getItem(WC64_AUTOSAVE_KEY)).toBe("off");
    expect(readWc64Autosave(s)).toBe(false);
    expect(writeWc64Draft(s, draft())).toBe(false);
    expect(s.getItem(WC64_STORAGE_KEY)).toBeNull();
    expect(setWc64Autosave(s, true)).toBe(true);
    expect(writeWc64Draft(s, draft())).toBe(true);
  });

  it("답 지우기는 기록을 없앤다", () => {
    const s = new MemoryStorage();
    writeWc64Draft(s, draft());
    expect(clearWc64Draft(s)).toBe(true);
    expect(readWc64Draft(s, T0)).toBeNull();
  });

  it("저장 키는 wc64 판 전용이다", () => {
    expect(WC64_STORAGE_KEY).toBe("hanbang:wedding-code:wc64:r1:draft");
    expect(WC64_AUTOSAVE_KEY).toBe(`${WC64_STORAGE_KEY}:autosave`);
  });
});
