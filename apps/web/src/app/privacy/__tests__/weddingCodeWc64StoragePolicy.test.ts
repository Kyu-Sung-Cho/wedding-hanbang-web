// @vitest-environment node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "../page";
import { WC64_ITEMS } from "@/lib/weddingCode/wc64/bank";
import {
  clearWc64Draft,
  createWc64Draft,
  readWc64Autosave,
  readWc64Draft,
  setWc64Autosave,
  writeWc64Draft,
} from "@/lib/weddingCode/wc64/io";
import { decodeWc64PairCode, encodeWc64PairCode } from "@/lib/weddingCode/wc64/pairCode";
import {
  WC64_AUTOSAVE_KEY,
  WC64_RETENTION_MS,
  WC64_STORAGE_KEY,
  WC64_VERSION,
  type Wc64Answers,
} from "@/lib/weddingCode/wc64/types";

/**
 * 처리방침의 64문항(wc64) 문단이 하는 약속을 **실제 io.ts·pairCode.ts** 로 확인한다. 선례는 weddingCodeV40StoragePolicy.test.ts 다.
 * 방침이 저장·전송 약속을 바꾸면 이 파일도 함께 바꾸고, 이 파일이 빨개지면 방침이 거짓이 된다는 뜻이다.
 * 계약 정본: docs/wedding-code/2026-10-16_wc64_report_contract.md 6·7절.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 16, 3, 0, 0);
const LABEL = `64문항 웨딩코드(${WC64_VERSION}) 이어하기·답 코드:`;
const CLOSING = "공용 기기에서는 자동저장을 끄거나 이 브라우저의 답을 지워 주세요.";

/** 아래 시험이 확인하는 약속. 방침에서 사라지면 첫 시험이 빨개진다. */
const PROMISES = [
  "고른 답과 식 계획 답은 이 브라우저에만 보관하고 서버로 보내지 않습니다",
  "마지막으로 저장한 때부터 30일 동안만 불러오며",
  "읽거나 다시 방문하는 것만으로 기간을 늘리지 않습니다",
  "기한이 지난 기록은 불러오지 않지만 지우거나 새 답으로 덮어쓰기 전까지 브라우저 저장소에 남을 수 있습니다",
  "자동저장은 처음에는 켜져 있고",
  "‘이 브라우저에 내 답 자동 저장’을 끄거나 ‘답 지우기’ 또는 ‘이 브라우저의 답 지우기’를 누르면 저장된 답을 바로 지웁니다",
  "끈 뒤에는 저장하지 않고 꺼짐 설정만 브라우저에 남깁니다",
  "계정·아모라·연구·이용 통계로 보내지 않으며 주소에도 담지 않습니다",
  "결과 화면의 답 코드에는 본인의 답과 식 계획 답이 담기고, 직접 복사해 보낸 경우에만 받은 사람이 볼 수 있습니다",
  "상대에게 받은 답 코드는 화면에만 두고 이 브라우저에 저장하지 않습니다",
] as const;

