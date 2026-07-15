import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../chatStore";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const messageRow = {
  id: "user-message-daily-limit",
  couple_id: "couple-1",
  sender_id: "user-1",
  sender_type: "bride",
  content: "이번 주 할 일을 정리해줘",
  metadata: null,
  visibility: "shared",
  created_at: "2026-07-13T00:00:00.000Z",
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
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(body: unknown): Response {
  return new Response(`data: ${JSON.stringify(body)}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("web Amora rolling/future opt-in provider-limit UX", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useChatStore.getState().reset();
    document.cookie = "demo_mode=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["couple_provider_daily", "오늘 이 커플의 아모라 이용량이 안전 한도에 도달했어요."],
    ["global_daily", "오늘 아모라 이용량이 안전 한도에 도달했어요."],
  ])("shows %s as terminal without offering a paid retry loop", async (code, message) => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: messageRow }))
      .mockResolvedValueOnce(jsonResponse(429, { error: message, code }));

    await expect(useChatStore.getState().sendMessage(sendParams)).resolves.toBe(true);

    const state = useChatStore.getState();
    expect(state.messages).toEqual([
      expect.objectContaining({ id: "user-message-daily-limit" }),
    ]);
    expect(state.error).toBe(message);
    expect(state.pendingAiRequest).toBeNull();
    expect(state.isStreaming).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["couple_provider_daily", "오늘 이 커플의 아모라 이용량이 안전 한도에 도달했어요."],
    ["global_daily", "오늘 아모라 이용량이 안전 한도에 도달했어요."],
  ])("treats a 200 SSE %s reservation race as terminal", async (code, message) => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: messageRow }))
      .mockResolvedValueOnce(sseResponse({ type: "error", message, code }));

    await expect(useChatStore.getState().sendMessage(sendParams)).resolves.toBe(true);

    const state = useChatStore.getState();
    expect(state.error).toBe(message);
    expect(state.pendingAiRequest).toBeNull();
    expect(state.isStreaming).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a transient provider outage retryable with the exact request identity", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: messageRow }))
      .mockResolvedValueOnce(jsonResponse(503, { error: "잠시 연결할 수 없어요." }));

    await useChatStore.getState().sendMessage(sendParams);

    const state = useChatStore.getState();
    expect(state.error).toBe("잠시 연결할 수 없어요.");
    expect(state.pendingAiRequest?.payload.clientRequestId).toMatch(/^web:/);
    expect(state.messages).toEqual([
      expect.objectContaining({ id: "user-message-daily-limit" }),
    ]);
  });
});
