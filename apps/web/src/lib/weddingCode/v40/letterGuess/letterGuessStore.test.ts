import { describe, expect, it } from "vitest";
import { V40_STORAGE, type Letter } from "@/constants/weddingCodeV40";
import { createExtraPort, writeAutosavePreference } from "../storage";
import type { FormBit, StorageLike } from "../types";
import { serializeLetterGuessEnvelope } from "./letterGuessEnvelope";
import {
  clearLetterGuess,
  letterGuessForAttempt,
  loadLetterGuess,
  saveLetterGuess,
  type LetterGuessLoad,
  type LetterGuessPort,
} from "./letterGuessStore";
import type { LetterGuess } from "./types";

const NOW = Date.UTC(2026, 9, 1, 3, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const TTL = V40_STORAGE.ttlMs;

function guess(...picks: (Letter | null)[]): LetterGuess {
  return picks as unknown as LetterGuess;
}

const SAMPLE = guess("V", null, "U", "A");
const EMPTY = guess(null, null, null, null);

interface FakeOptions {
  readonly readFails?: boolean;
  readonly writeResult?: "saved" | "off" | "unavailable";
  readonly removeFails?: boolean;
}

interface Calls {
  read: number;
  write: string[];
  remove: number;
}

/** 메모리에 한 칸을 가진 가짜 포트. 포트가 부른 횟수와 지금 든 원문을 볼 수 있다. */
function fakePort(initial: string | null = null, options: FakeOptions = {}) {
  let raw = initial;
  const calls: Calls = { read: 0, write: [], remove: 0 };
  const port: LetterGuessPort = {
    read() {
      calls.read += 1;
      return options.readFails === true ? { ok: false } : { ok: true, raw };
    },
    write(next) {
      calls.write.push(next);
      const result = options.writeResult ?? "saved";
      if (result === "saved") raw = next;
      return result;
    },
    remove() {
      calls.remove += 1;
      if (options.removeFails === true) return false;
      raw = null;
      return true;
    },
  };
  return { port, calls, raw: () => raw };
}

const envelopeAt = (picks: LetterGuess, formBit: FormBit, savedAt: number): string => serializeLetterGuessEnvelope(picks, formBit, savedAt) as string;

describe("loadLetterGuess: 읽기", () => {
  it("포트가 없거나 접근이 막혔으면 unavailable", () => {
    expect(loadLetterGuess(null, NOW)).toStrictEqual({ status: "unavailable" });
    const blocked = fakePort(envelopeAt(SAMPLE, 0, NOW - DAY), { readFails: true });
    expect(loadLetterGuess(blocked.port, NOW)).toStrictEqual({ status: "unavailable" });
    expect(blocked.calls.remove).toBe(0);
  });

  it("보관본이 없으면 empty, 올바르면 ready(고른 글자, 폼 비트, 저장 시각)", () => {
    expect(loadLetterGuess(fakePort().port, NOW)).toStrictEqual({ status: "empty" });
    const saved = fakePort(envelopeAt(SAMPLE, 1, NOW - DAY));
    expect(loadLetterGuess(saved.port, NOW)).toStrictEqual({ status: "ready", guess: SAMPLE, formBit: 1, savedAt: NOW - DAY });
  });

  it("읽기는 쓰지 않고 지우지도 않는다(ready, empty, invalid 모두): 읽기만으로 보관 기간이 늘지 않는다", () => {
    const cases: (string | null)[] = [envelopeAt(SAMPLE, 0, NOW - DAY), null, "{broken", envelopeAt(SAMPLE, 0, NOW + DAY)];
    for (const initial of cases) {
      const { port, calls, raw } = fakePort(initial);
      loadLetterGuess(port, NOW);
      expect(calls.write, String(initial)).toStrictEqual([]);
      expect(calls.remove, String(initial)).toBe(0);
      expect(raw()).toBe(initial);
    }
  });

  it("형식이 틀린 것(invalid)은 지우지 않는다: 다른 판이나 어긋난 시계일 수 있어 부르는 쪽이 정한다", () => {
    for (const bad of ["{broken", envelopeAt(SAMPLE, 0, NOW + DAY), '{"schema":2}', "----"]) {
      const { port, calls, raw } = fakePort(bad);
      expect(loadLetterGuess(port, NOW), bad).toStrictEqual({ status: "invalid" });
      expect(calls.remove, bad).toBe(0);
      expect(raw(), bad).toBe(bad);
    }
  });

  it("기간이 지난 것은 읽으면서 지우고 expired 로 답한다(경계: 기간 직전까지는 ready)", () => {
    const aged = (age: number) => fakePort(envelopeAt(SAMPLE, 0, NOW - age));
    const justInside = aged(TTL - 1);
    expect(loadLetterGuess(justInside.port, NOW).status).toBe("ready");
    expect(justInside.calls.remove).toBe(0);
    const justOutside = aged(TTL);
    expect(loadLetterGuess(justOutside.port, NOW)).toStrictEqual({ status: "expired" });
    expect(justOutside.calls.remove).toBe(1);
    expect(justOutside.raw()).toBeNull();
    // 한 번 지웠으니 다음 읽기는 없음이다.
    expect(loadLetterGuess(justOutside.port, NOW)).toStrictEqual({ status: "empty" });
  });

  it("지우기가 막혀도 던지지 않고 expired 로 답한다", () => {
    const { port } = fakePort(envelopeAt(SAMPLE, 0, NOW - TTL * 2), { removeFails: true });
    expect(loadLetterGuess(port, NOW)).toStrictEqual({ status: "expired" });
  });
});

describe("letterGuessForAttempt: 시도 묶기", () => {
  const ready = (formBit: FormBit): LetterGuessLoad => ({ status: "ready", guess: SAMPLE, formBit, savedAt: NOW - DAY });

  it("보관본의 폼 비트가 지금 시도의 폼 비트와 같을 때만 고른 글자를 돌려준다", () => {
    expect(letterGuessForAttempt(ready(0), 0)).toStrictEqual(SAMPLE);
    expect(letterGuessForAttempt(ready(1), 1)).toStrictEqual(SAMPLE);
    expect(letterGuessForAttempt(ready(0), 1)).toBeNull();
    expect(letterGuessForAttempt(ready(1), 0)).toBeNull();
  });

  it("읽기가 ready 가 아니면 null 이다(없음, 형식 위반, 만료, 막힘)", () => {
    for (const status of ["empty", "invalid", "expired", "unavailable"] as const) {
      expect(letterGuessForAttempt({ status }, 0), status).toBeNull();
      expect(letterGuessForAttempt({ status }, 1), status).toBeNull();
    }
  });
});

describe("saveLetterGuess: 쓰기", () => {
  it("고른 것이 있으면 봉투를 써서 saved 로 답하고 원문이 봉투와 같다(저장 시각은 지금)", () => {
    const { port, calls, raw } = fakePort();
    expect(saveLetterGuess(port, SAMPLE, 1, NOW)).toBe("saved");
    expect(calls.write).toStrictEqual([envelopeAt(SAMPLE, 1, NOW)]);
    expect(raw()).toBe(envelopeAt(SAMPLE, 1, NOW));
    expect(calls.remove).toBe(0);
  });

  it("고른 것이 없으면(null, 전부 고르지 않음) 쓰지 않고 이전 보관본을 지운다(cleared): 오래된 고른 글자가 남지 않는다", () => {
    for (const empty of [null, EMPTY]) {
      const { port, calls, raw } = fakePort(envelopeAt(SAMPLE, 0, NOW - DAY));
      expect(saveLetterGuess(port, empty, 0, NOW)).toBe("cleared");
      expect(calls.write).toStrictEqual([]);
      expect(calls.remove).toBe(1);
      expect(raw()).toBeNull();
    }
  });

  it("지울 수 없으면 unavailable 이다(막힌 저장소에서 지웠다고 말하지 않는다)", () => {
    const { port } = fakePort(envelopeAt(SAMPLE, 0, NOW - DAY), { removeFails: true });
    expect(saveLetterGuess(port, null, 0, NOW)).toBe("unavailable");
  });

  it("포트가 없으면 unavailable 이다(고른 것이 있어도 없어도)", () => {
    expect(saveLetterGuess(null, SAMPLE, 0, NOW)).toBe("unavailable");
    expect(saveLetterGuess(null, null, 0, NOW)).toBe("unavailable");
  });

  it("포트의 답을 그대로 옮긴다: 자동 저장이 꺼져 있으면 off(원문은 그대로), 막혔으면 unavailable", () => {
    const off = fakePort(null, { writeResult: "off" });
    expect(saveLetterGuess(off.port, SAMPLE, 0, NOW)).toBe("off");
    expect(off.raw()).toBeNull();
    const blocked = fakePort(null, { writeResult: "unavailable" });
    expect(saveLetterGuess(blocked.port, SAMPLE, 0, NOW)).toBe("unavailable");
    expect(blocked.raw()).toBeNull();
  });

  it("글자나 폼 비트나 시각의 모양이 틀리면 invalid 로 답하고 쓰지 않는다", () => {
    const bad = fakePort();
    expect(saveLetterGuess(bad.port, guess("W", null, null, null), 0, NOW)).toBe("invalid");
    expect(saveLetterGuess(bad.port, SAMPLE, 2 as unknown as FormBit, NOW)).toBe("invalid");
    expect(saveLetterGuess(bad.port, SAMPLE, 0, -1)).toBe("invalid");
    expect(saveLetterGuess(bad.port, SAMPLE, 0, Number.NaN)).toBe("invalid");
    expect(bad.calls.write).toStrictEqual([]);
    expect(bad.calls.remove).toBe(0);
  });
});

describe("clearLetterGuess: 지우기", () => {
  it("지우고 참을 돌려준다. 이미 없어도 참이다", () => {
    const { port, raw } = fakePort(envelopeAt(SAMPLE, 0, NOW - DAY));
    expect(clearLetterGuess(port)).toBe(true);
    expect(raw()).toBeNull();
    expect(clearLetterGuess(port)).toBe(true);
  });

  it("포트가 없거나 접근이 막혔으면 거짓이다", () => {
    expect(clearLetterGuess(null)).toBe(false);
    expect(clearLetterGuess(fakePort(envelopeAt(SAMPLE, 0, NOW), { removeFails: true }).port)).toBe(false);
  });
});

describe("생애 주기: 오래된 고른 글자가 다른 결과와 견줘지지 않는다", () => {
  it("쓰고 읽으면 같은 값이고, 다른 시도의 폼 비트로는 돌려주지 않으며, 고르지 않고 끝내면 지워진다", () => {
    const { port, raw } = fakePort();
    expect(saveLetterGuess(port, SAMPLE, 1, NOW)).toBe("saved");
    const loaded = loadLetterGuess(port, NOW + DAY);
    expect(letterGuessForAttempt(loaded, 1)).toStrictEqual(SAMPLE);
    // 새 시도(폼 비트가 다름)에서는 쓰지 못한다. 부르는 쪽이 지운다.
    expect(letterGuessForAttempt(loaded, 0)).toBeNull();
    expect(clearLetterGuess(port)).toBe(true);
    expect(loadLetterGuess(port, NOW + DAY)).toStrictEqual({ status: "empty" });
    // 다시 쓰고 나서 이번에는 아무것도 안 골랐다.
    expect(saveLetterGuess(port, SAMPLE, 0, NOW + 2 * DAY)).toBe("saved");
    expect(saveLetterGuess(port, null, 0, NOW + 2 * DAY)).toBe("cleared");
    expect(raw()).toBeNull();
    expect(loadLetterGuess(port, NOW + 2 * DAY)).toStrictEqual({ status: "empty" });
  });

  it("덮어쓰면 마지막에 고른 것이 남고 저장 시각은 마지막 쓰기부터다(기간이 마지막 저장부터 센다)", () => {
    const { port } = fakePort();
    saveLetterGuess(port, SAMPLE, 0, NOW);
    saveLetterGuess(port, guess(null, "D", null, null), 0, NOW + 20 * DAY);
    expect(loadLetterGuess(port, NOW + 40 * DAY)).toStrictEqual({ status: "ready", guess: guess(null, "D", null, null), formBit: 0, savedAt: NOW + 20 * DAY });
    // 처음 쓴 시각으로 세면 지났을 시간이지만 마지막 쓰기부터 세어 아직 남아 있다.
    expect(NOW + 40 * DAY - NOW).toBeGreaterThan(TTL);
  });
});

// ---------------------------------------------------------------------------
// 저장 모듈의 실제 포트와 이어 쓴다(통합 전 대입 검사)
// ---------------------------------------------------------------------------

/** 메모리 저장소. 던지게 하거나 막을 수 있다. */
function memoryStorage(options: { readonly throws?: boolean } = {}) {
  const data = new Map<string, string>();
  const handle: StorageLike = {
    getItem(key) {
      if (options.throws === true) throw new Error("막힘");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.throws === true) throw new Error("막힘");
      data.set(key, value);
    },
    removeItem(key) {
      if (options.throws === true) throw new Error("막힘");
      data.delete(key);
    },
  };
  return { handle, data };
}

