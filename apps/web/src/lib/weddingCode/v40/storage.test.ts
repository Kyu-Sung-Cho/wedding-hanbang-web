import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { V40_STORAGE, V40_STATE_ALPHABET } from "@/constants/weddingCodeV40";
import { BROWSER_STORAGE_FALLBACK_SNIPPET } from "@/lib/browserStorageFallback";
import type { HistoryEntry, ProgressSnapshot, Responses, StorageLike } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_FIXTURES } from "./fixtures";
import {
  appendHistory,
  browserStorage,
  clearHistory,
  clearProgress,
  decodeProgressAnswers,
  encodeProgressAnswers,
  probeLegacyV31Progress,
  purgeExpired,
  readAutosavePreference,
  readHistory,
  readProgress,
  storageModule,
  writeAutosavePreference,
  writeProgress,
} from "./storage";

const bank = WEDDING_CODE_V40_BANK;
const DAY = 24 * 60 * 60 * 1000;
const TTL = V40_STORAGE.ttlMs;
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);

// ---------------------------------------------------------------------------
// 가짜 저장소: 던지기, 가득 참, 조용히 버리기, 다른 값 저장하기, 없는 값 대신 엉뚱한 값 돌려주기
// ---------------------------------------------------------------------------

class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  readonly calls: string[] = [];
  failGet = false;
  failSet = false;
  failRemove = false;
  /** 값 전체 길이의 합이 이 값을 넘는 쓰기는 QuotaExceededError 를 던진다. */
  quota: number | null = null;
  /** 쓰기가 아무 일도 하지 않는다(던지지도 않는다). */
  dropSet = false;
  /** 쓰기가 다른 값을 저장한다. */
  mangleSet: ((value: string) => string) | null = null;
  /** 읽기가 이 함수의 값을 돌려준다(문자열이 아닌 값을 시험할 때). */
  getOverride: ((key: string) => unknown) | null = null;

  getItem(key: string): string | null {
    this.calls.push(`get:${key}`);
    if (this.failGet) throw new Error("SecurityError");
    if (this.getOverride) return this.getOverride(key) as string | null;
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.calls.push(`set:${key}`);
    if (this.failSet) throw new Error("SecurityError");
    if (this.dropSet) return;
    if (this.quota !== null) {
      let total = value.length;
      for (const [name, stored] of this.data) if (name !== key) total += stored.length;
      if (total > this.quota) throw new Error("QuotaExceededError");
    }
    this.data.set(key, this.mangleSet ? this.mangleSet(value) : value);
  }

  removeItem(key: string): void {
    this.calls.push(`remove:${key}`);
    if (this.failRemove) throw new Error("SecurityError");
    this.data.delete(key);
  }

  writes(): string[] {
    return this.calls.filter((call) => call.startsWith("set:") || call.startsWith("remove:"));
  }
}

const emptyAnswers = ".".repeat(68);

function rawEnvelope(overrides: Record<string, unknown> = {}, drop: readonly string[] = []): string {
  const base: Record<string, unknown> = {
    schema: 1,
    version: "v4.0-tendency",
    savedAt: NOW - 1000,
    formBit: 0,
    answers: emptyAnswers,
    screen: "questions",
    cursor: 0,
    skippedReviewDone: false,
  };
  const merged = { ...base, ...overrides };
  for (const key of drop) delete merged[key];
  return JSON.stringify(merged);
}

function fixture(name: string) {
  const found = V40_FIXTURES.find((entry) => entry.name === name);
  if (!found) throw new Error(`없는 표본: ${name}`);
  return found;
}

function snapshotOf(name: string, screen: "questions" | "result" = "result", cursor = 0): ProgressSnapshot {
  const source = fixture(name);
  return { formBit: source.formBit, responses: source.responses, screen, cursor, skippedReviewDone: false };
}

function storeWith(key: string, raw: string): FakeStorage {
  const storage = new FakeStorage();
  storage.data.set(key, raw);
  return storage;
}

const progressStore = (raw: string): FakeStorage => storeWith(V40_STORAGE.progressKey, raw);

// ---------------------------------------------------------------------------
// 진행 저장용 68자 표기
// ---------------------------------------------------------------------------

describe("encodeProgressAnswers와 decodeProgressAnswers", () => {
  it("답하지 않은 문항은 점, 건너뜀은 -, 해당 없음은 _ 이고 길이는 68이다", () => {
    expect(encodeProgressAnswers(bank, {})).toBe(emptyAnswers);
    const encoded = encodeProgressAnswers(bank, { "money.limit.1": "3", "process.search.1": "skip", "scope.form.4": "na" });
    expect(encoded).toHaveLength(68);
    expect(encoded?.[bank.codeIndexById.get("money.limit.1") ?? -1]).toBe("3");
    expect(encoded?.[bank.codeIndexById.get("process.search.1") ?? -1]).toBe("-");
    expect(encoded?.[bank.codeIndexById.get("scope.form.4") ?? -1]).toBe("_");
    // 질문 순서: process.search.1(0번), money.limit.1(1번), scope.form.4(마지막에 가까운 채점 문항).
    expect(encoded?.replace(/[.]/gu, "")).toBe("-3_");
  });

  it("고정 표본 열두 개가 모두 왕복한다(링크 코드와 달리 체크섬과 폼 비트가 없다)", () => {
    for (const source of V40_FIXTURES) {
      const encoded = encodeProgressAnswers(bank, source.responses);
      expect(encoded, source.name).toHaveLength(68);
      expect(encoded).not.toContain(".");
      expect(decodeProgressAnswers(bank, encoded ?? "")).toEqual(source.responses);
    }
  });

  it("그 형식에 없는 상태 문자가 있으면 null 이다(두 가지 중 고르기는 0에서 5)", () => {
    expect(encodeProgressAnswers(bank, { "money.limit.1": "6" })).toBeNull();
    expect(encodeProgressAnswers(bank, { "money.limit.1": "z" })).toBeNull();
    expect(encodeProgressAnswers(bank, { "money.limit.1": "" })).toBeNull();
    expect(encodeProgressAnswers(bank, { "money.limit.1": "5" })).not.toBeNull();
  });

  it("은행에 없는 문항 id 와 문자열이 아닌 값은 없는 것으로 본다", () => {
    expect(encodeProgressAnswers(bank, { "ghost.item.1": "3" })).toBe(emptyAnswers);
    expect(encodeProgressAnswers(bank, { "money.limit.1": 3 } as unknown as Responses)).toBe(emptyAnswers);
    expect(encodeProgressAnswers(bank, null as unknown as Responses)).toBe(emptyAnswers);
  });

  it("길이가 68이 아니거나 쓸 수 없는 문자가 있으면 디코드는 null 이다", () => {
    expect(decodeProgressAnswers(bank, emptyAnswers)).toEqual({});
    for (const bad of ["", ".".repeat(67), ".".repeat(69), `#${".".repeat(67)}`, `9${".".repeat(67)}`, `${".".repeat(1)}9${".".repeat(66)}`]) {
      expect(decodeProgressAnswers(bank, bad), JSON.stringify(bad)).toBeNull();
    }
    expect(decodeProgressAnswers(bank, 5 as unknown as string)).toBeNull();
    expect(decodeProgressAnswers(bank, null as unknown as string)).toBeNull();
  });

  it("디코드 결과는 은행 문항 id 만 담은 순수 객체다(상속 키와 겹치지 않는다)", () => {
    const decoded = decodeProgressAnswers(bank, encodeProgressAnswers(bank, fixture("swua-example").responses) ?? "");
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.keys(decoded ?? {}).every((key) => bank.byId.has(key))).toBe(true);
  });

  it("알파벳 밖 문자는 어느 위치에서도 받지 않는다", () => {
    for (const char of ["ㄱ", "가", " ", "%", "~", "Z"]) {
      expect(decodeProgressAnswers(bank, char + ".".repeat(67))).toBeNull();
    }
    expect(V40_STATE_ALPHABET).toHaveLength(62);
  });
});

// ---------------------------------------------------------------------------
// readProgress
// ---------------------------------------------------------------------------

