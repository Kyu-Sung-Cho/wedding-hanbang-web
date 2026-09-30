import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click } from "@/components/wedding-code/v40/inputTestKit";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { V40_COPY, koreanDateLabel } from "@/lib/weddingCode/v40/copy";
import { buildResult } from "@/lib/weddingCode/v40/score";
import { appendHistory, readHistory, readProgress } from "@/lib/weddingCode/v40/storage";
import type { HistoryEntry, Responses } from "@/lib/weddingCode/v40/types";
import { historyEntryOf, planHistory } from "./WeddingCodeV40Client.model";
import {
  DAY,
  FakeStorage,
  NOW,
  answerScreenLikeFixture,
  bank,
  driveToEnd,
  fixture,
  mountClient,
  pressText,
  randomFor,
  resultSnapshotOf,
  screenName,
  seedProgress,
  textOf,
  type Mounted,
} from "./WeddingCodeV40Client.testKit";

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn(), captureEvent: vi.fn() }));

const capture = vi.mocked(captureWeddingCodeEvent);
const mounted: Mounted[] = [];

async function open(overrides: Parameters<typeof mountClient>[0] = {}): Promise<Mounted> {
  const view = await mountClient(overrides);
  mounted.push(view);
  return view;
}

function entryOf(name: string, at: number): HistoryEntry {
  const sample = fixture(name);
  return historyEntryOf(buildResult(bank, sample.formBit, sample.responses), at);
}

function historyText(container: HTMLElement): string {
  const section = container.querySelector('[data-result-section="history"]');
  return section === null ? "" : textOf(section);
}

beforeEach(() => {
  capture.mockClear();
  window.history.replaceState(null, "", "/wedding-code");
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.unmount();
});

describe("지난번 비교 기록을 어떻게 정하나 (순수 함수)", () => {
  const a = entryOf("all-clear", NOW - 9 * DAY);
  const b = entryOf("mixed-bands", NOW - 5 * DAY);
  const mine = entryOf("swua-example", NOW - DAY);
  const current = entryOf("swua-example", NOW);

  it("방금 끝낸 시도는 가장 최근 기록이 지난번이고 이번 결과를 새로 남긴다", () => {
    expect(planHistory([b, a], current, "fresh")).toEqual({ previous: b, append: true, replace: false });
    expect(planHistory([], current, "fresh")).toEqual({ previous: null, append: true, replace: false });
  });

  it("같은 결과를 다시 열면(이어 하기) 이번 시도의 기록은 건너뛰고 그 앞의 것과 견준다", () => {
    expect(planHistory([mine, b, a], current, "return")).toEqual({ previous: b, append: false, replace: false });
  });

  it("가장 최근 기록이 이번 결과와 다르면 그 기록이 지난번이다", () => {
    expect(planHistory([b, a], current, "return")).toEqual({ previous: b, append: false, replace: false });
  });

  it("이 화면이 남긴 기록은 답을 고쳐 결과가 달라졌을 때만 바꿔 쓰고, 그 앞의 것이 지난번이다", () => {
    const attempt = entryOf("mixed-bands", NOW - 60_000);
    expect(planHistory([attempt, a], current, "return", attempt.at)).toEqual({ previous: a, append: false, replace: true });
    expect(planHistory([attempt, a], attempt, "return", attempt.at)).toEqual({ previous: a, append: false, replace: false });
  });
});

