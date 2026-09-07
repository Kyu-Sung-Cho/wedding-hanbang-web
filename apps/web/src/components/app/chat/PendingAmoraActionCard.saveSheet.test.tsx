import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PendingAmoraActionCard from "./PendingAmoraActionCard";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { PendingAmoraAction } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const action: PendingAmoraAction = {
  version: 2,
  actionId: "11111111-1111-4111-8111-111111111111",
  tool: "update_budget",
  input: { totalBudget: 30_000_000, private_marker: "DO_NOT_RENDER_RAW_INPUT" },
  ...getAmoraToolOperationIdentity("update_budget", { totalBudget: 30_000_000 }),
  confirmation: "총예산을 3,000만 원으로 변경할까요?",
  issuedAt: Date.now(),
  expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
};
const messageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("아모라 변경 확인 시트", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onApply = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    document.body.style.overflow = "auto";
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  async function renderCard(disabledReason: "expired" | null = null) {
    await act(async () => root.render(
      <PendingAmoraActionCard
        action={action}
        messageId={messageId}
        disabledReason={disabledReason}
        isApplying={false}
        onApply={onApply}
        onDismiss={onDismiss}
      />,
    ));
  }

  async function openSheet() {
    const trigger = container.querySelector<HTMLButtonElement>("button");
    expect(trigger).not.toBeNull();
    trigger!.focus();
    await act(async () => trigger!.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    return { dialog: dialog!, trigger: trigger! };
  }

  function confirm(dialog: HTMLElement) {
    const button = dialog.querySelector<HTMLButtonElement>('button[data-amora-confirm]');
    expect(button).not.toBeNull();
    return button!;
  }

  it("첫 버튼은 전송 없이 시트를 열고 확인한 제안과 공유 범위를 보여준다", async () => {
    await renderCard();
    const { dialog } = await openSheet();
    expect(fetch).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain(action.confirmation);
    expect(dialog.textContent).toContain("분야");
    expect(dialog.textContent).toContain("예산");
    expect(dialog.textContent).toContain("공개 범위");
    expect(dialog.textContent).toContain("함께 보는 준비 정보");
    expect(dialog.textContent).not.toContain("DO_NOT_RENDER_RAW_INPUT");
    expect(dialog.textContent).not.toContain("두 분 다 확인");
    expect(dialog.textContent).not.toContain("대화를 계속 읽지 않아요");
    expect(dialog.textContent).not.toContain("알림으로 가요");
    expect(dialog.querySelector("input, select, textarea")).toBeNull();
    expect(dialog.closest(".amora-workspace")).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("포커스를 가두고 Escape로 닫으면 트리거 포커스와 스크롤을 복구한다", async () => {
    await renderCard();
    const { dialog, trigger } = await openSheet();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    const buttons = dialog.querySelectorAll<HTMLButtonElement>("button");
    buttons[buttons.length - 1]!.focus();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("auto");
    expect(onDismiss).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("바깥 클릭은 제안을 숨기지 않고 검토 창만 닫는다", async () => {
    await renderCard();
    const { dialog } = await openSheet();
    await act(async () => dialog.parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("나중에 정하기는 기존 dismiss만 실행한다", async () => {
    await renderCard();
    const { dialog } = await openSheet();
    const defer = Array.from(dialog.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("나중에 정하기"));
    await act(async () => defer!.click());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("지연된 확인 중에는 중복 요청과 닫기를 막고 서버 claim 뒤에만 적용한다", async () => {
    let resolveClaim!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => { resolveClaim = resolve; }));
    await renderCard();
    const { dialog } = await openSheet();
    await act(async () => { confirm(dialog).click(); confirm(dialog).click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(confirm(dialog).disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => dialog.parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    await act(async () => resolveClaim(new Response(JSON.stringify({ applicationGranted: true, retryAfterMs: 0 }), { status: 200 })));
    expect(fetch).toHaveBeenCalledWith(`/api/amora/shared-actions/${action.actionId}`, expect.objectContaining({
      method: "PUT", body: JSON.stringify({ messageId }),
    }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(action.actionId);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("실패는 시트 안에 남고 재시도는 같은 제안을 확인한다", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "변경 내용을 다시 확인해 주세요." }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applicationGranted: true, retryAfterMs: 0 }), { status: 200 }));
    await renderCard();
    const { dialog } = await openSheet();
    await act(async () => confirm(dialog).click());
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("변경 내용을 다시 확인해 주세요.");
    expect(onApply).not.toHaveBeenCalled();
    expect(confirm(dialog).disabled).toBe(false);
    await act(async () => confirm(dialog).click());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(action.actionId);
  });

  it("열어 둔 사이 만료되면 시트 안에서도 반영할 수 없다", async () => {
    await renderCard();
    const { dialog } = await openSheet();
    await renderCard("expired");
    expect(dialog.textContent).toContain("확인 시간이 지났어요");
    expect(confirm(dialog).disabled).toBe(true);
    await act(async () => confirm(dialog).click());
    expect(fetch).not.toHaveBeenCalled();
  });
});
