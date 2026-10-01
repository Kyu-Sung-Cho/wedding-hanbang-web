import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { V40_STORAGE } from "@/constants/weddingCodeV40";
import { BROWSER_STORAGE_FALLBACK_SNIPPET } from "@/lib/browserStorageFallback";
import type { StorageLike } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_FIXTURES } from "./fixtures";
import {
  browserStorage,
  clearHistory,
  clearProgress,
  createExtraPort,
  purgeExpired,
  readAutosavePreference,
  storageModule,
  writeAutosavePreference,
  writeProgress,
  type ExtraKey,
  type ExtraPort,
  type ExtraPortOptions,
} from "./storage";

/**
 * 웨딩코드 4.1 단계 2 의 곁가지 저장 포트(createExtraPort)와, 결과 보기 전에 고른 글자 키(V40_STORAGE.letterGuessKey)가
 * 기존 저장 함수와 만나는 곳을 고정한다. 기존 storage.test.ts 는 한 줄도 고치지 않았고, 이 파일이 새 면만 맡는다.
 */

const bank = WEDDING_CODE_V40_BANK;
const KEY = V40_STORAGE.letterGuessKey;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);

// ---------------------------------------------------------------------------
// 가짜 저장소: 던지기, 가득 참, 조용히 버리기, 다른 값 저장하기, 엉뚱한 값 돌려주기, 한 키만 못 지우기
// ---------------------------------------------------------------------------

class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  readonly calls: string[] = [];
  failGet = false;
  failSet = false;
  failRemove = false;
  /** 이 키 하나만 지우기가 던진다. */
  failRemoveKey: string | null = null;
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
    if (this.failRemove || this.failRemoveKey === key) throw new Error("SecurityError");
    this.data.delete(key);
  }

  writes(): string[] {
    return this.calls.filter((call) => call.startsWith("set:") || call.startsWith("remove:"));
  }
}

const letterPort = (handle: StorageLike | null, options: ExtraPortOptions = { honorAutosave: true }): ExtraPort => createExtraPort(handle, "letterGuess", options);

/** 자동 저장을 끈 가짜 저장소(끄기 선호 한 줄만 있다). */
function autosaveOff(): FakeStorage {
  const storage = new FakeStorage();
  storage.data.set(V40_STORAGE.autosaveKey, "off");
  return storage;
}

// ---------------------------------------------------------------------------
// 저장 키
// ---------------------------------------------------------------------------

