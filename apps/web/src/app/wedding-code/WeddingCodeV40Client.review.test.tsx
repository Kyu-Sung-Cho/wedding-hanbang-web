import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click } from "@/components/wedding-code/v40/inputTestKit";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { readProgress } from "@/lib/weddingCode/v40/storage";
import {
  FakeStorage,
  NOW,
  answerScreenLikeFixture,
  bank,
  fixture,
  itemsOnScreen,
  mountClient,
  pressText,
  randomFor,
  screenName,
  settle,
  textOf,
  type Mounted,
} from "./WeddingCodeV40Client.testKit";

/**
 * 검토에서 나온 결함(2026-09-30)을 다시 만들어 보는 시험: 화면 높이가 바뀔 때 둘째 문항이 사라지는 일, 통계 개수가 기기 높이에 달라지는 일,
 * 화면을 넘긴 직후의 두 번 누름, 결과 앞 넘어간 질문 다시 보기의 이전 단추, 페이지를 떠날 때 저장.
 */

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn(), captureEvent: vi.fn() }));

const capture = vi.mocked(captureWeddingCodeEvent);
const mounted: Mounted[] = [];

async function open(overrides: Parameters<typeof mountClient>[0] = {}): Promise<Mounted> {
  const view = await mountClient(overrides);
  mounted.push(view);
  return view;
}

function eventsNamed(name: string) {
  return capture.mock.calls.filter(([event]) => event === name);
}

/** 세로 길이 조건(max-height)을 사람이 바꿀 수 있는 화면 크기 대역. */
function controllableViewport(initialShort: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let short = initialShort;
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query.includes("max-height") ? short : false;
      },
      media: query,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    }),
  });
  return {
    async set(nextShort: boolean) {
      short = nextShort;
      await act(async () => {
        for (const listener of [...listeners]) listener({ matches: nextShort } as MediaQueryListEvent);
      });
      await settle(0);
    },
    restore() {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
    },
  };
}

async function nextPage(container: HTMLElement): Promise<void> {
  await click(container.querySelector('[data-nav="next"]'));
}

beforeEach(() => {
  capture.mockClear();
  window.history.replaceState(null, "", "/wedding-code");
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.unmount();
});

describe("화면 높이가 바뀔 때(repack) 질문 화면", () => {
  const firstScreen = bank.screens[0];

  it("전제: 첫 화면은 문항이 둘이다", () => {
    expect(firstScreen.length).toBeGreaterThanOrEqual(2);
  });

  it("문항 하나씩 나오던 첫 쪽이 높은 화면으로 바뀌면 둘째 문항도 그려진다(뷰가 첫 문항 것만 남지 않는다)", async () => {
    const viewport = controllableViewport(true);
    try {
      const sample = fixture("swua-example");
      const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
      await pressText(view.container, V40_COPY.intro.startButton);
      expect(itemsOnScreen(view.container)).toEqual([firstScreen[0]]);

      await viewport.set(false);
      expect(itemsOnScreen(view.container)).toEqual([...firstScreen]);
      // 쪽 key(q:<첫 문항>)가 같아서 예전에는 뷰가 첫 문항 것만 남았고, 둘째 문항이 목록에만 있고 그려지지 않았다.
      const second = view.container.querySelector(`[data-item="${firstScreen[1]}"]`);
      expect(second).not.toBeNull();
      expect(second?.querySelectorAll('[role="radio"], input[type="radio"], button').length).toBeGreaterThan(1);

      await viewport.set(true);
      expect(itemsOnScreen(view.container)).toEqual([firstScreen[0]]);
    } finally {
      viewport.restore();
    }
  });

  it("높은 화면의 두 문항 쪽이 낮은 화면으로 바뀌면 지금 보던 첫 문항 쪽으로 이어지고, 다시 높아지면 둘 다 나온다", async () => {
    const viewport = controllableViewport(false);
    try {
      const sample = fixture("swua-example");
      const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
      await pressText(view.container, V40_COPY.intro.startButton);
      expect(itemsOnScreen(view.container)).toEqual([...firstScreen]);
      await viewport.set(true);
      expect(itemsOnScreen(view.container)).toEqual([firstScreen[0]]);
      await viewport.set(false);
      expect(itemsOnScreen(view.container)).toEqual([...firstScreen]);
      // 다음을 눌러 안내가 뜬 뒤에도 안내가 가리키는 문항이 화면에 있다(안 보이는 문항을 채우라고 하지 않는다).
      await nextPage(view.container);
      await settle(200);
      expect(textOf(view.container)).toContain(V40_COPY.question.incomplete);
      for (const id of firstScreen) expect(view.container.querySelector(`[data-item="${id}"]`)).not.toBeNull();
    } finally {
      viewport.restore();
    }
  });

  it("무작위로 높이를 바꿔도 화면에 나온 문항과 쪽의 문항 목록이 늘 같다", async () => {
    const viewport = controllableViewport(true);
    try {
      const sample = fixture("swua-example");
      const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
      await pressText(view.container, V40_COPY.intro.startButton);
      let short = true;
      let seed = 7;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };
      for (let step = 0; step < 24; step += 1) {
        if (screenName(view.container) !== "questions") break;
        const roll = random();
        if (roll < 0.4) {
          short = !short;
          await viewport.set(short);
        } else {
          await answerScreenLikeFixture(view.container, sample);
          await nextPage(view.container);
        }
        const key = view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key");
        if (key === null || key === undefined) continue;
        const shown = itemsOnScreen(view.container);
        const screen = bank.screens.find((ids) => ids.includes(shown[0]));
        expect(screen, `화면 ${key}`).toBeDefined();
        // 짧은 화면은 문항 하나, 높은 화면은 배치표의 그 화면 전체.
        expect(shown, `화면 ${key} short=${short}`).toEqual(short ? [shown[0]] : [...(screen ?? [])]);
      }
    } finally {
      viewport.restore();
    }
  }, 60_000);
});

