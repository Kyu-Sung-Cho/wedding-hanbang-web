import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_GUESS_SET } from "@/constants/weddingCodeV40Guess";
import { V40_GUESS_COPY } from "@/lib/weddingCode/v40/guess/guessCopy";
import { guessAnswers } from "@/lib/weddingCode/v40/guess/guessFixtures";
import { cardText } from "@/lib/weddingCode/v40/guess/guessPresent";
import type { GuessAnswers, GuessPick } from "@/lib/weddingCode/v40/guess/types";
import type { FormBit } from "@/lib/weddingCode/v40/types";
import { click, createHarness, labelProblemsIn, labelledByText, pressKey, radiosIn, type Harness } from "../inputTestKit";
import { GuessSetFlow, type GuessSetFlowProps } from "./GuessSetFlow";

const copy = V40_GUESS_COPY;

interface Mounted {
  readonly onDone: ReturnType<typeof vi.fn>;
  readonly onLeave: ReturnType<typeof vi.fn>;
}

describe("GuessSetFlow", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await harness.unmount();
  });

  async function mount(props: Partial<GuessSetFlowProps> = {}): Promise<Mounted> {
    const onDone = vi.fn();
    const onLeave = vi.fn();
    await harness.render(<GuessSetFlow role="sender" formBit={0} initial={null} turnGuardMs={0} onDone={onDone} onLeave={onLeave} {...props} />);
    return { onDone, onLeave };
  }

  const root = () => harness.container.querySelector<HTMLElement>('[data-screen="pair-guess"]') as HTMLElement;
  const nav = (name: string) => harness.container.querySelector<HTMLButtonElement>(`[data-nav="${name}"]`);
  const navAll = (name: string) => [...harness.container.querySelectorAll<HTMLButtonElement>(`[data-nav="${name}"]`)];
  const escapeButton = (kind: string) => harness.container.querySelector<HTMLButtonElement>(`[data-escape="${kind}"]`);
  const radios = () => radiosIn(harness.container);
  const question = (kind: "self" | "guess") => harness.container.querySelector<HTMLElement>(`[data-question="${kind}"]`);
  const pressed = (button: HTMLElement | null) => button?.getAttribute("aria-pressed");
  /** 물음 하나의 알림 한 줄: 물음 묶음의 마지막 자식이다(카드 입력 안에도 같은 역할의 비어 있는 알림이 있다). */
  const statusOf = (kind: "self" | "guess") => question(kind)?.lastElementChild?.textContent;
  const buttonTexts = () => [...harness.container.querySelectorAll("button")].map((button) => button.textContent?.trim());

  async function start() {
    await click(nav("start"));
  }
  /** 장면 하나에서 내 답(과 짐작)을 화면 위치로 고른다. */
  async function answer(self: number | "notmine" | "skip" | null, guess: number | "unsure" | null = null) {
    if (typeof self === "number") await click(radios()[self]);
    else if (self !== null) await click(escapeButton(self));
    if (typeof guess === "number") await click(radios()[2 + guess]);
    else if (guess !== null) await click(escapeButton(guess));
  }

  describe("첫 화면", () => {
    it("제목, 안내, 선택이라는 말, 시작과 건너뛰기 단추를 그린다(보내는 사람 안내)", async () => {
      await mount();
      const el = root();
      expect(el.getAttribute("tabindex")).toBe("-1");
      expect(el.dataset.step).toBe("start");
      expect(el.querySelector("h1")?.textContent).toBe(copy.title);
      expect(el.querySelector("h2")).toBeNull();
      expect(el.getAttribute("aria-labelledby")).toBe(el.querySelector("h1")?.id);
      expect(el.textContent).toContain(copy.intro);
      expect(el.textContent).not.toContain(copy.receiverIntro);
      expect(el.textContent).toContain(copy.skipNote);
      expect(buttonTexts()).toEqual([copy.startButton, copy.leaveButton]);
      expect(radios()).toHaveLength(0);
    });

    it("받는 사람에게만 이 브라우저에 남기지 않는다는 한 줄이 있다(보내는 사람은 결과 화면의 진입 카드가 말한다)", async () => {
      await mount({ role: "receiver" });
      expect(root().querySelector("[data-receiver-storage]")?.textContent).toBe(copy.receiverStorageNote);
      await harness.unmount();
      harness = createHarness();
      await mount({ role: "sender" });
      expect(root().querySelector("[data-receiver-storage]")).toBeNull();
      expect(root().textContent).not.toContain(copy.receiverStorageNote);
    });

    it("받는 사람 안내를 그리고 시작과 건너뛰기를 같은 무게의 큰 단추로 둔다", async () => {
      await mount({ role: "receiver" });
      expect(root().textContent).toContain(copy.receiverIntro);
      expect(root().textContent).not.toContain(copy.intro);
      const start = nav("start") as HTMLElement;
      const leave = nav("leave") as HTMLElement;
      expect(start.className).toBe(leave.className);
    });

    it("보내는 사람에게는 건너뛰기가 시작보다 가벼운 단추다", async () => {
      await mount({ role: "sender" });
      expect((nav("start") as HTMLElement).className).not.toBe((nav("leave") as HTMLElement).className);
    });

    it("번호, n/N, A/B 라벨이 없다", async () => {
      await mount();
      expect(labelProblemsIn(harness.container)).toEqual([]);
    });

    it("라운지 안(embedded)에서는 제목이 h2 이고 바깥 화면의 h1 과 겹치지 않는다. 시작 화면과 장면 화면 모두 같다", async () => {
      await mount({ embedded: true });
      expect(root().querySelector("h2")?.textContent).toBe(copy.title);
      expect(root().querySelector("h1")).toBeNull();
      await start();
      expect(root().querySelector("h2")?.textContent).toBe(V40_GUESS_SET[0].caption);
      expect(root().querySelector("h1")).toBeNull();
    });
  });

  describe("장면 화면", () => {
    it("시작을 누르면 첫 장면이 열린다: 이름, 장면 글, 내 답 물음과 카드 둘과 탈출구 둘. 짐작 물음은 아직 없다", async () => {
      await mount();
      await start();
      const first = V40_GUESS_SET[0];
      const el = root();
      expect(el.dataset.step).toBe("scene");
      expect(el.dataset.scene).toBe(first.id);
      expect(el.querySelector("h1")?.textContent).toBe(first.caption);
      expect(el.querySelector("h2")).toBeNull();
      expect(el.textContent).toContain(first.stem);
      expect(el.textContent).toContain(copy.prompts.self);
      expect(el.textContent).not.toContain(copy.prompts.guess);
      expect(radios().map((radio) => radio.textContent?.trim())).toEqual([cardText(first.cards[0]), cardText(first.cards[1])]);
      expect(escapeButton("notmine")?.textContent?.trim()).toBe(copy.notMineButton);
      expect(escapeButton("skip")?.textContent?.trim()).toBe(copy.skipButton);
      expect(escapeButton("unsure")).toBeNull();
      expect(question("guess")).toBeNull();
      expect(labelProblemsIn(harness.container)).toEqual([]);
    });

    it("내 답이 카드이면 짐작 물음과 안내 한 줄, 카드 둘, 잘 모르겠어요 하나가 아래에 열린다", async () => {
      await mount();
      await start();
      await answer(0);
      const guess = question("guess") as HTMLElement;
      expect(guess).not.toBeNull();
      expect(guess.textContent).toContain(copy.prompts.guess);
      expect(guess.textContent).toContain(copy.guessNote);
      expect(radios()).toHaveLength(4);
      expect(escapeButton("unsure")?.textContent?.trim()).toBe(copy.unsureButton);
      expect([...harness.container.querySelectorAll("[data-escape]")].map((button) => (button as HTMLElement).dataset.escape)).toEqual(["notmine", "skip", "unsure"]);
    });

    it("두 물음의 카드 묶음 이름은 각자의 물음 글이다(낭독기가 어느 물음인지 안다)", async () => {
      await mount();
      await start();
      await answer(0);
      const groups = [...harness.container.querySelectorAll<HTMLElement>('[role="radiogroup"]')];
      expect(groups.map(labelledByText)).toEqual([copy.prompts.self, copy.prompts.guess]);
    });

    it("내 답을 탈출구로 바꾸면 그 장면의 짐작 물음과 고른 짐작이 사라진다", async () => {
      const { onDone } = await mount();
      await start();
      await answer(0, 1);
      expect(question("guess")).not.toBeNull();
      await click(escapeButton("notmine"));
      expect(question("guess")).toBeNull();
      expect(pressed(escapeButton("notmine"))).toBe("true");
      // 다시 카드를 고르면 짐작은 처음 상태로 열린다(옛 짐작이 살아나지 않는다).
      await click(radios()[1]);
      expect(question("guess")).not.toBeNull();
      expect(radios().filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(1);
      // 끝까지 가서 확인한다: 첫 장면의 짐작은 없다.
      for (let i = 1; i < 6; i += 1) await click(nav("next"));
      await click(nav("next"));
      const done = onDone.mock.calls[0][0] as GuessAnswers;
      expect(done.slots[0]).toEqual({ self: 1, guess: null });
    });

    it("탈출구는 aria-pressed 이고 다시 눌러도 풀리지 않으며 다른 답을 고르면 풀린다. 눌린 뒤 한 줄이 알림 영역에 나온다", async () => {
      await mount();
      await start();
      await click(escapeButton("notmine"));
      expect(pressed(escapeButton("notmine"))).toBe("true");
      expect(pressed(escapeButton("skip"))).toBe("false");
      expect(statusOf("self")).toBe(copy.escapeChosen.notmine);
      await click(escapeButton("notmine"));
      expect(pressed(escapeButton("notmine"))).toBe("true");
      await click(escapeButton("skip"));
      expect(pressed(escapeButton("notmine"))).toBe("false");
      expect(pressed(escapeButton("skip"))).toBe("true");
      expect(statusOf("self")).toBe(copy.escapeChosen.skip);
      await click(radios()[0]);
      expect(pressed(escapeButton("skip"))).toBe("false");
      expect(statusOf("self")).toBe("");
    });

    it("짐작의 잘 모르겠어요도 같은 규칙이고 카드를 고르면 풀린다", async () => {
      await mount();
      await start();
      await answer(0, "unsure");
      expect(pressed(escapeButton("unsure"))).toBe("true");
      expect(statusOf("guess")).toBe(copy.escapeChosen.unsure);
      await click(escapeButton("unsure"));
      expect(pressed(escapeButton("unsure"))).toBe("true");
      await click(radios()[3]);
      expect(pressed(escapeButton("unsure"))).toBe("false");
    });

    it("탈출구를 누른 뒤 한 줄에는 계산이라는 말이 없다", async () => {
      await mount();
      await start();
      await click(escapeButton("notmine"));
      expect(harness.container.textContent).not.toMatch(/계산/u);
    });

    it("방향키로 카드를 옮겨 고른다(라디오 그룹)", async () => {
      await mount();
      await start();
      radios()[0].focus();
      await pressKey("ArrowDown");
      expect(radios()[1].getAttribute("aria-checked")).toBe("true");
      expect(question("guess")).not.toBeNull();
    });
  });

  describe("카드 위아래는 내 폼 비트를 따른다", () => {
    for (const bit of [0, 1] as const) {
      it(`폼 비트 ${bit}: 화면 위 카드를 고르면 저장은 카드 기준으로 나간다`, async () => {
        const { onDone } = await mount({ formBit: bit as FormBit });
        await start();
        const item = V40_GUESS_SET[0];
        const topCard = bit === 0 ? 0 : 1;
        expect(radios()[0].textContent?.trim()).toBe(cardText(item.cards[topCard]));
        await click(radios()[0]);
        // 짐작은 아래 카드를 고른다(같은 순서이므로 위가 같은 카드다).
        expect(radios()[2].textContent?.trim()).toBe(cardText(item.cards[topCard]));
        await click(radios()[3]);
        for (let i = 0; i < 6; i += 1) await click(nav("next"));
        const done = onDone.mock.calls[0][0] as GuessAnswers;
        expect(done.slots[0]).toEqual({ self: topCard, guess: 1 - topCard });
      });
    }
  });

  describe("이동", () => {
    it("다음은 답 없이도 눌리고 장면 여섯을 지나 마지막은 마치기다. 고른 것이 없으면 onDone(null)", async () => {
      const { onDone } = await mount();
      await start();
      for (let scene = 0; scene < 5; scene += 1) {
        expect(nav("next")?.textContent?.trim()).toBe(copy.nextButton);
        expect(root().dataset.scene).toBe(V40_GUESS_SET[scene].id);
        await click(nav("next"));
      }
      expect(root().dataset.scene).toBe(V40_GUESS_SET[5].id);
      expect(nav("next")?.textContent?.trim()).toBe(copy.finishButton);
      expect(onDone).not.toHaveBeenCalled();
      await click(nav("next"));
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledWith(null);
    });

    it("이전은 앞 장면으로, 첫 장면에서는 첫 화면으로 돌아가고 고른 것은 그대로다", async () => {
      await mount();
      await start();
      await answer(1, 0);
      await click(nav("next"));
      expect(root().dataset.scene).toBe(V40_GUESS_SET[1].id);
      await click(nav("previous"));
      expect(root().dataset.scene).toBe(V40_GUESS_SET[0].id);
      expect(radios().filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(2);
      await click(nav("previous"));
      expect(root().dataset.step).toBe("start");
      expect(nav("previous")).toBeNull();
      await start();
      expect(radios().filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(2);
    });

    it("모든 장면 화면에 이전, 다음, 고른 것 없이 나갈게요가 있다(번호는 없다)", async () => {
      await mount();
      await start();
      for (let scene = 0; scene < 6; scene += 1) {
        expect(navAll("previous")).toHaveLength(1);
        expect(navAll("next")).toHaveLength(1);
        expect(navAll("leave")).toHaveLength(1);
        expect(nav("leave")?.textContent?.trim()).toBe(copy.leaveButton);
        expect(labelProblemsIn(harness.container), `${scene}`).toEqual([]);
        await click(nav("next"));
      }
    });

    it("화면이 바뀌면 초점이 화면 뿌리로 간다(같은 화면 안에서 답을 고를 때는 빼앗지 않는다)", async () => {
      await mount();
      await start();
      expect(document.activeElement).toBe(root());
      radios()[0].focus();
      await click(radios()[0]);
      expect(document.activeElement).not.toBe(root());
      await click(nav("next"));
      expect(document.activeElement).toBe(root());
    });
  });

  describe("마치기와 건너뛰기", () => {
    it("여섯 장면을 모두 답하면 세트 글자와 여섯 장면의 고름과 짐작이 저장 카드 기준으로 나간다(탈출구는 null)", async () => {
      const { onDone } = await mount();
      await start();
      // 장면마다 다른 조합: [내 답, 짐작]
      const plan: readonly (readonly [number | "notmine" | "skip", number | "unsure" | null])[] = [
        [0, 1], [1, 0], ["notmine", null], [0, "unsure"], ["skip", null], [1, 1],
      ];
      for (const [self, guess] of plan) {
        await answer(self, guess);
        await click(nav("next"));
      }
      expect(onDone).toHaveBeenCalledTimes(1);
      const done = onDone.mock.calls[0][0] as GuessAnswers;
      expect(done.set).toBe("1");
      const nullable = (value: GuessPick) => value;
      expect(done.slots.map((slot) => [nullable(slot.self), nullable(slot.guess)])).toEqual([[0, 1], [1, 0], [null, null], [0, null], [null, null], [1, 1]]);
    });

    it("고른 것 없이 나갈게요: 첫 화면에서도 장면 화면에서도 고른 것을 버리고 나간다(onDone 은 부르지 않는다)", async () => {
      const { onDone, onLeave } = await mount();
      await click(nav("leave"));
      expect(onLeave).toHaveBeenCalledTimes(1);
      expect(onDone).not.toHaveBeenCalled();
      await start();
      await answer(0, 1);
      await click(nav("leave"));
      expect(onLeave).toHaveBeenCalledTimes(2);
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  describe("이미 고른 것(고치기)", () => {
    const initial = guessAnswers([0, 1], [1, 0], [null, null], [0, null], [null, null], [1, 1]);

    it("고른 카드와 짐작이 미리 눌려 있고 그대로 마치면 같은 값이 나간다", async () => {
      const { onDone } = await mount({ initial, formBit: 1 });
      await start();
      const checked = () => radios().map((radio) => radio.getAttribute("aria-checked") === "true");
      // 폼 비트 1 이라 저장 카드 0 은 화면 아래에, 저장 카드 1 은 화면 위에 있다(고름은 카드 0 이라 아래, 짐작은 카드 1 이라 위).
      expect(checked()).toEqual([false, true, true, false]);
      for (let i = 0; i < 6; i += 1) await click(nav("next"));
      expect(onDone).toHaveBeenCalledWith(initial);
    });

    it("내 답이 없는 장면의 짐작은 묻지 않으므로 버린다(탈출구를 눌렀던 장면은 처음 상태로 돌아간다)", async () => {
      const odd = guessAnswers([null, 0], [1, null], [null, null], [null, null], [null, null], [null, null]);
      const { onDone } = await mount({ initial: odd });
      await start();
      expect(question("guess")).toBeNull();
      for (let i = 0; i < 6; i += 1) await click(nav("next"));
      expect(onDone).toHaveBeenCalledWith(guessAnswers([null, null], [1, null], [null, null], [null, null], [null, null], [null, null]));
    });
  });

  describe("두 번 누름 막기", () => {
    it("첫 화면의 단추는 마운트 직후 제한 시간 안의 누름을 무시한다", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
      const { onLeave } = await mount({ turnGuardMs: 300 });
      now.mockReturnValue(10_100);
      await click(nav("start"));
      expect(root().dataset.step).toBe("start");
      await click(nav("leave"));
      expect(onLeave).not.toHaveBeenCalled();
      now.mockReturnValue(10_400);
      await click(nav("start"));
      expect(root().dataset.step).toBe("scene");
    });

    it("시간 제한을 0 으로 주면 바로 눌린다", async () => {
      vi.spyOn(Date, "now").mockReturnValue(10_000);
      await mount({ turnGuardMs: 0 });
      await click(nav("start"));
      expect(root().dataset.step).toBe("scene");
    });
  });

  describe("저장소, 주소, 네트워크를 만지지 않는다", () => {
    it("끝까지 해도 저장소 쓰기, 주소 바꾸기, 요청이 없다", async () => {
      const local = vi.spyOn(Storage.prototype, "setItem");
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const replace = vi.spyOn(window.history, "replaceState");
      const push = vi.spyOn(window.history, "pushState");
      const hash = window.location.hash;
      const { onDone } = await mount();
      await start();
      for (let i = 0; i < 6; i += 1) {
        await answer(i % 2, 1 - (i % 2));
        await click(nav("next"));
      }
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(local).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(window.location.hash).toBe(hash);
      vi.unstubAllGlobals();
    });
  });

  describe("라운지 안", () => {
    it("embedded 이면 단추 줄이 하단 탭 위로 붙는다", async () => {
      await mount({ embedded: true });
      expect(harness.container.querySelector("[data-action-bar]")?.hasAttribute("data-embedded")).toBe(true);
    });
  });

  it("부모가 새 콜백으로 다시 그려도 고른 것과 화면 위치가 그대로다(화면 안 상태)", async () => {
    const first = await mount();
    await start();
    await answer(0, 1);
    const onDone = vi.fn();
    await harness.render(<GuessSetFlow role="sender" formBit={0} initial={null} turnGuardMs={0} onDone={onDone} onLeave={vi.fn()} />);
    expect(root().dataset.step).toBe("scene");
    expect(radios().filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(2);
    for (let i = 0; i < 6; i += 1) await click(nav("next"));
    expect(first.onDone).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect((onDone.mock.calls[0][0] as GuessAnswers).slots[0]).toEqual({ self: 0, guess: 1 });
  });
});
