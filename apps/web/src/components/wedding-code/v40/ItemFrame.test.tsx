import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ItemView, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { ItemFrame } from "./ItemFrame";
import {
  Controlled,
  click,
  createHarness,
  describedByText,
  isBefore,
  labelProblemsIn,
  labelledByText,
  pairView,
  recallView,
  type Harness,
} from "./inputTestKit";

describe("ItemFrame", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  function statusOf(): HTMLElement {
    const status = harness.container.querySelector<HTMLElement>('[role="status"]');
    if (!status) throw new Error("안내 자리가 없어요");
    return status;
  }

  function buttons(): HTMLButtonElement[] {
    return [...harness.container.querySelectorAll<HTMLButtonElement>("button")];
  }

  async function renderFrame(view: ItemView, value: ViewAnswer | null, onAnswer = vi.fn(), hint?: string | null) {
    await harness.render(
      <ItemFrame view={view} value={value} onAnswer={onAnswer} idPrefix="q1" hint={hint}>
        <div data-testid="slot">입력 자리</div>
      </ItemFrame>,
    );
    return onAnswer;
  }

  it("캡션, 앞말을 그리고 그룹 이름이 캡션이다", async () => {
    const view = pairView(0);
    await renderFrame(view, null);
    const group = harness.container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(labelledByText(group!)).toBe(view.caption);
    const text = harness.container.textContent ?? "";
    expect(text).toContain(view.caption);
    expect(text).toContain(view.stem);
    expect(text.indexOf(view.caption)).toBeLessThan(text.indexOf(view.stem));
  });

  it("형식 안내 한 줄은 hint 를 줄 때만 그린다", async () => {
    const view = pairView(0);
    await renderFrame(view, null);
    expect(harness.container.querySelector("#q1-hint")).toBeNull();

    await renderFrame(view, null, vi.fn(), "더 나 같은 쪽을 골라 주세요. 얼마나 가까운지도 함께 눌러요.");
    const hint = harness.container.querySelector("#q1-hint");
    expect(hint?.textContent).toBe("더 나 같은 쪽을 골라 주세요. 얼마나 가까운지도 함께 눌러요.");

    await renderFrame(view, null, vi.fn(), null);
    expect(harness.container.querySelector("#q1-hint")).toBeNull();
  });

  it("입력 자리는 앞말 뒤, 넘기기 단추 앞에 놓인다", async () => {
    const view = pairView(0);
    await renderFrame(view, null, vi.fn(), "안내");
    const slot = harness.container.querySelector('[data-testid="slot"]')!;
    const stem = harness.container.querySelector("#q1-stem")!;
    const hint = harness.container.querySelector("#q1-hint")!;
    const [unsure, na] = buttons();
    expect(isBefore(stem, hint)).toBe(true);
    expect(isBefore(hint, slot)).toBe(true);
    expect(isBefore(slot, unsure)).toBe(true);
    expect(isBefore(unsure, na)).toBe(true);
  });

  it("작은 단추 둘은 뷰가 준 이름이고 실제 버튼이며 꺼져 있지 않다", async () => {
    const view = pairView(0);
    await renderFrame(view, null);
    const found = buttons();
    expect(found.map((button) => button.textContent?.trim())).toEqual(["잘 모르겠어요", "제 상황과 안 맞아요"]);
    expect(found.map((button) => button.textContent?.trim())).toEqual([view.escapes.unsure, view.escapes.notApplicable]);
    for (const button of found) {
      expect(button.type).toBe("button");
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-disabled")).toBeNull();
      // 터치 목표 44픽셀(전역 규칙과 별개로 클래스에도 둔다).
      expect(button.className).toMatch(/min-h-1[1-9]/);
    }
  });

  it("단추를 누르면 넘기기 답을 한 번씩만 알린다", async () => {
    const onAnswer = await renderFrame(pairView(0), null);
    const [unsure, na] = buttons();
    await click(unsure);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenLastCalledWith({ fmt: "escape", which: "unsure" });
    await click(na);
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenLastCalledWith({ fmt: "escape", which: "na" });
  });

  it("두 단추는 낭독 설명이 붙어 있다", async () => {
    await renderFrame(pairView(0), null);
    for (const button of buttons()) {
      expect(describedByText(button)).toBe(V40_COPY.question.escapeDescription);
    }
  });

  it("설명 글은 숨긴 글이라 훑어 읽을 때 문항마다 나오지 않고, 단추 설명으로만 읽힌다", async () => {
    await renderFrame(pairView(0), null);
    const help = harness.container.querySelector<HTMLElement>("#q1-escape-help");
    expect(help).not.toBeNull();
    expect(help?.hasAttribute("hidden")).toBe(true);
    expect(help?.textContent).toBe(V40_COPY.question.escapeDescription);
    // 숨김이 아닌 곳에는 이 문장이 다시 나오지 않는다.
    const copy = harness.container.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[hidden]").forEach((node) => node.remove());
    expect(copy.textContent).not.toContain(V40_COPY.question.escapeDescription);
  });

  it("눌린 넘기기 단추를 다시 눌러도 같은 답을 다시 알릴 뿐 풀리지 않는다(푸는 길은 다른 답을 고르는 것)", async () => {
    const view = pairView(0);
    const spy = vi.fn();
    await harness.render(
      <Controlled spy={spy}>
        {({ value, onAnswer }) => (
          <ItemFrame view={view} value={value} onAnswer={onAnswer} idPrefix="q1">
            <span>입력 자리</span>
          </ItemFrame>
        )}
      </Controlled>,
    );
    await click(buttons()[0]);
    await click(buttons()[0]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith({ fmt: "escape", which: "unsure" });
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(statusOf().textContent).toBe(V40_COPY.question.escapeChosenUnsure);
  });

  it("두 단추는 고대비에서도 초점이 보이도록 투명 윤곽선을 되살린다", async () => {
    await renderFrame(pairView(0), null);
    for (const button of buttons()) {
      expect(button.className).toContain("focus-visible:outline-hidden!");
    }
  });

  it("separated 를 주면 문항 위에 가는 선과 넉넉한 빈칸이 붙고, 주지 않으면 붙지 않는다", async () => {
    const view = pairView(0);
    await renderFrame(view, null);
    const plain = harness.container.querySelector<HTMLElement>('[role="group"]')!;
    expect(plain.className).not.toMatch(/border-t|pt-8/);
    await harness.render(
      <ItemFrame view={view} value={null} onAnswer={vi.fn()} idPrefix="q1" separated>
        <span>입력 자리</span>
      </ItemFrame>,
    );
    const separated = harness.container.querySelector<HTMLElement>('[role="group"]')!;
    expect(separated.className).toMatch(/border-t/);
    expect(separated.className).toMatch(/pt-8/);
    expect(separated.className).toMatch(/mt-8/);
    // 그룹 이름은 여전히 캡션이다.
    expect(labelledByText(separated)).toBe(view.caption);
  });

  it("누른 단추만 눌림 상태이고 안내 한 줄이 바뀐다", async () => {
    const view = pairView(0);
    await renderFrame(view, null);
    expect(buttons().map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    expect(statusOf().textContent).toBe("");

    await renderFrame(view, { fmt: "escape", which: "unsure" });
    expect(buttons().map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(statusOf().textContent).toBe(V40_COPY.question.escapeChosenUnsure);

    await renderFrame(view, { fmt: "escape", which: "na" });
    expect(buttons().map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(statusOf().textContent).toBe(V40_COPY.question.escapeChosenNotApplicable);

    // 다른 답을 고르면 다시 원래대로.
    await renderFrame(view, { fmt: "pair", cell: 2 });
    expect(buttons().map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    expect(statusOf().textContent).toBe("");
  });

  it("눌림 상태는 색뿐 아니라 체크 표식으로도 보인다", async () => {
    await renderFrame(pairView(0), { fmt: "escape", which: "unsure" });
    const [unsure, na] = buttons();
    expect(unsure.querySelector("svg")).not.toBeNull();
    expect(na.querySelector("svg")).toBeNull();
  });

  it("안내 자리는 비어 있어도 aria-live 로 처음부터 문서에 있다", async () => {
    await renderFrame(pairView(0), null);
    const status = statusOf();
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("");
  });

  it("지난 일 떠올리기에서 해당 없음은 이런 일이 없었어요 문장으로 알린다", async () => {
    await renderFrame(recallView(0), { fmt: "escape", which: "na" });
    expect(statusOf().textContent).toBe(V40_COPY.question.escapeChosenRecallNone);
  });

  it("누르면 부모가 준 값으로 다시 그려 안내가 바뀐다(제어되는 부모)", async () => {
    const view = pairView(0);
    const spy = vi.fn();
    await harness.render(
      <Controlled spy={spy}>
        {({ value, onAnswer }) => (
          <ItemFrame view={view} value={value} onAnswer={onAnswer} idPrefix="q1">
            <span>입력 자리</span>
          </ItemFrame>
        )}
      </Controlled>,
    );
    await click(buttons()[0]);
    expect(statusOf().textContent).toBe(V40_COPY.question.escapeChosenUnsure);
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("true");
    await click(buttons()[1]);
    expect(statusOf().textContent).toBe(V40_COPY.question.escapeChosenNotApplicable);
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("false");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("번호, n/N, A/B, 가나 라벨이 보이지 않는다", async () => {
    await renderFrame(pairView(0), { fmt: "escape", which: "na" }, vi.fn(), "더 나 같은 쪽을 골라 주세요. 얼마나 가까운지도 함께 눌러요.");
    expect(labelProblemsIn(harness.container)).toEqual([]);
  });

  it("문항 id 나 형식 이름을 화면에 내지 않는다", async () => {
    const view = pairView(0);
    await renderFrame(view, null);
    const html = harness.container.innerHTML;
    expect(html).not.toContain(view.id);
    expect(html).not.toMatch(/data-item|data-axis|data-facet/);
  });
});