function wc64Paragraph(): string {
  const text = renderToStaticMarkup(createElement(PrivacyPage)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const start = text.indexOf(LABEL);
  expect(start, "64문항 문단을 못 찾았다. 이 검사가 헛돈다").toBeGreaterThan(-1);
  const end = text.indexOf(CLOSING, start);
  expect(end, "64문항 문단의 끝 문장을 못 찾았다").toBeGreaterThan(start);
  return text.slice(start, end + CLOSING.length);
}

/** 던지지 않는 가짜 저장소. 쓰기와 지우기 호출을 센다. */
class FakeStorage {
  readonly data = new Map<string, string>();
  writeCalls = 0;
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  setItem(key: string, value: string): void { this.writeCalls += 1; this.data.set(key, value) }
  removeItem(key: string): void { this.writeCalls += 1; this.data.delete(key) }
  keys(): string[] { return [...this.data.keys()].sort() }
}

function draftAt(at: number, answers: Wc64Answers = { [WC64_ITEMS[0].id]: 4 }) {
  return { ...createWc64Draft(at), plan: "yes" as const, answers, screen: "questions" as const };
}

describe("처리방침 64문항 문단", () => {
  it("이 파일이 확인하는 약속이 방침에 그대로 적혀 있다", () => {
    const paragraph = wc64Paragraph();
    for (const promise of PROMISES) {
      expect(paragraph, `방침에서 「${promise}」 가 사라졌다. 그 약속을 확인하던 아래 시험도 함께 고칠 것`).toContain(promise);
    }
  });

  it("방침의 날짜 수가 WC64_RETENTION_MS 와 같고 그 값은 30일이다", () => {
    expect(WC64_RETENTION_MS).toBe(30 * DAY);
    expect(wc64Paragraph()).toContain(`${WC64_RETENTION_MS / DAY}일 동안만 불러오며`);
  });

  it("문단은 화면에 쓰지 않는 말과 링크 표현을 쓰지 않는다", () => {
    const paragraph = wc64Paragraph();
    expect(paragraph).not.toMatch(/MBTI|검증된|정확|과학적|진단|궁합|예측|확률/);
    // wc64 는 주소에 답을 담지 않으므로 링크·# 뒤를 말하면 거짓이다.
    expect(paragraph).not.toMatch(/링크|# 뒤/);
  });
});

describe("방침의 저장 약속이 io.ts 에서 참이다", () => {
  it("저장 키는 둘이고 둘 다 이 판 이름 아래에 있다", () => {
    expect(WC64_STORAGE_KEY).toBe("hanbang:wedding-code:wc64:r1:draft");
    expect(WC64_AUTOSAVE_KEY).toBe(`${WC64_STORAGE_KEY}:autosave`);
    const storage = new FakeStorage();
    expect(writeWc64Draft(storage, draftAt(NOW))).toBe(true);
    expect(setWc64Autosave(storage, true)).toBe(true);
    expect(storage.keys()).toEqual([WC64_STORAGE_KEY, WC64_AUTOSAVE_KEY].sort());
  });

  it("마지막으로 저장한 때부터 30일 동안만 불러온다 (방침의 「30일 동안만 불러오며」)", () => {
    const storage = new FakeStorage();
    expect(writeWc64Draft(storage, draftAt(NOW))).toBe(true);
    expect(readWc64Draft(storage, NOW + 30 * DAY - 1)?.answers).toEqual({ [WC64_ITEMS[0].id]: 4 });
    expect(readWc64Draft(storage, NOW + 30 * DAY)).toBeNull();
  });

  it("기간은 처음이 아니라 마지막 저장부터 다시 센다", () => {
    const storage = new FakeStorage();
    expect(writeWc64Draft(storage, draftAt(NOW))).toBe(true);
    expect(writeWc64Draft(storage, draftAt(NOW + 20 * DAY))).toBe(true);
    expect(readWc64Draft(storage, NOW + 30 * DAY)).not.toBeNull();
    expect(readWc64Draft(storage, NOW + 50 * DAY - 1)).not.toBeNull();
    expect(readWc64Draft(storage, NOW + 50 * DAY)).toBeNull();
  });

  it("읽기는 아무것도 쓰지 않는다 (방침의 「읽거나 다시 방문하는 것만으로 기간을 늘리지 않습니다」와 「브라우저 저장소에 남을 수 있습니다」)", () => {
    const storage = new FakeStorage();
    expect(writeWc64Draft(storage, draftAt(NOW))).toBe(true);
    const before = JSON.stringify([...storage.data.entries()]);
    const writes = storage.writeCalls;
    readWc64Draft(storage, NOW + 10 * DAY);
    readWc64Draft(storage, NOW + 40 * DAY);
    readWc64Autosave(storage);
    expect(storage.writeCalls, "읽기가 저장소에 썼다").toBe(writes);
    expect(JSON.stringify([...storage.data.entries()])).toBe(before);
    // 10일 뒤에 읽었어도 기간은 처음 저장한 때부터다.
    expect(readWc64Draft(storage, NOW + 30 * DAY)).toBeNull();
    // 기한이 지난 기록은 불러오지 않을 뿐 저장소에는 남아 있다(방침이 그렇게 말한다).
    expect(storage.data.has(WC64_STORAGE_KEY)).toBe(true);
  });

  it("자동저장은 따로 끈 적이 없으면 켜져 있다 (방침의 「처음에는 켜져 있고」)", () => {
    const storage = new FakeStorage();
    expect(readWc64Autosave(storage)).toBe(true);
    expect(writeWc64Draft(storage, draftAt(NOW))).toBe(true);
  });

  it("자동저장을 끄면 저장된 답을 바로 지우고 그 뒤로는 쓰지 않으며 꺼짐 설정만 남는다", () => {
    const storage = new FakeStorage();
    expect(writeWc64Draft(storage, draftAt(NOW))).toBe(true);
    expect(setWc64Autosave(storage, false)).toBe(true);
    expect(storage.keys()).toEqual([WC64_AUTOSAVE_KEY]);
    expect(writeWc64Draft(storage, draftAt(NOW + DAY))).toBe(false);
    expect(storage.keys()).toEqual([WC64_AUTOSAVE_KEY]);
  });

  it("‘답 지우기’와 ‘이 브라우저의 답 지우기’가 부르는 clearWc64Draft 는 저장된 답을 지운다", () => {
    const storage = new FakeStorage();
    expect(writeWc64Draft(storage, draftAt(NOW))).toBe(true);
    expect(clearWc64Draft(storage)).toBe(true);
    expect(storage.data.has(WC64_STORAGE_KEY)).toBe(false);
    expect(readWc64Draft(storage, NOW)).toBeNull();
  });
});

describe("방침의 답 코드 약속이 pairCode.ts 에서 참이다", () => {
  it("답 코드에는 본인의 답과 식 계획 답이 담긴다 (받은 사람이 답 전체를 읽을 수 있다)", () => {
    const answers: Wc64Answers = {};
    WC64_ITEMS.forEach((it, i) => { answers[it.id] = ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5 });
    const code = encodeWc64PairCode(answers, "maybe");
    const decoded = decodeWc64PairCode(code);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.plan).toBe("maybe");
    expect(decoded.answers).toEqual(answers);
  });

  it("답 코드를 만들고 읽는 일은 저장소와 주소를 건드리지 않는다", () => {
    const source = stripComments(readFileSync(path.join(WC64_LIB, "pairCode.ts"), "utf8"));
    expect(source).not.toMatch(/localStorage|sessionStorage|location|history\.|fetch\(|sendBeacon/);
  });

  it("받은 답 코드는 이 브라우저에 저장하지 않는다 (방침의 「화면에만 두고」)", () => {
    const source = stripComments(readFileSync(path.join(WC64_UI, "Compare64.tsx"), "utf8"));
    expect(source).toMatch(/decodeWc64PairCode/);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|\bStorage\b|writeWc64Draft|from "@\/lib\/weddingCode\/wc64\/io"/);
  });
});

/* ---------------- 「서버로 보내지 않습니다」「주소에도 담지 않습니다」의 소스 경계 ---------------- */

const WEB_SRC = path.resolve(__dirname, "../../..");
const WC64_LIB = path.join(WEB_SRC, "lib/weddingCode/wc64");
const WC64_UI = path.join(WEB_SRC, "components/weddingCode64");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string): string[] {
  let names: string[];
  try { names = readdirSync(dir) } catch { return [] }
  return names.flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("wc64 소스에는 서버·이용 통계·주소로 가는 길이 없다", () => {
  const files = [...sourceFiles(WC64_LIB), ...sourceFiles(WC64_UI)];

  it("검사할 파일이 있다 (헛돌지 않는다)", () => {
    expect(files.map(f => path.basename(f))).toEqual(expect.arrayContaining(["io.ts", "pairCode.ts", "model.ts", "types.ts"]));
  });

  it("fetch·sendBeacon·XMLHttpRequest·WebSocket·이용 통계·Supabase·주소 해시·history 를 쓰지 않는다", () => {
    const banned: [string, RegExp][] = [
      ["fetch", /\bfetch\s*\(/],
      ["sendBeacon", /sendBeacon/],
      ["XMLHttpRequest", /XMLHttpRequest/],
      ["WebSocket", /WebSocket|EventSource/],
      ["이용 통계", /@\/lib\/analytics|posthog|captureWeddingCodeEvent|gtag\(/i],
      ["Supabase", /supabase/i],
      ["주소 해시", /location\.hash|hashchange/],
      ["history", /history\.(pushState|replaceState)/],
      ["서버 액션", /["']use server["']/],
    ];
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const [name, pattern] of banned) {
        expect(source, `${path.relative(WEB_SRC, file)} 에 ${name}`).not.toMatch(pattern);
      }
    }
  });

  it("브라우저 저장 키는 방침이 말한 이 판의 키뿐이다", () => {
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/["'`](hanbang:[^"'`$]*)/g)) {
        expect(match[1].startsWith(WC64_STORAGE_KEY), `${path.relative(WEB_SRC, file)} 의 저장 키 ${match[1]}`).toBe(true);
      }
    }
  });
});