describe("이용 통계 scene_reached", () => {
  it("짧은 화면이 한 화면의 두 문항을 쪽 둘로 나눠도 화면 번호 하나에 한 번만 보낸다", async () => {
    const viewport = controllableViewport(true);
    try {
      const sample = fixture("swua-example");
      const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
      await pressText(view.container, V40_COPY.intro.startButton);
      // 첫 화면의 문항 둘(쪽 둘), 그다음 화면의 첫 문항.
      await answerScreenLikeFixture(view.container, sample);
      await nextPage(view.container);
      await answerScreenLikeFixture(view.container, sample);
      await nextPage(view.container);
      const reached = eventsNamed("wedding_code_scene_reached").map(([, props]) => (props as { scene_index: number }).scene_index);
      expect(reached).toEqual([1, 2]);
    } finally {
      viewport.restore();
    }
  });
});

describe("화면을 넘긴 직후의 두 번 누름", () => {
  const GUARD = { turnGuardMs: 400 } as const;

  it("시작하기를 누른 바로 뒤의 다음 누름은 무시해서 손대지 않은 질문에 안내가 뜨지 않는다", async () => {
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, ...GUARD } });
    await pressText(view.container, V40_COPY.intro.startButton);
    const key = view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key");
    await nextPage(view.container);
    await settle(200);
    expect(view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).toBe(key);
    expect(textOf(view.container)).not.toContain(V40_COPY.question.incomplete);
  });

  it("시간이 지난 뒤의 다음 누름은 그대로 통한다(덜 채웠으면 안내가 뜬다)", async () => {
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, ...GUARD } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await settle(450);
    await nextPage(view.container);
    await settle(200);
    expect(textOf(view.container)).toContain(V40_COPY.question.incomplete);
  });

  it("그 쪽에서 답을 하나라도 골랐으면 다음 누름은 바로 눌러도 통한다(빠른 사용자와 자동 실행기를 막지 않는다)", async () => {
    const sample = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample), ...GUARD } });
    await pressText(view.container, V40_COPY.intro.startButton);
    const key = view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key");
    await answerScreenLikeFixture(view.container, sample);
    expect(view.container.querySelectorAll('[role="radio"][aria-checked="true"], input[type="radio"]:checked').length).toBeGreaterThan(0);
    await nextPage(view.container);
    expect(view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).not.toBe(key);
  });

  it("넘긴 직후의 두 번 누름은 다음 화면에서도 걸러지고, 답을 고른 뒤에는 풀린다", async () => {
    const sample = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample), ...GUARD } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    const second = view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key");
    // 손가락이 다음 단추를 두 번 두드린 것처럼: 새 화면에서 답 없이 곧바로 누른다.
    await nextPage(view.container);
    await settle(200);
    expect(view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).toBe(second);
    expect(textOf(view.container)).not.toContain(V40_COPY.question.incomplete);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    expect(view.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).not.toBe(second);
  });

  it("쉬는 카드의 이어서 하기는 넘긴 직후여도 막지 않는다(질문 화면이 아닌 카드는 두 번 눌림 거름의 대상이 아니다)", async () => {
    const sample = fixture("swua-example");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample), ...GUARD } });
    await pressText(view.container, V40_COPY.intro.startButton);
    for (let step = 0; step < 40 && screenName(view.container) === "questions"; step += 1) {
      await answerScreenLikeFixture(view.container, sample);
      await nextPage(view.container);
    }
    expect(screenName(view.container)).toBe("rest");
    await pressText(view.container, V40_COPY.rest.continueButton);
    expect(screenName(view.container)).toBe("questions");
  }, 60_000);

  it("이어서 하기 바로 뒤의 다음 누름도 무시한다(저장된 답에서 이어 한 첫 쪽)", async () => {
    const storage = new FakeStorage();
    const sample = fixture("swua-example");
    const first = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(first.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(first.container, sample);
    await nextPage(first.container);
    await first.unmount();
    mounted.pop();

    const second = await open({ deps: { storage, now: () => NOW, ...GUARD } });
    await pressText(second.container, V40_COPY.intro.resume.continueButton);
    const key = second.container.querySelector("[data-page-key]")?.getAttribute("data-page-key");
    await nextPage(second.container);
    await settle(200);
    expect(second.container.querySelector("[data-page-key]")?.getAttribute("data-page-key")).toBe(key);
    expect(textOf(second.container)).not.toContain(V40_COPY.question.incomplete);
  });
});

