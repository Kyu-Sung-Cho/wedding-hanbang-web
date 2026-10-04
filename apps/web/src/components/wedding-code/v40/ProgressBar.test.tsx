import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { V40_SEGMENT_NAMES } from "@/constants/weddingCodeV40";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ProgressSegment, SectionIndex } from "@/lib/weddingCode/v40/types";
import { ProgressBar } from "./ProgressBar";
import { createHarness, labelProblems, labelProblemsIn, type Harness } from "./inputTestKit";

const TOTALS = [16, 16, 16, 16, 4] as const;

/** flow.progressSegments 와 같은 모양의 다섯 칸. current 가 null 이면 어느 칸도 아니다(소개, 결과). */
function segments(current: SectionIndex | null, done: readonly number[] = [0, 0, 0, 0, 0]): ProgressSegment[] {
  return ([0, 1, 2, 3, 4] as const).map((index) => ({
    index,
    name: V40_SEGMENT_NAMES[index],
    done: done[index],
    total: TOTALS[index],
    current: current === index,
  }));
}

describe("ProgressBar", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  function bar(): HTMLElement {
    const element = harness.container.querySelector<HTMLElement>('[role="progressbar"]');
    if (!element) throw new Error("진행 막대가 없어요");
    return element;
  }

  it("progressbar 하나이고 이름이 진행 상황이다", async () => {
    await harness.render(<ProgressBar segments={segments(0)} />);
    expect(harness.container.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(bar().getAttribute("aria-label")).toBe(V40_COPY.progress.regionLabel);
  });

  it.each([0, 1, 2, 3, 4] as const)("구간 %s 에 있으면 낭독기에 그 구간 알림이 읽힌다", async (index) => {
    await harness.render(<ProgressBar segments={segments(index)} />);
    expect(bar().getAttribute("aria-valuetext")).toBe(V40_COPY.progress.sectionAnnouncements[index]);
  });

  it("두 번째 구간의 알림은 「지금 두 번째 구간이에요」다", async () => {
    await harness.render(<ProgressBar segments={segments(1)} />);
    expect(bar().getAttribute("aria-valuetext")).toBe("지금 두 번째 구간이에요");
  });

  it("지금 칸의 이름만 보이고 나머지 칸 이름은 그리지 않는다", async () => {
    for (const index of [0, 1, 2, 3, 4] as const) {
      await harness.render(<ProgressBar segments={segments(index)} />);
      const text = harness.container.textContent ?? "";
      expect(text).toBe(V40_COPY.progress.segmentNames[index]);
      const others = V40_SEGMENT_NAMES.filter((_, other) => other !== index);
      for (const name of others) {
        // 「처음」은 다른 이름의 부분 문자열일 수 있어 이름 하나가 통째로 같은 요소가 없는지로 본다.
        const named = [...harness.container.querySelectorAll("[data-segment-name]")].map((element) => element.textContent);
        expect(named).not.toContain(name);
      }
      expect(harness.container.querySelectorAll("[data-segment-name]")).toHaveLength(1);
    }
  });

  it("마지막 칸의 이름은 16px 남짓한 칸 안이 아니라 줄 오른쪽 끝에 한 번 붙는다(가로 넘침 방지)", async () => {
    await harness.render(<ProgressBar segments={segments(4)} />);
    const names = harness.container.querySelectorAll<HTMLElement>("[data-segment-name]");
    expect(names).toHaveLength(1);
    const name = names[0]!;
    expect(name.className).toContain("absolute");
    expect(name.className).toContain("right-0");
    expect(name.className).toContain("whitespace-nowrap");
    // 칸(flex-grow 를 가진 상자) 안에 들어 있지 않다.
    expect(name.closest<HTMLElement>("[style*='flex-grow']")).toBeNull();
    // 이름 줄은 자리 잡은 상자(relative)라 오른쪽 끝 기준이 이 줄이다.
    expect(name.parentElement?.className).toContain("relative");
    // 다른 칸의 이름은 칸 안에 그대로 있다(넘칠 만큼 좁은 칸이 아니다).
    await harness.render(<ProgressBar segments={segments(0)} />);
    const first = harness.container.querySelector<HTMLElement>("[data-segment-name]")!;
    expect(first.className).not.toContain("absolute");
    expect(first.closest<HTMLElement>("[style*='flex-grow']")).not.toBeNull();
  });

  it("소개나 결과처럼 어느 칸도 아니면 이름도 낭독 알림도 없다", async () => {
    await harness.render(<ProgressBar segments={segments(null)} />);
    expect(harness.container.querySelectorAll("[data-segment-name]")).toHaveLength(0);
    expect(bar().hasAttribute("aria-valuetext")).toBe(false);
  });

  it("announcement 를 주면 지금 칸 알림 대신 그 말이 읽힌다(쉬는 카드)", async () => {
    await harness.render(<ProgressBar segments={segments(0)} announcement={V40_COPY.progress.restAnnouncement} />);
    expect(bar().getAttribute("aria-valuetext")).toBe(V40_COPY.progress.restAnnouncement);
  });

  it("보이는 글자에 번호와 n/N 과 A/B 가 없다", async () => {
    for (const index of [0, 1, 2, 3, 4] as const) {
      await harness.render(<ProgressBar segments={segments(index, [8, 3, 0, 0, 0])} />);
      expect(labelProblems(harness.container.textContent ?? "")).toEqual([]);
      expect(labelProblemsIn(harness.container)).toEqual([]);
      expect(harness.container.textContent ?? "").not.toMatch(/\d|\//);
    }
  });

  it("칸 너비는 문항 수에 비례하고 칸 안은 저장된 문항 수만큼 찬다", async () => {
    await harness.render(<ProgressBar segments={segments(1, [16, 8, 0, 0, 0])} />);
    const cells = [...harness.container.querySelectorAll<HTMLElement>("[data-segment]")];
    expect(cells).toHaveLength(5);
    expect(cells.map((cell) => cell.style.flexGrow)).toEqual(["16", "16", "16", "16", "4"]);
    const fills = cells.map((cell) => cell.querySelector<HTMLElement>("[data-fill]")!.style.width);
    expect(fills).toEqual(["100%", "50%", "0%", "0%", "0%"]);
  });

  it("낭독기가 읽는 값은 0 에서 전체 문항 수까지 중 저장된 문항 수다", async () => {
    await harness.render(<ProgressBar segments={segments(1, [16, 8, 0, 0, 0])} />);
    expect(bar().getAttribute("aria-valuemin")).toBe("0");
    expect(bar().getAttribute("aria-valuemax")).toBe("68");
    expect(bar().getAttribute("aria-valuenow")).toBe("24");
    await harness.render(<ProgressBar segments={segments(0)} />);
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
    expect(bar().getAttribute("aria-valuemax")).toBe("68");
  });

  it("차오른 부분은 고대비 모드에서도 보이도록 강조색 대신 시스템 색을 쓴다", async () => {
    await harness.render(<ProgressBar segments={segments(1, [16, 8, 0, 0, 0])} />);
    const fills = [...harness.container.querySelectorAll<HTMLElement>("[data-fill]")];
    expect(fills).toHaveLength(5);
    for (const fill of fills) {
      expect(fill.className).toContain("forced-colors:bg-[Highlight]");
    }
  });

  it("범위 밖 값이 와도 막대가 넘치거나 음수가 되지 않는다", async () => {
    const odd: ProgressSegment[] = [
      { index: 0, name: "처음", done: 40, total: 16, current: true },
      { index: 1, name: "이어서", done: -3, total: 16, current: false },
      { index: 2, name: "절반쯤", done: 5, total: 0, current: false },
    ];
    await harness.render(<ProgressBar segments={odd} />);
    const fills = [...harness.container.querySelectorAll<HTMLElement>("[data-fill]")].map((element) => element.style.width);
    expect(fills).toEqual(["100%", "0%", "0%"]);
  });

  it("칸이 하나도 없으면 아무것도 그리지 않는다", async () => {
    await harness.render(<ProgressBar segments={[]} />);
    expect(harness.container.innerHTML).toBe("");
  });

  it("지금 칸은 색이 아니라 굵기와 이름으로 알린다", async () => {
    await harness.render(<ProgressBar segments={segments(2)} />);
    const current = harness.container.querySelector<HTMLElement>('[data-segment="2"]')!;
    const other = harness.container.querySelector<HTMLElement>('[data-segment="1"]')!;
    expect(current.hasAttribute("data-current")).toBe(true);
    expect(other.hasAttribute("data-current")).toBe(false);
    expect(current.className).toContain("h-2");
    expect(other.className).toContain("h-1.5");
  });
});
