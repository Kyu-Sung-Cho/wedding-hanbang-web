import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PendingAmoraActionCard, {
  getPendingAmoraAction,
  getPendingActionDisabledReason,
  isPendingAmoraActionExpired,
} from "./PendingAmoraActionCard";
import type { ChatMessage, PendingAmoraAction } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const action: PendingAmoraAction = {
  version: 1,
  actionId: "11111111-1111-4111-8111-111111111111",
  tool: "update_budget",
  input: { totalBudget: 30_000_000 },
  confirmation: "총예산을 3,000만 원으로 변경할까요?",
  issuedAt: Date.parse("2026-07-17T00:00:00.000Z"),
  expiresAt: Date.parse("2026-07-17T00:10:00.000Z"),
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "ai-message-1",
    couple_id: "couple-1",
    sender_id: null,
    sender_role: "ai",
    content: "원하시면 바로 반영할게요.",
    metadata: { pending_amora_action: action },
    visibility: "shared",
    created_at: "2026-07-17T00:00:01.000Z",
    ...overrides,
  };
}

describe("PendingAmoraActionCard", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("shows the canonical server confirmation and requires the explicit apply button", async () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={onDismiss}
        />,
      );
    });

    expect(container.textContent).toContain(action.confirmation);
    expect(container.textContent).not.toContain("30000000");
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("확인한 내용을 이대로 적용");
    expect(buttons[1]?.textContent).toContain("이번 화면에서 숨기기");
    expect(buttons[1]?.getAttribute("aria-label")).toBe("이 제안을 이번 화면에서만 숨기기");

    await act(async () => buttons[0]?.click());
    expect(onApply).toHaveBeenCalledWith(action.actionId);

    await act(async () => buttons[1]?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps expired or superseded actions visible but disables mutation", async () => {
    const onApply = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          disabledReason="not_latest"
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });

    const apply = container.querySelector("button");
    expect(apply?.disabled).toBe(true);
    expect(container.textContent).toContain("새 대화가 이어져");
    await act(async () => apply?.click());
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("pending action message boundary", () => {
  it("accepts only a structurally valid action on a shared AI message", () => {
    expect(getPendingAmoraAction(message())).toEqual(action);
    expect(getPendingAmoraAction(message({ visibility: "bride_private" }))).toBeNull();
    expect(getPendingAmoraAction(message({ sender_role: "bride" }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, actionId: "not-a-uuid" } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, confirmation: "" } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, input: [] as unknown as Record<string, unknown> } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, issuedAt: "2026-07-17T00:00:00.000Z" as unknown as number } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, expiresAt: action.expiresAt + 1 } },
    }))).toBeNull();
  });

  it("uses the server expiry instant without a locale conversion", () => {
    expect(isPendingAmoraActionExpired(action, action.expiresAt - 1)).toBe(false);
    expect(isPendingAmoraActionExpired(action, action.expiresAt)).toBe(true);
  });

  it("disables an expired, superseded, or in-flight action", () => {
    const now = action.expiresAt - 1;
    expect(getPendingActionDisabledReason(action, now, true, false)).toBeNull();
    expect(getPendingActionDisabledReason(action, action.expiresAt, true, false)).toBe("expired");
    expect(getPendingActionDisabledReason(action, now, false, false)).toBe("not_latest");
    expect(getPendingActionDisabledReason(action, now, true, true)).toBe("busy");
  });
});
