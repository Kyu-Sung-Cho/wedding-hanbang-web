// @vitest-environment node

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { V40_STORAGE } from "@/constants/weddingCodeV40";
import PrivacyPage from "../page";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import {
  appendHistory,
  createExtraPort,
  readAutosavePreference,
  readHistory,
  readProgress,
  writeAutosavePreference,
  writeProgress,
} from "@/lib/weddingCode/v40/storage";
import { loadLetterGuess, saveLetterGuess } from "@/lib/weddingCode/v40/letterGuess/letterGuess";
import type { LetterGuess } from "@/lib/weddingCode/v40/letterGuess/letterGuess";
import type { HistoryEntry, ProgressSnapshot, StorageLike } from "@/lib/weddingCode/v40/types";

/**
 * 처리방침 v4 문단이 저장에 관해 하는 약속을 **실제 storage.ts** 로 확인한다.
 *
 * weddingCodeResearchNotice.test.tsx 는 방침 문장이 상수와 화면 문구에 맞는지만 본다. 「이후 저장을 멈추며」
 * 「읽어도 기간이 늘지 않으며」 같은 말이 코드에서 참인지는 여기서 본다. 저장 모듈의 세부 동작(봉투 모양, 만료 경계,
 * 충돌, 던지는 저장소)은 lib/weddingCode/v40/storage.test.ts 가 자세히 본다. 이 파일은 방침 문장에 묶인 것만 둔다.
 * 방침이 저장 약속을 바꾸면 이 파일도 함께 바꾸고, 이 파일이 빨개지면 방침이 거짓이 된다는 뜻이다.
 */

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const bank = WEDDING_CODE_V40_BANK;

/** 던지지 않는 가짜 저장소. 쓰기와 지우기 호출을 센다. */
class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  writeCalls = 0;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writeCalls += 1;
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.writeCalls += 1;
    this.data.delete(key);
  }

  keys(): string[] {
    return [...this.data.keys()].sort();
  }
}

const SNAPSHOT: ProgressSnapshot = { formBit: 0, responses: {}, screen: "questions", cursor: 0, skippedReviewDone: false };

function historyEntry(at: number): HistoryEntry {
  return {
    at,
    formBit: 0,
    axes: [
      { letter: "V", band: "clear", provisional: false },
      { letter: "W", band: "lean", provisional: false },
      { letter: "F", band: "even", provisional: false },
      { letter: "A", band: "lean", provisional: false },
    ],
  } as unknown as HistoryEntry;
}

/**
 * 아래 동작 시험이 확인하는 약속이 **방침에 아직 적혀 있는가**. 방침이 그 문장을 지우거나 바꾸면 이 시험이 빨개져서, 더 이상
 * 약속하지 않는 동작을 계속 지키는 죽은 시험이 남지 않게 하고, 방침이 저장 약속을 바꿀 때 이 파일을 함께 고치게 한다.
 * (반대 방향, 방침에 새 저장 약속이 생기는 것은 weddingCodeResearchNotice.test.tsx 의 문장 고정이 잡는다.)
 */
const PROMISES_TESTED_BELOW = [
  "30일 동안 이어서 이용할 수 있고",
  "읽거나 재방문만 해서는 기간이 늘어나지 않으며",
  "읽어도 보관 기간이 늘거나 저장된 내용이 바뀌지 않습니다",
  "폼 비트를 최근 세 번까지 함께 보관하며",
  "이 기록에는 답을 넣지 않고",
  "이전 판(v3.1)의 저장된 답도 지우며",
  "꺼짐 설정만 브라우저에 남깁니다",
  "이후 저장을 멈추며",
  // 4.1 단계 2(결과 전 글자 고르기)가 더한 약속. 아래 「먼저 고른 글자」 시험이 실제 storage.ts 와 letterGuess 모듈로 확인한다.
  "자동저장이 켜져 있을 때만 이 브라우저에 30일 동안 보관하고",
  "이 브라우저에 보관한 먼저 고른 글자도 지우며",
  "화면에 열려 있는 먼저 고른 글자는 새로고침하기 전까지 남아 있습니다",
] as const;

