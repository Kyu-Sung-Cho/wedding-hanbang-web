// @vitest-environment jsdom

// 웹 채팅 사진 첨부 (2026-09-18, wave 2 · 2.5a).
//
// 앱이 같은 첨부 판정을 쓰도록 ChatBubble 의 인라인 판정을 `@hanbang/shared/chat-image-attachments` 로
// 옮겼다. 웹 동작은 바뀌면 안 된다 — 요청 조건·본문·키, 사람 말풍선 위의 사진/PDF 렌더,
// 그리고 웹에는 출처 필터를 새로 넣지 않는다(앱에만 둔다). 이 파일의 동작 단언은 옮기기 전 코드에서도
// 그대로 통과해야 하는 특성 테스트다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatBubble from "./ChatBubble";
import type { ChatMessage } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";
const SENDER_ID = "11111111-1111-4111-8111-111111111111";
const PATH = `${COUPLE_ID}/${SENDER_ID}/55555555-5555-4555-8555-555555555555.png`;

function humanMessage(metadata: ChatMessage["metadata"], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: MESSAGE_ID,
    couple_id: COUPLE_ID,
    sender_id: SENDER_ID,
    sender_role: "bride",
    visibility: "shared",
    content: "파일을 보냈어요. 확인해줘.",
    metadata,
    created_at: "2026-09-18T00:00:00Z",
    ...overrides,
  };
}

describe("ChatBubble image attachments", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.restoreAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function render(message: ChatMessage, isCurrentUser: boolean) {
    await act(async () => {
      root.render(<ChatBubble message={message} isCurrentUser={isCurrentUser} />);
    });
    // fetch → json → setState 사슬이 끝날 때까지 기다린다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it.each([true, false])("asks image-urls with only the message id and draws the signed image above the bubble (own=%s)", async (own) => {
    // 웹에는 출처 필터가 없다 — 서버가 준 URL 이 Supabase 가 아니어도 예전처럼 그린다.
    const signedUrl = "https://signed.invalid/object/sign/chat-image/a.png?token=t";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ urls: [{ path: PATH, signedUrl }, { path: "x", signedUrl: null }] }), { status: 200 }),
    );

    await render(humanMessage({ imagePaths: [PATH] }), own);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/chat/image-urls");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ messageId: MESSAGE_ID }));

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe(signedUrl);
    expect(images[0].getAttribute("alt")).toBe("첨부 이미지 1");
    const bubbleText = Array.from(container.querySelectorAll("p")).find((node) => node.textContent === "파일을 보냈어요. 확인해줘.");
    expect(bubbleText).toBeTruthy();
    expect(images[0].compareDocumentPosition(bubbleText!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the PDF branch and the legacy imageUrls trigger", async () => {
    const pdf = "https://signed.invalid/object/sign/chat-image/doc.pdf?token=t";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ urls: [{ signedUrl: pdf }] }), { status: 200 }),
    );

    await render(humanMessage({ imageUrls: [`https://abc.supabase.co/storage/v1/object/public/chat-image/${COUPLE_ID}/1700000000000-a1b2c.pdf`] }), false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(pdf);
    expect(link?.textContent).toContain("PDF 문서");
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("sends nothing when the message has no attachments", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const metadata of [{}, { imagePaths: [] }, { imageUrls: [] }, null] as ChatMessage["metadata"][]) {
      await render(humanMessage(metadata), true);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("draws nothing for a failed or empty answer", async () => {
    for (const response of [
      new Response(JSON.stringify({ error: "x" }), { status: 404 }),
      new Response(JSON.stringify({ urls: [] }), { status: 200 }),
    ]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
      await render(humanMessage({ imagePaths: [PATH] }, { id: `${MESSAGE_ID.slice(0, -1)}${response.status === 404 ? "1" : "2"}` }), false);
      expect(container.querySelectorAll("img")).toHaveLength(0);
      expect(container.querySelector("a")).toBeNull();
    }
  });

  it("reads the attachment decision from the shared module only", () => {
    const source = readFileSync(join(process.cwd(), "src/components/app/chat/ChatBubble.tsx"), "utf8");
    expect(source).toMatch(/import \{ getChatImageAttachmentRefs \} from "@hanbang\/shared\/chat-image-attachments";/);
    const component = source.slice(source.indexOf("function ChatImageAttachments("), source.indexOf("// AI 메시지 피드백 UI"));
    expect(component).toMatch(/getChatImageAttachmentRefs\(metadata\)/);
    expect(component).toMatch(/const attachmentKey = `\$\{messageId\}\|\$\{/);
    expect(component).not.toMatch(/metadata\?\.imagePaths|metadata\?\.imageUrls/);
    // 웹에는 출처 필터를 넣지 않는다 — 서명 URL 해석은 앱만 쓴다.
    expect(source).not.toMatch(/parseChatImageUrlsResponse/);
  });
});
