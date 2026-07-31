import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommunityReplyNotifications from "./CommunityReplyNotifications";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const POST_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";
const NOTIFICATION_ID = "55555555-5555-4555-8555-555555555555";
const href = `/wedding/community/post/${POST_ID}#comment-${COMMENT_ID}`;

function notification(readAt: string | null = null) {
  return {
    id: NOTIFICATION_ID,
    recipient_id: "11111111-1111-4111-8111-111111111111",
    actor_id: "22222222-2222-4222-8222-222222222222",
    actor_nickname: "경험자",
    post_id: POST_ID,
    comment_id: COMMENT_ID,
    parent_comment_id: null,
    kind: "post_reply",
    read_at: readAt,
    created_at: "2026-07-31T00:00:00.000Z",
    title: "경험자님이 내 고민에 답변을 남겼어요",
    message: "계약금 환불 고민",
    href,
  };
}

describe("CommunityReplyNotifications", () => {
  let root: Root;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("shows the unread count, marks one read, and returns to its exact answer", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: [notification()] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    await act(async () => {
      root.render(<CommunityReplyNotifications />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const trigger = container.querySelector(
      'button[aria-label="새 답변 알림 1개"]',
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.click();
    });
    expect(container.textContent).toContain("계약금 환불 고민");

    const answerButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("내 고민에 답변"),
    );
    await act(async () => {
      answerButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/community/notifications",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ids: [NOTIFICATION_ID] }),
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(href);
  });

  it("marks every unread notification from the panel without changing links", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: [notification()] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    await act(async () => {
      root.render(<CommunityReplyNotifications />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      (
        container.querySelector(
          'button[aria-label="새 답변 알림 1개"]',
        ) as HTMLButtonElement
      ).click();
    });

    const markAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("모두 읽음"),
    );
    await act(async () => {
      markAll?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/community/notifications",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ all: true }),
      }),
    );
    expect(container.querySelector('[aria-label="새 답변 알림 1개"]')).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
