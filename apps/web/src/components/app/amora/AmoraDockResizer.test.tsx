import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AmoraDockResizer from "./AmoraDockResizer";
import { AMORA_DOCK_RATIO_MAX, AMORA_DOCK_RATIO_MIN, AMORA_DOCK_RATIO_STEP } from "./amoraDock";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("본문과 아모라 사이 경계", () => {
  let root: Root;
  let container: HTMLDivElement;
  let row: HTMLDivElement;
  let pane: HTMLDivElement;
  const onCommit = vi.fn();

  beforeEach(() => {
    onCommit.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    row = document.createElement("div");
    pane = document.createElement("div");
    // 줄은 사이드바 220px 오른쪽에서 1200px 이다.
    row.getBoundingClientRect = () => ({ left: 220, width: 1200, right: 1420, top: 0, bottom: 900, height: 900, x: 220, y: 0, toJSON: () => ({}) });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(ratio: number) {
    const rowRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
    rowRef.current = row;
    const paneRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
    paneRef.current = pane;
    await act(async () => root.render(
      <AmoraDockResizer ratio={ratio} rowRef={rowRef} paneRef={paneRef} paneId="amora-dock-pane" onCommit={onCommit} />,
    ));
    return container.querySelector<HTMLDivElement>('[role="separator"]')!;
  }

  function press(separator: HTMLElement, key: string) {
    act(() => {
      separator.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }

  it("값은 왼쪽 칸(본문)의 몫으로 읽힌다. 아모라 몫은 글로 함께 말한다", async () => {
    const separator = await render(AMORA_DOCK_RATIO_MAX);
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-controls")).toBe("amora-dock-pane");
    expect(separator.getAttribute("aria-valuenow")).toBe("50");
    expect(separator.getAttribute("aria-valuemin")).toBe("50");
    expect(separator.getAttribute("aria-valuemax")).toBe("67");
    expect(separator.getAttribute("aria-valuetext")).toBe("아모라가 50%를 차지해요");
    expect(separator.tabIndex).toBe(0);

    // 반반일 때는 두 몫이 같아 어느 쪽을 값으로 썼는지 드러나지 않는다. 1/3 에서 한 번 더 본다.
    const narrow = await render(AMORA_DOCK_RATIO_MIN);
    expect(narrow.getAttribute("aria-valuenow")).toBe("67");
    expect(narrow.getAttribute("aria-valuetext")).toBe("아모라가 33%를 차지해요");
  });

  it("왼쪽 화살표는 경계를 왼쪽으로 옮겨 아모라를 넓히고, 오른쪽 화살표는 좁힌다. 범위를 넘지 않는다", async () => {
    let separator = await render(AMORA_DOCK_RATIO_MIN);
    press(separator, "ArrowLeft");
    expect(onCommit).toHaveBeenLastCalledWith(AMORA_DOCK_RATIO_MIN + AMORA_DOCK_RATIO_STEP);
    press(separator, "ArrowRight");
    expect(onCommit).toHaveBeenLastCalledWith(AMORA_DOCK_RATIO_MIN);

    separator = await render(AMORA_DOCK_RATIO_MAX);
    press(separator, "ArrowLeft");
    expect(onCommit).toHaveBeenLastCalledWith(AMORA_DOCK_RATIO_MAX);
    press(separator, "Home");
    expect(onCommit).toHaveBeenLastCalledWith(AMORA_DOCK_RATIO_MAX);
    press(separator, "End");
    expect(onCommit).toHaveBeenLastCalledWith(AMORA_DOCK_RATIO_MIN);

    onCommit.mockClear();
    press(separator, "a");
    expect(onCommit).not.toHaveBeenCalled();
  });

  /** 끌기 흉내. 누르고 움직이는 동안은 단추가 눌려 있고(buttons 1), 뗄 때와 그냥 지나갈 때는 아니다. */
  function pointerOn(separator: HTMLElement) {
    return (type: string, clientX: number, buttons = type === "pointerup" ? 0 : 1) => {
      act(() => {
        separator.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0, buttons }));
      });
    };
  }

  it("끄는 동안에는 아모라 칸 너비만 바로 바꾸고, 손을 떼면 1/3·1/2 근처를 그 값에 붙여 한 번만 반영한다", async () => {
    const separator = await render(AMORA_DOCK_RATIO_MAX);
    const pointer = pointerOn(separator);

    pointer("pointerdown", 820);
    pointer("pointermove", 940);
    expect(pane.style.width).toBe("40%");
    expect(onCommit).not.toHaveBeenCalled();

    pointer("pointermove", 1000);
    expect(pane.style.width).toBe("35%");
    pointer("pointerup", 1000);
    // 35% 는 1/3 근처라 1/3 에 붙는다. 칸도 붙인 값으로 바로 맞춘다.
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(AMORA_DOCK_RATIO_MIN);
    expect(pane.style.width).toMatch(/^33\.33/);

    // 누르지 않은 채 움직이면 아무 일도 없다.
    pointer("pointermove", 700, 0);
    expect(pane.style.width).toMatch(/^33\.33/);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("조금 끌다가 처음 값 근처에 놓아 같은 값으로 돌아오면, 칸 너비도 그 값으로 돌려놓는다", async () => {
    // 상태가 그대로면 React 는 너비를 다시 쓰지 않는다. 손잡이가 맞추지 않으면 칸이 48% 에 남는다.
    pane.style.width = "50%";
    const separator = await render(AMORA_DOCK_RATIO_MAX);
    const pointer = pointerOn(separator);

    pointer("pointerdown", 820);
    pointer("pointermove", 844);
    expect(pane.style.width).toBe("48%");
    pointer("pointerup", 844);

    expect(onCommit).toHaveBeenLastCalledWith(AMORA_DOCK_RATIO_MAX);
    expect(pane.style.width).toBe("50%");
  });

  it("놓았다는 소식을 놓쳐도, 단추를 누르지 않은 채 지나가면 끌기를 끝내고 더는 너비를 바꾸지 않는다", async () => {
    // 손잡이를 잡지 못한 채 밖에서 손을 떼면 pointerup 이 이 요소에 오지 않는다.
    const separator = await render(AMORA_DOCK_RATIO_MAX);
    const pointer = pointerOn(separator);

    pointer("pointerdown", 820);
    pointer("pointermove", 940);
    expect(pane.style.width).toBe("40%");

    pointer("pointermove", 1000, 0);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(0.4);
    expect(pane.style.width).toBe("40%");

    pointer("pointermove", 760, 0);
    expect(pane.style.width).toBe("40%");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("잡은 포인터를 잃으면 그 자리에서 끌기를 끝낸다", async () => {
    const separator = await render(AMORA_DOCK_RATIO_MAX);
    const pointer = pointerOn(separator);

    pointer("pointerdown", 820);
    pointer("pointermove", 940);
    act(() => {
      separator.dispatchEvent(new MouseEvent("lostpointercapture", { bubbles: true }));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(0.4);
    pointer("pointermove", 1000);
    expect(pane.style.width).toBe("40%");
  });
});