describe("처리방침 v4 문단이 저장에 관해 하는 약속", () => {
  it("이 파일이 확인하는 약속이 방침에 그대로 적혀 있다", () => {
    const text = renderToStaticMarkup(createElement(PrivacyPage)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const start = text.indexOf("웨딩코드(v4.0-tendency·v4.1-depth·v4.2-depth) 이어하기·링크 보내기:");
    expect(start, "v4 문단을 못 찾았다. 이 검사가 헛돈다").toBeGreaterThan(-1);
    const paragraph = text.slice(start, text.indexOf("지워 주세요.", start) + "지워 주세요.".length);
    for (const promise of PROMISES_TESTED_BELOW) {
      expect(paragraph, `방침에서 「${promise}」 가 사라졌다. 그 약속을 확인하던 아래 시험도 함께 고칠 것`).toContain(promise);
    }
  });
});

describe("처리방침 v4 문단의 저장 약속이 storage.ts 에서 참이다", () => {
  it("기간은 마지막으로 실제 저장한 때부터 30일이다 (방침의 「30일 동안 이어서」)", () => {
    expect(V40_STORAGE.ttlMs).toBe(30 * DAY);
    const storage = new FakeStorage();
    expect(writeProgress(storage, bank, SNAPSHOT, null, NOW).status).toBe("saved");
    expect(readProgress(storage, bank, NOW + 30 * DAY - 1).status).toBe("ready");
    expect(readProgress(storage, bank, NOW + 30 * DAY).status).toBe("expired");
    // 기한이 지난 답은 불러오지 않는다 (방침의 「기한이 지난 답은 불러오지 않습니다」).
    expect(readProgress(storage, bank, NOW + 30 * DAY)).not.toHaveProperty("snapshot");
  });

  it("기간은 처음 저장한 때가 아니라 마지막으로 저장한 때부터 다시 센다 (방침의 「마지막으로 답이나 진행을 저장한 때부터」)", () => {
    const storage = new FakeStorage();
    const first = writeProgress(storage, bank, SNAPSHOT, null, NOW);
    expect(first.status).toBe("saved");
    const firstRaw = first.status === "saved" ? first.raw : null;
    expect(writeProgress(storage, bank, { ...SNAPSHOT, cursor: 1 }, firstRaw, NOW + 20 * DAY).status).toBe("saved");
    // 처음 저장한 때부터 세면 30일째에 이미 지난 것이다.
    expect(readProgress(storage, bank, NOW + 30 * DAY).status).toBe("ready");
    expect(readProgress(storage, bank, NOW + 50 * DAY - 1).status).toBe("ready");
    expect(readProgress(storage, bank, NOW + 50 * DAY).status).toBe("expired");
  });

  it("읽기는 아무것도 쓰지 않는다: 저장 기간이 늘지 않고 저장된 내용이 바뀌지 않는다 (방침의 「읽거나 재방문만 해서는」과 「읽어도 … 바뀌지 않습니다」)", () => {
    const storage = new FakeStorage();
    expect(writeProgress(storage, bank, SNAPSHOT, null, NOW).status).toBe("saved");
    expect(appendHistory(storage, historyEntry(NOW - 20 * DAY), NOW).status).toBe("saved");
    expect(appendHistory(storage, historyEntry(NOW - DAY), NOW).status).toBe("saved");
    const before = JSON.stringify([...storage.data.entries()]);
    const writesBefore = storage.writeCalls;
    // 두 사람 결과 링크가 「나」 표시를 위해 하는 읽기와 같은 호출들.
    readProgress(storage, bank, NOW + 10 * DAY);
    readProgress(storage, bank, NOW + 40 * DAY);
    readHistory(storage, NOW + 10 * DAY);
    // 기록 일부만 기간이 지났을 때와 모두 지났을 때도 읽기는 저장소에서 아무것도 덜어 내지 않는다(기간이 지난 것을 지우는 일은 purgeExpired 몫이다).
    expect(readHistory(storage, NOW + 15 * DAY).entries).toHaveLength(1);
    expect(readHistory(storage, NOW + 40 * DAY).status).toBe("expired");
    readAutosavePreference(storage);
    expect(storage.writeCalls, "읽기가 저장소에 썼다").toBe(writesBefore);
    expect(JSON.stringify([...storage.data.entries()])).toBe(before);
    // 10일 뒤에 읽었어도 기간은 처음 저장한 때부터다.
    expect(readProgress(storage, bank, NOW + 30 * DAY).status).toBe("expired");
  });

  it("비교 기록은 최근 세 번까지이고 답이 들어 있지 않다 (방침의 「최근 세 번」과 「이 기록에는 답을 넣지 않고」)", () => {
    expect(V40_STORAGE.historyMax).toBe(3);
    const storage = new FakeStorage();
    for (let index = 5; index >= 1; index -= 1) expect(appendHistory(storage, historyEntry(NOW - index * DAY), NOW).status).toBe("saved");
    const read = readHistory(storage, NOW);
    expect(read.entries).toHaveLength(3);
    const stored = JSON.parse(storage.data.get(V40_STORAGE.historyKey) ?? "null") as { entries: Record<string, unknown>[] };
    for (const item of stored.entries) expect(Object.keys(item).sort()).toEqual(["at", "axes", "formBit"]);
    expect(storage.data.get(V40_STORAGE.historyKey)).not.toMatch(/responses|answers/u);
  });

  it("답이 딸린 기록을 넘겨도 답은 저장되지 않는다 (방침의 「이 기록에는 답을 넣지 않고」)", () => {
    const storage = new FakeStorage();
    const withAnswers = { ...historyEntry(NOW - DAY), responses: { "money.limit.1": "3" }, answers: "3333" } as unknown as HistoryEntry;
    appendHistory(storage, withAnswers, NOW);
    expect(storage.data.get(V40_STORAGE.historyKey) ?? "").not.toMatch(/responses|answers|money\.limit/u);
    // 정상 기록은 저장된다(위 검사가 저장 자체를 막아 놓고 통과하는 것이 아니다).
    expect(appendHistory(storage, historyEntry(NOW - DAY), NOW).status).toBe("saved");
    expect(readHistory(storage, NOW).entries).toHaveLength(1);
  });

  it("자동 저장을 끄면 저장된 답, 비교 기록, 이전 판의 저장된 답을 지우고 꺼짐 설정만 남는다 (방침의 「꺼짐 설정만 브라우저에 남깁니다」)", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.legacyV31ProgressKey, "{}");
    expect(writeProgress(storage, bank, SNAPSHOT, null, NOW).status).toBe("saved");
    expect(appendHistory(storage, historyEntry(NOW - DAY), NOW).status).toBe("saved");
    expect(storage.keys()).toEqual([V40_STORAGE.historyKey, V40_STORAGE.legacyV31ProgressKey, V40_STORAGE.progressKey].sort());
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    expect(storage.keys()).toEqual([V40_STORAGE.autosaveKey]);
    expect(readAutosavePreference(storage)).toBe("off");
  });

  /**
   * 방침은 「이후 저장을 멈추며 꺼짐 설정만 브라우저에 남깁니다」라고 약속한다. storage.ts 의 writeProgress 와 appendHistory 는
   * 선호가 off 이면 아무것도 쓰지 않고 unavailable 로 답하므로(2026-09-30 적대적 검토 뒤 고침), 화면이 선호 확인을 빠뜨려도 약속이 지켜진다.
   * 이 자리에는 예전에 「알려진 빈틈」 표시(it.fails)가 있었고 고친 뒤에 지웠다.
   */
  it("자동 저장을 끈 뒤에는 진행 저장과 비교 기록을 쓰지 않는다 (방침의 「이후 저장을 멈추며」)", () => {
    const storage = new FakeStorage();
    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    writeProgress(storage, bank, SNAPSHOT, null, NOW);
    appendHistory(storage, historyEntry(NOW - DAY), NOW);
    expect(storage.keys(), "끈 뒤에 저장소에 남은 키").toEqual([V40_STORAGE.autosaveKey]);
  });
});

