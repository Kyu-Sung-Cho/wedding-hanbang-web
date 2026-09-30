import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { Perspective } from "@/lib/weddingCode/v40/types";
import { CouplePerspectiveSwitch } from "./CouplePerspectiveSwitch";
import { click, createHarness, describedByText, labelProblemsIn, type Harness } from "./inputTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
});

const radios = () => [...harness.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const text = () => harness.container.textContent ?? "";

/** 부모처럼 선택을 들고 있는 껍데기: 사람이 고른 것이 있으면 그것, 없으면 detected. */
function Host({ detected, spy }: { readonly detected: Perspective | null; readonly spy: (value: Perspective) => void }) {
  const [chosen, setChosen] = useState<Perspective | null>(null);
  return (
    <CouplePerspectiveSwitch
      idPrefix="t-persp"
      detected={detected}
      value={chosen ?? detected}
      onChange={(next) => {
        spy(next);
        setChosen(next);
      }}
    />
  );
}

describe("CouplePerspectiveSwitch", () => {
  it("이 기기의 내 답이 링크와 같으면 자동으로 정했다는 한 줄과 함께 그쪽이 골라져 있다", async () => {
    await harness.render(<CouplePerspectiveSwitch idPrefix="t-persp" detected="second" value="second" onChange={() => undefined} />);
    expect(harness.container.querySelector("legend")?.textContent).toBe(V40_COPY.couple.perspective.groupLabel);
    expect(radios().map((radio) => radio.checked)).toEqual([false, true]);
    expect(text()).toContain(V40_COPY.couple.perspective.autoNote);
    expect(text()).not.toContain(V40_COPY.couple.perspective.askNote);
    expect(describedByText(radios()[1])).toBe(V40_COPY.couple.perspective.autoNote);
  });

  it("맞는 것이 없고 고른 것도 없으면 누가 나인지 고르게 하고 아무것도 골라져 있지 않다", async () => {
    await harness.render(<CouplePerspectiveSwitch idPrefix="t-persp" detected={null} value={null} onChange={() => undefined} />);
    expect(radios().map((radio) => radio.checked)).toEqual([false, false]);
    expect(text()).toContain(V40_COPY.couple.perspective.askNote);
    expect(text()).not.toContain(V40_COPY.couple.perspective.autoNote);
    expect(text()).toContain(V40_COPY.couple.perspective.iAmFirstOption);
    expect(text()).toContain(V40_COPY.couple.perspective.iAmSecondOption);
  });

  it("사람이 고르면 onChange 가 불리고 안내 글이 사라진다(이미 정했다)", async () => {
    const spy = vi.fn();
    await harness.render(<Host detected={null} spy={spy} />);
    await click(radios()[1]);
    expect(spy).toHaveBeenCalledWith("second");
    expect(radios().map((radio) => radio.checked)).toEqual([false, true]);
    expect(text()).not.toContain(V40_COPY.couple.perspective.askNote);
    await click(radios()[0]);
    expect(spy).toHaveBeenLastCalledWith("first");
    expect(radios().map((radio) => radio.checked)).toEqual([true, false]);
  });

  it("자동으로 정한 뒤 사람이 다른 쪽을 고르면 자동으로 정했다는 말이 사라진다(더는 참이 아니다)", async () => {
    const spy = vi.fn();
    await harness.render(<Host detected="first" spy={spy} />);
    expect(text()).toContain(V40_COPY.couple.perspective.autoNote);
    await click(radios()[1]);
    expect(spy).toHaveBeenCalledWith("second");
    expect(text()).not.toContain(V40_COPY.couple.perspective.autoNote);
    expect(text()).not.toContain(V40_COPY.couple.perspective.askNote);
  });

  it("라디오 둘은 같은 이름의 진짜 라디오이고 번호나 A/B 라벨이 없다", async () => {
    await harness.render(<CouplePerspectiveSwitch idPrefix="t-persp" detected={null} value={null} onChange={() => undefined} />);
    expect(new Set(radios().map((radio) => radio.name)).size).toBe(1);
    expect(labelProblemsIn(harness.container)).toEqual([]);
  });
});
