import { afterEach, describe, expect, it, vi } from "vitest";
import { buildResult } from "@/lib/weddingCode/v40/score";
import { readProgress } from "@/lib/weddingCode/v40/storage";
import type { Responses } from "@/lib/weddingCode/v40/types";
import { NOW, DAY, FakeStorage, bank, fixture, resultSnapshotOf, seedProgress } from "./WeddingCodeV40Client.testKit";
import {
  LINK_OPENED_STATE_KEY,
  answerCounts,
  decodedFromSnapshot,
  historyEntryOf,
  linkOpenedState,
  readLinkOpened,
  readOnlyStorage,
  sameHistoryResult,
  viewportPack,
  watchViewportPack,
} from "./WeddingCodeV40Client.model";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("읽기만 되는 저장소", () => {
  it("읽기는 그대로 돌려주고 쓰기와 지우기는 원래 저장소에 닿지 않는다", () => {
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(fixture("swua-example")), NOW - 40 * DAY);
    const before = JSON.stringify([...storage.data.entries()]);
    const logBefore = storage.log.length;
    const readable = readOnlyStorage(storage);

    expect(readProgress(readable, bank, NOW).status).toBe("expired");
    readable.setItem("아무 키", "아무 값");
    readable.removeItem("아무 키");
    expect(JSON.stringify([...storage.data.entries()])).toBe(before);
    expect(storage.log.slice(logBefore).every((entry) => entry.startsWith("get:"))).toBe(true);
  });

  it("원래 저장소의 읽기가 던지면 그대로 던진다(읽는 쪽이 unavailable 로 다룬다)", () => {
    const storage = new FakeStorage();
    storage.failGet = true;
    expect(readProgress(readOnlyStorage(storage), bank, NOW).status).toBe("unavailable");
  });
});

describe("지난번 비교 기록 한 건", () => {
  it("결과의 글자와 세기, 임시 여부, 폼 비트, 시각만 담고 답은 담지 않는다", () => {
    const sample = fixture("provisional-tie");
    const result = buildResult(bank, sample.formBit, sample.responses);
    const entry = historyEntryOf(result, NOW);
    expect(Object.keys(entry).sort()).toEqual(["at", "axes", "formBit"]);
    expect(entry.at).toBe(NOW);
    expect(entry.formBit).toBe(sample.formBit);
    expect(entry.axes).toHaveLength(4);
    for (const [index, axis] of entry.axes.entries()) {
      expect(Object.keys(axis).sort()).toEqual(["band", "letter", "provisional"]);
      expect(axis.letter).toBe(result.axes[index].letter);
      expect(axis.provisional).toBe(result.axes[index].provisional);
    }
    expect(entry.axes.some((axis) => axis.provisional)).toBe(true);
    expect(JSON.stringify(entry)).not.toMatch(/responses|answers/u);
  });

  it("글자를 못 정한 주제는 세기도 없다", () => {
    const sample = fixture("unusable-axis");
    const entry = historyEntryOf(buildResult(bank, sample.formBit, sample.responses), NOW);
    const unset = entry.axes.filter((axis) => axis.letter === null);
    expect(unset.length).toBeGreaterThan(0);
    for (const axis of unset) expect(axis.band).toBeNull();
  });

  it("시각만 다른 두 기록은 같은 결과이고, 글자나 폼 비트가 다르면 다른 결과이다", () => {
    const sample = fixture("swua-example");
    const result = buildResult(bank, sample.formBit, sample.responses);
    const a = historyEntryOf(result, NOW);
    expect(sameHistoryResult(a, historyEntryOf(result, NOW + DAY))).toBe(true);
    expect(sameHistoryResult(undefined, a)).toBe(false);
    const other = fixture("all-clear");
    expect(sameHistoryResult(a, historyEntryOf(buildResult(bank, other.formBit, other.responses), NOW))).toBe(false);
    expect(sameHistoryResult({ ...a, formBit: a.formBit === 0 ? 1 : 0 }, a)).toBe(false);
  });
});

