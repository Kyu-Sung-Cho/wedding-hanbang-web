import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COPY, storageExpiredNote } from "@/lib/weddingCode/v40/copy";
import {
  BoundaryFallbackScreen,
  BrokenLinkScreen,
  NoCompareScreen,
  PositionGateScreen,
  StorageNotice,
} from "./NoticeScreens";
import { click, createHarness, labelledByText, type Harness } from "./inputTestKit";
import { hasDash, notValidatedCount, visibleLabelProblems } from "./startFlowTestKit";

describe("NoticeScreens", () => {
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

  describe("StorageNotice", () => {
    it.each([
      ["unavailable", V40_COPY.storageNotice.unavailable],
      ["invalid", V40_COPY.storageNotice.invalid],
      ["invalidClock", `${V40_COPY.storageNotice.invalid} 폰 날짜와 시간이 맞는지 확인해 보세요.`],
      ["expired", storageExpiredNote()],
      ["conflict", V40_COPY.storageNotice.conflict],
    ] as const)("%s 는 copy.ts 의 문구를 그대로 말한다", async (problem, expected) => {
      await harness.render(<StorageNotice problem={problem} />);
      expect(text()).toBe(expected);
    });

    it("창끼리 어긋난 안내는 두 단추가 각각 무엇을 지우는지 누르기 전에 말한다", () => {
      const conflict = V40_COPY.storageNotice.conflict;
      expect(conflict).toContain("저장된 답을 불러오면 이 창에서 넘긴 답은 쓰이지 않고");
      expect(conflict).toContain("이 창의 답으로 저장하면 다른 창에서 저장한 답은 사라져요");
    });

    it("live 를 끄면 안내 글 자신은 알림 영역이 아니다(부모의 알림 영역 안에 넣을 때). conflict 는 늘 alert 다", async () => {
      await harness.render(<StorageNotice problem="unavailable" live={false} />);
      expect(harness.container.querySelector("[role]")).toBeNull();
      await harness.render(<StorageNotice problem="unavailable" />);
      expect(harness.container.querySelector('[role="status"]')).not.toBeNull();
      await harness.render(<StorageNotice problem="conflict" live={false} />);
      expect(harness.container.querySelector('[role="alert"]')).not.toBeNull();
    });

    it("창끼리 어긋났을 때만 두 단추가 있고 각각 자기 콜백을 부른다", async () => {
      const onLoadSaved = vi.fn();
      const onKeepThis = vi.fn();
      await harness.render(<StorageNotice problem="conflict" onLoadSaved={onLoadSaved} onKeepThis={onKeepThis} />);
      expect(buttons().map((button) => button.textContent?.trim())).toEqual([
        V40_COPY.storageNotice.loadSavedButton,
        V40_COPY.storageNotice.keepThisButton,
      ]);
      await click(buttonNamed(V40_COPY.storageNotice.loadSavedButton));
      expect(onLoadSaved).toHaveBeenCalledTimes(1);
      expect(onKeepThis).not.toHaveBeenCalled();
      await click(buttonNamed(V40_COPY.storageNotice.keepThisButton));
      expect(onKeepThis).toHaveBeenCalledTimes(1);
    });

    it("다른 문제에는 단추가 없다", async () => {
      for (const problem of ["unavailable", "invalid", "invalidClock", "expired"] as const) {
        await harness.render(<StorageNotice problem={problem} onLoadSaved={vi.fn()} onKeepThis={vi.fn()} />);
        expect(buttons()).toHaveLength(0);
      }
    });

    it("어긋남은 alert 로, 나머지는 status 로 알린다", async () => {
      await harness.render(<StorageNotice problem="conflict" />);
      expect(harness.container.querySelector('[role="alert"]')).not.toBeNull();
      await harness.render(<StorageNotice problem="unavailable" />);
      expect(harness.container.querySelector('[role="status"]')).not.toBeNull();
      expect(harness.container.querySelector('[role="alert"]')).toBeNull();
    });

    it("저장됐다고 말하는 글이 없다", async () => {
      for (const problem of ["unavailable", "invalid", "invalidClock", "expired", "conflict"] as const) {
        await harness.render(<StorageNotice problem={problem} />);
        expect(text()).not.toContain("저장했어요");
        expect(text()).not.toContain(V40_COPY.autosave.statusOn);
      }
    });
  });

  describe("BrokenLinkScreen", () => {
    it("제목, 본문, 처음부터 시작하기 단추가 copy.ts 의 문구다", async () => {
      const onStart = vi.fn();
      await harness.render(<BrokenLinkScreen onStart={onStart} />);
      const copy = V40_COPY.error.brokenLink;
      expect(harness.container.querySelector("h1")?.textContent).toBe(copy.title);
      expect(text()).toContain(copy.body);
      expect(buttons().map((button) => button.textContent?.trim())).toEqual([copy.startButton]);
      await click(buttons()[0]);
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it("같은 안내를 이미 화면에 내보냈으면 제목을 다시 보이지 않고 화면 이름으로만 남긴다", async () => {
      await harness.render(<BrokenLinkScreen onStart={vi.fn()} noticeShown />);
      expect(harness.container.querySelector("h1")).toBeNull();
      expect(text()).not.toContain(V40_COPY.error.brokenLink.title);
      expect(harness.container.querySelector("section")?.getAttribute("aria-label")).toBe(V40_COPY.error.brokenLink.title);
    });

    it("기본값을 채우지 않는다: 답이나 글자가 없다", async () => {
      await harness.render(<BrokenLinkScreen onStart={vi.fn()} />);
      expect(harness.container.querySelectorAll("[role='radio'], [role='table'], table")).toHaveLength(0);
    });
  });

  describe("PositionGateScreen", () => {
    it("같은 위치만 눌렀을 때는 그 안내와 처음부터 다시 하기만 있다", async () => {
      const onRestart = vi.fn();
      await harness.render(<PositionGateScreen reason="rhythm" onRestart={onRestart} onReviewSkipped={vi.fn()} />);
      expect(harness.container.querySelector("h1")?.textContent).toBe(V40_COPY.gate.title);
      expect(text()).toContain(V40_COPY.gate.rhythmBody);
      expect(text()).not.toContain(V40_COPY.gate.noInformationBody);
      expect(text()).toContain(V40_COPY.gate.noLinkNote);
      expect(buttons().map((button) => button.textContent?.trim())).toEqual([V40_COPY.gate.restartButton]);
      await click(buttons()[0]);
      expect(onRestart).toHaveBeenCalledTimes(1);
    });

    it("확정 글자가 없는데 다시 볼 넘어간 질문이 없으면 없는 단추(넘어간 질문 다시 보기)를 권하지 않는다", async () => {
      await harness.render(<PositionGateScreen reason="noInformation" onRestart={vi.fn()} />);
      expect(text()).toContain(V40_COPY.gate.noInformationBodyRestartOnly);
      expect(text()).not.toContain(V40_COPY.gate.noInformationBody);
      expect(text()).not.toContain("넘어간 질문을 다시 보거나");
      expect(buttons().map((button) => button.textContent?.trim())).toEqual([V40_COPY.gate.restartButton]);
    });

    it("확정 글자가 없을 때는 넘어간 질문 다시 보기가 함께 있다", async () => {
      const onReviewSkipped = vi.fn();
      await harness.render(<PositionGateScreen reason="noInformation" onRestart={vi.fn()} onReviewSkipped={onReviewSkipped} />);
      expect(text()).toContain(V40_COPY.gate.noInformationBody);
      expect(buttons().map((button) => button.textContent?.trim())).toEqual([
        V40_COPY.gate.restartButton,
        V40_COPY.gate.reviewSkippedButton,
      ]);
      await click(buttonNamed(V40_COPY.gate.reviewSkippedButton));
      expect(onReviewSkipped).toHaveBeenCalledTimes(1);
    });

    it("다시 볼 질문이 없어 콜백을 주지 않으면 그 단추를 그리지 않는다", async () => {
      await harness.render(<PositionGateScreen reason="noInformation" onRestart={vi.fn()} />);
      expect(buttonNamed(V40_COPY.gate.reviewSkippedButton)).toBeUndefined();
    });

    it("글자, 링크, 고지는 보이지 않는다", async () => {
      await harness.render(<PositionGateScreen reason="rhythm" onRestart={vi.fn()} />);
      expect(notValidatedCount(harness.container)).toBe(0);
      expect(harness.container.querySelectorAll("a")).toHaveLength(0);
    });
  });

  describe("NoCompareScreen", () => {
    it("두 사람 결과를 만들 수 없다는 안내와 처음부터 다시 하기가 있고 볼 수 있다고 약속하지 않는다", async () => {
      const onRestart = vi.fn();
      await harness.render(<NoCompareScreen onRestart={onRestart} />);
      expect(text()).toContain(V40_COPY.receive.noCompareNote);
      expect(buttons().map((button) => button.textContent?.trim())).toEqual([V40_COPY.receive.noCompareRestartButton]);
      expect(text()).not.toMatch(/볼 수 있을 거예요|반드시|꼭 볼/);
      await click(buttons()[0]);
      expect(onRestart).toHaveBeenCalledTimes(1);
    });
  });

  describe("BoundaryFallbackScreen", () => {
    it("제목, 새로고침 안내, 새로고침 단추가 copy.ts 의 문구이고 alert 로 읽힌다", async () => {
      const onReload = vi.fn();
      await harness.render(<BoundaryFallbackScreen onReload={onReload} />);
      const copy = V40_COPY.error.boundary;
      expect(harness.container.querySelector("h1")?.textContent).toBe(copy.title);
      expect(text()).toContain(copy.body);
      expect(harness.container.querySelector('[role="alert"]')).not.toBeNull();
      await click(buttonNamed(copy.reloadButton));
      expect(onReload).toHaveBeenCalledTimes(1);
    });
  });

  describe("모든 안내 화면", () => {
    const screens = [
      ["깨진 링크", () => <BrokenLinkScreen onStart={vi.fn()} />],
      ["관문(같은 위치)", () => <PositionGateScreen reason="rhythm" onRestart={vi.fn()} />],
      ["관문(정보 없음)", () => <PositionGateScreen reason="noInformation" onRestart={vi.fn()} onReviewSkipped={vi.fn()} />],
      ["두 사람 결과 불가", () => <NoCompareScreen onRestart={vi.fn()} />],
      ["오류 대체", () => <BoundaryFallbackScreen onReload={vi.fn()} />],
    ] as const;

    it.each(screens)("%s: 번호와 A/B 가 없고 줄표가 없다", async (_name, render) => {
      await harness.render(render());
      expect(visibleLabelProblems(harness.container)).toEqual([]);
      expect(hasDash(text())).toBe(false);
    });

    it.each(screens)("%s: 제목이 화면 이름이고 화면이 뜨면 초점이 간다", async (_name, render) => {
      await harness.render(render());
      const section = harness.container.querySelector("section")!;
      expect(labelledByText(section)).toBe(harness.container.querySelector("h1")!.textContent);
      expect(document.activeElement).toBe(section);
    });

    it.each(screens)("%s: 모든 단추가 진짜 단추이고 꺼져 있지 않다", async (_name, render) => {
      await harness.render(render());
      expect(buttons().length).toBeGreaterThan(0);
      for (const button of buttons()) {
        expect(button.type).toBe("button");
        expect(button.disabled).toBe(false);
        expect(button.getAttribute("aria-disabled")).toBeNull();
      }
    });
  });
});
