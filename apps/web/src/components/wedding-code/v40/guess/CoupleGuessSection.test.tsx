import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_GUESS_SET } from "@/constants/weddingCodeV40Guess";
import { compareGuesses, type GuessComparison } from "@/lib/weddingCode/v40/guess/guessCompare";
import { V40_GUESS_COPY } from "@/lib/weddingCode/v40/guess/guessCopy";
import { GUESS_FIXTURES } from "@/lib/weddingCode/v40/guess/guessFixtures";
import { cardAct } from "@/lib/weddingCode/v40/guess/guessPresent";
import type { Perspective } from "@/lib/weddingCode/v40/types";
import { click, createHarness, labelProblemsIn, pressKey, type Harness } from "../inputTestKit";
import { CoupleGuessSection, GUESS_LAYOUT, type CoupleGuessSectionProps } from "./CoupleGuessSection";

const copy = V40_GUESS_COPY;

function comparisonOf(name: string): GuessComparison {
  const fixture = GUESS_FIXTURES.find((entry) => entry.name === name);
  if (fixture === undefined) throw new Error(`표본이 없다: ${name}`);
  return compareGuesses(fixture.first, fixture.second);
}

describe("CoupleGuessSection", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.unmount();
  });

  async function mount(comparison: GuessComparison, perspective: Perspective | null = null, extra: Partial<CoupleGuessSectionProps> = {}) {
    await harness.render(<CoupleGuessSection comparison={comparison} perspective={perspective} headingLevel={2} idPrefix="t" {...extra} />);
  }
  const section = () => harness.container.querySelector<HTMLElement>('[data-part="guess"]');
  const items = () => [...harness.container.querySelectorAll<HTMLElement>("li[data-scene]")];
  const toggle = () => harness.container.querySelector<HTMLButtonElement>("[data-guess-toggle]") as HTMLButtonElement;
  const body = () => harness.container.querySelector<HTMLElement>("[data-guess-body]");
  /** 장면 하나의 줄: [이름표, 값] 쌍들을 화면 순서대로. */
  const rowsOf = (li: HTMLElement) =>
    [...li.querySelectorAll("dl")].map((dl) => [...dl.querySelectorAll("div")].map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]));

  describe("아무것도 그리지 않는 경우", () => {
    it("둘 다 안 했거나 한쪽만 했으면 구역도 제목도 그리지 않는다", async () => {
      await mount(comparisonOf("one-sided"));
      expect(harness.container.textContent).toBe("");
      await mount({ kind: "none" });
      expect(harness.container.textContent).toBe("");
      expect(section()).toBeNull();
    });
  });

  describe("나란히 놓을 것이 없을 때", () => {
    it("제목과 빈 상태 한 줄만 그린다(토글, 밑줄, 끝 줄은 없다)", async () => {
      await mount(comparisonOf("all-same"));
      expect(harness.container.querySelector("h2")?.textContent).toBe(copy.title);
      expect(harness.container.textContent).toContain(copy.emptyState);
      expect(toggle()).toBeNull();
      expect(items()).toHaveLength(0);
      expect(harness.container.textContent).not.toContain(copy.tail);
      expect(harness.container.textContent).not.toContain(copy.sub);
      await mount(comparisonOf("self-only"));
      expect(harness.container.textContent).toContain(copy.emptyState);
    });
  });

  describe("줄이 있을 때", () => {
    it("제목, 밑줄, 출처 문장, 토글, 장면 목록, 줄 없는 장면 한 줄, 끝 줄이 위에서 아래로 있다(줄이 없는 장면이 있을 때)", async () => {
      // guess-only: 장면 하나만 줄이 된다. 나머지 다섯은 줄이 없는 장면이다.
      await mount(comparisonOf("guess-only"));
      const el = section() as HTMLElement;
      expect(items()).toHaveLength(1);
      expect(el.getAttribute("aria-labelledby")).toBe(el.querySelector("h2")?.id);
      const text = el.textContent ?? "";
      const order = [copy.title, copy.sub, copy.sourceNote, copy.hideButton, V40_GUESS_SET[0].caption, copy.unlistedNote, copy.tail].map((piece) => text.indexOf(piece));
      expect(order.every((at) => at >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(text.split(copy.unlistedNote)).toHaveLength(2);
      expect(text.split(copy.tail)).toHaveLength(2);
    });

    it("여섯 장면이 모두 줄로 놓였으면 「여기에 없는 장면」 한 줄을 그리지 않는다(가리킬 것이 없다). 나머지 순서와 끝 줄은 그대로다", async () => {
      for (const name of ["six-differ", "all-differ"]) {
        await mount(comparisonOf(name));
        expect(items()).toHaveLength(V40_GUESS_SET.length);
        const text = (section() as HTMLElement).textContent ?? "";
        expect(text).not.toContain(copy.unlistedNote);
        expect(harness.container.querySelector("[data-guess-unlisted]")).toBeNull();
        const order = [copy.title, copy.sub, copy.sourceNote, copy.hideButton, V40_GUESS_SET[0].caption, copy.tail].map((piece) => text.indexOf(piece));
        expect(order.every((at) => at >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
      }
    });

    it("장면 이름 아래 사실이 먼저이고 짐작이 뒤다. 값은 카드의 한 일 그대로이고 값(cost)은 보이지 않는다", async () => {
      const comparison = comparisonOf("six-differ");
      await mount(comparison, "first");
      const scenes = comparison.kind === "both" ? comparison.scenes : [];
      expect(items()).toHaveLength(6);
      scenes.forEach((scene, at) => {
        const item = V40_GUESS_SET[scene.index];
        const li = items()[at];
        expect(li.dataset.scene).toBe(item.id);
        expect(li.querySelector("p")?.textContent).toBe(item.caption);
        const diff = scene.diffs[0];
        expect(rowsOf(li)).toEqual([
          [
            [copy.rowLabels.meGuessedPartner.actualLabel, cardAct(item, diff.actual)],
            [copy.rowLabels.meGuessedPartner.guessLabel, cardAct(item, diff.guessed)],
          ],
        ]);
        for (const card of item.cards) expect(li.textContent).not.toContain(card.cost);
        expect(li.textContent).not.toMatch(/[「」"]/u);
      });
    });

    it("자르지 않는다: 여섯 장면이 모두 어긋나면 장면 여섯 블록과 줄 열둘이 모두 나온다", async () => {
      await mount(comparisonOf("all-differ"), "first");
      expect(items()).toHaveLength(6);
      expect(harness.container.querySelectorAll("dl")).toHaveLength(12);
    });

    it("내 고름이 없고 짐작만 있는 쪽의 장면도 한 줄 그린다(guess-only)", async () => {
      await mount(comparisonOf("guess-only"), null);
      expect(items()).toHaveLength(1);
    });

    it("번호, n/N, A/B 라벨과 숫자가 없고 누가 맞혔는지, 개수, 점수 말이 없다", async () => {
      await mount(comparisonOf("all-differ"), "second");
      expect(labelProblemsIn(harness.container)).toEqual([]);
      expect(harness.container.textContent).not.toMatch(/[0-9]/u);
      expect(harness.container.textContent).not.toMatch(/맞혔|맞았|틀렸|정답|점수|개수|몇 개/u);
    });

    it("검토를 받지 않은 장면이 있는 동안 구역 뿌리에 검토 대기 표시가 있다", async () => {
      await mount(comparisonOf("six-differ"));
      expect(section()?.dataset.review).toBe("pending");
    });
  });

  describe("나 기준(누가 나인지)에 따른 이름표와 순서", () => {
    const all = () => comparisonOf("all-differ");

    function directionsInFirstScene(): string[] {
      return [...(items()[0].querySelectorAll("dl") as NodeListOf<HTMLElement>)].map((dl) => dl.dataset.direction ?? "");
    }

    it("내가 먼저 답한 사람이면 내가 짐작한 쌍이 먼저이고 이름표는 내가/상대가 꼴이다", async () => {
      await mount(all(), "first");
      expect(directionsInFirstScene()).toEqual(["firstGuessedSecond", "secondGuessedFirst"]);
      const labels = [...items()[0].querySelectorAll("dt")].map((dt) => dt.textContent);
      expect(labels).toEqual([
        copy.rowLabels.meGuessedPartner.actualLabel, copy.rowLabels.meGuessedPartner.guessLabel,
        copy.rowLabels.partnerGuessedMe.actualLabel, copy.rowLabels.partnerGuessedMe.guessLabel,
      ]);
    });

    it("내가 나중에 답한 사람이면 방향 순서가 뒤집히고 내가 짐작한 쌍이 먼저다", async () => {
      await mount(all(), "second");
      expect(directionsInFirstScene()).toEqual(["secondGuessedFirst", "firstGuessedSecond"]);
      const labels = [...items()[0].querySelectorAll("dt")].map((dt) => dt.textContent);
      expect(labels.slice(0, 2)).toEqual([copy.rowLabels.meGuessedPartner.actualLabel, copy.rowLabels.meGuessedPartner.guessLabel]);
      expect(labels.slice(2)).toEqual([copy.rowLabels.partnerGuessedMe.actualLabel, copy.rowLabels.partnerGuessedMe.guessLabel]);
    });

    it("누가 나인지 모르면(링크를 직접 만든 경우) 먼저/나중에 답한 사람 꼴이고 상대의 짐작을 내 말로 붙이지 않는다", async () => {
      await mount(all(), null);
      const labels = [...harness.container.querySelectorAll("dt")].map((dt) => dt.textContent ?? "");
      expect(new Set(labels)).toEqual(new Set([
        copy.rowLabels.firstGuessedSecond.actualLabel, copy.rowLabels.firstGuessedSecond.guessLabel,
        copy.rowLabels.secondGuessedFirst.actualLabel, copy.rowLabels.secondGuessedFirst.guessLabel,
      ]));
      expect(harness.container.textContent).not.toContain(copy.rowLabels.meGuessedPartner.actualLabel);
      expect(harness.container.textContent).not.toContain(copy.rowLabels.partnerGuessedMe.guessLabel);
    });

    it("두 사람의 자리를 바꿔 넣고 나 기준도 바꾸면 화면의 (장면, 이름표, 값)이 똑같다", async () => {
      const fixture = GUESS_FIXTURES.find((entry) => entry.name === "all-differ") as (typeof GUESS_FIXTURES)[number];
      const flatten = () => items().flatMap((li) => rowsOf(li).flat().map(([label, value]) => `${li.dataset.scene}|${label}|${value}`)).sort();
      await mount(compareGuesses(fixture.first, fixture.second), "first");
      const forward = flatten();
      await mount(compareGuesses(fixture.second, fixture.first), "second");
      expect(flatten()).toEqual(forward);
    });
  });

  describe("배치", () => {
    it("기본은 장면별이고 방향 소제목이 없다", async () => {
      expect(GUESS_LAYOUT).toBe("byScene");
      await mount(comparisonOf("all-differ"), "first");
      expect(section()?.dataset.layout).toBe("byScene");
      expect(harness.container.querySelector("h3")).toBeNull();
      expect(harness.container.querySelector("[data-direction-group]")).toBeNull();
    });

    it("방향별 배치에서는 줄이 있는 방향에만 소제목이 나오고 나를 먼저 놓는다", async () => {
      await mount(comparisonOf("all-differ"), "first", { layout: "byDirection" });
      const groups = [...harness.container.querySelectorAll<HTMLElement>("[data-direction-group]")];
      expect(groups.map((group) => group.dataset.directionGroup)).toEqual(["firstGuessedSecond", "secondGuessedFirst"]);
      expect(groups.map((group) => group.querySelector("h3")?.textContent)).toEqual([copy.rowLabels.meGuessedPartner.subhead, copy.rowLabels.partnerGuessedMe.subhead]);
      groups.forEach((group) => expect(group.querySelectorAll("li")).toHaveLength(6));
      // 한 방향만 어긋나면 그 방향의 소제목만 나온다.
      await mount(comparisonOf("six-differ"), "first", { layout: "byDirection" });
      const only = [...harness.container.querySelectorAll<HTMLElement>("[data-direction-group]")];
      expect(only.map((group) => group.dataset.directionGroup)).toEqual(["firstGuessedSecond"]);
      expect(only[0].querySelector("h3")?.textContent).toBe(copy.rowLabels.meGuessedPartner.subhead);
      expect(harness.container.querySelectorAll("li")).toHaveLength(6);
      // 소제목이 없는 방향의 줄은 그 방향 묶음에 끼지 않는다: 각 장면 칸에는 그 방향의 줄 하나뿐이다.
      for (const li of items()) expect(li.querySelectorAll("dl")).toHaveLength(1);
    });

    it("제목 수준 3 이면 방향 소제목이 한 단계 아래(h4)다", async () => {
      await mount(comparisonOf("all-differ"), null, { layout: "byDirection", headingLevel: 3 });
      expect(harness.container.querySelector("h3")?.textContent).toBe(copy.title);
      expect(harness.container.querySelectorAll("h4")).toHaveLength(2);
    });
  });

  describe("가리기", () => {
    it("열림이 기본이고 토글은 aria-expanded 와 본문을 가리킨다", async () => {
      await mount(comparisonOf("six-differ"));
      expect(toggle().textContent?.trim()).toBe(copy.hideButton);
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
      expect(toggle().getAttribute("aria-controls")).toBe(body()?.id);
      expect(body()).not.toBeNull();
    });

    it("가리기를 누르면 내용이 문서에서 빠지고(숨김 스타일이 아니다) 한 줄과 보기 단추만 남는다", async () => {
      await mount(comparisonOf("six-differ"));
      await click(toggle());
      expect(toggle().textContent?.trim()).toBe(copy.showButton);
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      expect(toggle().hasAttribute("aria-controls")).toBe(false);
      expect(body()).toBeNull();
      expect(items()).toHaveLength(0);
      expect(harness.container.querySelectorAll("dl")).toHaveLength(0);
      expect(harness.container.textContent).toContain(copy.hiddenNote);
      for (const item of V40_GUESS_SET) for (const card of item.cards) expect(harness.container.textContent).not.toContain(card.act);
      // 제목과 출처 문장은 남아 있다.
      expect(harness.container.querySelector("h2")?.textContent).toBe(copy.title);
    });

    it("보기를 누르면 다시 열린다", async () => {
      await mount(comparisonOf("six-differ"));
      await click(toggle());
      await click(toggle());
      expect(items()).toHaveLength(6);
      expect(harness.container.textContent).not.toContain(copy.hiddenNote);
    });

    it("Escape 를 누르면 닫히고 초점이 토글로 간다", async () => {
      await mount(comparisonOf("six-differ"));
      toggle().focus();
      const event = await pressKey("Escape");
      expect(event.defaultPrevented).toBe(false);
      expect(body()).toBeNull();
      expect(document.activeElement).toBe(toggle());
      // 이미 닫혀 있으면 아무 일도 없다.
      await pressKey("Escape");
      expect(body()).toBeNull();
    });

    it("초점이 구역 밖(문서 본문, 다른 요소)에 있어도 Escape 로 닫힌다(옆 사람이 볼 때 키보드로 가릴 수 있다)", async () => {
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      try {
        await mount(comparisonOf("six-differ"));
        (document.activeElement as HTMLElement | null)?.blur();
        expect(document.activeElement).toBe(document.body);
        await pressKey("Escape");
        expect(body()).toBeNull();
        expect(toggle().textContent?.trim()).toBe(copy.showButton);
        // 다시 열고, 구역 밖의 다른 요소에 초점이 있어도 같다.
        await click(toggle());
        expect(body()).not.toBeNull();
        outside.focus();
        expect(document.activeElement).toBe(outside);
        await pressKey("Escape");
        expect(body()).toBeNull();
      } finally {
        outside.remove();
      }
    });

    it("Escape 가 아닌 키는 닫지 않는다. 가릴 내용이 없는 빈 상태에서는 Escape 가 아무 일도 하지 않는다", async () => {
      await mount(comparisonOf("six-differ"));
      await pressKey("Enter");
      await pressKey("ArrowDown");
      expect(body()).not.toBeNull();
      await mount(comparisonOf("all-same"));
      await pressKey("Escape");
      expect(harness.container.textContent).toContain(copy.emptyState);
    });

    it("토글 단추는 구역 제목을 설명으로 가진다(같은 이름의 가리기 단추가 두 구역에 있어도 어느 구역의 것인지 읽힌다)", async () => {
      await mount(comparisonOf("six-differ"));
      const heading = harness.container.querySelector("h2") as HTMLElement;
      expect(heading.id).not.toBe("");
      expect(toggle().getAttribute("aria-describedby")).toBe(heading.id);
      await click(toggle());
      expect(toggle().getAttribute("aria-describedby")).toBe(heading.id);
    });

    it("화면이 숨겨지면(visibilitychange hidden) 닫히고 다시 보여도 보기를 누를 때까지 닫혀 있다", async () => {
      await mount(comparisonOf("six-differ"));
      expect(body()).not.toBeNull();
      const state = vi.spyOn(document, "visibilityState", "get");
      state.mockReturnValue("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(body()).not.toBeNull();
      state.mockReturnValue("hidden");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(body()).toBeNull();
      state.mockReturnValue("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(body()).toBeNull();
      await click(toggle());
      expect(body()).not.toBeNull();
    });

    it("정리 때 화면 숨김 듣기를 지운다(떠난 뒤의 이벤트가 상태를 바꾸지 않는다)", async () => {
      const add = vi.spyOn(document, "addEventListener");
      const remove = vi.spyOn(document, "removeEventListener");
      await mount(comparisonOf("six-differ"));
      expect(add.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
      await harness.unmount();
      expect(remove.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
      harness = createHarness();
    });

    it("가림 상태는 화면의 메모리뿐이다: 다시 그리면 열림으로 돌아가고 저장소를 쓰지 않는다", async () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      await mount(comparisonOf("six-differ"));
      await click(toggle());
      expect(body()).toBeNull();
      await harness.unmount();
      harness = createHarness();
      await mount(comparisonOf("six-differ"));
      expect(body()).not.toBeNull();
      expect(setItem).not.toHaveBeenCalled();
    });
  });

  describe("제목 수준", () => {
    it("기본 제목은 2 단계이고 3 을 줄 수 있다", async () => {
      await mount(comparisonOf("six-differ"));
      expect(harness.container.querySelector("h2")?.textContent).toBe(copy.title);
      await mount(comparisonOf("six-differ"), null, { headingLevel: 3 });
      expect(harness.container.querySelector("h3")?.textContent).toBe(copy.title);
    });
  });
});
