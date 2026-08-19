import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatBubble from "./ChatBubble";
import { ETIQUETTE_PARTS } from "@/constants/etiquetteData";
import type { ChatMessage } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/stores/chatStore", () => ({
  useChatStore: () => ({ messages: [], sendMessage: vi.fn() }),
}));

/**
 * 아모라가 붙이는 `[etiquette:N]` 태그 → 읽기 카드.
 *
 * 2026-08-19 이전에는 태그를 파싱해 놓고도 "가족 이야기 더 나누기"라는 문구로 `/chat`에
 * 되돌려 보냈다(코퍼스가 지워져 있어서). 코퍼스가 돌아왔으니 태그가 가리키는 챕터로
 * 직접 보낸다. 이 테스트는 그 연결이 다시 끊기는 것을 막는다.
 */
const aiMessage = (content: string): ChatMessage =>
  ({
    id: "m1",
    content,
    sender_role: "ai",
    created_at: "2026-08-19T00:00:00.000Z",
    metadata: null,
  }) as unknown as ChatMessage;

let container: HTMLDivElement;
let root: Root;

const render = async (content: string) => {
  await act(async () => {
    root.render(<ChatBubble message={aiMessage(content)} isCurrentUser={false} />);
  });
};

const guideLinks = () =>
  [...container.querySelectorAll("a")].filter((a) =>
    (a.getAttribute("href") ?? "").includes("/etiquette"),
  );

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ChatBubble etiquette tags", () => {
  it("turns a tag into a link to that exact chapter", async () => {
    await render("상견례는 양가가 처음 만나는 자리예요. [etiquette:2]");

    const links = guideLinks();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toContain("part=2");

    const part2 = ETIQUETTE_PARTS.find((part) => part.number === 2)!;
    expect(links[0].textContent).toContain(part2.title);
    expect(links[0].textContent).toContain(part2.subtitle);
  });

  it("strips the tag from the visible answer", async () => {
    await render("청첩장은 미리 돌리는 게 좋아요. [etiquette:4]");
    expect(container.textContent).not.toContain("[etiquette:4]");
    expect(container.textContent).toContain("청첩장은 미리 돌리는 게 좋아요.");
  });

  it("renders one card per tag and drops duplicates", async () => {
    await render("[etiquette:1] 그리고 [etiquette:2] 또 [etiquette:1]");
    expect(guideLinks()).toHaveLength(2);
  });

  it("draws no card for a chapter that does not exist", async () => {
    await render("존재하지 않는 번호예요. [etiquette:99]");
    expect(guideLinks()).toHaveLength(0);
    expect(container.textContent).not.toContain("[etiquette:99]");
  });

  it("no longer falls back to the generic family-talk card", async () => {
    await render("폐백은 생략하는 집도 많아요. [etiquette:7]");
    expect(container.textContent).not.toContain("가족 이야기 더 나누기");
    expect(guideLinks()[0]?.getAttribute("href")).toContain("part=7");
  });
});
