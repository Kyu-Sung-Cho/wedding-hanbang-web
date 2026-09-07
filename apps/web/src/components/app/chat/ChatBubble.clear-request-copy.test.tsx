import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatBubble from "./ChatBubble";
import type { ChatMessage } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/stores/chatStore", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ respondToClearRequest: vi.fn() }),
}));

/**
 * 함께 새로 시작 카드가 **무엇이 남는지** 말한다. (2026-09-03)
 *
 * 원문은 남지만 정리 경계 전 대화·요약은 이후 상담 입력에서 제외된다.
 * 저장한 준비 상태까지 지워졌거나 모든 맥락을 계속 읽는다고 오해시키지 않는다.
 *
 * 화면을 렌더해서 묻는다 — 소스에 문자열이 있는지가 아니라, 세 상태에서 각각 무엇이
 * 나오는지로.
 */
const clearRequestMessage = (status: "pending" | "accepted" | "declined"): ChatMessage =>
  ({
    id: "m-clear",
    content: "",
    sender_role: "user",
    created_at: "2026-09-03T00:00:00.000Z",
    metadata: {
      clearRequest: {
        type: "shared",
        requestedBy: "user-1",
        requestedAt: "2026-09-03T00:00:00.000Z",
        status,
      },
    },
  }) as unknown as ChatMessage;

let container: HTMLDivElement;
let root: Root;

const render = async (
  status: "pending" | "accepted" | "declined",
  isRequester: boolean,
) => {
  await act(async () => {
    root.render(
      <ChatBubble message={clearRequestMessage(status)} isCurrentUser={isRequester} />,
    );
  });
  return container.textContent ?? "";
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("함께 새로 시작 카드가 남는 것을 말한다", () => {
  it("동의 뒤 원문 보관과 이전 상담 제외, 저장한 준비 상태 보존을 구분한다", async () => {
    const text = await render("accepted", false);
    expect(text).toContain("양쪽 화면이 깨끗하게 정리됐어요");
    expect(text).toContain("정리 전 대화는 이후 상담에 쓰지 않아요");
    expect(text).toContain("저장한 예산·일정·결정은 남아요");
    expect(text).not.toContain("기존 맥락은 유지");
    // 무엇이 지워지는지 말하지 않은 채 "보존" 만 말하던 옛 문구.
    expect(text).not.toContain("데이터는 보존돼 있어요");
  });

  it("요청한 쪽과 받은 쪽 모두 동의 전에 같은 사실을 본다", async () => {
    const requesterText = await render("pending", true);
    expect(requesterText).toContain("상대방 동의를 기다리는 중이에요");
    expect(requesterText).toContain("해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요");

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const responderText = await render("pending", false);
    expect(responderText).toContain("상대방이 함께 새로 시작하자고 제안했어요");
    expect(responderText).toContain("해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요");
  });

  it("정말 지우는 자리 두 곳을 함께 알려준다", async () => {
    for (const status of ["pending", "accepted"] as const) {
      await act(async () => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      const text = await render(status, false);
      expect(text).toContain("비공개 대화·아모라 기억 삭제");
      expect(text).toContain("아모라가 기억하는 것");
    }
  });

  it("거절된 카드에는 삭제 안내를 붙이지 않는다", async () => {
    const text = await render("declined", false);
    expect(text).toContain("기존 대화는 그대로 유지돼요");
    expect(text).not.toContain("비공개 대화·아모라 기억 삭제");
  });
});
