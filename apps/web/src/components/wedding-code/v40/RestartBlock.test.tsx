import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { click, createHarness, describedByText, labelledByText, pressKey, type Harness } from "./inputTestKit";
import { RestartBlock } from "./RestartBlock";
import { buttonByText, textOf } from "./resultTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="alertdialog"]');
}

function status(): HTMLElement {
  return harness.container.querySelector<HTMLElement>("[data-clear-status]")!;
}

async function renderBlock(overrides: { onRestart?: () => void; onClearStorage?: () => boolean | Promise<boolean> } = {}) {
  const onRestart = overrides.onRestart ?? vi.fn();
  const onClearStorage = overrides.onClearStorage ?? vi.fn(async () => true);
  await harness.render(<RestartBlock onRestart={onRestart} onClearStorage={onClearStorage} />);
  return { onRestart, onClearStorage };
}

describe("RestartBlock: 처음부터 다시 하기", () => {
  it("두 단추만 보이고 누르는 즉시 아무것도 지우지 않는다", async () => {
    const { onRestart, onClearStorage } = await renderBlock();
    expect([...harness.container.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      V40_COPY.manage.restart.button,
      V40_COPY.manage.clear.button,
    ]);
    expect(dialog()).toBeNull();
    await click(buttonByText(harness.container, V40_COPY.manage.restart.button));
    expect(onRestart).not.toHaveBeenCalled();
    expect(onClearStorage).not.toHaveBeenCalled();
  });

  it("확인 창은 무엇이 지워지는지 적고 접근성 이름과 설명을 가진 모달이다", async () => {
    await renderBlock();
    await click(buttonByText(harness.container, V40_COPY.manage.restart.button));
    const box = dialog()!;
    // 문서 맨 끝(body)에 그려서 부모의 잘림이나 하단 탭 막대에 가려지지 않는다. 블록 안쪽에 그리면 안 된다.
    expect(box.closest("[data-confirm-overlay]")?.parentElement).toBe(document.body);
    expect(harness.container.contains(box)).toBe(false);
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(labelledByText(box)).toBe(V40_COPY.manage.restart.confirmTitle);
    expect(describedByText(box)).toBe(V40_COPY.manage.restart.confirmBody);
    expect(textOf(box)).toContain("지금까지 한 답이 이 브라우저에서 지워지고");
    expect(textOf(box)).toContain("이미 보낸 링크는 그대로 열려서");
    expect([...box.querySelectorAll("button")].map((button) => button.textContent).sort()).toEqual(
      [V40_COPY.manage.restart.cancelButton, V40_COPY.manage.restart.confirmButton].sort(),
    );
  });

  it("열리면 안전한 쪽(그대로 두기)에 초점이 가고 그대로 두면 부르지 않고 초점이 단추로 돌아온다", async () => {
    const { onRestart } = await renderBlock();
    const opener = buttonByText(harness.container, V40_COPY.manage.restart.button);
    await click(opener);
    expect(document.activeElement).toBe(buttonByText(dialog()!, V40_COPY.manage.restart.cancelButton));
    await click(buttonByText(dialog()!, V40_COPY.manage.restart.cancelButton));
    expect(dialog()).toBeNull();
    expect(onRestart).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("이스케이프와 바깥 누르기는 그대로 두기다", async () => {
    const { onRestart } = await renderBlock();
    const opener = buttonByText(harness.container, V40_COPY.manage.restart.button);
    await click(opener);
    const event = await pressKey("Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    await click(opener);
    await click(document.body.querySelector("[data-confirm-overlay]"));
    expect(dialog()).toBeNull();
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("창 안을 눌러도 닫히지 않는다", async () => {
    await renderBlock();
    await click(buttonByText(harness.container, V40_COPY.manage.restart.button));
    await click(dialog()!.querySelector("p"));
    expect(dialog()).not.toBeNull();
  });

  it("탭은 창 안의 두 단추만 돈다(문서에 그려진 순서 그대로: 확인 단추가 앞, 그대로 두기가 뒤)", async () => {
    await renderBlock();
    await click(buttonByText(harness.container, V40_COPY.manage.restart.button));
    const cancel = buttonByText(dialog()!, V40_COPY.manage.restart.cancelButton);
    const confirm = buttonByText(dialog()!, V40_COPY.manage.restart.confirmButton);
    const inDocumentOrder = [...dialog()!.querySelectorAll("button")];
    expect(inDocumentOrder).toEqual([confirm, cancel]);
    expect(document.activeElement).toBe(cancel);
    // 맨 뒤(그대로 두기)에서 앞으로 탭하면 맨 앞(확인)으로 돌아온다. 창 밖으로 새지 않는다.
    const forward = await pressKey("Tab");
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
    // 맨 앞(확인)에서 뒤로 탭하면 맨 뒤(그대로 두기)로 돌아온다.
    const backward = await pressKey("Tab", { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    // 창 안에서 다음 단추로 가는 탭은 브라우저가 알아서 하게 둔다.
    confirm.focus();
    const inside = await pressKey("Tab");
    expect(inside.defaultPrevented).toBe(false);
  });

  it("창 안의 글을 눌러 초점이 body 로 빠져도 이스케이프가 통하고 탭이 뒤의 화면으로 새지 않는다", async () => {
    const { onRestart } = await renderBlock();
    const opener = buttonByText(harness.container, V40_COPY.manage.restart.button);
    await click(opener);
    const cancel = buttonByText(dialog()!, V40_COPY.manage.restart.cancelButton);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    const tab = await pressKey("Tab");
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    (document.activeElement as HTMLElement | null)?.blur();
    const shiftTab = await pressKey("Tab", { shiftKey: true });
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    const escape = await pressKey("Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(onRestart).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("창이 닫힌 뒤에는 문서에 건 키 듣기를 거둔다(이스케이프가 다른 화면을 건드리지 않는다)", async () => {
    await renderBlock();
    await click(buttonByText(harness.container, V40_COPY.manage.restart.button));
    await click(buttonByText(dialog()!, V40_COPY.manage.restart.cancelButton));
    const escape = await pressKey("Escape");
    expect(escape.defaultPrevented).toBe(false);
  });

  it("지우고 다시 하기를 고르면 한 번 부르고 창이 닫힌다", async () => {
    const { onRestart, onClearStorage } = await renderBlock();
    await click(buttonByText(harness.container, V40_COPY.manage.restart.button));
    await click(buttonByText(dialog()!, V40_COPY.manage.restart.confirmButton));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onClearStorage).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });
});

describe("RestartBlock: 이 기기의 저장 지우기", () => {
  it("확인 창에서 고른 뒤에만 부르고 실제로 지웠다고 알려 줄 때만 지웠다고 말한다", async () => {
    const { onClearStorage, onRestart } = await renderBlock();
    await click(buttonByText(harness.container, V40_COPY.manage.clear.button));
    expect(onClearStorage).not.toHaveBeenCalled();
    const box = dialog()!;
    expect(labelledByText(box)).toBe(V40_COPY.manage.clear.confirmTitle);
    expect(textOf(box)).toContain("되돌릴 수 없어요");
    expect(textOf(box)).toContain("이미 보낸 링크는 지울 수 없어요");
    expect(status().textContent).toBe("");
    await click(buttonByText(box, V40_COPY.manage.clear.confirmButton));
    await settle();
    expect(onClearStorage).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    expect(status().textContent).toBe(V40_COPY.manage.clear.done);
    expect(status().getAttribute("role")).toBe("status");
    expect(dialog()).toBeNull();
  });

  it("지우지 못했으면 지웠다고 하지 않고 브라우저 설정으로 안내한다", async () => {
    await renderBlock({ onClearStorage: async () => false });
    await click(buttonByText(harness.container, V40_COPY.manage.clear.button));
    await click(buttonByText(dialog()!, V40_COPY.manage.clear.confirmButton));
    await settle();
    expect(status().textContent).toBe(V40_COPY.manage.clear.failed);
    expect(harness.container.textContent).not.toContain(V40_COPY.manage.clear.done);
  });

  it("던져도, true 가 아닌 값이어도 지웠다고 하지 않는다", async () => {
    await renderBlock({
      onClearStorage: async () => {
        throw new Error("blocked");
      },
    });
    await click(buttonByText(harness.container, V40_COPY.manage.clear.button));
    await click(buttonByText(dialog()!, V40_COPY.manage.clear.confirmButton));
    await settle();
    expect(status().textContent).toBe(V40_COPY.manage.clear.failed);
    await harness.render(<RestartBlock key="other" onRestart={vi.fn()} onClearStorage={(() => undefined) as unknown as () => boolean} />);
    await click(buttonByText(harness.container, V40_COPY.manage.clear.button));
    await click(buttonByText(dialog()!, V40_COPY.manage.clear.confirmButton));
    await settle();
    expect(status().textContent).toBe(V40_COPY.manage.clear.failed);
  });

  it("지우는 동안에는 단추가 잠기고, 그대로 두면 부르지 않는다", async () => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const onClearStorage = vi.fn(() => pending);
    await renderBlock({ onClearStorage });
    await click(buttonByText(harness.container, V40_COPY.manage.clear.button));
    await click(buttonByText(dialog()!, V40_COPY.manage.clear.cancelButton));
    expect(onClearStorage).not.toHaveBeenCalled();
    expect(status().textContent).toBe("");
    await click(buttonByText(harness.container, V40_COPY.manage.clear.button));
    await click(buttonByText(dialog()!, V40_COPY.manage.clear.confirmButton));
    const opener = buttonByText(harness.container, V40_COPY.manage.clear.button);
    expect(opener.disabled).toBe(true);
    expect(opener.getAttribute("aria-busy")).toBe("true");
    expect(status().textContent).toBe("");
    await act(async () => finish(true));
    await settle();
    expect(status().textContent).toBe(V40_COPY.manage.clear.done);
    expect(buttonByText(harness.container, V40_COPY.manage.clear.button).disabled).toBe(false);
  });

  const CLEAR_CASES: ReadonlyArray<readonly [string, () => boolean | Promise<boolean>]> = [
    ["동기", () => true],
    ["비동기", async () => true],
    ["실패", async () => false],
  ];

  it.each(CLEAR_CASES)("지우기가 끝나면(%s) 확인 창이 사라져도 초점이 지우기 단추로 돌아온다(body 로 빠지지 않는다)", async (_name, onClearStorage) => {
    await renderBlock({ onClearStorage });
    const opener = buttonByText(harness.container, V40_COPY.manage.clear.button);
    await click(opener);
    await click(buttonByText(dialog()!, V40_COPY.manage.clear.confirmButton));
    await settle();
    expect(dialog()).toBeNull();
    expect(opener.disabled).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("다시 열면 지난 결과 안내를 지운다", async () => {
    await renderBlock();
    await click(buttonByText(harness.container, V40_COPY.manage.clear.button));
    await click(buttonByText(dialog()!, V40_COPY.manage.clear.confirmButton));
    await settle();
    expect(status().textContent).toBe(V40_COPY.manage.clear.done);
    await click(buttonByText(harness.container, V40_COPY.manage.clear.button));
    expect(status().textContent).toBe("");
  });

  it("화면이 사라진 뒤에 답이 와도 오류가 나지 않는다", async () => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    await renderBlock({ onClearStorage: () => pending });
    await click(buttonByText(harness.container, V40_COPY.manage.clear.button));
    await click(buttonByText(dialog()!, V40_COPY.manage.clear.confirmButton));
    await harness.render(<div />);
    await act(async () => finish(true));
    await settle();
    expect(harness.container.textContent).toBe("");
  });
});