describe("readProgress", () => {
  it("저장이 없으면 empty, 접근이 던지면 unavailable 이다", () => {
    expect(readProgress(new FakeStorage(), bank, NOW)).toEqual({ status: "empty", raw: null });
    const blocked = new FakeStorage();
    blocked.failGet = true;
    expect(readProgress(blocked, bank, NOW)).toEqual({ status: "unavailable", raw: null });
  });

  it("올바른 봉투는 ready 이고 스냅샷, 저장 시각, 원문을 돌려준다", () => {
    const raw = rawEnvelope({ savedAt: NOW - DAY, formBit: 1, cursor: 12, skippedReviewDone: true, answers: `${".".repeat(30)}-${".".repeat(37)}` });
    const read = readProgress(progressStore(raw), bank, NOW);
    expect(read.status).toBe("ready");
    if (read.status !== "ready") return;
    expect(read.raw).toBe(raw);
    expect(read.savedAt).toBe(NOW - DAY);
    expect(read.snapshot).toEqual({ formBit: 1, responses: { [bank.items[30].id]: "skip" }, screen: "questions", cursor: 12, skippedReviewDone: true });
  });

  it("읽기는 저장소에 아무것도 쓰지 않는다(저장 기간을 늘리지 않고 다른 탭의 값을 지우지 않는다). 기간이 지난 저장도 지우지 않는다", () => {
    for (const raw of [rawEnvelope(), rawEnvelope({ savedAt: NOW - TTL - 1 }), rawEnvelope({ savedAt: NOW - TTL - 40 * DAY }), "not json", rawEnvelope({ schema: 9 })]) {
      const storage = progressStore(raw);
      readProgress(storage, bank, NOW);
      expect(storage.writes(), raw).toEqual([]);
      expect(storage.data.get(V40_STORAGE.progressKey)).toBe(raw);
    }
  });

  it("30일 기간: 저장한 지 30일에서 1밀리초 모자라면 ready, 정확히 30일이면 expired 다", () => {
    expect(readProgress(progressStore(rawEnvelope({ savedAt: NOW - TTL + 1 })), bank, NOW).status).toBe("ready");
    const expired = readProgress(progressStore(rawEnvelope({ savedAt: NOW - TTL })), bank, NOW);
    expect(expired.status).toBe("expired");
    expect(expired.raw).toBe(rawEnvelope({ savedAt: NOW - TTL }));
    expect(readProgress(progressStore(rawEnvelope({ savedAt: NOW - TTL - 5 * DAY })), bank, NOW).status).toBe("expired");
  });

  it("저장 시각이 하루를 넘는 미래이거나 안전한 정수가 아니면 invalid 다", () => {
    for (const savedAt of [NOW + DAY + 1, NOW + 400 * DAY, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 2, Number.NaN]) {
      expect(readProgress(progressStore(rawEnvelope({ savedAt })), bank, NOW).status, String(savedAt)).toBe("invalid");
    }
    expect(readProgress(progressStore(rawEnvelope({ savedAt: NOW })), bank, NOW).status).toBe("ready");
  });

  it("시계가 원인으로 읽지 못한 invalid 에만 clockAhead 표시가 붙는다(폰 날짜를 확인하라는 안내의 근거)", () => {
    for (const savedAt of [NOW + DAY + 1, NOW + 400 * DAY]) {
      const raw = rawEnvelope({ savedAt });
      expect(readProgress(progressStore(raw), bank, NOW), String(savedAt)).toEqual({ status: "invalid", raw, clockAhead: true });
    }
    // 시각이 아닌 다른 이유로 읽지 못하는 저장에는 붙지 않는다(시각이 미래여도 마찬가지다).
    for (const patch of [{ version: "v0-other" }, { formBit: 2 }, { screen: "intro" }, { cursor: -1 }, { answers: "짧음" }, { savedAt: -1 }, { savedAt: "1" }]) {
      const raw = rawEnvelope({ savedAt: NOW + 2 * DAY, ...patch });
      const read = readProgress(progressStore(raw), bank, NOW);
      expect(read, JSON.stringify(patch)).toEqual({ status: "invalid", raw });
    }
    const garbled = "not json";
    expect(readProgress(progressStore(garbled), bank, NOW)).toEqual({ status: "invalid", raw: garbled });
  });

  it("기기 시계가 저장 뒤에 뒤로 가서 저장 시각이 하루 안의 미래로 보여도 멀쩡한 저장으로 읽고, 30일은 저장 시각부터 센다(감사 6-2)", () => {
    // 자동 시각 보정이나 날짜 고침으로 시계가 1초, 1분, 1시간, 하루 뒤로 간 경우. 예전에는 이 모두 invalid 라서 하던 답을 이어 할 길이 없었다.
    for (const back of [1, 60_000, 3_600_000, DAY]) {
      const read = readProgress(progressStore(rawEnvelope({ savedAt: NOW + back })), bank, NOW);
      expect(read.status, String(back)).toBe("ready");
    }
    // 나이는 음수로 본다: 시계가 따라잡아 저장 시각에서 30일이 되는 순간에야 지난 것으로 본다(기간을 늘리지도 줄이지도 않는다).
    const raw = progressStore(rawEnvelope({ savedAt: NOW + DAY }));
    expect(readProgress(raw, bank, NOW + DAY + TTL - 1).status).toBe("ready");
    expect(readProgress(raw, bank, NOW + DAY + TTL).status).toBe("expired");
  });

  it("모양이 어긋난 봉투는 모두 invalid 다(던지지 않는다)", () => {
    const cases: [string, string][] = [
      ["JSON 이 아님", "not json"],
      ["빈 문자열", ""],
      ["배열", "[]"],
      ["null", "null"],
      ["숫자", "7"],
      ["키 하나 없음", rawEnvelope({}, ["cursor"])],
      ["키 하나 더 있음", rawEnvelope({ extra: 1 })],
      ["답이 들어 있는 다른 키", rawEnvelope({ responses: {} })],
      ["스키마 2", rawEnvelope({ schema: 2 })],
      ["스키마 문자열", rawEnvelope({ schema: "1" })],
      ["판 태그 틀림", rawEnvelope({ version: "v3.1-preferences" })],
      ["폼 비트 2", rawEnvelope({ formBit: 2 })],
      ["폼 비트 문자", rawEnvelope({ formBit: "0" })],
      ["답이 짧음", rawEnvelope({ answers: ".".repeat(67) })],
      ["답이 김", rawEnvelope({ answers: ".".repeat(69) })],
      ["답이 숫자", rawEnvelope({ answers: 5 })],
      ["답의 위치별 범위 밖", rawEnvelope({ answers: `${"9"}${".".repeat(67)}` })],
      ["답의 알파벳 밖", rawEnvelope({ answers: `#${".".repeat(67)}` })],
      ["화면 이름 틀림", rawEnvelope({ screen: "done" })],
      ["cursor 음수", rawEnvelope({ cursor: -1 })],
      ["cursor 68", rawEnvelope({ cursor: 68 })],
      ["cursor 소수", rawEnvelope({ cursor: 1.5 })],
      ["cursor 문자열", rawEnvelope({ cursor: "3" })],
      ["다시 보기 표시가 불리언이 아님", rawEnvelope({ skippedReviewDone: "yes" })],
      ["result 인데 답하지 않은 문항", rawEnvelope({ screen: "result", cursor: 0 })],
      ["result 인데 cursor 가 0 이 아님", rawEnvelope({ screen: "result", cursor: 4, answers: "-".repeat(68) })],
    ];
    for (const [name, raw] of cases) expect(readProgress(progressStore(raw), bank, NOW).status, name).toBe("invalid");
  });

  it("result 는 68개가 모두 있고 cursor 가 0 일 때만 받는다", () => {
    const answers = encodeProgressAnswers(bank, fixture("swua-example").responses) ?? "";
    expect(readProgress(progressStore(rawEnvelope({ screen: "result", cursor: 0, answers })), bank, NOW).status).toBe("ready");
  });

  it("길이 상한(1024자)을 넘는 원문은 파싱하지 않고 invalid 다", () => {
    const long = rawEnvelope({ answers: emptyAnswers, padding: "x".repeat(2000) });
    expect(long.length).toBeGreaterThan(V40_STORAGE.maxEnvelopeLength);
    expect(readProgress(progressStore(long), bank, NOW).status).toBe("invalid");
    const atLimit = `{"a":"${"x".repeat(V40_STORAGE.maxEnvelopeLength)}"}`;
    expect(readProgress(progressStore(atLimit), bank, NOW).status).toBe("invalid");
  });

  it("그 밖에는 올바른 봉투도 길이가 1024자를 넘으면 invalid 이고 정확히 1024자까지는 ready 다", () => {
    const base = rawEnvelope();
    const atLimit = base + " ".repeat(V40_STORAGE.maxEnvelopeLength - base.length);
    expect(atLimit).toHaveLength(V40_STORAGE.maxEnvelopeLength);
    expect(readProgress(progressStore(atLimit), bank, NOW).status).toBe("ready");
    expect(readProgress(progressStore(`${atLimit} `), bank, NOW).status).toBe("invalid");
  });

  it("프로토타입 오염을 시도하는 키가 있어도 invalid 이고 전역 객체가 오염되지 않는다", () => {
    const polluted = '{"__proto__":{"polluted":true},"schema":1,"version":"v4.0-tendency","savedAt":1,"formBit":0,"answers":"","screen":"questions","cursor":0,"skippedReviewDone":false}';
    expect(readProgress(progressStore(polluted), bank, NOW).status).toBe("invalid");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("저장소가 문자열이 아닌 값을 돌려줘도 던지지 않고 invalid 다", () => {
    const storage = new FakeStorage();
    storage.getOverride = () => 12345;
    expect(readProgress(storage, bank, NOW).status).toBe("invalid");
    storage.getOverride = () => undefined;
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
  });

  it("지금 시각이 잘못 들어와도 던지지 않는다", () => {
    expect(readProgress(progressStore(rawEnvelope()), bank, Number.NaN).status).toBe("invalid");
    expect(readProgress(progressStore(rawEnvelope()), bank, -5).status).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// writeProgress
// ---------------------------------------------------------------------------

describe("writeProgress", () => {
  it("쓰고 읽으면 같은 스냅샷이 ready 로 돌아온다(폼 비트와 답만 저장한다)", () => {
    const storage = new FakeStorage();
    const snapshot = snapshotOf("swua-example", "result");
    const written = writeProgress(storage, bank, snapshot, null, NOW);
    expect(written.status).toBe("saved");
    const read = readProgress(storage, bank, NOW + 1);
    expect(read.status).toBe("ready");
    if (read.status !== "ready" || written.status !== "saved") return;
    expect(read.snapshot).toEqual(snapshot);
    expect(read.raw).toBe(written.raw);
    expect(read.savedAt).toBe(NOW);
    const stored = JSON.parse(written.raw) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["answers", "cursor", "formBit", "savedAt", "schema", "screen", "skippedReviewDone", "version"]);
    expect(stored.answers).toBe(encodeProgressAnswers(bank, snapshot.responses));
    expect(written.raw.length).toBeLessThanOrEqual(V40_STORAGE.maxEnvelopeLength);
  });

  it("모든 고정 표본을 questions 와 result 로 저장하고 다시 읽는다", () => {
    for (const source of V40_FIXTURES) {
      for (const screen of ["questions", "result"] as const) {
        const storage = new FakeStorage();
        const snapshot: ProgressSnapshot = { formBit: source.formBit, responses: source.responses, screen, cursor: screen === "result" ? 0 : 20, skippedReviewDone: source.name === "skip-hint" };
        expect(writeProgress(storage, bank, snapshot, null, NOW).status, `${source.name} ${screen}`).toBe("saved");
        const read = readProgress(storage, bank, NOW);
        expect(read.status === "ready" && read.snapshot, `${source.name} ${screen}`).toEqual(snapshot);
      }
    }
  });

  it("아직 답하지 않은 문항이 있어도 questions 로 저장하고 읽는다", () => {
    const storage = new FakeStorage();
    const snapshot: ProgressSnapshot = { formBit: 1, responses: { "money.limit.1": "2", "process.search.1": "skip" }, screen: "questions", cursor: 3, skippedReviewDone: false };
    expect(writeProgress(storage, bank, snapshot, null, NOW).status).toBe("saved");
    const read = readProgress(storage, bank, NOW);
    expect(read.status === "ready" && read.snapshot).toEqual(snapshot);
  });

  it("지금 저장된 원문이 expectedRaw 와 다르면 conflict 이고 다른 탭이 쓴 것을 지우지 않는다", () => {
    const other = rawEnvelope({ savedAt: NOW - 500, cursor: 9 });
    const storage = progressStore(other);
    const conflict = writeProgress(storage, bank, snapshotOf("swua-example", "questions", 5), null, NOW);
    expect(conflict).toEqual({ status: "conflict" });
    expect(storage.data.get(V40_STORAGE.progressKey)).toBe(other);
    expect(storage.writes()).toEqual([]);
    expect(writeProgress(storage, bank, snapshotOf("swua-example", "questions", 5), rawEnvelope({ cursor: 1 }), NOW)).toEqual({ status: "conflict" });
    const ok = writeProgress(storage, bank, snapshotOf("swua-example", "questions", 5), other, NOW);
    expect(ok.status).toBe("saved");
  });

  it("읽은 원문을 expectedRaw 로 넘겨 이어 쓰고, 그 사이 다른 탭이 쓰면 conflict 다", () => {
    const storage = new FakeStorage();
    const first = writeProgress(storage, bank, snapshotOf("all-clear", "questions", 2), null, NOW);
    if (first.status !== "saved") throw new Error("첫 저장 실패");
    const second = writeProgress(storage, bank, snapshotOf("all-clear", "questions", 4), first.raw, NOW + 1000);
    if (second.status !== "saved") throw new Error("둘째 저장 실패");
    expect(second.raw).not.toBe(first.raw);
    expect(writeProgress(storage, bank, snapshotOf("all-clear", "questions", 6), first.raw, NOW + 2000)).toEqual({ status: "conflict" });
  });

  it("저장소가 가득 차면 unavailable 이고 원래 값이 남는다", () => {
    const stored = rawEnvelope({ cursor: 2 });
    const storage = progressStore(stored);
    storage.quota = 50;
    expect(writeProgress(storage, bank, snapshotOf("all-clear", "questions", 4), stored, NOW)).toEqual({ status: "unavailable" });
    expect(storage.data.get(V40_STORAGE.progressKey)).toBe(stored);
  });

  it("쓰기가 던지거나 조용히 버려지거나 다른 값을 저장하면 저장됐다고 말하지 않는다(unavailable)", () => {
    const thrower = new FakeStorage();
    thrower.failSet = true;
    expect(writeProgress(thrower, bank, snapshotOf("all-clear"), null, NOW)).toEqual({ status: "unavailable" });
    const dropper = new FakeStorage();
    dropper.dropSet = true;
    expect(writeProgress(dropper, bank, snapshotOf("all-clear"), null, NOW)).toEqual({ status: "unavailable" });
    const mangler = new FakeStorage();
    mangler.mangleSet = (value) => value.replace("questions", "questiona").replace("result", "resulta");
    expect(writeProgress(mangler, bank, snapshotOf("all-clear"), null, NOW)).toEqual({ status: "unavailable" });
    const blocked = new FakeStorage();
    blocked.failGet = true;
    expect(writeProgress(blocked, bank, snapshotOf("all-clear"), null, NOW)).toEqual({ status: "unavailable" });
  });

  it("잘못된 스냅샷은 invalid 이고 저장소를 건드리지 않는다", () => {
    const base = snapshotOf("swua-example", "questions", 4);
    const bads: [string, ProgressSnapshot][] = [
      ["폼 비트", { ...base, formBit: 2 as 0 }],
      ["화면 이름", { ...base, screen: "done" as "result" }],
      ["cursor 음수", { ...base, cursor: -1 }],
      ["cursor 68", { ...base, cursor: 68 }],
      ["cursor 소수", { ...base, cursor: 2.5 }],
      ["skippedReviewDone", { ...base, skippedReviewDone: 1 as unknown as boolean }],
      ["그 형식에 없는 상태 문자", { ...base, responses: { "money.limit.1": "9" } }],
      ["result 인데 미답", { ...base, screen: "result", cursor: 0, responses: { "money.limit.1": "1" } }],
      ["result 인데 cursor 가 0 이 아님", { ...snapshotOf("swua-example", "result"), cursor: 5 }],
    ];
    for (const [name, snapshot] of bads) {
      const storage = new FakeStorage();
      expect(writeProgress(storage, bank, snapshot, null, NOW), name).toEqual({ status: "invalid" });
      expect(storage.calls, name).toEqual([]);
    }
    const storage = new FakeStorage();
    expect(writeProgress(storage, bank, null as unknown as ProgressSnapshot, null, NOW)).toEqual({ status: "invalid" });
    expect(writeProgress(storage, bank, base, undefined as unknown as null, NOW)).toEqual({ status: "invalid" });
    expect(writeProgress(storage, bank, base, null, Number.NaN)).toEqual({ status: "invalid" });
    expect(writeProgress(storage, bank, base, null, -1)).toEqual({ status: "invalid" });
  });

  it("스냅샷에 딸려 온 다른 필드는 저장하지 않는다(답 문구가 새어 들어갈 수 없다)", () => {
    const storage = new FakeStorage();
    const snapshot = { ...snapshotOf("swua-example", "result"), secretText: "개인적인 문장", drafts: { x: 1 } } as ProgressSnapshot;
    const written = writeProgress(storage, bank, snapshot, null, NOW);
    expect(written.status).toBe("saved");
    const raw = storage.data.get(V40_STORAGE.progressKey) ?? "";
    expect(raw).not.toContain("secretText");
    expect(raw).not.toContain("개인적인");
    expect(raw).not.toContain("drafts");
  });

  it("30일은 마지막 실제 저장부터 센다(읽기는 늘리지 않고 다시 쓰면 새로 센다)", () => {
    const storage = new FakeStorage();
    const first = writeProgress(storage, bank, snapshotOf("swua-example", "questions", 3), null, NOW);
    if (first.status !== "saved") throw new Error("첫 저장 실패");
    const midway = NOW + 29 * DAY;
    expect(readProgress(storage, bank, midway).status).toBe("ready");
    // 읽기만 한 채 31일이 지나면 만료다.
    expect(readProgress(storage, bank, NOW + 31 * DAY).status).toBe("expired");
    // 29일째에 다시 저장하면 31일째에도 ready 다.
    const second = writeProgress(storage, bank, snapshotOf("swua-example", "questions", 8), first.raw, midway);
    expect(second.status).toBe("saved");
    const later = readProgress(storage, bank, NOW + 31 * DAY);
    expect(later.status).toBe("ready");
    expect(later.status === "ready" && later.savedAt).toBe(midway);
  });

  it("만료된 원문 위에도 expectedRaw 로 이어 쓸 수 있다", () => {
    const stale = rawEnvelope({ savedAt: NOW - TTL - DAY });
    const storage = progressStore(stale);
    const read = readProgress(storage, bank, NOW);
    expect(read.status).toBe("expired");
    expect(writeProgress(storage, bank, snapshotOf("all-clear", "questions", 1), read.raw, NOW).status).toBe("saved");
  });
});

describe("clearProgress", () => {
  it("v4 진행 저장만 지운다", () => {
    const storage = progressStore(rawEnvelope());
    storage.data.set(V40_STORAGE.historyKey, "kept");
    storage.data.set(V40_STORAGE.legacyV31ProgressKey, "kept");
    expect(clearProgress(storage)).toEqual({ status: "cleared" });
    expect(storage.data.has(V40_STORAGE.progressKey)).toBe(false);
    expect(storage.data.get(V40_STORAGE.historyKey)).toBe("kept");
    expect(storage.data.get(V40_STORAGE.legacyV31ProgressKey)).toBe("kept");
    expect(readProgress(storage, bank, NOW).status).toBe("empty");
  });

  it("지우기가 던지면 unavailable 이다", () => {
    const storage = progressStore(rawEnvelope());
    storage.failRemove = true;
    expect(clearProgress(storage)).toEqual({ status: "unavailable" });
  });
});

// ---------------------------------------------------------------------------
// 지난번과 비교 기록
// ---------------------------------------------------------------------------

/** 기록 한 건(돈 V 뚜렷해요, 준비 W 기울어요, 정하는 사람 F 반반이에요, 지쳤을 때 A 기울어요). tweak 으로 주제를 바꾼다. */
function entry(at: number, formBit: 0 | 1 = 0, tweak?: (axes: { letter: string | null; band: string | null; provisional: boolean }[]) => void): HistoryEntry {
  const axes = [
    { letter: "V", band: "clear", provisional: false },
    { letter: "W", band: "lean", provisional: false },
    { letter: "F", band: "even", provisional: false },
    { letter: "A", band: "lean", provisional: false },
  ];
  tweak?.(axes);
  return { at, formBit, axes } as unknown as HistoryEntry;
}

describe("readHistory와 appendHistory", () => {
  it("기록이 없으면 empty, 접근이 막히면 unavailable 이다", () => {
    expect(readHistory(new FakeStorage(), NOW)).toEqual({ status: "empty", entries: [] });
    const blocked = new FakeStorage();
    blocked.failGet = true;
    expect(readHistory(blocked, NOW)).toEqual({ status: "unavailable", entries: [] });
  });

  it("건이 하나도 없는 올바른 봉투는 empty 이고(expired 가 아니다) 첫 추가가 이어 쓴다", () => {
    const raw = JSON.stringify({ schema: 1, version: "v4.0-tendency", entries: [] });
    const storage = storeWith(V40_STORAGE.historyKey, raw);
    expect(readHistory(storage, NOW)).toEqual({ status: "empty", entries: [] });
    expect(appendHistory(storage, entry(NOW - DAY), NOW)).toEqual({ status: "saved" });
    expect(readHistory(storage, NOW).entries).toHaveLength(1);
  });

  it("한 건을 추가하면 읽을 수 있고 봉투에는 글자, 세기, 시각, 폼 비트만 있다", () => {
    const storage = new FakeStorage();
    expect(appendHistory(storage, entry(NOW - 1000, 1), NOW)).toEqual({ status: "saved" });
    const read = readHistory(storage, NOW);
    expect(read).toEqual({ status: "ready", entries: [entry(NOW - 1000, 1)] });
    const stored = JSON.parse(storage.data.get(V40_STORAGE.historyKey) ?? "null") as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["entries", "schema", "version"]);
    expect(JSON.stringify(stored)).not.toMatch(/responses|answers|money\.|limit/u);
    expect(Object.keys((stored.entries as Record<string, unknown>[])[0]).sort()).toEqual(["at", "axes", "formBit"]);
  });

  it("최신이 앞이고 최대 3건이며 넘치면 가장 오래된 것부터 버린다", () => {
    const storage = new FakeStorage();
    for (let index = 1; index <= 5; index += 1) expect(appendHistory(storage, entry(NOW - (6 - index) * DAY), NOW).status).toBe("saved");
    const read = readHistory(storage, NOW);
    expect(read.status).toBe("ready");
    expect(read.entries.map((item) => item.at)).toEqual([NOW - 1 * DAY, NOW - 2 * DAY, NOW - 3 * DAY]);
    expect(V40_STORAGE.historyMax).toBe(3);
  });

  it("시각 순서와 상관없이 늦게 들어온 오래된 결과도 제자리에 들어간다", () => {
    const storage = new FakeStorage();
    appendHistory(storage, entry(NOW - 1 * DAY), NOW);
    appendHistory(storage, entry(NOW - 5 * DAY), NOW);
    appendHistory(storage, entry(NOW - 3 * DAY), NOW);
    expect(readHistory(storage, NOW).entries.map((item) => item.at)).toEqual([NOW - 1 * DAY, NOW - 3 * DAY, NOW - 5 * DAY]);
  });

  it("30일이 지난 건은 읽을 때 빼고 모두 지났으면 expired 다", () => {
    const storage = new FakeStorage();
    appendHistory(storage, entry(NOW - 29 * DAY), NOW - 29 * DAY);
    appendHistory(storage, entry(NOW - 10 * DAY), NOW - 10 * DAY);
    expect(readHistory(storage, NOW).entries).toHaveLength(2);
    const later = NOW + 2 * DAY;
    expect(readHistory(storage, later).entries.map((item) => item.at)).toEqual([NOW - 10 * DAY]);
    const boundary = readHistory(storage, NOW - 10 * DAY + TTL);
    expect(boundary).toEqual({ status: "expired", entries: [] });
    expect(readHistory(storage, NOW - 10 * DAY + TTL - 1).status).toBe("ready");
  });

  it("읽기는 기간이 지난 건이 있어도 저장소에 아무것도 쓰지 않는다(지우는 일은 purgeExpired 몫)", () => {
    const storage = new FakeStorage();
    appendHistory(storage, entry(NOW - 29 * DAY), NOW - 29 * DAY);
    appendHistory(storage, entry(NOW - 10 * DAY), NOW - 10 * DAY);
    const before = JSON.stringify([...storage.data.entries()]);
    const writesBefore = storage.writes().length;
    readHistory(storage, NOW + 2 * DAY);
    readHistory(storage, NOW - 10 * DAY + TTL);
    readHistory(storage, NOW + 90 * DAY);
    expect(storage.writes().length).toBe(writesBefore);
    expect(JSON.stringify([...storage.data.entries()])).toBe(before);
  });

  it("추가할 때 지난 건은 버리고 새로 쓴다", () => {
    const storage = new FakeStorage();
    appendHistory(storage, entry(NOW - 40 * DAY), NOW - 40 * DAY);
    appendHistory(storage, entry(NOW - 1 * DAY), NOW);
    expect(readHistory(storage, NOW).entries.map((item) => item.at)).toEqual([NOW - 1 * DAY]);
  });

  it("같은 건을 다시 추가해도 늘지 않는다(멱등)", () => {
    const storage = new FakeStorage();
    appendHistory(storage, entry(NOW - DAY), NOW);
    const before = storage.data.get(V40_STORAGE.historyKey);
    expect(appendHistory(storage, entry(NOW - DAY), NOW)).toEqual({ status: "saved" });
    expect(storage.data.get(V40_STORAGE.historyKey)).toBe(before);
    expect(readHistory(storage, NOW).entries).toHaveLength(1);
    appendHistory(storage, entry(NOW - DAY, 1), NOW);
    expect(readHistory(storage, NOW).entries).toHaveLength(2);
  });

  it("글자를 못 정한 주제와 임시 글자도 기록한다", () => {
    const storage = new FakeStorage();
    const tweak = (axes: { letter: string | null; band: string | null; provisional: boolean }[]) => {
      axes[2] = { letter: null, band: null, provisional: false };
      axes[3] = { letter: "H", band: "even", provisional: true };
    };
    expect(appendHistory(storage, entry(NOW - DAY, 0, tweak), NOW).status).toBe("saved");
    expect(readHistory(storage, NOW).entries).toEqual([entry(NOW - DAY, 0, tweak)]);
  });

  it("잘못된 기록은 invalid 이고 저장소를 쓰지 않는다", () => {
    const bads: [string, unknown][] = [
      ["답이 딸려 옴", { ...entry(NOW - DAY), responses: { "money.limit.1": "1" } }],
      ["시각이 하루를 넘는 미래", entry(NOW + DAY + 1)],
      ["시각 소수", entry(1.5)],
      ["시각 음수", entry(-1)],
      ["폼 비트", entry(NOW - DAY, 2 as 0)],
      ["주제가 셋", { at: NOW - DAY, formBit: 0, axes: entry(NOW - DAY).axes.slice(0, 3) }],
      ["다른 주제의 글자", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: "S", band: "clear", provisional: false }; axes[1] = { letter: "V", band: "clear", provisional: false }; })],
      ["소문자 글자", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: "v", band: "clear", provisional: false }; })],
      ["상태 글자 B", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: "B", band: "clear", provisional: false }; })],
      ["세기 이름 틀림", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: "V", band: "strong", provisional: false }; })],
      ["글자 없이 세기", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: null, band: "lean", provisional: false }; })],
      ["세기 없이 글자", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: "V", band: null, provisional: false }; })],
      ["글자 없이 임시", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: null, band: null, provisional: true }; })],
      ["임시 글자인데 세기가 뚜렷해요", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: "V", band: "clear", provisional: true }; })],
      ["임시 글자인데 세기가 기울어요", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: "V", band: "lean", provisional: true }; })],
      ["임시 표시가 불리언이 아님", entry(NOW - DAY, 0, (axes) => { axes[0] = { letter: "V", band: "even", provisional: 1 as unknown as boolean }; })],
      ["축 안에 다른 키", entry(NOW - DAY, 0, (axes) => { (axes[0] as Record<string, unknown>).extra = 1; })],
      ["null", null],
      ["문자열", "v"],
    ];
    for (const [name, value] of bads) {
      const storage = new FakeStorage();
      expect(appendHistory(storage, value as HistoryEntry, NOW), name).toEqual({ status: "invalid" });
      expect(storage.writes(), name).toEqual([]);
    }
    expect(appendHistory(new FakeStorage(), entry(NOW - DAY), Number.NaN)).toEqual({ status: "invalid" });
  });

  it("형식이 어긋난 기록 원문은 invalid 이고 다음 추가가 새로 시작한다", () => {
    const good = JSON.stringify({ schema: 1, version: "v4.0-tendency", entries: [entry(NOW - DAY)] });
    const cases: [string, string][] = [
      ["JSON 아님", "nope"],
      ["배열", "[]"],
      ["키 하나 더", JSON.stringify({ schema: 1, version: "v4.0-tendency", entries: [], extra: 1 })],
      ["스키마", JSON.stringify({ schema: 2, version: "v4.0-tendency", entries: [] })],
      ["판", JSON.stringify({ schema: 1, version: "v3.1-preferences", entries: [] })],
      ["건이 4개", JSON.stringify({ schema: 1, version: "v4.0-tendency", entries: [entry(NOW - DAY), entry(NOW - 2 * DAY), entry(NOW - 3 * DAY), entry(NOW - 4 * DAY)] })],
      ["최신이 뒤", JSON.stringify({ schema: 1, version: "v4.0-tendency", entries: [entry(NOW - 3 * DAY), entry(NOW - DAY)] })],
      ["건에 답이 있음", JSON.stringify({ schema: 1, version: "v4.0-tendency", entries: [{ ...entry(NOW - DAY), responses: {} }] })],
      ["시각이 하루를 넘는 미래", JSON.stringify({ schema: 1, version: "v4.0-tendency", entries: [entry(NOW + DAY + 1)] })],
      ["너무 김", `${good}${" ".repeat(3000)}`],
    ];
    for (const [name, raw] of cases) {
      const storage = storeWith(V40_STORAGE.historyKey, raw);
      expect(readHistory(storage, NOW), name).toEqual({ status: "invalid", entries: [] });
      expect(storage.writes(), name).toEqual([]);
      expect(appendHistory(storage, entry(NOW - 2 * DAY), NOW), name).toEqual({ status: "saved" });
      expect(readHistory(storage, NOW).entries, name).toEqual([entry(NOW - 2 * DAY)]);
    }
  });

  it("기기 시계가 뒤로 가도(기록 시각이 하루 안의 미래) 지난번 비교 기록을 버리지 않고, 시계가 뒤로 간 채 남긴 새 기록이 이전 기록을 지우지 않는다(감사 6-2)", () => {
    const storage = new FakeStorage();
    expect(appendHistory(storage, entry(NOW), NOW)).toEqual({ status: "saved" });
    for (const back of [1000, 3_600_000, DAY]) {
      const read = readHistory(storage, NOW - back);
      expect(read.status, String(back)).toBe("ready");
      expect(read.entries, String(back)).toEqual([entry(NOW)]);
    }
    // 시계가 1시간 뒤로 간 채 새 기록을 남겨도 이전 기록은 남고, 시각이 더 늦은 것이 앞이다.
    expect(appendHistory(storage, entry(NOW - 3_600_000, 1), NOW - 3_600_000)).toEqual({ status: "saved" });
    expect(readHistory(storage, NOW - 3_600_000).entries).toEqual([entry(NOW), entry(NOW - 3_600_000, 1)]);
    expect(readHistory(storage, NOW + 1000).entries).toEqual([entry(NOW), entry(NOW - 3_600_000, 1)]);
    // 하루를 넘게 뒤로 간 시계는 전과 같이 읽지 않는다(기간을 사실상 늘리는 값).
    expect(readHistory(storage, NOW - DAY - 1).status).toBe("invalid");
  });

  it("쓰기 실패는 unavailable 이고 기존 기록을 남긴다", () => {
    const storage = new FakeStorage();
    appendHistory(storage, entry(NOW - 2 * DAY), NOW);
    const before = storage.data.get(V40_STORAGE.historyKey);
    storage.failSet = true;
    expect(appendHistory(storage, entry(NOW - DAY), NOW)).toEqual({ status: "unavailable" });
    storage.failSet = false;
    storage.dropSet = true;
    expect(appendHistory(storage, entry(NOW - DAY), NOW)).toEqual({ status: "unavailable" });
    expect(storage.data.get(V40_STORAGE.historyKey)).toBe(before);
    storage.dropSet = false;
    storage.failGet = true;
    expect(appendHistory(storage, entry(NOW - DAY), NOW)).toEqual({ status: "unavailable" });
    const full = new FakeStorage();
    full.quota = 10;
    expect(appendHistory(full, entry(NOW - DAY), NOW)).toEqual({ status: "unavailable" });
  });

  it("clearHistory 는 기록만 지우고 던지면 unavailable 이다", () => {
    const storage = new FakeStorage();
    appendHistory(storage, entry(NOW - DAY), NOW);
    storage.data.set(V40_STORAGE.progressKey, "kept");
    expect(clearHistory(storage)).toEqual({ status: "cleared" });
    expect(readHistory(storage, NOW).status).toBe("empty");
    expect(storage.data.get(V40_STORAGE.progressKey)).toBe("kept");
    storage.failRemove = true;
    expect(clearHistory(storage)).toEqual({ status: "unavailable" });
  });

  it("실제 결과에서 만든 기록(글자와 세기)이 왕복한다", () => {
    const storage = new FakeStorage();
    const source = fixture("swua-example");
    const axes = [
      { letter: "S", band: "lean", provisional: false },
      { letter: "W", band: "clear", provisional: false },
      { letter: "U", band: "lean", provisional: false },
      { letter: "A", band: "even", provisional: false },
    ];
    const item = { at: NOW - 1, formBit: source.formBit, axes } as unknown as HistoryEntry;
    expect(appendHistory(storage, item, NOW).status).toBe("saved");
    expect(readHistory(storage, NOW).entries).toEqual([item]);
  });
});

