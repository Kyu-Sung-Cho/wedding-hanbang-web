import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../chatStore";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const messageRow = {
  id: "user-message-1",
  couple_id: "couple-1",
  sender_id: "user-1",
  sender_type: "bride",
  content: "계약서 봐줘",
  metadata: null,
  visibility: "shared",
  created_at: "2026-07-11T00:00:00.000Z",
};

const sendParams = {
  content: messageRow.content,
  senderId: messageRow.sender_id,
  senderRole: "bride" as const,
  coupleId: messageRow.couple_id,
  senderName: "테스트 사용자",
  weddingContext: {
    weddingDate: "2026-12-12",
    budget: 30_000_000,
    venue: null,
    progress: {},
  },
  images: [
    {
      base64: "c2FmZS1hdHRhY2htZW50",
      mediaType: "application/pdf",
      previewUrl: "blob:contract",
      fileName: "contract.pdf",
      byteSize: 128,
    },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function completedSseResponse(): Response {
  const event = {
    type: "done",
    fullContent: "계약서에서 확인할 항목을 정리했어요.",
    metadata: {
      serverMessageId: "ai-message-1",
      serverCreatedAt: "2026-07-11T00:00:01.000Z",
    },
  };
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useChatStore AI response retry", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useChatStore.getState().reset();
    document.cookie = "demo_mode=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replays the same request first and rotates only after explicit request_failed", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: messageRow }))
      .mockRejectedValueOnce(new TypeError("connection dropped"))
      .mockResolvedValueOnce(
        jsonResponse(409, { error: "실패한 요청입니다.", code: "request_failed" })
      )
      .mockResolvedValueOnce(completedSseResponse());

    const stored = await useChatStore.getState().sendMessage(sendParams);

    expect(stored).toBe(true);
    expect(useChatStore.getState().pendingAiRequest).not.toBeNull();
    expect(useChatStore.getState().pendingAiRequest?.payload.attachments).toEqual([
      {
        base64: sendParams.images[0].base64,
        mediaType: sendParams.images[0].mediaType,
        fileName: sendParams.images[0].fileName,
      },
    ]);

    await useChatStore.getState().retryAiResponse();

    const messageInsertCalls = mockFetch.mock.calls.filter(
      ([url]) => url === "/api/chat/messages"
    );
    const aiCalls = mockFetch.mock.calls.filter(([url]) => url === "/api/chat");
    const aiBodies = aiCalls.map(([, init]) => JSON.parse(String(init?.body)));

    expect(messageInsertCalls).toHaveLength(1);
    expect(aiCalls).toHaveLength(3);
    expect(aiBodies[1].clientRequestId).toBe(aiBodies[0].clientRequestId);
    expect(aiBodies[2].clientRequestId).not.toBe(aiBodies[0].clientRequestId);
    expect(aiBodies[1].messages).toEqual(aiBodies[0].messages);
    expect(aiBodies[2].messages).toEqual(aiBodies[0].messages);
    expect(aiBodies[2].attachments).toEqual(aiBodies[0].attachments);

    const state = useChatStore.getState();
    expect(state.pendingAiRequest).toBeNull();
    expect(state.error).toBeNull();
    expect(state.messages.map((message) => message.id)).toEqual([
      "user-message-1",
      "ai-message-1",
    ]);
  });

  it("reports a user-message save failure without creating an AI retry", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(503, { error: "unavailable" }));

    const stored = await useChatStore.getState().sendMessage(sendParams);

    expect(stored).toBe(false);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().pendingAiRequest).toBeNull();
    expect(useChatStore.getState().error).toContain("입력 내용과 첨부는 그대로");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("lets the user stop a slow AI response while preserving an exact retry", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: messageRow }))
      .mockImplementationOnce((_, init?: RequestInit) => new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));

    const sendPromise = useChatStore.getState().sendMessage(sendParams);
    await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(true));

    useChatStore.getState().cancelAiResponse();
    await expect(sendPromise).resolves.toBe(true);

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.error).toContain("답변 생성을 멈췄어요");
    expect(state.pendingAiRequest).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("never restores the previous user's pending request after a reset abort", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: messageRow }))
      .mockImplementationOnce((_, init?: RequestInit) => new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));

    const sendPromise = useChatStore.getState().sendMessage(sendParams);
    await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(true));
    expect(useChatStore.getState().pendingAiRequest?.payload.attachments).toHaveLength(1);

    useChatStore.getState().reset();
    await expect(sendPromise).resolves.toBe(true);

    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.pendingAiRequest).toBeNull();
    expect(state.streamingContent).toBe("");
    expect(state.error).toBeNull();
    expect(state.isStreaming).toBe(false);
  });
});