describe("결과 앞에서 저절로 열린 넘어간 질문 다시 보기", () => {
  async function driveToSkippedReview(view: Mounted, sample: ReturnType<typeof fixture>): Promise<void> {
    await pressText(view.container, V40_COPY.intro.startButton);
    for (let step = 0; step < 220 && view.container.querySelector('[data-edit-mode="skipped"]') === null; step += 1) {
      if (screenName(view.container) === "questions") {
        await answerScreenLikeFixture(view.container, sample);
        await nextPage(view.container);
      } else {
        await pressText(view.container, V40_COPY.rest.continueButton);
      }
    }
    expect(view.container.querySelector('[data-edit-mode="skipped"]')).not.toBeNull();
  }

  it("첫 쪽에도 이전 단추가 있고 누르면 마지막 질문 화면으로 돌아간다(결과로 가서 다시 보기를 끝내 버리지 않는다). 거기서 다음은 곧바로 결과다", async () => {
    const sample = fixture("unusable-axis");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    await driveToSkippedReview(view, sample);
    const previous = view.container.querySelector('[data-nav="previous"]');
    expect(previous).not.toBeNull();
    await click(previous);
    expect(view.container.querySelector('[data-edit-mode="skipped"]')).toBeNull();
    expect(screenName(view.container)).toBe("questions");
    const lastScreen = bank.screens[bank.screens.length - 1];
    const shown = itemsOnScreen(view.container);
    expect(shown.length).toBeGreaterThan(0);
    for (const id of shown) expect(lastScreen).toContain(id);
    // 이미 본 다시 보기는 두 번 열리지 않는다: 다음은 곧바로 결과다.
    await nextPage(view.container);
    expect(view.container.querySelector('[data-edit-mode="skipped"]')).toBeNull();
    expect(screenName(view.container)).toBe("result");
  }, 60_000);

  it("첫 쪽의 그대로 결과 보기 단추는 그대로 결과로 간다", async () => {
    const sample = fixture("unusable-axis");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    await driveToSkippedReview(view, sample);
    await pressText(view.container, V40_COPY.edit.skippedReviewSkipButton);
    expect(screenName(view.container)).toBe("result");
  }, 60_000);

  it("결과에서 사용자가 연 넘어간 질문 다시 보기는 첫 쪽에도 이전 단추가 있고 누르면 결과로 돌아간다", async () => {
    const sample = fixture("unusable-axis");
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    await driveToSkippedReview(view, sample);
    await pressText(view.container, V40_COPY.edit.skippedReviewSkipButton);
    expect(screenName(view.container)).toBe("result");
    await pressText(view.container, V40_COPY.quality.reviewSkippedButton);
    expect(view.container.querySelector('[data-edit-mode="skipped"]')).not.toBeNull();
    expect(view.container.querySelector('[data-edit-mode="skipped"]')).not.toBeNull();
    const previous = view.container.querySelector('[data-nav="previous"]');
    expect(previous).not.toBeNull();
    await click(previous);
    expect(screenName(view.container)).toBe("result");
  }, 60_000);

});