// ---------------------------------------------------------------------------
// 기간이 지난 저장 지우기: 읽기 함수는 쓰지 않으므로(처리방침) 지우는 일은 purgeExpired 가 맡는다
// ---------------------------------------------------------------------------

describe("purgeExpired", () => {
  const answers = encodeProgressAnswers(bank, fixture("swua-example").responses) ?? "";
  const staleProgress = (): string => rawEnvelope({ savedAt: NOW - TTL - DAY, answers, screen: "result" });

  it("기간이 지난 진행 저장을 지운다: 지운 뒤에는 empty 이고 답이 어디에도 남지 않으며 다음 쓰기는 expectedRaw null 로 이어진다", () => {
    const storage = progressStore(staleProgress());
    // 읽기만으로는 그대로 남는다.
    expect(readProgress(storage, bank, NOW).status).toBe("expired");
    expect(storage.data.has(V40_STORAGE.progressKey)).toBe(true);
    expect(purgeExpired(storage, bank, NOW)).toEqual({ progress: true, history: false });
    expect(storage.writes()).toEqual([`remove:${V40_STORAGE.progressKey}`]);
    expect(storage.data.size).toBe(0);
    expect(readProgress(storage, bank, NOW)).toEqual({ status: "empty", raw: null });
    expect(writeProgress(storage, bank, snapshotOf("all-clear", "questions", 1), null, NOW).status).toBe("saved");
  });

  it("경계: 저장한 지 정확히 30일이면 지우고 1밀리초 모자라면 지우지 않는다", () => {
    const exact = progressStore(rawEnvelope({ savedAt: NOW - TTL }));
    expect(purgeExpired(exact, bank, NOW)).toEqual({ progress: true, history: false });
    expect(exact.data.has(V40_STORAGE.progressKey)).toBe(false);
    const almost = progressStore(rawEnvelope({ savedAt: NOW - TTL + 1 }));
    expect(purgeExpired(almost, bank, NOW)).toEqual({ progress: false, history: false });
    expect(almost.data.has(V40_STORAGE.progressKey)).toBe(true);
  });

  it("기간 안의 저장, 형식이 깨진 저장, 시각이 미래인 저장은 건드리지 않는다", () => {
    for (const raw of [rawEnvelope(), "not json", rawEnvelope({ schema: 9 }), rawEnvelope({ savedAt: NOW + DAY }), rawEnvelope({ savedAt: NOW - TTL - DAY }).replace('"formBit":0', '"formBit":7')]) {
      const storage = progressStore(raw);
      expect(purgeExpired(storage, bank, NOW), raw).toEqual({ progress: false, history: false });
      expect(storage.writes(), raw).toEqual([]);
      expect(storage.data.get(V40_STORAGE.progressKey)).toBe(raw);
    }
  });

  it("비교 기록: 모두 지났으면 키를 지우고 일부만 지났으면 남은 건으로 다시 쓴다", () => {
    const storage = new FakeStorage();
    appendHistory(storage, entry(NOW - 29 * DAY), NOW - 29 * DAY);
    appendHistory(storage, entry(NOW - 10 * DAY), NOW - 10 * DAY);
    expect(purgeExpired(storage, bank, NOW)).toEqual({ progress: false, history: false });
    expect(readHistory(storage, NOW).entries).toHaveLength(2);
    // 일부만 지난 시각.
    expect(purgeExpired(storage, bank, NOW + 2 * DAY)).toEqual({ progress: false, history: true });
    const rewritten = JSON.parse(storage.data.get(V40_STORAGE.historyKey) ?? "null") as { schema: number; version: string; entries: { at: number }[] };
    expect(rewritten.entries.map((item) => item.at)).toEqual([NOW - 10 * DAY]);
    expect(Object.keys(rewritten).sort()).toEqual(["entries", "schema", "version"]);
    expect(readHistory(storage, NOW + 2 * DAY).status).toBe("ready");
    // 모두 지난 시각.
    expect(purgeExpired(storage, bank, NOW - 10 * DAY + TTL)).toEqual({ progress: false, history: true });
    expect(storage.data.has(V40_STORAGE.historyKey)).toBe(false);
    expect(readHistory(storage, NOW)).toEqual({ status: "empty", entries: [] });
  });

  it("진행 저장과 비교 기록을 한 번에 지운다", () => {
    const storage = progressStore(staleProgress());
    appendHistory(storage, entry(NOW - 40 * DAY), NOW - 40 * DAY);
    storage.data.set("unrelated", "kept");
    expect(purgeExpired(storage, bank, NOW)).toEqual({ progress: true, history: true });
    expect([...storage.data.keys()]).toEqual(["unrelated"]);
  });

  it("기록이 깨졌거나 비었거나 기간 안이면 건드리지 않는다", () => {
    const empty = JSON.stringify({ schema: 1, version: "v4.0-tendency", entries: [] });
    for (const raw of ["not json", empty, JSON.stringify({ schema: 1, version: "v4.0-tendency", entries: [], extra: 1 })]) {
      const storage = storeWith(V40_STORAGE.historyKey, raw);
      expect(purgeExpired(storage, bank, NOW), raw).toEqual({ progress: false, history: false });
      expect(storage.writes(), raw).toEqual([]);
    }
    const fresh = new FakeStorage();
    appendHistory(fresh, entry(NOW - DAY), NOW);
    expect(purgeExpired(fresh, bank, NOW)).toEqual({ progress: false, history: false });
    expect(readHistory(fresh, NOW).entries).toHaveLength(1);
  });

  it("지우지 못하면 던지지 않고 false 이며 저장은 그대로다", () => {
    const storage = progressStore(staleProgress());
    appendHistory(storage, entry(NOW - 29 * DAY), NOW - 29 * DAY);
    appendHistory(storage, entry(NOW - 10 * DAY), NOW - 10 * DAY);
    const before = JSON.stringify([...storage.data.entries()]);
    storage.failRemove = true;
    storage.failSet = true;
    expect(purgeExpired(storage, bank, NOW + 2 * DAY)).toEqual({ progress: false, history: false });
    expect(JSON.stringify([...storage.data.entries()])).toBe(before);
    const blocked = new FakeStorage();
    blocked.failGet = true;
    expect(purgeExpired(blocked, bank, NOW)).toEqual({ progress: false, history: false });
  });

  it("지우려는 순간 다른 탭이 새로 쓴 값은 지우지 않는다", () => {
    const fresh = rawEnvelope({ savedAt: NOW });
    const storage = progressStore(staleProgress());
    const originalGet = storage.getItem.bind(storage);
    let reads = 0;
    storage.getItem = (key: string) => {
      const value = originalGet(key);
      reads += 1;
      // 첫 읽기(만료 판정) 직후 다른 탭이 새 값을 쓴다.
      if (reads === 1) storage.data.set(key, fresh);
      return value;
    };
    expect(purgeExpired(storage, bank, NOW)).toEqual({ progress: false, history: false });
    expect(storage.data.get(V40_STORAGE.progressKey)).toBe(fresh);
    expect(storage.writes()).toEqual([]);
  });

  it("시각이 올바르지 않으면 아무것도 하지 않는다", () => {
    const storage = progressStore(staleProgress());
    for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(purgeExpired(storage, bank, bad), String(bad)).toEqual({ progress: false, history: false });
    }
    expect(storage.writes()).toEqual([]);
  });

  it("자동 저장이 꺼져 있어도 기간이 지난 것은 지운다(지우기는 선호와 무관하다)", () => {
    const storage = progressStore(staleProgress());
    storage.data.set(V40_STORAGE.autosaveKey, "off");
    expect(purgeExpired(storage, bank, NOW)).toEqual({ progress: true, history: false });
    expect(storage.data.get(V40_STORAGE.autosaveKey)).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// 자동 저장 선호
// ---------------------------------------------------------------------------

describe("자동 저장 선호", () => {
  it("아무것도 없으면 켜짐이다", () => {
    expect(readAutosavePreference(new FakeStorage())).toBe("on");
  });

  it("끄기를 쓰면 v4 진행 저장, v4 기록, 이전 판 진행 저장을 함께 지우고 선호만 남긴다", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.progressKey, rawEnvelope());
    storage.data.set(V40_STORAGE.historyKey, "history");
    storage.data.set(V40_STORAGE.legacyV31ProgressKey, "legacy");
    storage.data.set("hanbang:wedding-code:comparison:v1", "kept-by-client");
    storage.data.set("unrelated", "kept");
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    expect(readAutosavePreference(storage)).toBe("off");
    expect([...storage.data.keys()].sort()).toEqual(["hanbang:wedding-code:comparison:v1", V40_STORAGE.autosaveKey, "unrelated"].sort());
    expect(storage.data.get(V40_STORAGE.autosaveKey)).toBe("off");
  });

  it("켜기는 선호만 쓰고 저장된 것을 지우지 않는다", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.progressKey, rawEnvelope());
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    storage.data.set(V40_STORAGE.progressKey, rawEnvelope());
    expect(writeAutosavePreference(storage, "on")).toEqual({ status: "saved" });
    expect(readAutosavePreference(storage)).toBe("on");
    expect(storage.data.has(V40_STORAGE.progressKey)).toBe(true);
  });

  it("끈 뒤에는 writeProgress 와 appendHistory 가 아무것도 쓰지 않고 off 로 답한다(화면이 선호 확인을 빠뜨려도 답이 남지 않는다)", () => {
    const storage = new FakeStorage();
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    const writesBefore = storage.writes().length;
    expect(writeProgress(storage, bank, snapshotOf("swua-example", "result"), null, NOW)).toEqual({ status: "off" });
    expect(appendHistory(storage, entry(NOW - DAY), NOW)).toEqual({ status: "off" });
    expect(storage.writes().length).toBe(writesBefore);
    expect(storage.data.has(V40_STORAGE.progressKey)).toBe(false);
    expect(storage.data.has(V40_STORAGE.historyKey)).toBe(false);
    // 이전 판에서 끈 사람(v4 선호가 아직 없음)도 같다.
    const legacy = new FakeStorage();
    legacy.data.set(V40_STORAGE.legacyV31AutosaveKey, "off");
    expect(writeProgress(legacy, bank, snapshotOf("swua-example", "result"), null, NOW)).toEqual({ status: "off" });
    expect(appendHistory(legacy, entry(NOW - DAY), NOW)).toEqual({ status: "off" });
    expect([...legacy.data.keys()]).toEqual([V40_STORAGE.legacyV31AutosaveKey]);
    // 다시 켜면 쓸 수 있다.
    expect(writeAutosavePreference(storage, "on")).toEqual({ status: "saved" });
    expect(writeProgress(storage, bank, snapshotOf("swua-example", "result"), null, NOW).status).toBe("saved");
    expect(appendHistory(storage, entry(NOW - DAY), NOW)).toEqual({ status: "saved" });
  });

  it("off 는 저장소가 막힌 것(unavailable)과 다른 상태다: 끈 선호가 있으면 쓰기가 막혀도 off, 켜진 채 막히면 unavailable", () => {
    const off = new FakeStorage();
    expect(writeAutosavePreference(off, "off")).toEqual({ status: "saved" });
    off.failSet = true;
    expect(writeProgress(off, bank, snapshotOf("swua-example"), null, NOW)).toEqual({ status: "off" });
    expect(appendHistory(off, entry(NOW - DAY), NOW)).toEqual({ status: "off" });
    const on = new FakeStorage();
    on.failSet = true;
    expect(writeProgress(on, bank, snapshotOf("swua-example"), null, NOW)).toEqual({ status: "unavailable" });
    expect(appendHistory(on, entry(NOW - DAY), NOW)).toEqual({ status: "unavailable" });
  });

  it("모양이 틀린 입력은 끈 상태에서도 invalid 로 답한다(검증이 먼저다)", () => {
    const storage = new FakeStorage();
    writeAutosavePreference(storage, "off");
    expect(writeProgress(storage, bank, null as unknown as ProgressSnapshot, null, NOW)).toEqual({ status: "invalid" });
    expect(appendHistory(storage, entry(NOW + 2 * DAY), NOW)).toEqual({ status: "invalid" });
  });

  it("이전 판(v3.1)에서 끈 사람은 v4 에서도 끈 것으로 읽되, v4 에서 다시 켜면 켜진다", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.legacyV31AutosaveKey, "off");
    expect(readAutosavePreference(storage)).toBe("off");
    expect(writeAutosavePreference(storage, "on")).toEqual({ status: "saved" });
    expect(readAutosavePreference(storage)).toBe("on");
    // 이전 판의 선호는 건드리지 않는다.
    expect(storage.data.get(V40_STORAGE.legacyV31AutosaveKey)).toBe("off");
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    expect(readAutosavePreference(storage)).toBe("off");
  });

  it("이전 판 선호가 켜짐이거나 알 수 없는 값이면 v4 는 켜짐이다", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.legacyV31AutosaveKey, "on");
    expect(readAutosavePreference(storage)).toBe("on");
    storage.data.set(V40_STORAGE.legacyV31AutosaveKey, "maybe");
    storage.data.set(V40_STORAGE.autosaveKey, "weird");
    expect(readAutosavePreference(storage)).toBe("on");
  });

  it("저장소 접근이 던지면 읽기는 기본값(켜짐), 쓰기는 unavailable 이다", () => {
    const storage = new FakeStorage();
    storage.failGet = true;
    expect(readAutosavePreference(storage)).toBe("on");
    const blocked = new FakeStorage();
    blocked.failSet = true;
    blocked.failRemove = true;
    expect(writeAutosavePreference(blocked, "off")).toEqual({ status: "unavailable" });
    expect(writeAutosavePreference(blocked, "on")).toEqual({ status: "unavailable" });
  });

  it("끄기 중 지우기가 하나라도 실패하면 saved 라고 말하지 않는다", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.progressKey, rawEnvelope());
    storage.failRemove = true;
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "unavailable" });
  });

  it("끄기는 가득 찬 저장소에서 지운 뒤에 선호를 쓴다(비운 자리로 선호가 들어간다)", () => {
    const storage = new FakeStorage();
    const big = rawEnvelope();
    storage.data.set(V40_STORAGE.progressKey, big);
    storage.quota = big.length + 1;
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    expect(readAutosavePreference(storage)).toBe("off");
  });

  it("잘못된 선호 값은 쓰지 않는다", () => {
    const storage = new FakeStorage();
    expect(writeAutosavePreference(storage, "maybe" as "on")).toEqual({ status: "unavailable" });
    expect(storage.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 이전 판(v3.1) 진행 저장 감지
// ---------------------------------------------------------------------------

describe("probeLegacyV31Progress", () => {
  const legacy = (raw: string): FakeStorage => storeWith(V40_STORAGE.legacyV31ProgressKey, raw);
  const NONE = { present: false, savedAt: null } as const;
  // v3.1 이 시작 단추를 누를 때 저장하는 모양: 답 0개(스물다섯 칸과 취향 여섯 칸과 세 자리가 모두 -).
  const NO_ANSWER_CODE = `31_${"-".repeat(25)}_-.-.-.-.-.-_-_-_-`;
  // 첫 문장에 5점 하나. v3.1 이 쓴 값과 같은 모양이다(실제 v3.1 이 쓴 값과의 대조는 storage.legacyProbe.test.ts).
  const ONE_ANSWER_CODE = `31_5${"-".repeat(24)}_-.-.-.-.-.-_-_-_-`;
  /** v3.1 진행 저장 봉투(스키마 2). 기본은 하루 전에 저장한 답 하나. */
  function v31Envelope(overrides: Record<string, unknown> = {}, drop: readonly string[] = []): string {
    const base: Record<string, unknown> = {
      schema: 2,
      version: "v3.1-preferences",
      savedAt: NOW - DAY,
      answerCode: ONE_ANSWER_CODE,
      flow: "core",
      index: 1,
      screen: "questions",
      editing: false,
      needsPriorityReview: false,
    };
    const merged = { ...base, ...overrides };
    for (const key of drop) delete merged[key];
    return JSON.stringify(merged);
  }

  it("없으면 present 가 false 다", () => {
    expect(probeLegacyV31Progress(new FakeStorage(), NOW)).toEqual(NONE);
    expect(probeLegacyV31Progress(legacy(""), NOW)).toEqual(NONE);
  });

  it("읽을 수 있는 30일 안의 v3.1 진행에 답이 하나 있으면 present 와 그 저장 시각을 돌려준다", () => {
    expect(probeLegacyV31Progress(legacy(v31Envelope({ savedAt: NOW - 3 * DAY })), NOW)).toEqual({ present: true, savedAt: NOW - 3 * DAY });
    // 스키마 1(흐름 키 없음)도 읽는다.
    expect(probeLegacyV31Progress(legacy(v31Envelope({ schema: 1 }, ["flow"])), NOW)).toEqual({ present: true, savedAt: NOW - DAY });
  });

  it("시작만 눌러 답이 하나도 없는 진행은 키에 값이 있어도 present 가 false 다(거짓 카드가 뜨지 않는다)", () => {
    expect(probeLegacyV31Progress(legacy(v31Envelope({ answerCode: NO_ANSWER_CODE })), NOW)).toEqual(NONE);
    expect(probeLegacyV31Progress(legacy(v31Envelope({ schema: 1, answerCode: NO_ANSWER_CODE }, ["flow"])), NOW)).toEqual(NONE);
  });

  it("아직 모름, 해당 없음, 건너뜀, 취향 상관없음도 고른 답으로 센다", () => {
    for (const code of [
      `31_u${"-".repeat(24)}_-.-.-.-.-.-_-_-_-`,
      `31_${"-".repeat(24)}n_-.-.-.-.-.-_-_-_-`,
      `31_${"-".repeat(12)}s${"-".repeat(12)}_-.-.-.-.-.-_-_-_-`,
      `31_${"-".repeat(25)}_p.-.-.-.-.-_-_-_-`,
      `31_${"-".repeat(25)}_-.-.-.-.-.c00_-_-_-`,
      `31_${"-".repeat(25)}_-.-.-.-.-.-_c01_-_-`,
      `31_${"-".repeat(25)}_-.-.-.-.-.-_-_s_-`,
      `31_${"-".repeat(25)}_-.-.-.-.-.-_-_-_c00`,
    ]) {
      expect(probeLegacyV31Progress(legacy(v31Envelope({ answerCode: code })), NOW), code).toEqual({ present: true, savedAt: NOW - DAY });
    }
  });

  it("저장 시각 경계: 30일이 되는 순간 지나고, 지금과 하루 안의 미래까지는 읽고, 그보다 먼 미래나 안전한 정수가 아니면 읽지 않는다", () => {
    expect(probeLegacyV31Progress(legacy(v31Envelope({ savedAt: NOW - TTL + 1 })), NOW)).toEqual({ present: true, savedAt: NOW - TTL + 1 });
    expect(probeLegacyV31Progress(legacy(v31Envelope({ savedAt: NOW })), NOW)).toEqual({ present: true, savedAt: NOW });
    // 기기 시계가 저장 뒤에 뒤로 간 경우(v3.1 읽기와 같은 규칙, 감사 6-2)
    expect(probeLegacyV31Progress(legacy(v31Envelope({ savedAt: NOW + 1 })), NOW)).toEqual({ present: true, savedAt: NOW + 1 });
    expect(probeLegacyV31Progress(legacy(v31Envelope({ savedAt: NOW + DAY })), NOW)).toEqual({ present: true, savedAt: NOW + DAY });
    for (const savedAt of [NOW - TTL, NOW - TTL - DAY, NOW + DAY + 1, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(probeLegacyV31Progress(legacy(v31Envelope({ savedAt })), NOW), String(savedAt)).toEqual(NONE);
    }
    expect(probeLegacyV31Progress(legacy(v31Envelope()), Number.NaN)).toEqual(NONE);
  });

  it("깨진 원문과 JSON 이 아닌 값은 던지지 않고 present 가 false 다", () => {
    for (const raw of ["not json", "[]", "null", "7", '"text"', "{", "x".repeat(5000)]) {
      expect(probeLegacyV31Progress(legacy(raw), NOW), raw.slice(0, 20)).toEqual(NONE);
    }
  });

  it("savedAt 만 있는 값이나 answerCode 가 엉뚱한 값은 v3.1 진행이 아니라서 present 가 false 다(키에 값이 있다는 것만으로는 카드를 내지 않는다)", () => {
    expect(probeLegacyV31Progress(legacy(JSON.stringify({ savedAt: NOW - DAY })), NOW)).toEqual(NONE);
    expect(probeLegacyV31Progress(legacy(JSON.stringify({ savedAt: NOW - 3 * DAY, answerCode: "아무 값", 뭐든: [1, 2, 3] })), NOW)).toEqual(NONE);
    expect(probeLegacyV31Progress(legacy(v31Envelope({ answerCode: "아무 값" })), NOW)).toEqual(NONE);
    expect(probeLegacyV31Progress(legacy(v31Envelope({ answerCode: 31 })), NOW)).toEqual(NONE);
  });

  it("스키마, 버전, 봉투 키, 이어 할 자리가 v3.1 의 모양과 다르면 읽지 않는다", () => {
    const cases: Array<[string, string]> = [
      ["스키마 3", v31Envelope({ schema: 3 })],
      ["스키마 없음", v31Envelope({}, ["schema"])],
      ["다른 버전", v31Envelope({ version: "v3.0-preferences" })],
      ["v4 버전", v31Envelope({ version: "v4.0-tendency" })],
      ["모르는 키", v31Envelope({ extra: 1 })],
      ["스키마 2 인데 흐름 키 없음", v31Envelope({}, ["flow"])],
      ["스키마 1 인데 흐름 키 있음", v31Envelope({ schema: 1 })],
      ["모르는 흐름", v31Envelope({ flow: "all" })],
      ["흐름이 문자열이 아님", v31Envelope({ flow: 1 })],
      ["자리가 음수", v31Envelope({ index: -1 })],
      ["자리가 34", v31Envelope({ index: 34 })],
      ["자리가 소수", v31Envelope({ index: 1.5 })],
      ["자리가 문자열", v31Envelope({ index: "1" })],
      ["모르는 화면", v31Envelope({ screen: "intro" })],
      ["editing 이 불리언이 아님", v31Envelope({ editing: 0 })],
      ["needsPriorityReview 가 불리언이 아님", v31Envelope({ needsPriorityReview: "no" })],
    ];
    for (const [name, raw] of cases) expect(probeLegacyV31Progress(legacy(raw), NOW), name).toEqual(NONE);
    // 자리의 양 끝은 읽는다.
    expect(probeLegacyV31Progress(legacy(v31Envelope({ index: 0 })), NOW).present).toBe(true);
    expect(probeLegacyV31Progress(legacy(v31Envelope({ index: 33 })), NOW).present).toBe(true);
  });

  it("답 코드의 모양이 틀리면 읽지 않는다(칸 수, 글자, 조각 수, 첫 조각)", () => {
    const cells = "-".repeat(25);
    const cases: Array<[string, string]> = [
      ["문장 24칸", `31_5${"-".repeat(23)}_-.-.-.-.-.-_-_-_-`],
      ["문장 26칸", `31_5${"-".repeat(25)}_-.-.-.-.-.-_-_-_-`],
      ["문장 칸에 6점", `31_6${"-".repeat(24)}_-.-.-.-.-.-_-_-_-`],
      ["문장 칸에 p", `31_p${"-".repeat(24)}_-.-.-.-.-.-_-_-_-`],
      ["취향 5칸", `31_5${"-".repeat(24)}_-.-.-.-.-_-_-_-`],
      ["취향 7칸", `31_5${"-".repeat(24)}_-.-.-.-.-.-.-_-_-_-`],
      ["조각 5개", `31_5${"-".repeat(24)}_-.-.-.-.-.-_-_-`],
      ["조각 7개", `31_5${"-".repeat(24)}_-.-.-.-.-.-_-_-_-_-`],
      ["첫 조각이 32", `32_5${"-".repeat(24)}_-.-.-.-.-.-_-_-_-`],
      ["선택 칸이 빈 문자열", `31_5${"-".repeat(24)}_-.-.-.-.-.-__-_-`],
      ["선택 칸에 모르는 글자", `31_5${"-".repeat(24)}_-.-.-.-.-.x_-_-_-`],
      ["선택 칸의 c 뒤에 번호 없음", `31_${cells}_c.-.-.-.-.-_-_-_-`],
      ["선택 칸의 c 뒤 번호가 한 글자", `31_${cells}_c0.-.-.-.-.-_-_-_-`],
      ["선택 칸의 c 뒤 번호가 세 글자", `31_${cells}_c000.-.-.-.-.-_-_-_-`],
      ["대문자", `31_5${"-".repeat(24)}_-.-.-.-.-.-_-_-_C00`],
      ["길이 256 초과", `31_5${"-".repeat(24)}_-.-.-.-.-.-_-_-_c${"00".repeat(130)}`],
    ];
    for (const [name, code] of cases) expect(probeLegacyV31Progress(legacy(v31Envelope({ answerCode: code })), NOW), name).toEqual(NONE);
  });

  it("원문이 2048자를 넘으면 읽지 않고 2048자까지는 읽는다(v3.1 봉투 상한)", () => {
    const base = v31Envelope();
    expect(base.length).toBeLessThan(2048);
    const exact = base + " ".repeat(2048 - base.length);
    expect(exact).toHaveLength(2048);
    expect(probeLegacyV31Progress(legacy(exact), NOW).present).toBe(true);
    expect(probeLegacyV31Progress(legacy(`${exact} `), NOW)).toEqual(NONE);
  });

  it("접근이 던지면 present 가 false 이다", () => {
    const storage = legacy(v31Envelope());
    storage.failGet = true;
    expect(probeLegacyV31Progress(storage, NOW)).toEqual(NONE);
  });

  it("읽기만 하고 지우지도 쓰지도 않는다(읽을 수 없는 값도 지우지 않는다)", () => {
    for (const raw of [v31Envelope(), v31Envelope({ answerCode: NO_ANSWER_CODE }), v31Envelope({ savedAt: NOW - TTL }), "not json"]) {
      const storage = legacy(raw);
      probeLegacyV31Progress(storage, NOW);
      expect(storage.calls).toEqual([`get:${V40_STORAGE.legacyV31ProgressKey}`]);
      expect(storage.data.get(V40_STORAGE.legacyV31ProgressKey)).toBe(raw);
    }
  });

  it("present 이면 savedAt 이 있고 아니면 null 이다(화면은 present 만 본다)", () => {
    for (const raw of [v31Envelope(), v31Envelope({ answerCode: NO_ANSWER_CODE }), v31Envelope({ savedAt: NOW - TTL }), "not json", ""]) {
      const probe = probeLegacyV31Progress(legacy(raw), NOW);
      expect(probe.present, raw.slice(0, 30)).toBe(probe.savedAt !== null);
    }
  });
});

// ---------------------------------------------------------------------------
// 소스 경계: v3.1 모듈을 가져오지 않는다
// ---------------------------------------------------------------------------

describe("소스 경계", () => {
  const source = readFileSync(resolve(__dirname, "storage.ts"), "utf8");

  it("가져오는 모듈은 v4 상수, v4 타입, v4 states, 저장소 핸들 도우미 뿐이고 v3.1 모듈을 가져오지 않는다", () => {
    const specs = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(specs.length).toBeGreaterThan(0);
    // 저장소 핸들 도우미(lib/weddingCode/browserStorageHandle.ts)는 v3.1 과 v4 가 함께 쓰는 중립 파일이다(저장소 이름이 거기 한 곳에만 있다).
    for (const spec of specs) expect(["@/constants/weddingCodeV40", "./types", "./contract", "./states", "../browserStorageHandle"], spec).toContain(spec);
    expect(source).not.toMatch(/import[^;]*(v31|V31)/u);
  });

  /**
   * 계약 문서 9.3절: 브라우저 저장소의 이름을 부르는 유일한 자리는 lib/weddingCode/browserStorageHandle.ts 의 realLocalStorage() 다(v3.1 과 함께 쓴다).
   * storage.ts 의 browserStorage() 는 그 결과를 그대로 돌려줄 뿐이라 이 파일에는 저장소 이름이 하나도 없다. 소스 가드(규칙 5)가 다른 파일을 막고,
   * 이 시험이 두 파일 모두를 확인한다. 주석은 문법 조각이 아니라서 세지 않고, 문자열 색인(window["localStorage"])도 센다.
   */
  const handleSource = readFileSync(resolve(__dirname, "../browserStorageHandle.ts"), "utf8");
  function storageNameHits(text: string, fileName: string): { name: string; owner: string }[] {
    const names = new Set(["localStorage", "sessionStorage", "indexedDB"]);
    const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const hits: { name: string; owner: string }[] = [];
    const ownerOf = (node: ts.Node): string => {
      for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
        if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text;
      }
      return "(함수 바깥)";
    };
    const visit = (node: ts.Node): void => {
      if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && names.has(node.text)) hits.push({ name: node.text, owner: ownerOf(node) });
      ts.forEachChild(node, visit);
    };
    visit(file);
    return hits;
  }

  it("저장소 이름(localStorage, sessionStorage, indexedDB)은 storage.ts 에 없고 도우미의 realLocalStorage 함수 안에 한 번만 나온다", () => {
    expect(storageNameHits(source, "storage.ts")).toEqual([]);
    expect(storageNameHits(handleSource, "browserStorageHandle.ts")).toEqual([{ name: "localStorage", owner: "realLocalStorage" }]);
    expect(source).toMatch(/export function browserStorage\(\): StorageLike \| null/u);
    expect(source).toMatch(/return realLocalStorage\(\)/u);
  });

  it("이전 판 키 문자열이 v3.1 소스의 값과 같다(소스 텍스트만 읽는다)", () => {
    const v31Progress = readFileSync(resolve(__dirname, "../v31LocalProgress.ts"), "utf8");
    const key = /export const LOCAL_KEY = "([^"]+)"/u.exec(v31Progress)?.[1];
    expect(V40_STORAGE.legacyV31ProgressKey).toBe(key);
    const hook = readFileSync(resolve(__dirname, "../../../app/wedding-code/useV31LocalProgress.ts"), "utf8");
    const preference = /V31_SAVE_PREFERENCE_KEY = "([^"]+)"/u.exec(hook)?.[1];
    expect(V40_STORAGE.legacyV31AutosaveKey).toBe(preference);
  });
});

