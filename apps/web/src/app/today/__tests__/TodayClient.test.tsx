import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TODAY_DECK, drawThree, findCard } from "@/lib/todayOneLine/deck";
import TodayClient, { CardFace } from "../TodayClient";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SEED = 20260729;

describe("오늘 한 마디 화면", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function mount(seed = SEED) {
    await act(async () => {
      root.render(<TodayClient shareOrigin="https://hanbang.ai" seed={seed} />);
    });
  }

  function cardIds(): string[] {
    return [...container.querySelectorAll("[data-card]")].map(
      (node) => node.getAttribute("data-card") ?? "",
    );
  }

  async function click(selector: string) {
    const node = container.querySelector<HTMLElement>(selector);
    expect(node, `없는 요소: ${selector}`).not.toBeNull();
    await act(async () => {
      node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function clickText(text: string) {
    const node = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(text),
    );
    expect(node, `없는 버튼: ${text}`).toBeDefined();
    expect(node!.disabled, `잠긴 버튼: ${text}`).toBe(false);
    await act(async () => {
      node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  /**
   * 카드 행도 `button`이라 `button:not([disabled])`로는 CTA를 못 집는다. 글자로 찾는다.
   * 어느 단계인지 본문 텍스트로 판정하면 안 된다 — 첫 화면 안내에도 「상대가 나한테
   * 물어줄 한 장」이 들어 있어서 매번 틀린 버튼을 고른다.
   */
  async function clickPrimary() {
    const labels = ["이 한 장 건네기", "이 카드로 정하기"];
    const label = labels.find((text) =>
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.includes(text),
      ),
    );
    expect(label, "진행 버튼이 없다").toBeDefined();
    await clickText(label!);
  }

  /** 화면에 실제로 보이는 텍스트 중 하나에 이 카드의 문장이 있는지. */
  function showsSay(id: string): boolean {
    const card = findCard(id);
    return card !== null && (container.textContent ?? "").includes(card.say);
  }

  it("설문 없이 바로 세 장을 보여준다", async () => {
    await mount();
    expect(cardIds()).toHaveLength(3);
    // 입력 필드가 하나라도 있으면 이건 설문이지 뽑기가 아니다.
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
  });

  it("세 장은 마음 2 + 돈 1이다", async () => {
    await mount();
    const kinds = cardIds().map((id) => findCard(id)?.kind);
    expect(kinds.filter((kind) => kind === "money")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "heart")).toHaveLength(2);
  });

  it("같은 seed면 같은 세 장을 그린다 — SSR과 어긋나지 않는다", async () => {
    await mount();
    const first = cardIds();
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(cardIds()).toEqual(first);
  });

  it("다른 세 장을 누르면 카드가 실제로 바뀐다", async () => {
    await mount();
    const before = cardIds();
    await click("[data-shuffle]");
    expect(cardIds()).not.toEqual(before);
    expect(cardIds()).toHaveLength(3);
  });

  it("고르기 전에는 진행 버튼이 잠겨 있다", async () => {
    await mount();
    const next = container.querySelector<HTMLButtonElement>("button[disabled]");
    expect(next?.textContent).toContain("이 카드로 정하기");
  });

  /**
   * 아무 seed로나 확인하면 안 된다. 배선(`exclude`)을 통째로 지워도 그 seed에서는
   * 우연히 안 겹쳐서 통과한다 — 실제로 이 테스트의 첫 판이 그렇게 통과했다.
   * **배선이 빠지면 반드시 겹치는 seed**를 찾아서 그 위에서 확인한다.
   * (give 단계 offset 9973을 알고 있어야 하므로 구현과 붙어 있는 테스트다.)
   */
  it("내가 고른 카드는 상대 몫 후보에서 빠진다", async () => {
    let seed = -1;
    let collidingId = "";
    for (let candidate = 0; candidate < 500 && seed < 0; candidate += 1) {
      const first = drawThree(candidate).map((card) => card.id);
      const giveWithoutExclude = drawThree(candidate + 9973).map((card) => card.id);
      const overlap = first.find((id) => giveWithoutExclude.includes(id));
      if (overlap) {
        seed = candidate;
        collidingId = overlap;
      }
    }
    expect(seed, "배선이 빠지면 겹치는 seed를 못 찾았다").toBeGreaterThanOrEqual(0);

    await mount(seed);
    await click(`[data-card="${collidingId}"]`);
    await clickPrimary();

    expect(cardIds()).not.toContain(collidingId);
    // 본문 전체로 확인하면 안 된다 — 첫 화면 안내에도 같은 문구가 있어서 늘 통과한다.
    expect(container.querySelector("h1")?.textContent).toBe(
      "이번엔 상대가 나한테 물어줄 한 장",
    );
  });

  /**
   * 이 제품의 약속은 「링크에는 이 한 장만 담겨요. 내가 고른 카드는 가지 않아요」다.
   * 공유 링크가 내 카드를 담으면 문구가 거짓말이 되고 상대가 잘못된 카드를 받는다.
   */
  it("공유 링크에는 상대 카드만 담기고 내 카드는 안 담긴다", async () => {
    await mount();
    const mine = cardIds()[0];
    await click(`[data-card="${mine}"]`);
    await clickPrimary();

    const theirs = cardIds()[0];
    await click(`[data-card="${theirs}"]`);
    await clickPrimary();

    const shareUrl = container
      .querySelector("[data-share-url]")
      ?.getAttribute("data-share-url");
    expect(shareUrl).toBe(`https://hanbang.ai/today/from?c=${theirs}`);
    expect(shareUrl).not.toContain(mine);
    expect(container.querySelector(`[data-card-face="${mine}"]`)).not.toBeNull();
  });

  // raw URL을 회색 상자에 뿌리면 캡처를 보내는 순간 어느 카드인지 들킨다.
  it("주소 원문을 화면 텍스트로 뿌리지 않는다", async () => {
    await mount();
    await click(`[data-card="${cardIds()[0]}"]`);
    await clickPrimary();
    await click(`[data-card="${cardIds()[0]}"]`);
    await clickPrimary();

    expect(container.querySelector("[data-share-url]")).not.toBeNull();
    expect(container.textContent).not.toContain("https://hanbang.ai/today/from");
  });

  it("상대 몫을 건너뛰면 공유 영역이 아예 없다", async () => {
    await mount();
    const mine = cardIds()[0];
    await click(`[data-card="${mine}"]`);
    await clickPrimary();

    await clickText("이번엔 안 고를게요");

    expect(container.querySelector(`[data-card-face="${mine}"]`)).not.toBeNull();
    expect(container.querySelector("[data-share-url]")).toBeNull();
    expect(container.textContent).not.toContain("상대가 나한테 물어줄 한 마디");
  });

  it("다시 고르기를 누르면 첫 화면으로 돌아온다", async () => {
    await mount();
    await click(`[data-card="${cardIds()[0]}"]`);
    await clickPrimary();
    await click(`[data-card="${cardIds()[0]}"]`);
    await clickPrimary();

    await clickText("다시 고르기");

    expect(cardIds()).toHaveLength(3);
    expect(container.querySelector("[data-card-face]")).toBeNull();
  });

  it("고른 카드의 문장이 결과 화면에 그대로 나온다", async () => {
    await mount();
    const mine = cardIds()[0];
    await click(`[data-card="${mine}"]`);
    await clickPrimary();
    await clickText("이번엔 안 고를게요");
    expect(showsSay(mine)).toBe(true);
  });
});

describe("카드 한 장", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("계약 확인 문구는 있는 카드에만 나온다", async () => {
    const withCheck = TODAY_DECK.find((card) => card.check !== "")!;
    await act(async () => root.render(<CardFace card={withCheck} />));
    expect(container.textContent).toContain("계약 전 확인할 것");
    expect(container.textContent).toContain(withCheck.check);

    const withoutCheck = TODAY_DECK.find((card) => card.check === "")!;
    await act(async () => root.render(<CardFace card={withoutCheck} />));
    expect(container.textContent).not.toContain("계약 전 확인할 것");
  });

  // 캡처 한 장이 그대로 돌아다니므로 출처가 카드 안에 있어야 한다.
  it("카드 안에 출처가 찍힌다", async () => {
    await act(async () => root.render(<CardFace card={TODAY_DECK[0]} />));
    expect(container.textContent).toContain("hanbang.ai");
  });
});
