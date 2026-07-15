import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../chatStore";
import { useAuthStore } from "../authStore";
import type { ToolExecutionResult, WeddingJourney } from "@/types/database.types";
import { attachmentProviderConsentVersion } from "@hanbang/shared";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const originalRefreshJourney = useAuthStore.getState().refreshJourney;

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
  attachmentProviderConsentVersion,
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

function completedSseResponseWithToolResult(result: ToolExecutionResult): Response {
  const toolEvent = { type: "tool_result", result };
  const doneEvent = {
    type: "done",
    fullContent: "상담 요청 일정을 기록했어요.",
    metadata: {
      serverMessageId: "ai-message-1",
      serverCreatedAt: "2026-07-11T00:00:01.000Z",
    },
  };
  return new Response(
    `data: ${JSON.stringify(toolEvent)}\n\ndata: ${JSON.stringify(doneEvent)}\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function journeyWithProgress(progress: Record<string, unknown>): WeddingJourney {
  return {
    id: "journey-1",
    couple_id: "couple-1",
    wedding_date: "2026-12-12",
    total_budget: 30_000_000,
    venue: null,
    progress,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  } as unknown as WeddingJourney;
}

describe("useChatStore AI response retry", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useChatStore.getState().reset();
    useAuthStore.setState({ refreshJourney: originalRefreshJourney });
    useAuthStore.getState().reset();
    document.cookie = "demo_mode=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    useAuthStore.getState().reset();
    useAuthStore.setState({ refreshJourney: originalRefreshJourney });
    vi.restoreAllMocks();
  });

  it("does not save or send an attachment without the current provider consent version", async () => {
    const { attachmentProviderConsentVersion: _consent, ...withoutConsent } = sendParams;
    expect(_consent).toBe(attachmentProviderConsentVersion);

    const stored = await useChatStore.getState().sendMessage(withoutConsent);

    expect(stored).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState().error).toContain("OpenAI 전송 동의");
    expect(useChatStore.getState().pendingAiRequest).toBeNull();
  });

  it("ignores a stale successful create_booking result without changing local journey state", async () => {
    const bookingId = "12345678-1234-4234-9234-123456789abc";
    const event = {
      id: `evt_booking_${bookingId}`,
      date: "2026-07-20",
      title: "14:00 상담 요청",
      sourceKey: `booking:${bookingId}`,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    };
    useAuthStore.setState({
      journey: journeyWithProgress({
        studio: { category: "studio", status: "in_progress", spent: 300_000 },
        __booking_costs: { legacy: 100_000 },
        __events: [],
      }),
      refreshJourney: vi.fn().mockResolvedValue(undefined),
    });
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: messageRow }))
      .mockResolvedValueOnce(completedSseResponseWithToolResult({
        toolName: "create_booking",
        toolInput: {},
        toolOutput: {
          syncedEvent: {
            ...event,
            spent: 9_999_999,
            cost: 9_999_999,
            payer: "couple",
          },
          syncedCategoryKey: "studio",
          syncedNewSpent: 9_999_999,
        },
        success: true,
        displayMessage: "",
      }));

    await useChatStore.getState().sendMessage({ ...sendParams, images: [] });

    const progress = useAuthStore.getState().journey?.progress as unknown as Record<string, unknown>;
    expect(progress.__events).toEqual([]);
    expect(progress.studio).toMatchObject({ spent: 300_000 });
    expect(progress.__booking_costs).toEqual({ legacy: 100_000 });
  });

  it("ignores a stale successful cancel_booking result without changing local journey state", async () => {
    const bookingId = "12345678-1234-4234-9234-123456789abc";
    const eventId = `evt_booking_${bookingId}`;
    const otherEvent = {
      id: "evt_manual",
      date: "2026-07-21",
      title: "직접 기록한 일정",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    };
    useAuthStore.setState({
      journey: journeyWithProgress({
        studio: { category: "studio", status: "in_progress", spent: 800_000 },
        __booking_costs: { [bookingId]: 500_000 },
        __events: [
          { ...otherEvent, id: eventId, sourceKey: `booking:${bookingId}` },
          otherEvent,
        ],
      }),
      refreshJourney: vi.fn().mockResolvedValue(undefined),
    });
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: messageRow }))
      .mockResolvedValueOnce(completedSseResponseWithToolResult({
        toolName: "cancel_booking",
        toolInput: {},
        toolOutput: {
          syncedEventIdRemoved: eventId,
          syncedCategoryKey: "studio",
          syncedNewSpent: 300_000,
        },
        success: true,
        displayMessage: "",
      }));

    await useChatStore.getState().sendMessage({ ...sendParams, images: [] });

    const progress = useAuthStore.getState().journey?.progress as unknown as Record<string, unknown>;
    expect(progress.__events).toEqual([
      { ...otherEvent, id: eventId, sourceKey: `booking:${bookingId}` },
      otherEvent,
    ]);
    expect(progress.studio).toMatchObject({ spent: 800_000 });
    expect(progress.__booking_costs).toEqual({ [bookingId]: 500_000 });
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
    expect(aiBodies[1].currentUserMessageId).toBe(aiBodies[0].currentUserMessageId);
    expect(aiBodies[2].currentUserMessageId).toBe(aiBodies[0].currentUserMessageId);
    expect(aiBodies[0]).not.toHaveProperty("messages");
    expect(aiBodies[0].attachmentProviderConsentVersion).toBe(attachmentProviderConsentVersion);
    expect(aiBodies[2].attachmentProviderConsentVersion).toBe(attachmentProviderConsentVersion);
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

  it("never includes partner-only messages in an Amora request", async () => {
    const partnerOnlyContent = "PARTNER_ONLY_SECRET";
    const partnerRow = {
      ...messageRow,
      id: "partner-message-1",
      content: partnerOnlyContent,
      metadata: { target: "partner" },
    };
    const aiQuestionRow = {
      ...messageRow,
      id: "user-message-2",
      content: "아모라에게만 묻는 질문",
    };
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: partnerRow }))
      .mockResolvedValueOnce(jsonResponse(201, { message: aiQuestionRow }))
      .mockResolvedValueOnce(completedSseResponse());

    await useChatStore.getState().sendMessage({
      ...sendParams,
      content: partnerOnlyContent,
      images: [],
      target: "partner",
    });
    await useChatStore.getState().sendMessage({
      ...sendParams,
      content: aiQuestionRow.content,
      images: [],
    });

    const aiCall = mockFetch.mock.calls.find(([url]) => url === "/api/chat");
    const aiBody = JSON.parse(String(aiCall?.[1]?.body));
    expect(aiBody.currentUserMessageId).toBe(aiQuestionRow.id);
    expect(aiBody).not.toHaveProperty("messages");
    expect(JSON.stringify(aiBody)).not.toContain(partnerOnlyContent);
  });

  it("never includes partner-only messages in a mediation request", async () => {
    const partnerOnlyContent = "PARTNER_MEDIATION_SECRET";
    const partnerRow = {
      ...messageRow,
      id: "partner-message-2",
      content: partnerOnlyContent,
      metadata: { target: "partner" },
    };
    mockFetch
      .mockResolvedValueOnce(jsonResponse(201, { message: partnerRow }))
      .mockResolvedValueOnce(completedSseResponse());

    await useChatStore.getState().sendMessage({
      ...sendParams,
      content: partnerOnlyContent,
      images: [],
      target: "partner",
    });
    await useChatStore.getState().requestMediation({
      coupleId: sendParams.coupleId,
      senderRole: sendParams.senderRole,
      senderName: sendParams.senderName,
      weddingContext: sendParams.weddingContext,
      conflictContext: "서로 일정 의견이 달라요",
    });

    const aiCalls = mockFetch.mock.calls.filter(([url]) => url === "/api/chat");
    expect(aiCalls).toHaveLength(0);
    expect(useChatStore.getState().error).toContain("자동 갈등 중재는 현재 제공하지 않아요");
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