describe("웨딩코드 4.0 클라이언트: 지난번 비교 기록", () => {
  it("기록은 최근 세 건까지이고 이번 결과가 맨 앞에 남으며, 비교에는 이번을 뺀 가장 최근 기록의 날짜가 나온다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    for (const days of [10, 9, 8]) appendHistory(storage, entryOf("all-clear", NOW - days * DAY), NOW);
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await driveToEnd(view.container, own);
    const entries = readHistory(storage, NOW).entries;
    expect(entries.map((entry) => entry.at)).toEqual([NOW, NOW - 8 * DAY, NOW - 9 * DAY]);
    expect(entries[0]).toEqual(historyEntryOf(buildResult(bank, own.formBit, own.responses), NOW));
    expect(historyText(view.container)).toContain(koreanDateLabel(NOW - 8 * DAY));
    expect(historyText(view.container)).not.toContain(koreanDateLabel(NOW));
  }, 60_000);

  it("이 기기에 기록이 없으면 지난번과 비교 구역이 없다", async () => {
    const own = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    await driveToEnd(view.container, own);
    expect(view.container.querySelector('[data-result-section="history"]')).toBeNull();
  }, 60_000);

  it("이어 하기로 결과를 다시 열면 이번 시도가 남긴 기록 바로 앞의 기록과 비교하고 기록을 늘리지 않는다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    appendHistory(storage, entryOf("all-clear", NOW - 5 * DAY), NOW);
    appendHistory(storage, entryOf("swua-example", NOW - DAY), NOW);
    seedProgress(storage, resultSnapshotOf(own), NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(historyText(view.container)).toContain(koreanDateLabel(NOW - 5 * DAY));
    expect(historyText(view.container)).not.toContain(koreanDateLabel(NOW - DAY));
    expect(readHistory(storage, NOW).entries).toHaveLength(2);
  });

  it("주제 답을 고쳐 결과가 달라지면 이번 시도의 기록을 고친 결과로 바꾸고 지난번과 비교는 그 앞 시도와 한다", async () => {
    const own = fixture("swua-example");
    const other = fixture("couple-partner");
    const storage = new FakeStorage();
    appendHistory(storage, entryOf("all-clear", NOW - 6 * DAY), NOW);
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await driveToEnd(view.container, own);
    expect(readHistory(storage, NOW).entries).toHaveLength(2);

    // 돈 주제 열여섯 문항을 다른 표본의 답으로 고쳐서 돈 글자가 바뀌게 한다.
    const review = [...view.container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => textOf(button) === V40_COPY.block.reviewAxisButton)[0];
    await click(review);
    for (let step = 0; step < 20 && screenName(view.container) === "questions"; step += 1) {
      await answerScreenLikeFixture(view.container, other, own.formBit);
      await click(view.container.querySelector('[data-nav="next"]'));
    }
    expect(screenName(view.container)).toBe("result");

    const edited: Responses = { ...own.responses, ...Object.fromEntries(bank.scoredByAxis.money.map((item) => [item.id, other.responses[item.id]])) };
    const expected = buildResult(bank, own.formBit, edited);
    expect(expected.axes[0].letter).not.toBe(buildResult(bank, own.formBit, own.responses).axes[0].letter);
    const entries = readHistory(storage, NOW).entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(historyEntryOf(expected, NOW));
    expect(entries[1].at).toBe(NOW - 6 * DAY);
    // 고치기 전의 같은 시도 결과가 아니라 앞 시도(엿새 전)와 견준다.
    expect(historyText(view.container)).toContain(koreanDateLabel(NOW - 6 * DAY));
  }, 60_000);

  it("답 다시 보기를 하다가 새로고침해도 이어 하기로 돌아온 결과가 고치기 전 결과를 「지난번」이라며 견주지 않는다", async () => {
    const own = fixture("swua-example");
    const other = fixture("couple-partner");
    const storage = new FakeStorage();
    const first = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await driveToEnd(first.container, own);
    const before = readHistory(storage, NOW).entries;
    expect(before).toHaveLength(1);
    expect(before[0]).toEqual(historyEntryOf(buildResult(bank, own.formBit, own.responses), NOW));

    // 돈 주제 다시 보기를 열어 마지막 화면 앞까지 다른 표본의 답으로 고치고(넘길 때마다 저장된다) 마치지 않은 채 새로고침한다.
    const review = [...first.container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => textOf(button) === V40_COPY.block.reviewAxisButton)[0];
    await click(review);
    for (let step = 0; step < 20; step += 1) {
      const next = first.container.querySelector<HTMLElement>('[data-nav="next"]');
      if (screenName(first.container) !== "questions" || textOf(next!) === V40_COPY.question.resultButton) break;
      await answerScreenLikeFixture(first.container, other, own.formBit);
      await click(next);
    }
    expect(screenName(first.container)).toBe("questions");
    const saved = readProgress(storage, bank, NOW);
    expect(saved.status).toBe("ready");
    if (saved.status !== "ready") return;
    const edited = buildResult(bank, saved.snapshot.formBit, saved.snapshot.responses);
    expect(edited.axes[0].letter, "고친 답으로 돈 글자가 달라져야 시험이 된다").not.toBe(buildResult(bank, own.formBit, own.responses).axes[0].letter);
    // 넘길 때마다 이번 시도의 기록이 고친 결과를 따라간다(기록이 한 건이고 시각은 그대로다).
    const mid = readHistory(storage, NOW).entries;
    expect(mid).toHaveLength(1);
    expect(mid[0]).toEqual(historyEntryOf(edited, NOW));

    await first.unmount();
    mounted.pop();
    const reopened = await open({ deps: { storage, now: () => NOW + 60_000 } });
    await pressText(reopened.container, V40_COPY.intro.resume.continueButton);
    expect(screenName(reopened.container)).toBe("result");
    // 앞 시도가 없으므로 견줄 것이 없다: 같은 시도의 고치기 전 결과를 지난번으로 삼지 않는다.
    expect(reopened.container.querySelector('[data-result-section="history"]')).toBeNull();
    expect(readHistory(storage, NOW + 60_000).entries).toHaveLength(1);

    // 이어받은 시도를 이어서 더 고치면 그 기록이 또 따라간다(앞 시도가 있으면 그것과 견준다).
    const another = fixture("all-clear");
    const review2 = [...reopened.container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => textOf(button) === V40_COPY.block.reviewAxisButton)[1];
    await click(review2);
    for (let step = 0; step < 20 && screenName(reopened.container) === "questions"; step += 1) {
      await answerScreenLikeFixture(reopened.container, another, saved.snapshot.formBit);
      await click(reopened.container.querySelector('[data-nav="next"]'));
    }
    expect(screenName(reopened.container)).toBe("result");
    expect(readHistory(storage, NOW + 60_000).entries).toHaveLength(1);
    expect(reopened.container.querySelector('[data-result-section="history"]')).toBeNull();
  }, 120_000);

  it("답을 고쳐도 결과가 그대로면 기록을 다시 쓰지 않는다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await driveToEnd(view.container, own);
    const writesBefore = storage.writes().length;
    const review = [...view.container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => textOf(button) === V40_COPY.block.reviewAxisButton)[0];
    await click(review);
    for (let step = 0; step < 20 && screenName(view.container) === "questions"; step += 1) {
      await answerScreenLikeFixture(view.container, own);
      await click(view.container.querySelector('[data-nav="next"]'));
    }
    expect(screenName(view.container)).toBe("result");
    const historyWrites = storage.writes().filter((entry) => entry.includes("history"));
    expect(historyWrites).toHaveLength(1);
    expect(storage.writes().length).toBeGreaterThan(writesBefore);
  }, 60_000);

  it("자동 저장을 끄면 기록을 남기지도 읽지도 않는다", async () => {
    const own = fixture("swua-example");
    const storage = new FakeStorage();
    appendHistory(storage, entryOf("all-clear", NOW - 6 * DAY), NOW);
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.autosave.turnOffButton);
    await driveToEnd(view.container, own);
    expect(readHistory(storage, NOW).entries).toHaveLength(0);
    expect(view.container.querySelector('[data-result-section="history"]')).toBeNull();
  }, 60_000);
});
