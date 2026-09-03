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
 * 이 요청이 실제로 바꾸는 것은 양쪽 화면(프로필의 clear cursor)뿐이다. 원문·요약·결정·
 * 커플 프로필은 그대로 남고 아모라는 그것을 계속 읽는다. 그런데 카드는
 * "양쪽 화면이 정리돼요 / 데이터는 보존돼 있어요" 라고만 해서, 팀 테스트에서
 * "초기화했는데 아모라가 지난 얘기를 계속 한다" 로 읽혔다.
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
  it("동의가 끝난 뒤에도 원문과 아모라 맥락이 남는다고 말한다", async () => {
    const text = await render("accepted", false);
    expect(text).toContain("양쪽 화면이 깨끗하게 정리됐어요");
    expect(text).toContain("원문 데이터와 아모라가 참고하는 기존 맥락은 유지돼요");
    // 무엇이 지워지는지 말하지 않은 채 "보존" 만 말하던 옛 문구.
    expect(text).not.toContain("데이터는 보존돼 있어요");
  });

  it("요청한 쪽과 받은 쪽 모두 동의 전에 같은 사실을 본다", async () => {
    const requesterText = await render("pending", true);
    expect(requesterText).toContain("상대방 동의를 기다리는 중이에요");
    expect(requesterText).toContain("원문 데이터와 아모라가 참고하는 기존 맥락은 유지돼요");

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const responderText = await render("pending", false);
    expect(responderText).toContain("상대방이 함께 새로 시작하자고 제안했어요");
    expect(responderText).toContain("원문 데이터와 아모라가 참고하는 기존 맥락은 유지돼요");
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
