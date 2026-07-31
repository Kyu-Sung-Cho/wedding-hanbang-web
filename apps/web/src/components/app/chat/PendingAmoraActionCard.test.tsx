import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PendingAmoraActionCard, {
  getPendingAmoraAction,
  getPendingActionDisabledReason,
  isPendingAmoraActionExpired,
} from "./PendingAmoraActionCard";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { ChatMessage, PendingAmoraAction } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const budgetIdentity = getAmoraToolOperationIdentity(
  "update_budget",
  { totalBudget: 30_000_000 },
);
const action: PendingAmoraAction = {
  version: 2,
  actionId: "11111111-1111-4111-8111-111111111111",
  tool: "update_budget",
  input: { totalBudget: 30_000_000 },
  inputDigest: budgetIdentity.inputDigest,
  operationKey: budgetIdentity.operationKey,
  confirmation: "총예산을 3,000만 원으로 변경할까요?",
  issuedAt: Date.parse("2026-07-17T00:00:00.000Z"),
  expiresAt: Date.parse("2026-07-18T00:00:00.000Z"),
};

const singleIdentity = getAmoraToolOperationIdentity(
  "add_schedule_event",
  { date: "2026-08-01", title: "드레스 피팅" },
);
const singleAction: PendingAmoraAction = {
  version: 2,
  actionId: "22222222-2222-4222-8222-222222222222",
  tool: "add_schedule_event",
  input: { date: "2026-08-01", title: "드레스 피팅" },
  inputDigest: singleIdentity.inputDigest,
  operationKey: singleIdentity.operationKey,
  confirmation: "드레스 피팅 일정을 추가할까요?",
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
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("shows the canonical server confirmation and requires the explicit apply button", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      applicationGranted: true,
      retryAfterMs: 0,
    }), { status: 200 }));
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={singleAction}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={onDismiss}
        />,
      );
    });

    expect(container.textContent).toContain(singleAction.confirmation);
    expect(container.textContent).not.toContain("30000000");
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("확인한 내용을 이대로 적용");
    expect(buttons[1]?.textContent).toContain("이번 화면에서 숨기기");
    expect(buttons[1]?.getAttribute("aria-label")).toBe("이 제안을 이번 화면에서만 숨기기");

    await act(async () => buttons[0]?.click());
    await act(async () => Promise.resolve());
    expect(onApply).toHaveBeenCalledWith(singleAction.actionId);
    expect(fetch).toHaveBeenCalledWith(
      `/api/amora/shared-actions/${singleAction.actionId}`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      }),
    );

    await act(async () => buttons[1]?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps expired or superseded actions visible but disables mutation", async () => {
    const onApply = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
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

  it("records only my first confirmation and clearly says nothing changed yet", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: false,
        acceptedCount: 0,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: true,
        acceptedCount: 1,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      }), { status: 200 }));
    const onApply = vi.fn();

    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });
    await act(async () => Promise.resolve());
    const confirm = container.querySelector<HTMLButtonElement>(
      'button[aria-label="이 공동 변경을 확인"]',
    );
    expect(confirm).not.toBeNull();

    await act(async () => confirm?.click());
    await act(async () => Promise.resolve());

    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).toContain("내 확인 1/2");
    expect(container.textContent).toContain("아직 반영되지 않았어요");
  });

  it("lets me withdraw my linked-couple confirmation without applying the change", async () => {
    const messageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: true,
        acceptedCount: 1,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: false,
        acceptedCount: 0,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      }), { status: 200 }));
    const onApply = vi.fn();

    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId={messageId}
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });
    await act(async () => Promise.resolve());

    const withdraw = container.querySelector<HTMLButtonElement>(
      'button[aria-label="내 공동 변경 확인 취소"]',
    );
    expect(withdraw).not.toBeNull();

    await act(async () => withdraw?.click());
    await act(async () => Promise.resolve());

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/amora/shared-actions/${action.actionId}`,
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      }),
    );
    expect(container.textContent).toContain("현재 0/2");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("still lets me withdraw after both confirmations but before applying", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: true,
        acceptedCount: 2,
        requiredCount: 2,
        partnerLinked: true,
        ready: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: false,
        acceptedCount: 1,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      }), { status: 200 }));
    const onApply = vi.fn();

    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });
    await act(async () => Promise.resolve());

    const withdraw = container.querySelector<HTMLButtonElement>(
      'button[aria-label="내 공동 변경 확인 취소"]',
    );
    expect(withdraw).not.toBeNull();
    await act(async () => withdraw?.click());
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("상대방 확인 1/2");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows a withdrawal failure and never applies the change", async () => {
    const errorMessage = "이미 반영된 변경은 확인을 취소할 수 없어요.";
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: true,
        acceptedCount: 1,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: errorMessage,
      }), { status: 409 }));
    const onApply = vi.fn();

    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });
    await act(async () => Promise.resolve());

    const withdraw = container.querySelector<HTMLButtonElement>(
      'button[aria-label="내 공동 변경 확인 취소"]',
    );
    await act(async () => withdraw?.click());
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain(errorMessage);
    expect(container.querySelector(
      'button[aria-label="내 공동 변경 확인 취소"]',
    )).not.toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("applies only after the other member makes the exact proposal unanimous", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: false,
        acceptedCount: 1,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: true,
        acceptedCount: 2,
        requiredCount: 2,
        partnerLinked: true,
        ready: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        applicationGranted: true,
        retryAfterMs: 0,
      }), { status: 200 }));
    const onApply = vi.fn();

    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });
    await act(async () => Promise.resolve());
    const confirm = container.querySelector<HTMLButtonElement>(
      'button[aria-label="이 공동 변경을 확인하고 바로 반영"]',
    );
    expect(container.textContent).toContain("확인하고 바로 반영");
    expect(container.textContent).toContain(
      "내 확인을 누르면 바로 반영을 시작해요",
    );
    await act(async () => confirm?.click());
    await act(async () => Promise.resolve());

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(action.actionId);
  });

  it("does not create a second confirmation while another client owns the application lease", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: false,
        acceptedCount: 1,
        requiredCount: 2,
        partnerLinked: true,
        ready: false,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approvalMode: "couple",
        accepted: true,
        acceptedCount: 2,
        requiredCount: 2,
        partnerLinked: true,
        ready: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        applicationGranted: false,
        retryAfterMs: 30_000,
      }), { status: 200 }));
    const onApply = vi.fn();

    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });
    await act(async () => Promise.resolve());

    const confirm = container.querySelector<HTMLButtonElement>(
      'button[aria-label="이 공동 변경을 확인하고 바로 반영"]',
    );
    await act(async () => confirm?.click());
    await act(async () => Promise.resolve());

    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "다른 화면에서 반영을 시작했어요",
    );
    expect(container.textContent).toContain("30초 뒤");
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
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, inputDigest: "wrong" } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, operationKey: "wrong" } },
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