describe("V40_STORAGE.letterGuessKey", () => {
  it("값이 고정이고 v4 저장 키와 같은 층에 있다", () => {
    expect(V40_STORAGE.letterGuessKey).toBe("hanbang:wedding-code:v4:letter-guess");
    const layer = V40_STORAGE.progressKey.slice(0, V40_STORAGE.progressKey.lastIndexOf(":") + 1);
    expect(layer).toBe("hanbang:wedding-code:v4:");
    expect(V40_STORAGE.letterGuessKey.startsWith(layer)).toBe(true);
  });

  it("다른 저장 키와 겹치지 않는다", () => {
    const keys: string[] = [];
    for (const value of Object.values(V40_STORAGE)) if (typeof value === "string") keys.push(value);
    expect(keys).toContain(V40_STORAGE.letterGuessKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("저장 상수의 키 목록이 이 단계가 더한 하나만큼만 늘었다(키가 하나 더 생기면 개인정보 검토가 먼저다)", () => {
    expect(Object.keys(V40_STORAGE).sort()).toEqual(
      ["autosaveKey", "historyKey", "historyMax", "legacyV31AutosaveKey", "legacyV31ProgressKey", "letterGuessKey", "maxEnvelopeLength", "progressKey", "ttlMs"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 포트의 기본 동작
// ---------------------------------------------------------------------------

describe("createExtraPort: 읽기, 쓰기, 지우기", () => {
  it("쓰면 saved, 읽으면 쓴 원문, 지우면 true 이고 그 키 하나만 만진다", () => {
    const storage = new FakeStorage();
    storage.data.set("unrelated", "kept");
    const port = letterPort(storage);
    expect(port.read()).toEqual({ ok: true, raw: null });
    expect(port.write('{"a":1}')).toBe("saved");
    expect(port.read()).toEqual({ ok: true, raw: '{"a":1}' });
    expect(port.write("second")).toBe("saved");
    expect(storage.data.get(KEY)).toBe("second");
    expect(port.remove()).toBe(true);
    expect(port.read()).toEqual({ ok: true, raw: null });
    expect([...storage.data.keys()]).toEqual(["unrelated"]);
    expect(storage.data.get("unrelated")).toBe("kept");
    // 쓰거나 지운 것은 이 키뿐이다. 자동 저장 선호 키는 읽기만 했다.
    expect(storage.writes().length).toBeGreaterThan(0);
    for (const call of storage.writes()) expect(call.endsWith(`:${KEY}`), call).toBe(true);
  });

  it("포트를 만들기만 해서는 저장소를 건드리지 않는다", () => {
    const storage = new FakeStorage();
    letterPort(storage);
    letterPort(storage, { honorAutosave: false, prefHandle: storage });
    expect(storage.calls).toEqual([]);
  });

  it("읽기는 문자열이 아닌 값을 문자열로 바꾸고 없는 값(null, undefined)은 raw null 로 답한다", () => {
    const storage = new FakeStorage();
    storage.getOverride = () => 123;
    expect(letterPort(storage).read()).toEqual({ ok: true, raw: "123" });
    storage.getOverride = () => undefined;
    expect(letterPort(storage).read()).toEqual({ ok: true, raw: null });
    storage.getOverride = () => null;
    expect(letterPort(storage).read()).toEqual({ ok: true, raw: null });
  });

  it("글자가 아닌 값을 쓰려 하면 저장소에 쓰지 않고 unavailable 이다", () => {
    const storage = new FakeStorage();
    expect(letterPort(storage).write(123 as unknown as string)).toBe("unavailable");
    expect(letterPort(storage).write(null as unknown as string)).toBe("unavailable");
    expect(storage.writes()).toEqual([]);
    expect(storage.data.size).toBe(0);
  });
});

describe("createExtraPort: 저장소를 못 쓰는 경우", () => {
  it("핸들이 null(저장소를 못 쓰는 브라우저)이면 읽기는 ok false, 쓰기는 unavailable, 지우기는 false 다", () => {
    for (const honorAutosave of [true, false]) {
      const port = letterPort(null, { honorAutosave });
      expect(port.read(), String(honorAutosave)).toEqual({ ok: false });
      expect(port.write("x"), String(honorAutosave)).toBe("unavailable");
      expect(port.remove(), String(honorAutosave)).toBe(false);
    }
    const none = letterPort(undefined as unknown as null);
    expect(none.read()).toEqual({ ok: false });
    expect(none.write("x")).toBe("unavailable");
    expect(none.remove()).toBe(false);
  });

  it("읽기가 던지면 ok false 이고, 읽어서 확인할 수 없는 쓰기는 saved 라고 하지 않는다", () => {
    const storage = new FakeStorage();
    storage.failGet = true;
    const port = letterPort(storage);
    expect(port.read()).toEqual({ ok: false });
    // 선호를 못 읽어 켜짐으로 보고 쓰지만, 쓴 뒤 다시 읽을 수 없으니 저장됐다고 말하지 않는다.
    expect(port.write("x")).toBe("unavailable");
  });

  it("쓰기가 던지면(막힘, 가득 참) unavailable 이고 이전 값은 그대로다", () => {
    const blocked = new FakeStorage();
    blocked.failSet = true;
    expect(letterPort(blocked).write("x")).toBe("unavailable");
    expect(blocked.data.has(KEY)).toBe(false);

    const full = new FakeStorage();
    full.data.set(KEY, "old");
    full.quota = 5;
    expect(letterPort(full).write("longer-than-the-quota")).toBe("unavailable");
    expect(full.data.get(KEY)).toBe("old");
  });

  it("쓴 뒤 다시 읽어 같지 않으면 unavailable 이다(조용히 버리는 저장소, 다른 값을 저장하는 저장소)", () => {
    const dropping = new FakeStorage();
    dropping.dropSet = true;
    expect(letterPort(dropping).write("x")).toBe("unavailable");
    expect(dropping.data.has(KEY)).toBe(false);

    const mangling = new FakeStorage();
    mangling.mangleSet = (value) => `${value}!`;
    expect(letterPort(mangling).write("x")).toBe("unavailable");
  });

  it("지우기가 던지면 false 이고 값은 남는다", () => {
    const storage = new FakeStorage();
    storage.data.set(KEY, "stay");
    storage.failRemove = true;
    expect(letterPort(storage).remove()).toBe(false);
    expect(storage.data.get(KEY)).toBe("stay");
  });

  it("무엇이 던져져도(문자열, 숫자, null) 세 함수 모두 던지지 않는다", () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw "blocked";
      },
      setItem: () => {
        throw 1;
      },
      removeItem: () => {
        throw null;
      },
    };
    for (const honorAutosave of [true, false]) {
      const port = letterPort(hostile, { honorAutosave });
      expect(() => port.read()).not.toThrow();
      expect(() => port.write("x")).not.toThrow();
      expect(() => port.remove()).not.toThrow();
      expect(port.read()).toEqual({ ok: false });
      expect(port.write("x")).toBe("unavailable");
      expect(port.remove()).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 자동 저장 선호
// ---------------------------------------------------------------------------

describe("createExtraPort: 자동 저장 선호", () => {
  it("자동 저장이 꺼져 있으면 쓰지 않고 off 로 답한다", () => {
    const storage = new FakeStorage();
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    const writesBefore = storage.writes().length;
    expect(letterPort(storage).write("x")).toBe("off");
    expect(storage.writes().length).toBe(writesBefore);
    expect(storage.data.has(KEY)).toBe(false);
    // 다시 켜면 쓸 수 있다.
    expect(writeAutosavePreference(storage, "on")).toEqual({ status: "saved" });
    expect(letterPort(storage).write("x")).toBe("saved");
    expect(storage.data.get(KEY)).toBe("x");
  });

  it("이전 판(v3.1)에서 끈 사람도 꺼진 것으로 읽는다", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.legacyV31AutosaveKey, "off");
    expect(letterPort(storage).write("x")).toBe("off");
    expect(storage.writes()).toEqual([]);
  });

  it("꺼져 있어도 이미 있는 값을 건드리지 않고, 지우기는 선호와 무관하게 된다", () => {
    const storage = autosaveOff();
    storage.data.set(KEY, "left-over");
    const port = letterPort(storage);
    expect(port.write("new")).toBe("off");
    expect(storage.data.get(KEY)).toBe("left-over");
    expect(port.remove()).toBe(true);
    expect(storage.data.has(KEY)).toBe(false);
  });

  it("honorAutosave 가 거짓이면 꺼져 있어도 쓴다", () => {
    const storage = autosaveOff();
    expect(letterPort(storage, { honorAutosave: false }).write("x")).toBe("saved");
    expect(storage.data.get(KEY)).toBe("x");
  });

  it("honorAutosave 를 안 주었거나 거짓이 아니면 꺼짐을 따른다(꺼짐을 어기는 쪽으로 틀리지 않는다)", () => {
    for (const options of [{}, undefined, { honorAutosave: "no" }, { honorAutosave: null }, { honorAutosave: 0 }] as unknown as ExtraPortOptions[]) {
      const storage = autosaveOff();
      expect(createExtraPort(storage, "letterGuess", options).write("x"), JSON.stringify(options ?? null)).toBe("off");
      expect(storage.data.has(KEY)).toBe(false);
      expect(storage.writes()).toEqual([]);
    }
  });

  it("prefHandle 를 주면 선호는 그 핸들에서만 읽고 값은 포트의 핸들에 쓴다(이 창만의 저장소가 이 브라우저의 선호를 따른다)", () => {
    const session = new FakeStorage();
    const local = new FakeStorage();
    expect(writeAutosavePreference(local, "off")).toEqual({ status: "saved" });
    const port = letterPort(session, { honorAutosave: true, prefHandle: local });
    expect(port.write("x")).toBe("off");
    expect(session.calls, "선호를 포트의 핸들에서 읽으면 안 된다").toEqual([]);
    expect(writeAutosavePreference(local, "on")).toEqual({ status: "saved" });
    expect(port.write("x")).toBe("saved");
    expect(session.data.get(KEY)).toBe("x");
    expect(local.data.has(KEY), "값을 선호 핸들에 쓰면 안 된다").toBe(false);
  });

  it("포트의 핸들에 꺼짐이 적혀 있어도 prefHandle 가 켜짐이면 prefHandle 를 따른다", () => {
    const session = autosaveOff();
    const local = new FakeStorage();
    expect(letterPort(session, { honorAutosave: true, prefHandle: local }).write("x")).toBe("saved");
    expect(session.data.get(KEY)).toBe("x");
  });

  it("prefHandle 가 null 이면 선호를 읽을 곳이 없어 쓰지 않고 unavailable 이다(honorAutosave 가 거짓이면 쓴다)", () => {
    const storage = new FakeStorage();
    expect(letterPort(storage, { honorAutosave: true, prefHandle: null }).write("x")).toBe("unavailable");
    expect(storage.calls).toEqual([]);
    expect(letterPort(storage, { honorAutosave: false, prefHandle: null }).write("x")).toBe("saved");
    expect(storage.data.get(KEY)).toBe("x");
  });
});

describe("createExtraPort: 모르는 이름", () => {
  it("타입을 우회한 이름(없는 이름, 객체 안에 원래 있는 이름)도 저장소를 건드리지 않고 쓸 수 없다고 답한다", () => {
    for (const name of ["nope", "toString", "constructor", "__proto__", "hasOwnProperty", ""]) {
      const storage = new FakeStorage();
      const port = createExtraPort(storage, name as ExtraKey, { honorAutosave: true });
      expect(port.read(), name).toEqual({ ok: false });
      expect(port.write("x"), name).toBe("unavailable");
      expect(port.remove(), name).toBe(false);
      expect(storage.calls, name).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 자동 저장 끄기와 글자 고르기 키
// ---------------------------------------------------------------------------

describe("writeAutosavePreference(off): 결과 보기 전에 고른 글자도 함께 지운다", () => {
  it("끄기는 기존 세 키에 더해 글자 고르기 키를 지우고 다른 키는 남긴다", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.progressKey, "progress");
    storage.data.set(V40_STORAGE.historyKey, "history");
    storage.data.set(V40_STORAGE.legacyV31ProgressKey, "legacy");
    storage.data.set(KEY, "letter");
    storage.data.set("hanbang:wedding-code:comparison:v1", "kept-by-client");
    storage.data.set("unrelated", "kept");
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    expect([...storage.data.keys()].sort()).toEqual(["hanbang:wedding-code:comparison:v1", V40_STORAGE.autosaveKey, "unrelated"].sort());
    expect(readAutosavePreference(storage)).toBe("off");
  });

  it("켜기는 선호만 쓰고 글자 고르기 값을 지우지 않는다", () => {
    const storage = new FakeStorage();
    storage.data.set(KEY, "letter");
    expect(writeAutosavePreference(storage, "on")).toEqual({ status: "saved" });
    expect(storage.data.get(KEY)).toBe("letter");
    expect(storage.calls.filter((call) => call.endsWith(`:${KEY}`))).toEqual([]);
  });

  it("글자 고르기 키 하나만 못 지워도 saved 라고 말하지 않는다", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.progressKey, "progress");
    storage.data.set(KEY, "letter");
    storage.failRemoveKey = KEY;
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "unavailable" });
    expect(storage.data.get(KEY)).toBe("letter");
    // 나머지는 그대로 지운다.
    expect(storage.data.has(V40_STORAGE.progressKey)).toBe(false);
  });

  it("지운 뒤에 선호를 쓴다(가득 찬 저장소에서 글자 고르기 값이 차지한 자리로 선호가 들어간다)", () => {
    const storage = new FakeStorage();
    storage.data.set(KEY, "x".repeat(100));
    storage.quota = 101;
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    expect(readAutosavePreference(storage)).toBe("off");
    expect(storage.calls.indexOf(`remove:${KEY}`)).toBeGreaterThanOrEqual(0);
    expect(storage.calls.indexOf(`remove:${KEY}`)).toBeLessThan(storage.calls.indexOf(`set:${V40_STORAGE.autosaveKey}`));
  });

  it("모르는 선호 값은 아무것도 만지지 않는다", () => {
    const storage = new FakeStorage();
    storage.data.set(KEY, "letter");
    expect(writeAutosavePreference(storage, "maybe" as "on")).toEqual({ status: "unavailable" });
    expect(storage.calls).toEqual([]);
    expect(storage.data.get(KEY)).toBe("letter");
  });

  it("끈 뒤에는 포트가 쓰지 않고, 끈 순간 남아 있던 값은 이미 지워져 있다", () => {
    const storage = new FakeStorage();
    const port = letterPort(storage);
    expect(port.write("before")).toBe("saved");
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    expect(port.read()).toEqual({ ok: true, raw: null });
    expect(port.write("after")).toBe("off");
    expect(port.read()).toEqual({ ok: true, raw: null });
  });
});

describe("기존 지우기 함수는 글자 고르기 키를 건드리지 않는다(클라이언트가 포트의 remove 를 따로 부른다)", () => {
  it("clearProgress, clearHistory, purgeExpired 는 글자 고르기 값을 읽지도 지우지도 않는다", () => {
    const storage = new FakeStorage();
    storage.data.set(KEY, "kept");
    const source = V40_FIXTURES.find((entry) => entry.name === "swua-example");
    if (source === undefined) throw new Error("없는 표본: swua-example");
    // 기간이 지난 진행 저장을 심어서 purgeExpired 가 실제로 무언가를 지우게 한다.
    const old = NOW - 31 * DAY;
    const snapshot = { formBit: source.formBit, responses: source.responses, screen: "result" as const, cursor: 0, skippedReviewDone: false };
    expect(writeProgress(storage, bank, snapshot, null, old).status).toBe("saved");
    expect(purgeExpired(storage, bank, NOW).progress).toBe(true);
    expect(clearProgress(storage)).toEqual({ status: "cleared" });
    expect(clearHistory(storage)).toEqual({ status: "cleared" });
    expect(storage.data.get(KEY)).toBe("kept");
    expect(storage.calls.filter((call) => call.endsWith(`:${KEY}`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 계약과 소스 경계
// ---------------------------------------------------------------------------

describe("계약: 포트는 storageModule 밖의 일반 내보내기다", () => {
  it("storageModule 은 계약의 열세 개 그대로이고 포트 함수를 담지 않는다", () => {
    expect(typeof createExtraPort).toBe("function");
    const names = Object.keys(storageModule);
    expect(names).toHaveLength(13);
    expect(names.filter((name) => /extra/iu.test(name))).toEqual([]);
    expect(Object.values(storageModule)).not.toContain(createExtraPort);
  });
});

describe("소스 경계", () => {
  const source = readFileSync(resolve(__dirname, "storage.ts"), "utf8");
  const file = ts.createSourceFile("storage.ts", source, ts.ScriptTarget.Latest, true);
  const portFunction = file.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "createExtraPort");

  it("createExtraPort 는 일반 내보내기 함수다", () => {
    expect(portFunction).toBeDefined();
    expect((portFunction?.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
  });

  it("포트 함수 안에는 저장소 이름도 저장소 메서드 호출도 없다(핸들은 이 파일의 도우미로만 만진다)", () => {
    const names = new Set(["localStorage", "sessionStorage", "indexedDB"]);
    const methods = new Set(["getItem", "setItem", "removeItem", "clear"]);
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && names.has(node.text)) found.push(`이름 ${node.text}`);
      if (ts.isPropertyAccessExpression(node) && methods.has(node.name.text)) found.push(`메서드 ${node.name.text}`);
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && methods.has(node.argumentExpression.text)) found.push(`메서드 ${node.argumentExpression.text}`);
      ts.forEachChild(node, visit);
    };
    if (portFunction !== undefined) visit(portFunction);
    expect(found).toEqual([]);
  });

  it("글자 고르기 키는 storage.ts 와 상수 파일과 시험 파일 밖에서 쓰지 않는다(소스 가드 규칙 5 가 같은 키를 알기 전까지의 울타리)", () => {
    const webSrc = resolve(__dirname, "../../..");
    const roots = ["lib/weddingCode/v40", "components/wedding-code/v40", "app/wedding-code"].map((dir) => join(webSrc, dir));
    const files: string[] = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(?:ts|tsx)$/u.test(entry.name) && !/\.test\.(?:ts|tsx)$/u.test(entry.name)) files.push(full);
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const full of files) {
      if (full === resolve(__dirname, "storage.ts")) continue;
      const parsed = ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === "letterGuessKey") offenders.push(full.slice(webSrc.length + 1).replace(/\\/gu, "/"));
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 실제 브라우저 저장소(jsdom)
// ---------------------------------------------------------------------------

describe("브라우저 저장소 핸들과 함께 쓰기", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("browserStorage() 핸들로 만든 포트가 실제 저장소에 쓰고 읽고 지우며, 끄기가 그 값을 지운다", () => {
    const handle = browserStorage();
    expect(handle).not.toBeNull();
    if (handle === null) return;
    const port = letterPort(handle);
    expect(port.write("picked")).toBe("saved");
    expect(window.localStorage.getItem(KEY)).toBe("picked");
    expect(port.read()).toEqual({ ok: true, raw: "picked" });
    expect(writeAutosavePreference(handle, "off")).toEqual({ status: "saved" });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(port.write("again")).toBe("off");
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(writeAutosavePreference(handle, "on")).toEqual({ status: "saved" });
    expect(port.write("again")).toBe("saved");
    expect(port.remove()).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("저장소가 막힌 브라우저(루트 스니펫이 메모리 객체로 갈아 끼움)에서는 핸들이 null 이라 포트가 저장했다고 말하지 않는다", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    const originalSession = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      new Function(BROWSER_STORAGE_FALLBACK_SNIPPET)();
      const handle = browserStorage();
      expect(handle).toBeNull();
      const port = letterPort(handle);
      expect(port.write("picked")).toBe("unavailable");
      expect(port.read()).toEqual({ ok: false });
      expect(port.remove()).toBe(false);
    } finally {
      setItem.mockRestore();
      if (original) Object.defineProperty(window, "localStorage", original);
      if (originalSession) Object.defineProperty(window, "sessionStorage", originalSession);
    }
    expect(browserStorage()).toBe(window.localStorage);
  });
});