/**
 * 4.1 단계 2: 방침이 결과 전 글자 고르기(「먼저 고른 글자」)에 하는 약속을 실제 storage.ts 와 letterGuess 모듈로 확인한다.
 * 포트는 클라이언트가 쓰는 것과 같은 createExtraPort(honorAutosave 참)다. 서로 짐작하기는 저장하지 않으므로 여기에 확인할 저장 약속이 없다
 * (링크로 가는 것은 guess 폴더의 시험과 소스 가드 규칙 5, 11 이 본다).
 */
describe("처리방침 v4 문단의 먼저 고른 글자 약속이 storage.ts 에서 참이다", () => {
  const GUESS: LetterGuess = ["V", null, "U", "A"];
  const newPort = (storage: StorageLike) => createExtraPort(storage, "letterGuess", { honorAutosave: true });

  it("자동 저장이 켜져 있으면 이 브라우저(local)에 쓰고, 기간은 마지막으로 저장한 때부터 30일이며, 읽기는 쓰지 않아 기간을 늘리지 않는다 (방침의 「30일 동안 보관하고」)", () => {
    const storage = new FakeStorage();
    const port = newPort(storage);
    expect(saveLetterGuess(port, GUESS, 0, NOW)).toBe("saved");
    expect(storage.keys()).toEqual([V40_STORAGE.letterGuessKey]);
    expect(V40_STORAGE.ttlMs).toBe(30 * DAY);

    const before = JSON.stringify([...storage.data.entries()]);
    const writesBefore = storage.writeCalls;
    expect(loadLetterGuess(port, NOW + 10 * DAY).status).toBe("ready");
    expect(loadLetterGuess(port, NOW + 30 * DAY - 1).status).toBe("ready");
    expect(storage.writeCalls, "읽기가 저장소에 썼다").toBe(writesBefore);
    expect(JSON.stringify([...storage.data.entries()])).toBe(before);
    // 10일째와 29일째에 읽었어도 기간은 저장한 때부터다.
    expect(loadLetterGuess(port, NOW + 30 * DAY).status).toBe("expired");
    expect(loadLetterGuess(port, NOW + 30 * DAY)).not.toHaveProperty("guess");
  });

  it("보관하는 것은 고른 글자뿐이다: 고른 것이 없으면 쓰지 않고, 답과 링크 코드는 들어가지 않는다 (방침의 「고른 글자는 … 보관하고」)", () => {
    const storage = new FakeStorage();
    const port = newPort(storage);
    expect(saveLetterGuess(port, [null, null, null, null], 0, NOW)).toBe("cleared");
    expect(storage.keys()).toEqual([]);
    expect(saveLetterGuess(port, GUESS, 1, NOW)).toBe("saved");
    const raw = storage.data.get(V40_STORAGE.letterGuessKey) ?? "";
    const stored = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["formBit", "guess", "savedAt", "schema", "version"]);
    expect(stored.guess).toBe("V-UA");
    expect(raw).not.toMatch(/responses|answers|[?&#]a=/u);
  });

  it("자동 저장을 끄면 먼저 고른 글자의 보관본도 지우고 꺼짐 설정만 남으며, 끈 뒤에는 쓰지 않는다 (방침의 「먼저 고른 글자도 지우며」와 「이후 저장을 멈추며」)", () => {
    const storage = new FakeStorage();
    storage.data.set(V40_STORAGE.legacyV31ProgressKey, "{}");
    const port = newPort(storage);
    expect(writeProgress(storage, bank, SNAPSHOT, null, NOW).status).toBe("saved");
    expect(appendHistory(storage, historyEntry(NOW - DAY), NOW).status).toBe("saved");
    expect(saveLetterGuess(port, GUESS, 0, NOW)).toBe("saved");
    expect(storage.keys()).toEqual([V40_STORAGE.historyKey, V40_STORAGE.legacyV31ProgressKey, V40_STORAGE.letterGuessKey, V40_STORAGE.progressKey].sort());

    expect(writeAutosavePreference(storage, "off")).toEqual({ status: "saved" });
    expect(storage.keys(), "끈 뒤에 저장소에 남은 키").toEqual([V40_STORAGE.autosaveKey]);
    expect(readAutosavePreference(storage)).toBe("off");

    // 끈 뒤에는 포트가 쓰지 않는다(화면이 선호 확인을 빠뜨려도 약속이 지켜진다).
    expect(saveLetterGuess(port, GUESS, 0, NOW)).toBe("off");
    expect(storage.keys()).toEqual([V40_STORAGE.autosaveKey]);
  });

  it("저장소를 쓸 수 없으면(null 핸들) 아무것도 쓰지 않고 쓸 수 없다고 답한다 (방침의 「자동저장이 켜져 있을 때만」)", () => {
    const port = createExtraPort(null, "letterGuess", { honorAutosave: true });
    expect(saveLetterGuess(port, GUESS, 0, NOW)).toBe("unavailable");
    expect(loadLetterGuess(port, NOW)).toEqual({ status: "unavailable" });
  });
});