describe("browserStorage: 브라우저 저장소 핸들(계약 문서 9.3절)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  function blockLocalStorage(read: () => unknown): () => void {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: read as () => Storage });
    return () => {
      if (original) Object.defineProperty(window, "localStorage", original);
    };
  }

  it("브라우저에서는 window.localStorage 를 그대로 돌려준다", () => {
    expect(browserStorage()).toBe(window.localStorage);
  });

  it("저장소에 닿는 것만으로 던지는 환경(개인정보 보호 모드, 앱 안 브라우저)에서는 던지지 않고 null 이다", () => {
    const restore = blockLocalStorage(() => {
      throw new Error("SecurityError");
    });
    try {
      expect(() => browserStorage()).not.toThrow();
      expect(browserStorage()).toBeNull();
    } finally {
      restore();
    }
  });

  it("저장소가 없다고 답하는 환경(null, undefined)도 null 이다", () => {
    for (const missing of [null, undefined]) {
      const restore = blockLocalStorage(() => missing);
      try {
        expect(browserStorage()).toBeNull();
      } finally {
        restore();
      }
    }
  });

  it("저장소가 막힌 브라우저에서 루트 스니펫이 갈아 끼운 메모리 객체는 진짜 저장소가 아니라서 null 이다(저장했다고 거짓말하지 않는다)", () => {
    const memory = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined, key: () => null, length: 0 };
    const restore = blockLocalStorage(() => memory);
    try {
      expect(browserStorage()).toBeNull();
    } finally {
      restore();
    }
  });

  it("실제 스니펫을 돌려도(쓰기가 던지는 저장소, 접근이 던지는 저장소) 갈아 끼워진 메모리 저장소는 null 이다", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    const originalSession = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      // 쓰기가 던지는 저장소(가득 참): 스니펫이 메모리 객체로 갈아 끼운다.
      new Function(BROWSER_STORAGE_FALLBACK_SNIPPET)();
      expect(Object.prototype.toString.call(window.localStorage)).toBe("[object Object]");
      expect(browserStorage()).toBeNull();
    } finally {
      setItem.mockRestore();
      if (original) Object.defineProperty(window, "localStorage", original);
      if (originalSession) Object.defineProperty(window, "sessionStorage", originalSession);
    }
    expect(browserStorage()).toBe(window.localStorage);

    const restore = blockLocalStorage(() => {
      throw new Error("SecurityError");
    });
    try {
      // 접근이 던지는 저장소: 스니펫이 메모리 객체로 갈아 끼운다(sessionStorage 는 멀쩡해서 그대로 둔다).
      new Function(BROWSER_STORAGE_FALLBACK_SNIPPET)();
      expect(browserStorage()).toBeNull();
    } finally {
      restore();
    }
    expect(browserStorage()).toBe(window.localStorage);
  });

  it("window 가 없는 서버 렌더링에서는 null 이다", () => {
    vi.stubGlobal("window", undefined);
    expect(browserStorage()).toBeNull();
  });

  it("받은 핸들을 이 파일의 함수에 넘겨 읽고 쓸 수 있다(핸들에 직접 부르지 않는다)", () => {
    const handle = browserStorage();
    expect(handle).not.toBeNull();
    if (handle === null) return;
    expect(readAutosavePreference(handle)).toBe("on");
    expect(writeAutosavePreference(handle, "off")).toEqual({ status: "saved" });
    expect(window.localStorage.getItem(V40_STORAGE.autosaveKey)).toBe("off");
    expect(readAutosavePreference(handle)).toBe("off");
    expect(writeProgress(handle, bank, snapshotOf("swua-example"), null, NOW)).toEqual({ status: "off" });
    expect(window.localStorage.getItem(V40_STORAGE.progressKey)).toBeNull();
  });
});

describe("계약", () => {
  it("storageModule 은 계약의 함수 열세 개를 모두 낸다", () => {
    expect(Object.keys(storageModule).sort()).toEqual(
      [
        "appendHistory",
        "browserStorage",
        "clearHistory",
        "clearProgress",
        "decodeProgressAnswers",
        "encodeProgressAnswers",
        "probeLegacyV31Progress",
        "purgeExpired",
        "readAutosavePreference",
        "readHistory",
        "readProgress",
        "writeAutosavePreference",
        "writeProgress",
      ].sort(),
    );
  });
});