describe("페이지를 떠날 때(visibilitychange, pagehide) 저장", () => {
  function setVisibility(state: "hidden" | "visible") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  }

  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
  });

  async function hide(): Promise<void> {
    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  it("넘기기 전에 고른 답이 있으면 화면이 숨겨질 때 저장한다(beforeunload 가 안 불리는 앱 안 브라우저 대비)", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    expect(readProgress(storage, bank, NOW).status).not.toBe("ready");
    await hide();
    const saved = readProgress(storage, bank, NOW);
    expect(saved.status).toBe("ready");
    if (saved.status === "ready") {
      // 넘기기 전에 고른 답이 저장에 들어 있다.
      for (const id of itemsOnScreen(view.container)) expect(saved.snapshot.responses[id]).toBeDefined();
    }
  });

  it("쪽을 떠나는 pagehide 에서도 저장하고, 이미 저장한 뒤에는 다시 쓰지 않는다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(readProgress(storage, bank, NOW).status).toBe("ready");
    const writes = storage.writes().length;
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(storage.writes().length).toBe(writes);
  });

  it("자동 저장이 꺼져 있으면 숨겨져도 아무것도 쓰지 않는다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.autosave.turnOffButton);
    const before = storage.writes().length;
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    await hide();
    expect(storage.writes().length).toBe(before);
    expect(readProgress(storage, bank, NOW).status).not.toBe("ready");
  });

  it("보이는 상태로 돌아올 때(visible)나 답이 없을 때는 쓰지 않는다", async () => {
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.startButton);
    const before = storage.writes().length;
    await hide();
    expect(storage.writes().length).toBe(before);
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(storage.writes().length).toBe(before);
  });
});

describe("질문 화면의 쪽 제목과 저장 알림 영역", () => {
  it("질문 화면에는 눈에 보이지 않는 h1 이 하나 있다", async () => {
    const view = await open({ deps: { storage: new FakeStorage(), now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.startButton);
    expect(view.container.querySelectorAll("h1")).toHaveLength(1);
    expect(view.container.querySelector("h1")?.className).toContain("sr-only");
  });

  it("라운지 안에서는 바깥 화면이 h1 을 가지므로 질문 화면의 쪽 제목은 h2 다", async () => {
    const view = await open({ embedded: true, deps: { storage: new FakeStorage(), now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.startButton);
    expect(view.container.querySelector("h1")).toBeNull();
    expect(view.container.querySelector("h2.sr-only")).not.toBeNull();
  });

  it("저장이 도중에 막히면 늘 문서에 있던 알림 영역 안에 저장 불가 안내가 들어온다", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(sample) } });
    await pressText(view.container, V40_COPY.intro.startButton);
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    const region = view.container.querySelector<HTMLElement>("[data-save-region]");
    const problemRegion = view.container.querySelector<HTMLElement>("[data-save-problem-region]");
    expect(region).not.toBeNull();
    expect(problemRegion).not.toBeNull();
    expect(region?.textContent).toContain(V40_COPY.leave.autosaveOnNote);
    expect(problemRegion?.textContent).toBe("");
    storage.failSet = true;
    await answerScreenLikeFixture(view.container, sample);
    await nextPage(view.container);
    // 두 영역 모두 다시 만들어지지 않고 그대로 있다. 저장 불가 안내는 문항 위 영역에 들어오고 저장됐다는 말은 사라진다.
    expect(view.container.querySelector("[data-save-region]")).toBe(region);
    expect(view.container.querySelector("[data-save-problem-region]")).toBe(problemRegion);
    expect(problemRegion?.textContent).toContain(V40_COPY.storageNotice.unavailable);
    expect(region?.textContent).not.toContain(V40_COPY.leave.autosaveOnNote);
  }, 60_000);
});