describe("저장 모듈의 createExtraPort 와 이어 쓴다", () => {
  const KEY = V40_STORAGE.letterGuessKey;

  it("ExtraPort 가 이 모듈의 포트로 그대로 대입되고, 저장하고 읽고 지운다(키 하나에 봉투 하나)", () => {
    const { handle, data } = memoryStorage();
    const port: LetterGuessPort = createExtraPort(handle, "letterGuess", { honorAutosave: true });
    expect(saveLetterGuess(port, SAMPLE, 1, NOW)).toBe("saved");
    expect([...data.keys()]).toStrictEqual([KEY]);
    expect(data.get(KEY)).toBe(envelopeAt(SAMPLE, 1, NOW));
    const loaded = loadLetterGuess(port, NOW + DAY);
    expect(loaded).toStrictEqual({ status: "ready", guess: SAMPLE, formBit: 1, savedAt: NOW });
    expect(letterGuessForAttempt(loaded, 1)).toStrictEqual(SAMPLE);
    expect(letterGuessForAttempt(loaded, 0)).toBeNull();
    expect(clearLetterGuess(port)).toBe(true);
    expect(data.size).toBe(0);
    expect(loadLetterGuess(port, NOW)).toStrictEqual({ status: "empty" });
  });

  it("기간이 지난 보관본은 읽으면서 저장소에서 지워진다", () => {
    const { handle, data } = memoryStorage();
    const port = createExtraPort(handle, "letterGuess", { honorAutosave: true });
    saveLetterGuess(port, SAMPLE, 0, NOW);
    expect(loadLetterGuess(port, NOW + TTL)).toStrictEqual({ status: "expired" });
    expect(data.size).toBe(0);
  });

  it("고른 것이 없으면 이전 보관본이 저장소에서 지워진다(오래된 고른 글자가 남지 않는다)", () => {
    const { handle, data } = memoryStorage();
    const port = createExtraPort(handle, "letterGuess", { honorAutosave: true });
    saveLetterGuess(port, SAMPLE, 0, NOW);
    expect(data.size).toBe(1);
    expect(saveLetterGuess(port, null, 0, NOW + DAY)).toBe("cleared");
    expect(data.size).toBe(0);
  });

  it("자동 저장이 꺼져 있으면 쓰지 않고 off 로 답하며, 자동 저장 끄기가 보관본을 함께 지운다", () => {
    const { handle, data } = memoryStorage();
    const port = createExtraPort(handle, "letterGuess", { honorAutosave: true });
    expect(saveLetterGuess(port, SAMPLE, 0, NOW)).toBe("saved");
    expect(writeAutosavePreference(handle, "off")).toStrictEqual({ status: "saved" });
    expect(data.has(KEY)).toBe(false);
    expect(saveLetterGuess(port, SAMPLE, 0, NOW + DAY)).toBe("off");
    expect(data.has(KEY)).toBe(false);
    expect(loadLetterGuess(port, NOW + DAY)).toStrictEqual({ status: "empty" });
  });

  it("저장소를 못 쓰는 브라우저(핸들 null)와 던지는 저장소에서도 던지지 않고 상태로 답한다", () => {
    const none = createExtraPort(null, "letterGuess", { honorAutosave: true });
    expect(loadLetterGuess(none, NOW)).toStrictEqual({ status: "unavailable" });
    expect(saveLetterGuess(none, SAMPLE, 0, NOW)).toBe("unavailable");
    expect(saveLetterGuess(none, null, 0, NOW)).toBe("unavailable");
    expect(clearLetterGuess(none)).toBe(false);
    const { handle } = memoryStorage({ throws: true });
    const blocked = createExtraPort(handle, "letterGuess", { honorAutosave: true });
    expect(loadLetterGuess(blocked, NOW)).toStrictEqual({ status: "unavailable" });
    expect(saveLetterGuess(blocked, SAMPLE, 0, NOW)).toBe("unavailable");
    expect(clearLetterGuess(blocked)).toBe(false);
  });

  it("저장 키는 상수의 것 하나뿐이고 링크와 다른 키를 건드리지 않는다", () => {
    const { handle, data } = memoryStorage();
    data.set(V40_STORAGE.progressKey, "keep-progress");
    data.set(V40_STORAGE.historyKey, "keep-history");
    const port = createExtraPort(handle, "letterGuess", { honorAutosave: true });
    saveLetterGuess(port, SAMPLE, 0, NOW);
    clearLetterGuess(port);
    expect(data.get(V40_STORAGE.progressKey)).toBe("keep-progress");
    expect(data.get(V40_STORAGE.historyKey)).toBe("keep-history");
    expect(KEY).toBe("hanbang:wedding-code:v4:letter-guess");
  });
});
