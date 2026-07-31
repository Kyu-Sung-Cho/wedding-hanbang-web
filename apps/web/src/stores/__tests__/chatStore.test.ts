import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildConfirmedActionRecoveryRequest,
  useChatStore,
} from "../chatStore";
import type { WeddingContext } from "@/types/chat.types";
import { useAuthStore } from "../authStore";
import { captureEvent } from "@/lib/analytics";

const mockFetch = vi.fn();
const chatStoreSource = readFileSync(
  path.join(process.cwd(), "src/stores/chatStore.ts"),
  "utf8",
);
const mockInsertSingle = vi.fn();
const mockStorageUpload = vi.fn();
const mockInsert = vi.fn(() => ({
  select: vi.fn(() => ({
    single: mockInsertSingle,
  })),
}));

const mockSupabase = {
  storage: {
    from: vi.fn(() => ({ upload: mockStorageUpload })),
  },
  from: vi.fn(() => ({
    insert: mockInsert,
  })),
};

function completedChatResponse(content = "완료된 답변") {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({
          type: "done",
          fullContent: content,
          metadata: { serverMessageId: "ai-message-retry-1" },
        })}\n\n`
      ));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockSupabase,
}));

vi.mock("@/lib/analytics", () => ({
  captureEvent: vi.fn(),
}));

describe("confirmed Amora action recovery", () => {
  const actionId = "22222222-2222-4222-8222-222222222222";
  const sourceMessage = {
    id: "11111111-1111-4111-8111-111111111111",
    couple_id: "couple-1",
    sender_id: null,
    sender_role: "ai" as const,
    content: "예산을 변경할까요?",
    metadata: null,
    visibility: "shared" as const,
    created_at: "2026-07-30T01:00:00.000Z",
  };
  const confirmationMessage = {
    id: "33333333-3333-4333-8333-333333333333",
    couple_id: "couple-1",
    sender_id: "user-1",
    sender_role: "bride" as const,
    content: "좋아요. 제안한 변경을 적용해 주세요.",
    metadata: { confirmed_amora_action_id: actionId },
    visibility: "shared" as const,
    created_at: "2026-07-30T01:01:00.000Z",
  };

  beforeEach(() => {
    useAuthStore.setState({
      profile: {
        id: "user-1",
        name: "테스터",
        role: "bride",
        couple_id: "couple-1",
      } as never,
      journey: null,
    });
  });

  it("builds an explicit provider-only resume from the latest owned durable confirmation", () => {
    const recovery = buildConfirmedActionRecoveryRequest(
      [sourceMessage, confirmationMessage],
      "couple-1",
    );

    expect(recovery).toEqual(expect.objectContaining({
      userMessageId: confirmationMessage.id,
      confirmedActionId: actionId,
      recoveryKind: "confirmed_action",
      canRetry: true,
    }));
    expect(JSON.parse(recovery?.requestBody ?? "{}")).toEqual(expect.objectContaining({
      userMessageId: confirmationMessage.id,
      confirmedActionId: actionId,
      visibility: "shared",
    }));
  });

  it("loads the newest bounded history and restores chronological display order", () => {
    expect(chatStoreSource).toMatch(
      /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(500\)/,
    );
    expect(chatStoreSource).toMatch(
      /\.or\("metadata->>target\.is\.null,metadata->>target\.neq\.partner"\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(1\)\s*\.maybeSingle\(\)/,
    );
    expect(chatStoreSource).toMatch(
      /const allMessages = boundedRows\s*\.reverse\(\)/,
    );
  });

  it("ignores direct partner chat but stops recovery after a newer canonical AI turn", () => {
    const partnerMessage = {
      ...confirmationMessage,
      id: "44444444-4444-4444-8444-444444444444",
      sender_id: "user-2",
      sender_role: "groom" as const,
      content: "확인했어",
      metadata: { target: "partner" as const },
      created_at: "2026-07-30T01:02:00.000Z",
    };
    expect(buildConfirmedActionRecoveryRequest(
      [sourceMessage, confirmationMessage, partnerMessage],
      "couple-1",
    )).toEqual(expect.objectContaining({
      userMessageId: confirmationMessage.id,
    }));

    const aiResponse = {
      ...sourceMessage,
      id: "55555555-5555-4555-8555-555555555555",
      content: "반영했어요.",
      metadata: { confirmed_amora_action_id: actionId },
      created_at: "2026-07-30T01:03:00.000Z",
    };
    expect(buildConfirmedActionRecoveryRequest(
      [sourceMessage, confirmationMessage, aiResponse],
      "couple-1",
    )).toBeNull();
  });
});

describe("useChatStore quota warning", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useAuthStore.setState({ isDemo: false, journey: null });
    mockFetch.mockReset();
    mockInsertSingle.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.cookie = "demo_mode=true; path=/";
  });

  it("clears a stale exhausted warning when a chat request starts", async () => {
    useChatStore.setState({ quotaRemaining: 0 });
    mockFetch.mockResolvedValue(new Response("", { status: 500 }));

    await useChatStore.getState().sendMessage({
      content: "안녕",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });

    expect(useChatStore.getState().quotaRemaining).toBeNull();
  });

  it("clears a stale exhausted warning when an initial greeting starts", async () => {
    useChatStore.setState({ quotaRemaining: 0 });
    mockFetch.mockResolvedValue(new Response("", { status: 500 }));

    await useChatStore.getState().requestInitialGreeting({
      coupleId: "couple-1",
      senderRole: "bride",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });

    expect(useChatStore.getState().quotaRemaining).toBeNull();
  });

  it("clears a stale exhausted warning when a mediation request starts", async () => {
    useChatStore.setState({ quotaRemaining: 0 });
    mockFetch.mockResolvedValue(new Response("", { status: 500 }));

    await useChatStore.getState().requestMediation({
      coupleId: "couple-1",
      senderRole: "bride",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      conflictContext: "테스트 갈등",
    });

    expect(useChatStore.getState().quotaRemaining).toBeNull();
  });

  it("sends only the requester's explicit summary for structured mediation", async () => {
    useChatStore.setState({
      messages: [
        {
          id: "partner-secret",
          couple_id: "couple-1",
          sender_id: "user-2",
          sender_role: "groom",
          content: "PARTNER_RAW_SECRET",
          metadata: { target: "partner" },
          visibility: "shared",
          created_at: "2026-07-31T00:00:00.000Z",
        },
        {
          id: "private-secret",
          couple_id: "couple-1",
          sender_id: "user-1",
          sender_role: "bride",
          content: "PRIVATE_RAW_SECRET",
          metadata: { target: "ai" },
          visibility: "bride_private",
          created_at: "2026-07-31T00:00:01.000Z",
        },
      ],
    });
    mockFetch.mockResolvedValue(completedChatResponse("조율 초안"));

    await useChatStore.getState().requestMediation({
      coupleId: "couple-1",
      senderRole: "bride",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      conflictContext: "  예산 상한선을 두고 의견이 달라요.  ",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(
      String((mockFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;
    const serialized = JSON.stringify(requestBody);
    expect(serialized).not.toContain("PARTNER_RAW_SECRET");
    expect(serialized).not.toContain("PRIVATE_RAW_SECRET");
    expect(requestBody).toMatchObject({
      requestKind: "mediation",
      visibility: "shared",
      conflictContext: "예산 상한선을 두고 의견이 달라요.",
      messages: [
        {
          role: "user",
          content: expect.stringContaining("[MEDIATION_REQUEST]"),
        },
      ],
    });
  });

  it("does not call the mediation endpoint for an empty summary", async () => {
    await useChatStore.getState().requestMediation({
      coupleId: "couple-1",
      senderRole: "bride",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      conflictContext: "   ",
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState().error).toContain("상황을 짧게");
  });

  it("consumes CRLF SSE frames split across network chunks and keeps quota metadata", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("da"));
        controller.enqueue(encoder.encode('ta: {"type":"quota","remaining":7}\r'));
        controller.enqueue(encoder.encode("\n\r\n"));
        controller.enqueue(encoder.encode('data: {"type":"text_delta","content":"안녕"}\r\n\r'));
        controller.enqueue(encoder.encode("\n"));
        controller.enqueue(encoder.encode(
          'data: {"type":"quota","remaining":-1}\r\n\r\n',
        ));
        controller.enqueue(encoder.encode(
          'data: {"type":"done","fullContent":"안녕하세요","metadata":{}}\r\n\r\n',
        ));
        controller.close();
      },
    });
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));

    await useChatStore.getState().sendMessage({
      content: "안녕",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스트",
      weddingContext: {} as WeddingContext,
    });

    expect(useChatStore.getState().quotaRemaining).toBe(7);
    expect(useChatStore.getState().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ sender_role: "ai", content: "안녕하세요" }),
    ]));
    expect(useChatStore.getState().error).toBeNull();
  });

  it("clears a partial draft immediately when the stream reports an error", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));

    const sendPromise = useChatStore.getState().sendMessage({
      content: "질문",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스트",
      weddingContext: {} as WeddingContext,
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    streamController.enqueue(encoder.encode(
      'data: {"type":"text_delta","content":"확정되지 않은 초안"}\n\n',
    ));
    await vi.waitFor(() => {
      expect(useChatStore.getState().streamingContent).toBe("확정되지 않은 초안");
    });

    streamController.enqueue(encoder.encode(
      'data: {"type":"error","message":"답변을 만들지 못했어요."}\n\n',
    ));
    await vi.waitFor(() => {
      expect(useChatStore.getState().error).toBe("답변을 만들지 못했어요.");
    });
    expect(useChatStore.getState().streamingContent).toBe("");

    await sendPromise;
    expect(useChatStore.getState().messages.some((message) =>
      message.sender_role === "ai" && message.content.includes("초안")
    )).toBe(false);
  });
});

describe("useChatStore progress synchronization", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useAuthStore.setState({
      isDemo: false,
      journey: {
        id: "journey-1",
        couple_id: "couple-1",
        wedding_date: "2027-05-01",
        total_budget: 30_000_000,
        venue: null,
        progress: { __events: [] } as never,
        created_at: "2026-07-15T00:00:00.000Z",
        updated_at: "2026-07-15T00:00:00.000Z",
      },
    });
    mockFetch.mockReset();
    mockInsertSingle.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.cookie = "demo_mode=; Max-Age=0; path=/";
  });

  it("applies a logged wedding moment locally and waits for the authoritative journey refresh", async () => {
    const event = {
      id: "evt-moment-1",
      date: "2026-07-18",
      title: "상견례",
      momentType: "sanggyeonrye",
      createdAt: "2026-07-15T09:13:01.000Z",
      updatedAt: "2026-07-15T09:13:01.000Z",
    };
    const insertedMessage = {
      id: "message-1",
      couple_id: "couple-1",
      sender_id: "user-1",
      sender_type: "bride",
      role: "user",
      content: "토요일에 상견례야",
      metadata: null,
      visibility: "shared",
      created_at: "2026-07-15T09:13:00.000Z",
    };
    mockInsertSingle.mockResolvedValue({ data: insertedMessage, error: null });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: "tool_result",
            result: {
              toolName: "log_wedding_event",
              toolInput: { moment_type: "sanggyeonrye", date: "2026-07-18" },
              toolOutput: { event, created: true, moment_label: "상견례" },
              success: true,
              displayMessage: "일정을 저장했어요.",
            },
          })}\n\n`
        ));
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: "done",
            fullContent: "상견례 일정을 저장했어요.",
            metadata: { serverMessageId: "ai-message-1" },
          })}\n\n`
        ));
        controller.close();
      },
    });

    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/chat") {
        return new Response(stream, { status: 200 });
      }
      if (input === "/api/auth/me") {
        await refreshGate;
        return new Response(JSON.stringify({
          journey: {
            ...useAuthStore.getState().journey,
            progress: { __events: [event] },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    let sendResolved = false;
    const sendPromise = useChatStore.getState().sendMessage({
      content: "토요일에 상견례야",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    }).then(() => {
      sendResolved = true;
    });

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/me", { cache: "no-store" });
    });
    expect(sendResolved).toBe(false);
    expect(useAuthStore.getState().journey?.progress.__events).toContainEqual(event);

    releaseRefresh();
    await sendPromise;
    expect(sendResolved).toBe(true);
  });

  it("keeps an Amora budget change visible after the authoritative refresh", async () => {
    const insertedMessage = {
      id: "message-budget-1",
      couple_id: "couple-1",
      sender_id: "user-1",
      sender_type: "bride",
      role: "user",
      content: "총예산을 4천만원으로 바꿔줘",
      metadata: null,
      visibility: "shared",
      created_at: "2026-07-15T09:20:00.000Z",
    };
    mockInsertSingle.mockResolvedValue({ data: insertedMessage, error: null });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: "tool_result",
            result: {
              toolName: "update_budget",
              toolInput: { total_budget: 40_000_000 },
              toolOutput: { total_budget: 40_000_000 },
              success: true,
              displayMessage: "총예산을 변경했어요.",
            },
          })}\n\n`
        ));
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: "done",
            fullContent: "총예산을 4천만원으로 변경했어요.",
            metadata: { serverMessageId: "ai-message-budget-1" },
          })}\n\n`
        ));
        controller.close();
      },
    });

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/chat") return new Response(stream, { status: 200 });
      if (input === "/api/auth/me") {
        return new Response(JSON.stringify({
          journey: {
            ...useAuthStore.getState().journey,
            total_budget: 40_000_000,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    await useChatStore.getState().sendMessage({
      content: "총예산을 4천만원으로 바꿔줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });

    expect(useAuthStore.getState().journey?.total_budget).toBe(40_000_000);
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/me", { cache: "no-store" });
  });

  it("keeps an ephemeral NAVER result when done has no assistant text or persisted provider data", async () => {
    mockInsertSingle.mockResolvedValue({
      data: {
        id: "message-place-1",
        couple_id: "couple-1",
        sender_id: "user-1",
        sender_type: "bride",
        role: "user",
        content: "강남 상견례 식당 찾아줘",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T09:30:00.000Z",
      },
      error: null,
    });
    const placeResult = {
      toolName: "search_nearby_places",
      toolInput: { query: "강남 상견례 식당" },
      toolOutput: {
        query: "강남 상견례 식당",
        places: [{
          id: "naver-0",
          name: "한방정식",
          address: "서울 강남구",
          searchUrl: "https://search.naver.com/search.naver?query=test",
          mapsUrl: "https://map.naver.com/p/search/test",
        }],
      },
      success: true,
      displayMessage: "검색 결과 1곳을 찾았습니다.",
    };
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: "tool_result", result: placeResult })}\n\n`
        ));
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: "done",
            fullContent: "",
            metadata: { serverMessageId: "ai-message-place-1" },
          })}\n\n`
        ));
        controller.close();
      },
    });
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));

    await useChatStore.getState().sendMessage({
      content: "강남 상견례 식당 찾아줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });

    const aiMessage = useChatStore.getState().messages.find(
      (message) => message.id === "ai-message-place-1"
    );
    expect(aiMessage?.content).toBe("");
    expect(aiMessage?.metadata?.toolResults).toEqual([placeResult]);
    expect(useChatStore.getState().streamingToolResults).toEqual([]);
  });
});

describe("useChatStore failed provider retry", () => {
  const insertedMessage = {
    id: "user-message-1",
    couple_id: "couple-1",
    sender_id: "user-1",
    sender_type: "bride",
    role: "user",
    content: "계약서를 봐줘",
    metadata: null,
    visibility: "bride_private",
    created_at: "2026-07-17T00:00:00.000Z",
  };

  beforeEach(() => {
    useChatStore.getState().reset();
    mockFetch.mockReset();
    mockInsertSingle.mockReset();
    mockStorageUpload.mockReset();
    mockSupabase.from.mockClear();
    mockSupabase.storage.from.mockClear();
    vi.mocked(captureEvent).mockClear();
    mockInsertSingle.mockResolvedValue({ data: insertedMessage, error: null });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.cookie = "demo_mode=; Max-Age=0; path=/";
  });

  it("admits only one persistence and provider request on an immediate double tap", async () => {
    let releaseInsert!: (value: unknown) => void;
    mockInsertSingle.mockImplementation(() => new Promise((resolve) => {
      releaseInsert = resolve;
    }));
    mockFetch.mockResolvedValue(completedChatResponse());
    const params = {
      content: "계약서를 봐줘",
      senderId: "user-1",
      senderRole: "bride" as const,
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "bride_private" as const,
    };

    const first = useChatStore.getState().sendMessage(params);
    expect(useChatStore.getState().isSending).toBe(true);
    const second = useChatStore.getState().sendMessage(params);

    await vi.waitFor(() => expect(mockInsertSingle).toHaveBeenCalledTimes(1));
    releaseInsert({ data: insertedMessage, error: null });
    await Promise.all([first, second]);

    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(captureEvent).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().isSending).toBe(false);
  });

  it("rejects an oversized image before analytics, upload, message persistence, or provider work", async () => {
    await useChatStore.getState().sendMessage({
      content: "이 이미지를 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "a".repeat(3 * 1024 * 1024 + 4),
        mediaType: "image/png",
        previewUrl: "blob:image",
        fileName: "large.png",
      }],
    });

    expect(useChatStore.getState().error).toMatch(/첨부.*(크기|MB).*다시/);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().failedRequest).toBeNull();
    expect(captureEvent).not.toHaveBeenCalled();
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockInsertSingle).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retries only the provider request with the exact original body and durable ids", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(completedChatResponse());

    await useChatStore.getState().sendMessage({
      content: "계약서를 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} },
      visibility: "bride_private",
    });

    const failed = useChatStore.getState().failedRequest;
    expect(failed).toEqual(expect.objectContaining({
      userMessageId: "user-message-1",
      content: "계약서를 봐줘",
      visibility: "bride_private",
      canRetry: true,
    }));
    const firstBody = (mockFetch.mock.calls[0][1] as RequestInit).body;
    const firstPayload = JSON.parse(String(firstBody));
    expect(firstPayload).toEqual(expect.objectContaining({
      clientRequestId: failed?.clientRequestId,
      userMessageId: "user-message-1",
      visibility: "bride_private",
    }));

    await useChatStore.getState().retryFailedMessage();

    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect((mockFetch.mock.calls[1][1] as RequestInit).body).toBe(firstBody);
    expect(useChatStore.getState().failedRequest).toBeNull();
    expect(useChatStore.getState().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ai-message-retry-1", content: "완료된 답변" }),
    ]));
  });

  it("keeps the exact explicit action confirmation id in the provider retry snapshot", async () => {
    mockInsert.mockClear();
    mockFetch
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(completedChatResponse());

    await useChatStore.getState().sendMessage({
      content: "좋아요. 이 변경을 적용해 주세요.",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      confirmedActionId: "22222222-2222-4222-8222-222222222222",
    });

    const failed = useChatStore.getState().failedRequest;
    expect(failed).toEqual(expect.objectContaining({
      confirmedActionId: "22222222-2222-4222-8222-222222222222",
    }));
    const firstBody = (mockFetch.mock.calls[0][1] as RequestInit).body;
    expect(JSON.parse(String(firstBody))).toEqual(expect.objectContaining({
      confirmedActionId: "22222222-2222-4222-8222-222222222222",
    }));
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        confirmed_amora_action_id:
          "22222222-2222-4222-8222-222222222222",
      },
    }));

    await useChatStore.getState().retryFailedMessage();

    expect((mockFetch.mock.calls[1][1] as RequestInit).body).toBe(firstBody);
    expect(JSON.parse(String((mockFetch.mock.calls[1][1] as RequestInit).body))).toEqual(
      expect.objectContaining({ confirmedActionId: "22222222-2222-4222-8222-222222222222" }),
    );
  });

  it("reconciles a committed confirmation when its insert response is lost", async () => {
    const confirmedActionId = "22222222-2222-4222-8222-222222222222";
    const reconciledMessage = {
      ...insertedMessage,
      id: "33333333-3333-4333-8333-333333333333",
      content: "좋아요. 제안한 변경을 적용해 주세요.",
      metadata: { confirmed_amora_action_id: confirmedActionId },
      visibility: "shared",
    };
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { code: "NETWORK_RESPONSE_LOST" },
    });
    const recoveryQuery = {
      insert: mockInsert,
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: reconciledMessage,
        error: null,
      }),
    };
    recoveryQuery.select.mockReturnValue(recoveryQuery);
    recoveryQuery.eq.mockReturnValue(recoveryQuery);
    mockSupabase.from
      .mockImplementationOnce(() => ({ insert: mockInsert }))
      .mockImplementationOnce(() => recoveryQuery);
    mockFetch.mockResolvedValue(completedChatResponse());

    await useChatStore.getState().sendMessage({
      content: reconciledMessage.content,
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      confirmedActionId,
    });

    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
    expect(recoveryQuery.eq).toHaveBeenCalledWith(
      "metadata->>confirmed_amora_action_id",
      confirmedActionId,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(
      (mockFetch.mock.calls[0][1] as RequestInit).body,
    ))).toEqual(expect.objectContaining({
      userMessageId: reconciledMessage.id,
      confirmedActionId,
    }));
  });

  it("rejects a malformed or private action confirmation before any durable side effect", async () => {
    const base = {
      content: "좋아요. 제안한 변경을 적용해 주세요.",
      senderId: "user-1",
      senderRole: "bride" as const,
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "ai" as const,
    };

    await useChatStore.getState().sendMessage({
      ...base,
      visibility: "shared",
      confirmedActionId: "not-a-uuid",
    });
    await useChatStore.getState().sendMessage({
      ...base,
      visibility: "bride_private",
      confirmedActionId: "22222222-2222-4222-8222-222222222222",
    });

    expect(useChatStore.getState().error).toContain("확인");
    expect(mockInsertSingle).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("does not offer an identical retry or retain payload bytes for a permanent 422", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      error: "안전하지 않은 Word 파일이에요. 파일을 다시 저장한 뒤 첨부해주세요.",
      code: "UNSAFE_DOCX_ARCHIVE",
    }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    }));

    await useChatStore.getState().sendMessage({
      content: "계약서를 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });

    expect(useChatStore.getState().error).toContain("안전하지 않은 Word 파일");
    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: false,
      attachmentCount: 0,
      requestBody: "",
      unavailableReason: expect.stringContaining("새 메시지"),
    }));

    await useChatStore.getState().retryFailedMessage();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("blocks a duplicate retry while the first retry is in flight", async () => {
    mockFetch.mockResolvedValueOnce(new Response("temporary failure", { status: 503 }));
    await useChatStore.getState().sendMessage({
      content: "계약서를 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });

    let releaseRetry!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      releaseRetry = resolve;
    }));

    const firstRetry = useChatStore.getState().retryFailedMessage();
    const duplicateRetry = useChatStore.getState().retryFailedMessage();
    await duplicateRetry;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().isRetrying).toBe(true);

    releaseRetry(completedChatResponse());
    await firstRetry;
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retains a safe attachment as an immutable provider payload copy", async () => {
    document.cookie = "demo_mode=true; path=/";
    mockFetch
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(completedChatResponse("첨부 답변"));

    await useChatStore.getState().sendMessage({
      content: "이 파일을 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "Y29udHJhY3Q=",
        mediaType: "application/pdf",
        previewUrl: "blob:must-not-be-retained",
        fileName: "contract.pdf",
      }],
    });

    const firstBody = String((mockFetch.mock.calls[0][1] as RequestInit).body);
    expect(JSON.parse(firstBody).attachments).toEqual([{
      base64: "Y29udHJhY3Q=",
      mediaType: "application/pdf",
      fileName: "contract.pdf",
    }]);
    expect(firstBody).not.toContain("blob:must-not-be-retained");
    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      attachmentCount: 1,
      canRetry: true,
    }));

    await useChatStore.getState().retryFailedMessage();

    expect((mockFetch.mock.calls[1][1] as RequestInit).body).toBe(firstBody);
  });

  it("clears the old retry state as soon as a new message is accepted", async () => {
    mockFetch.mockResolvedValueOnce(new Response("temporary failure", { status: 503 }));
    await useChatStore.getState().sendMessage({
      content: "계약서를 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });
    expect(useChatStore.getState().failedRequest).not.toBeNull();

    await useChatStore.getState().sendMessage({
      content: "새 메시지",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "partner",
    });

    expect(useChatStore.getState().failedRequest).toBeNull();
  });

  it("clears retry material on store reset/logout", async () => {
    mockFetch.mockResolvedValueOnce(new Response("temporary failure", { status: 503 }));
    await useChatStore.getState().sendMessage({
      content: "계약서를 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });
    expect(useChatStore.getState().failedRequest).not.toBeNull();

    useChatStore.getState().reset();

    expect(useChatStore.getState().failedRequest).toBeNull();
    expect(useChatStore.getState().isRetrying).toBe(false);
  });

  it("does not restore retry material when an in-flight retry settles after logout", async () => {
    mockFetch.mockResolvedValueOnce(new Response("temporary failure", { status: 503 }));
    await useChatStore.getState().sendMessage({
      content: "계약서를 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });

    let releaseRetry!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      releaseRetry = resolve;
    }));
    const retry = useChatStore.getState().retryFailedMessage();
    useChatStore.getState().reset();

    releaseRetry(new Response("late failure", { status: 503 }));
    await retry;

    expect(useChatStore.getState().failedRequest).toBeNull();
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("discards retained retry material when the user closes the retry notice", async () => {
    mockFetch.mockResolvedValueOnce(new Response("temporary failure", { status: 503 }));
    await useChatStore.getState().sendMessage({
      content: "계약서를 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });

    useChatStore.getState().dismissFailedMessageRetry();

    expect(useChatStore.getState().failedRequest).toBeNull();
    expect(useChatStore.getState().error).toBeNull();
  });

  it("rejects an oversized PDF before any upload, message, or provider request", async () => {
    await useChatStore.getState().sendMessage({
      content: "이 파일을 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "a".repeat(3 * 1024 * 1024 + 4),
        mediaType: "application/pdf",
        previewUrl: "",
        fileName: "large.pdf",
      }],
    });

    expect(useChatStore.getState().error).toMatch(/첨부.*(크기|MB).*다시/);
    expect(useChatStore.getState().failedRequest).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects an oversized DOCX before any upload, message, or provider request", async () => {
    await useChatStore.getState().sendMessage({
      content: "이 문서를 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "a".repeat(3 * 1024 * 1024 + 4),
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        previewUrl: "",
        fileName: "large.docx",
      }],
    });

    expect(useChatStore.getState().error).toMatch(/첨부.*(크기|MB).*다시/);
    expect(useChatStore.getState().failedRequest).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects an attachment that cannot form a safe snapshot before every side effect", async () => {
    await useChatStore.getState().sendMessage({
      content: "이 파일을 봐줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "not-valid-base64",
        mediaType: "application/pdf",
        previewUrl: "",
        fileName: "broken.pdf",
      }],
    });

    expect(useChatStore.getState().error).toMatch(/안전하게.*다시 첨부/);
    expect(useChatStore.getState().failedRequest).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(captureEvent).not.toHaveBeenCalled();
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