describe("이용 통계로 보내는 개수", () => {
  it("답한 질문과 넘어간 질문(잘 모르겠어요, 제 상황과 안 맞아요)을 센다", () => {
    const sample = fixture("unusable-axis");
    const counts = answerCounts(bank, sample.responses);
    const skipped = Object.values(sample.responses).filter((value) => value === "skip" || value === "na").length;
    expect(counts.skipped).toBe(skipped);
    expect(counts.answered).toBe(68 - skipped);
  });

  it("답하지 않은 문항은 어느 쪽에도 세지 않는다", () => {
    const empty: Responses = {};
    expect(answerCounts(bank, empty)).toEqual({ answered: 0, skipped: 0 });
  });
});

describe("진행 저장을 두 사람 비교용 답으로", () => {
  it("폼 비트와 답을 그대로 옮긴다", () => {
    const sample = fixture("swua-example");
    expect(decodedFromSnapshot(resultSnapshotOf(sample))).toEqual({ formBit: sample.formBit, responses: sample.responses });
  });
});

describe("화면 크기에 맞는 묶음", () => {
  function stubMedia(matches: boolean) {
    const listeners: ((event: { matches: boolean }) => void)[] = [];
    const removed: unknown[] = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches,
        media: query,
        addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.push(listener),
        removeEventListener: (_type: string, listener: unknown) => removed.push(listener),
      }),
    });
    return { listeners, removed };
  }

  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("세로가 짧으면 문항 하나씩, 아니면 배치표대로이다", () => {
    stubMedia(true);
    expect(viewportPack()).toBe("single");
    stubMedia(false);
    expect(viewportPack()).toBe("screen");
  });

  it("화면 크기를 알 수 없으면 배치표대로 두고 알림을 걸지 않는다", () => {
    Reflect.deleteProperty(window, "matchMedia");
    expect(viewportPack()).toBe("screen");
    expect(() => watchViewportPack(() => undefined)()).not.toThrow();
  });

  it("크기가 바뀌면 알리고, 끊으면 더는 알리지 않는다", () => {
    const media = stubMedia(false);
    const seen: string[] = [];
    const stop = watchViewportPack((pack) => seen.push(pack));
    media.listeners[0]({ matches: true });
    media.listeners[0]({ matches: false });
    expect(seen).toEqual(["single", "screen"]);
    stop();
    expect(media.removed).toHaveLength(1);
  });
});

describe("받은 링크를 열었던 표시(브라우저 기록 칸)", () => {
  it("표시를 더하면서 라우터가 붙여 둔 기록 칸의 내용은 살리고, 다시 시작(null)이면 표시 없이 비운다", () => {
    const router = { __NA: true, tree: ["", {}] };
    expect(linkOpenedState(router, "partner")).toEqual({ ...router, [LINK_OPENED_STATE_KEY]: "partner" });
    expect(linkOpenedState(null, "both")).toEqual({ [LINK_OPENED_STATE_KEY]: "both" });
    expect(linkOpenedState("문자열", "partner")).toEqual({ [LINK_OPENED_STATE_KEY]: "partner" });
    expect(linkOpenedState(router, null)).toBeNull();
    // 받은 값을 바꾸지 않는다
    expect(router).toEqual({ __NA: true, tree: ["", {}] });
  });

  it("표시를 partner, both 만 읽고 그 밖의 값과 모양은 없는 것으로 본다", () => {
    expect(readLinkOpened({ [LINK_OPENED_STATE_KEY]: "partner" })).toBe("partner");
    expect(readLinkOpened({ [LINK_OPENED_STATE_KEY]: "both", other: 1 })).toBe("both");
    for (const bad of [null, undefined, "partner", 1, [], { [LINK_OPENED_STATE_KEY]: "other" }, { [LINK_OPENED_STATE_KEY]: true }, {}]) {
      expect(readLinkOpened(bad)).toBeNull();
    }
  });

  it("표시에는 답이나 글자가 들어갈 자리가 없다(값은 두 낱말 중 하나뿐)", () => {
    const state = linkOpenedState(null, "partner");
    expect(JSON.stringify(state)).toBe(`{"${LINK_OPENED_STATE_KEY}":"partner"}`);
  });
});
