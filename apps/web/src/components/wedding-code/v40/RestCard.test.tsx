import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_SEGMENT_NAMES } from "@/constants/weddingCodeV40";
import { V40_COPY, savedOnLine } from "@/lib/weddingCode/v40/copy";
import type { ProgressSegment, SectionIndex } from "@/lib/weddingCode/v40/types";
import { ActionBar, SectionCard } from "./SectionCard";
import { RestCard, type RestCardProps } from "./RestCard";
import { SelfIntroCard } from "./SelfIntroCard";
import { click, createHarness, isBefore, labelledByText, type Harness } from "./inputTestKit";
import { hasDash, notValidatedCount, visibleLabelProblems } from "./startFlowTestKit";

const TOTALS = [16, 16, 16, 16, 4] as const;

function segments(current: SectionIndex | null): ProgressSegment[] {
  return ([0, 1, 2, 3, 4] as const).map((index) => ({
    index,
    name: V40_SEGMENT_NAMES[index],
    done: current === null ? 0 : index < current ? TOTALS[index] : 0,
    total: TOTALS[index],
    current: current === index,
  }));
}

describe("쉬는 카드와 마지막 정리 카드", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  const text = () => harness.container.textContent ?? "";
  const buttons = () => [...harness.container.querySelectorAll<HTMLButtonElement>("button")];
  const buttonNamed = (name: string) => buttons().find((button) => button.textContent?.trim() === name);

  function renderRest(props: Partial<RestCardProps> = {}) {
    return harness.render(<RestCard after={0} onContinue={() => undefined} {...props} />);
  }

  describe("RestCard", () => {
    it.each([0, 1, 2] as const)("구간 %s 뒤: 제목이 화면 이름이고 몇 번째 구간인지는 글로 말하지 않는다", async (after) => {
      await renderRest({ after, saveState: "saved" });
      expect(harness.container.querySelector("h1")?.textContent).toBe(V40_COPY.rest.title);
      // 순서 낱말(첫 번째, 두 번째, 세 번째)은 화면에 내지 않는다: 진행 막대의 이름과 낭독 알림이 알려 준다.
      expect(text()).not.toMatch(/번째/u);
      expect(labelledByText(harness.container.querySelector("section")!)).toBe(V40_COPY.rest.title);
    });

    it("저장에 성공했을 때만 여기까지 저장했어요를 말한다(저장 날짜 줄은 없다: 쉬는 카드의 저장은 늘 오늘이다)", async () => {
      const at = Date.UTC(2026, 8, 29, 3);
      await renderRest({ saveState: "saved", savedAt: at });
      expect(text()).toContain(V40_COPY.rest.saved);
      expect(text()).not.toContain(savedOnLine(at)!);
      expect(text()).not.toContain(V40_COPY.rest.autosaveOff);
    });

    it("저장 상태를 모르면 저장했다는 말도 안 했다는 말도 하지 않는다", async () => {
      await renderRest({ saveState: null });
      expect(text()).not.toContain(V40_COPY.rest.saved);
      expect(text()).not.toContain(V40_COPY.rest.autosaveOff);
      expect(text()).not.toContain(V40_COPY.storageNotice.unavailable);
    });

    it("자동 저장이 꺼져 있으면 저장했다고 하지 않고 켜 달라고 하며 켜기 단추를 준다", async () => {
      const onTurnOnAutosave = vi.fn();
      await renderRest({ saveState: "off", onTurnOnAutosave });
      expect(text()).toContain(V40_COPY.rest.autosaveOff);
      expect(text()).not.toContain(V40_COPY.rest.saved);
      await click(buttonNamed(V40_COPY.rest.turnOnAutosaveButton));
      expect(onTurnOnAutosave).toHaveBeenCalledTimes(1);
    });

    it("이 브라우저에서 저장할 수 없으면 저장했다는 말 대신 저장 불가를 알린다", async () => {
      await renderRest({ saveState: "unavailable" });
      expect(text()).toContain(V40_COPY.storageNotice.unavailable);
      expect(text()).not.toContain(V40_COPY.rest.saved);
    });

    it("창끼리 어긋났으면 두 단추로 어느 답으로 이어 할지 고르게 한다", async () => {
      const onLoadSaved = vi.fn();
      const onKeepThis = vi.fn();
      await renderRest({ saveState: "conflict", onLoadSaved, onKeepThis });
      expect(text()).toContain(V40_COPY.storageNotice.conflict);
      expect(text()).not.toContain(V40_COPY.rest.saved);
      await click(buttonNamed(V40_COPY.storageNotice.loadSavedButton));
      await click(buttonNamed(V40_COPY.storageNotice.keepThisButton));
      expect(onLoadSaved).toHaveBeenCalledTimes(1);
      expect(onKeepThis).toHaveBeenCalledTimes(1);
    });

    it("이어서 하기가 onContinue 를 부르고, 이전은 콜백이 있을 때만 있다", async () => {
      const onContinue = vi.fn();
      const onBack = vi.fn();
      await renderRest({ onContinue });
      expect(buttonNamed(V40_COPY.question.previousButton)).toBeUndefined();
      await renderRest({ onContinue, onBack });
      await click(buttonNamed(V40_COPY.rest.continueButton));
      expect(onContinue).toHaveBeenCalledTimes(1);
      await click(buttonNamed(V40_COPY.question.previousButton));
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("진행 막대는 쉬어 가도 된다는 말을 낭독하고 그 구간 이름만 보인다", async () => {
      await renderRest({ after: 1, segments: segments(1) });
      const bar = harness.container.querySelector('[role="progressbar"]')!;
      expect(bar.getAttribute("aria-valuetext")).toBe(V40_COPY.progress.restAnnouncement);
      expect(harness.container.querySelectorAll("[data-segment-name]")).toHaveLength(1);
    });

    it("막대를 주지 않으면 그리지 않는다", async () => {
      await renderRest();
      expect(harness.container.querySelector('[role="progressbar"]')).toBeNull();
    });

    it("고지, 줄표, 번호, A/B 가 없다", async () => {
      await renderRest({ after: 2, segments: segments(2), saveState: "off", onTurnOnAutosave: vi.fn() });
      expect(notValidatedCount(harness.container)).toBe(0);
      expect(hasDash(text())).toBe(false);
      expect(visibleLabelProblems(harness.container, [])).toEqual([]);
    });

    it("이야기 카드나 구간 이름 카드가 아니다: 구간 이름 낱말이 제목이 아니다", async () => {
      await renderRest({ after: 0, segments: segments(0) });
      expect(harness.container.querySelector("h1")?.textContent).toBe(V40_COPY.rest.title);
      for (const name of V40_SEGMENT_NAMES) expect(harness.container.querySelector("h1")?.textContent).not.toBe(name);
    });

    it("라운지 안에서는 단추 줄이 하단 탭 위로 올라간다", async () => {
      await renderRest({ embedded: true });
      const bar = harness.container.querySelector<HTMLElement>("[data-action-bar]")!;
      expect(bar.className).toContain("max-md:bottom-[calc(75px+env(safe-area-inset-bottom))]");
    });

    it("이어서 하기는 단추 줄 안에 있고 저장 안내 뒤에 있다", async () => {
      await renderRest({ saveState: "saved" });
      const bar = harness.container.querySelector("[data-action-bar]")!;
      expect(bar.contains(buttonNamed(V40_COPY.rest.continueButton)!)).toBe(true);
      expect(isBefore(harness.container.querySelector("[data-rest-save]")!, bar)).toBe(true);
    });

    it("화면이 뜨면 초점이 화면 뿌리로 간다", async () => {
      await renderRest();
      expect(document.activeElement).toBe(harness.container.querySelector("section"));
    });
  });

  describe("글이 짧은 카드는 단추 줄을 화면 아래에 붙인다(질문 화면의 다음 단추와 같은 자리)", () => {
    it("쉬는 카드와 마지막 정리 카드의 뿌리는 화면 높이만큼 늘어나고 단추 줄 앞의 빈틈이 남는 높이를 먹는다", async () => {
      await renderRest();
      const rest = harness.container.querySelector("section")!;
      expect(rest.className).toContain("min-h-[calc(100dvh-5rem)]");
      expect(rest.className).toContain("flex-col");
      const spacer = rest.querySelector("[data-pin-bar-spacer]")!;
      expect(spacer.getAttribute("aria-hidden")).toBe("true");
      expect(spacer.className).toContain("flex-1");
      expect(isBefore(spacer, rest.querySelector("[data-action-bar]")!)).toBe(true);
      await harness.render(<SelfIntroCard onContinue={() => undefined} />);
      const wrapUp = harness.container.querySelector("section")!;
      expect(wrapUp.className).toContain("min-h-[calc(100dvh-5rem)]");
      expect(wrapUp.querySelector("[data-pin-bar-spacer]")).not.toBeNull();
    });

    it("라운지 안(embedded)에서는 바깥 화면이 높이를 정하므로 늘리지도 빈틈을 두지도 않는다", async () => {
      await renderRest({ embedded: true });
      const rest = harness.container.querySelector("section")!;
      expect(rest.className).not.toContain("min-h-dvh");
      expect(rest.querySelector("[data-pin-bar-spacer]")).toBeNull();
      await harness.render(<SelfIntroCard embedded onContinue={() => undefined} />);
      expect(harness.container.querySelector("section")!.className).not.toContain("min-h-dvh");
      expect(harness.container.querySelector("[data-pin-bar-spacer]")).toBeNull();
    });
  });

  describe("SelfIntroCard", () => {
    it("마지막 정리 한 문장과 이어서 하기뿐이다", async () => {
      const onContinue = vi.fn();
      await harness.render(<SelfIntroCard onContinue={onContinue} />);
      expect(harness.container.querySelector("h1")?.textContent).toBe(V40_COPY.wrapUp.intro);
      expect(text()).toBe(`${V40_COPY.wrapUp.intro}${V40_COPY.wrapUp.continueButton}`);
      await click(buttonNamed(V40_COPY.wrapUp.continueButton));
      expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it("이전은 콜백이 있을 때만 있다", async () => {
      const onBack = vi.fn();
      await harness.render(<SelfIntroCard onContinue={() => undefined} />);
      expect(buttonNamed(V40_COPY.question.previousButton)).toBeUndefined();
      await harness.render(<SelfIntroCard onContinue={() => undefined} onBack={onBack} />);
      await click(buttonNamed(V40_COPY.question.previousButton));
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("진행 막대는 마지막 정리를 낭독하고 그 이름만 보인다", async () => {
      await harness.render(<SelfIntroCard onContinue={() => undefined} segments={segments(4)} />);
      const bar = harness.container.querySelector('[role="progressbar"]')!;
      expect(bar.getAttribute("aria-valuetext")).toBe(V40_COPY.progress.sectionAnnouncements[4]);
      expect(harness.container.querySelector("[data-segment-name]")?.textContent).toBe(V40_COPY.progress.segmentNames[4]);
    });

    it("고지, 번호, A/B 가 없다", async () => {
      await harness.render(<SelfIntroCard onContinue={() => undefined} segments={segments(4)} embedded />);
      expect(notValidatedCount(harness.container)).toBe(0);
      expect(visibleLabelProblems(harness.container)).toEqual([]);
      expect(harness.container.querySelector<HTMLElement>("[data-action-bar]")!.className).toContain("75px");
    });
  });

  describe("SectionCard와 ActionBar", () => {
    it("제목이 영역의 이름이고 수준을 고를 수 있다", async () => {
      await harness.render(
        <>
          <SectionCard title="가" level={3} dataCard="x">
            <p>본문</p>
          </SectionCard>
        </>,
      );
      const card = harness.container.querySelector<HTMLElement>("section")!;
      expect(labelledByText(card)).toBe("가");
      expect(card.querySelector("h3")?.textContent).toBe("가");
      expect(card.getAttribute("data-section-card")).toBe("x");
    });

    it("ActionBar 는 바깥에서는 안전 영역만큼 안쪽 여백을 두고 안에서는 하단 탭 높이만큼 띄운다", async () => {
      await harness.render(<ActionBar>내용</ActionBar>);
      const plain = harness.container.querySelector<HTMLElement>("[data-action-bar]")!;
      expect(plain.className).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
      expect(plain.className).not.toContain("75px");
      await harness.render(<ActionBar embedded>내용</ActionBar>);
      const embedded = harness.container.querySelector<HTMLElement>("[data-action-bar]")!;
      expect(embedded.className).toContain("max-md:bottom-[calc(75px+env(safe-area-inset-bottom))]");
    });
  });
});
