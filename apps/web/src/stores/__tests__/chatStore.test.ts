import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildConfirmedActionRecoveryRequest,
  reconcileAmoraCrisisRecoveryMessages,
  syncToolResult,
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
const chatContentSource = readFileSync(
  path.join(process.cwd(), "src/components/app/chat/ChatContent.tsx"),
  "utf8",
);
const chatSidePanelSource = readFileSync(
  path.join(process.cwd(), "src/components/app/chat/ChatSidePanel.tsx"),
  "utf8",
);
const mockInsertSingle = vi.fn();
const mockStorageUpload = vi.fn();
const mockStorageRemove = vi.fn();
const mockInsert = vi.fn((payload?: unknown) => {
  void payload;
  return {
    select: vi.fn(() => ({
      single: mockInsertSingle,
    })),
  };
});
const mockReconcileMaybeSingle = vi.fn();
const mockReconcileQuery = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: mockReconcileMaybeSingle,
};
mockReconcileQuery.select.mockReturnValue(mockReconcileQuery);
mockReconcileQuery.eq.mockReturnValue(mockReconcileQuery);
const defaultChatMessagesTable = {
  insert: mockInsert,
  select: mockReconcileQuery.select,
};
const mockFrom = vi.fn((table?: string): Record<string, unknown> => {
  void table;
  return defaultChatMessagesTable;
});

const mockSupabase = {
  storage: {
    from: vi.fn(() => ({ upload: mockStorageUpload, remove: mockStorageRemove })),
  },
  from: mockFrom,
};

const TEST_COUPLE_UUID = "20000000-0000-4000-8000-000000000001";
const TEST_USER_UUID = "10000000-0000-4000-8000-000000000001";
const TEST_OTHER_USER_UUID = "10000000-0000-4000-8000-000000000002";
const TEST_CLIENT_REQUEST_UUID = "30000000-0000-4000-8000-000000000001";
const TEST_CONFIRMED_ACTION_UUID = "40000000-0000-4000-8000-000000000001";

describe("booking projection local sync", () => {
  it("keeps recorded spend and soft-cancels the stable event", () => {
    const bookingId = "60000000-0000-4000-8000-000000000001";
    const eventId = `evt_booking_${bookingId}`;
    useAuthStore.setState({
      journey: {
        id: "journey-1",
        progress: {
          studio: {
            category: "studio",
            status: "in_progress",
            spent: 850_000,
          },
          __events: [{
            id: eventId,
            sourceKey: `booking:${bookingId}`,
            date: "2026-10-01",
            title: "스튜디오 상담",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          }],
        },
      } as never,
    });
    const cancelledEvent = {
      id: eventId,
      sourceKey: `booking:${bookingId}`,
      date: "2026-10-01",
      title: "스튜디오 상담",
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T12:30:00.000Z",
        cancelledByProfileId: TEST_USER_UUID,
        reason: "예약 취소",
      },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T12:30:00.000Z",
    };

    syncToolResult({
      toolName: "cancel_booking",
      toolInput: { booking_id: bookingId },
      toolOutput: {
        scheduleCancelled: true,
        recordedSpendPreserved: true,
        quoteContributionCorrected: false,
        syncedEvent: cancelledEvent,
        syncedEventId: eventId,
        syncedEventIdRemoved: null,
        syncedCategoryKey: null,
        syncedNewSpent: null,
      },
      success: true,
      displayMessage: "",
    });

    const progress = useAuthStore.getState().journey?.progress as unknown as
      Record<string, unknown>;
    expect(progress.studio).toMatchObject({ spent: 850_000 });
    expect(progress.__events).toEqual([cancelledEvent]);
  });
});

function durableUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    couple_id: TEST_COUPLE_UUID,
    sender_id: TEST_USER_UUID,
    sender_type: "bride",
    role: "user",
    content: "retry this exact message",
    metadata: { client_request_id: TEST_CLIENT_REQUEST_UUID },
    visibility: "shared",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function completedChatResponse(
  content = "완료된 답변",
  metadata: Record<string, unknown> = { serverMessageId: "ai-message-retry-1" },
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({
          type: "done",
          fullContent: content,
          metadata,
        })}\n\n`
      ));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function failedChatStreamResponse(event: Record<string, unknown>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: "error",
        ...event,
      })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function retryableChatHttpResponse() {
  return new Response(JSON.stringify({
    error: "safe retry",
    code: "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED",
    retryable: true,
    retryPolicy: "same_request",
  }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
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

describe("Amora crisis reload recovery", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    mockFetch.mockReset();
    mockInsertSingle.mockReset();
    mockReconcileMaybeSingle.mockReset();
    mockReconcileMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSupabase.from.mockReset();
    mockSupabase.from.mockImplementation(() => defaultChatMessagesTable);
    mockInsertSingle.mockResolvedValue({
      data: {
        id: "user-message-1",
        couple_id: "couple-1",
        sender_id: "user-1",
        sender_type: "bride",
        role: "user",
        content: "지금 죽고 싶어",
        metadata: null,
        visibility: "bride_private",
        created_at: "2026-08-02T12:00:00.000Z",
      },
      error: null,
    });
    vi.stubGlobal("fetch", mockFetch);
    document.cookie = "demo_mode=; Max-Age=0; path=/";
    useAuthStore.setState({
      profile: {
        id: "user-1",
        name: "테스터",
        role: "bride",
        couple_id: "couple-1",
      } as never,
    });
  });

  it("adds a local-only same-visibility safety card without copying the disclosure into metadata", () => {
    const disclosure = {
      id: "crisis-user-1",
      couple_id: "couple-1",
      sender_id: "user-1",
      sender_role: "bride" as const,
      content: "지금 죽고 싶어",
      metadata: { target: "ai" as const },
      visibility: "bride_private" as const,
      created_at: "2026-08-02T12:00:00.000Z",
    };

    const recovered = reconcileAmoraCrisisRecoveryMessages(
      [disclosure],
      "couple-1",
    );

    expect(recovered).toHaveLength(2);
    expect(recovered[1]).toEqual(expect.objectContaining({
      sender_id: null,
      sender_role: "ai",
      visibility: "bride_private",
      content: expect.stringContaining("112"),
      metadata: expect.objectContaining({
        response_origin: "client_deterministic_crisis_recovery",
        in_reply_to_user_message_id: disclosure.id,
      }),
    }));
    expect(JSON.stringify(recovered[1].metadata)).not.toContain(disclosure.content);
  });

  it("reconciles the local card on history load and every later canonical insert", () => {
    expect(chatStoreSource).toMatch(
      /messages: reconcileAmoraCrisisRecoveryMessages\(allMessages, coupleId\)/,
    );
    expect(chatStoreSource).toMatch(
      /const nextMessages = reconcileAmoraCrisisRecoveryMessages\([\s\S]*newMsg[\s\S]*coupleId/,
    );
  });

  it("renders the recovered guidance as an alert and never treats it as feedback or community content", () => {
    expect(chatContentSource).toMatch(
      /const isPinnedSafetyCard = msg\.metadata\?\.pinned_safety_card === true/,
    );
    expect(chatContentSource).toMatch(
      /filter\(\(m\) => m\.sender_role === "ai" && m\.metadata\?\.pinned_safety_card !== true\)/,
    );
    expect(chatContentSource).toMatch(
      /!isPinnedSafetyCard[\s\S]*canConsiderCommunityFallback/,
    );
    expect(chatContentSource).toMatch(/data-amora-safety-card="true"/);
    expect(chatContentSource).toMatch(/role="alert"/);
  });

  it("binds an ephemeral deterministic crisis response to its durable user row without copying raw text", async () => {
    mockFetch.mockResolvedValue(completedChatResponse(
      "고정 안전 안내",
      {
        response_origin: "deterministic_crisis_safety",
        safety_classification: "self_harm",
        question_scope: "W5_safety_override",
      },
    ));

    await useChatStore.getState().sendMessage({
      content: "지금 죽고 싶어",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "bride_private",
    });

    const answer = useChatStore.getState().messages.find(
      (candidate) => candidate.sender_role === "ai",
    );
    expect(answer?.metadata).toEqual(expect.objectContaining({
      response_origin: "deterministic_crisis_safety",
      in_reply_to_user_message_id: "user-message-1",
    }));
    expect(JSON.stringify(answer?.metadata)).not.toContain("죽고 싶어");
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

  it("keeps the active send lock when greeting and mediation are requested mid-send", async () => {
    useChatStore.setState({ isSending: true, isStreaming: false });

    await useChatStore.getState().requestInitialGreeting({
      coupleId: TEST_COUPLE_UUID,
      senderRole: "bride",
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
    });
    await useChatStore.getState().requestMediation({
      coupleId: TEST_COUPLE_UUID,
      senderRole: "bride",
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      conflictContext: "We disagree about the budget order.",
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState().isSending).toBe(true);
    expect(useChatStore.getState().isStreaming).toBe(false);

    // reset() intentionally preserves in-flight flags, so do not leak this
    // synthetic lock into later tests in the shared singleton store.
    useChatStore.setState({ isSending: false });
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
    mockInsert.mockClear();
    mockInsertSingle.mockReset();
    mockStorageUpload.mockReset();
    mockStorageRemove.mockReset();
    mockReconcileMaybeSingle.mockReset();
    mockReconcileMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockReconcileQuery.select.mockClear();
    mockReconcileQuery.eq.mockClear();
    mockSupabase.from.mockReset();
    mockSupabase.from.mockImplementation(() => defaultChatMessagesTable);
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

  it("never sends a direct partner message back to the provider in demo context", async () => {
    document.cookie = "demo_mode=true; path=/";
    mockFetch.mockResolvedValue(completedChatResponse());
    const base = {
      senderId: "user-1",
      senderRole: "bride" as const,
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared" as const,
    };

    await useChatStore.getState().sendMessage({
      ...base,
      content: "상대방에게만 보낼 비밀 문장",
      target: "partner",
      partnerRecipientId: TEST_OTHER_USER_UUID,
    });
    expect(mockFetch).not.toHaveBeenCalled();

    await useChatStore.getState().sendMessage({
      ...base,
      content: "아모라에게 묻는 새 질문",
      target: "ai",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const providerPayload = JSON.parse(String(
      (mockFetch.mock.calls[0][1] as RequestInit).body,
    )) as { messages?: Array<{ content?: string }> };
    const providerContext = JSON.stringify(providerPayload.messages ?? []);
    expect(providerContext).toContain("아모라에게 묻는 새 질문");
    expect(providerContext).not.toContain("상대방에게만 보낼 비밀 문장");
  });

  it("pins a direct partner row to the exact recipient without invoking the provider", async () => {
    mockInsertSingle.mockResolvedValueOnce({
      data: {
        ...insertedMessage,
        content: "only for my linked partner",
        metadata: {
          target: "partner",
          client_request_id: TEST_CLIENT_REQUEST_UUID,
          partner_recipient_id: TEST_OTHER_USER_UUID,
        },
        visibility: "shared",
      },
      error: null,
    });

    const outcome = await useChatStore.getState().sendMessage({
      content: "only for my linked partner",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      target: "partner",
      partnerRecipientId: TEST_OTHER_USER_UUID,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome.userMessage).toBe("persisted");
    expect(mockInsert.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      metadata: {
        target: "partner",
        client_request_id: TEST_CLIENT_REQUEST_UUID,
        partner_recipient_id: TEST_OTHER_USER_UUID,
      },
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails closed before side effects when a direct partner recipient is missing", async () => {
    const outcome = await useChatStore.getState().sendMessage({
      content: "do not guess who receives this",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      target: "partner",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual({ userMessage: "not_persisted", reason: "validation" });
    expect(useChatStore.getState().error).toContain("상대방 연결 정보");
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails closed before side effects when the direct recipient is the sender", async () => {
    const outcome = await useChatStore.getState().sendMessage({
      content: "do not address this back to me",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      target: "partner",
      partnerRecipientId: TEST_USER_UUID,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual({ userMessage: "not_persisted", reason: "validation" });
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["shared AI", "shared", "ai"],
    ["private AI", "bride_private", "ai"],
    ["private partner", "bride_private", "partner"],
  ] as const)("never mixes a partner recipient into a %s delivery", async (
    _label,
    visibility,
    target,
  ) => {
    const outcome = await useChatStore.getState().sendMessage({
      content: "keep the delivery lane exact",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility,
      target,
      partnerRecipientId: TEST_OTHER_USER_UUID,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual({ userMessage: "not_persisted", reason: "validation" });
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("derives the same exact opposite roster slot in both web chat surfaces", () => {
    for (const surfaceSource of [chatContentSource, chatSidePanelSource]) {
      expect(surfaceSource).toMatch(/const linkedPartnerId =/);
      expect(surfaceSource).toMatch(/profile\.couple_id === coupleId/);
      expect(surfaceSource).toMatch(/couple\?\.bride_id === profile\.id/);
      expect(surfaceSource).toMatch(/couple\?\.groom_id === profile\.id/);
      expect(surfaceSource).toMatch(/partnerRecipientId: linkedPartnerId/);
    }
  });

  it("reports that the user message was not persisted when its database insert fails", async () => {
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { code: "XX001", message: "database unavailable" },
    });

    const outcome = await useChatStore.getState().sendMessage({
      content: "저장 실패 시 초안을 돌려줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "bride_private",
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "not_persisted",
      reason: "database",
    }));
    expect(useChatStore.getState().messages).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not destructively remove an immutable image after a failed user-row insert", async () => {
    mockStorageUpload.mockResolvedValue({ error: null });
    mockStorageRemove.mockResolvedValue({ error: null });
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "insert rejected" },
    });

    const outcome = await useChatStore.getState().sendMessage({
      content: "첨부 저장도 되돌려줘",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "bride_private",
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        previewUrl: "blob:image-preview",
        fileName: "receipt.png",
      }],
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "not_persisted",
      reason: "database",
    }));
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports an unknown persistence result when the reconciliation query also fails", async () => {
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { code: "NETWORK_RESPONSE_LOST", message: "insert response lost" },
    });
    mockReconcileMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "NETWORK_UNAVAILABLE", message: "cannot reconcile" },
    });

    const outcome = await useChatStore.getState().sendMessage({
      content: "전송 여부를 다시 확인해줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
    });

    expect(outcome).toEqual({
      userMessage: "persistence_unknown",
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(useChatStore.getState().error).toMatch(/전송됐는지 확인/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns the reusable idempotency key when the insert request throws before reconciliation", async () => {
    mockInsertSingle.mockRejectedValue(new Error("network disconnected"));
    mockReconcileMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "NETWORK_UNAVAILABLE", message: "cannot reconcile" },
    });

    const outcome = await useChatStore.getState().sendMessage({
      content: "네트워크 예외도 같은 키로 확인해줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
    });

    expect(outcome).toEqual({
      userMessage: "persistence_unknown",
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(useChatStore.getState().isSending).toBe(false);
  });

  it("reuses an immutable canonical image path and accepts only an exact 409 duplicate on retry", async () => {
    const persisted = durableUserRow();
    mockStorageUpload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        error: {
          statusCode: "409",
          error: "Duplicate",
          message: "The resource already exists",
        },
      });
    mockInsertSingle
      .mockResolvedValueOnce({
        data: null,
        error: { code: "NETWORK_RESPONSE_LOST", message: "insert response lost" },
      })
      .mockResolvedValueOnce({ data: persisted, error: null });
    mockReconcileMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "NETWORK_UNAVAILABLE", message: "cannot reconcile" },
      })
      .mockResolvedValueOnce({ data: null, error: null });
    mockFetch.mockResolvedValue(completedChatResponse());
    const params = {
      content: persisted.content,
      senderId: TEST_USER_UUID,
      senderRole: "bride" as const,
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared" as const,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        previewUrl: "blob:image-preview",
        fileName: "receipt.png",
      }],
    };

    const firstOutcome = await useChatStore.getState().sendMessage(params);
    expect(firstOutcome).toEqual({
      userMessage: "persistence_unknown",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    const retryOutcome = await useChatStore.getState().sendMessage(params);

    expect(retryOutcome).toEqual({
      userMessage: "persisted",
      userMessageId: persisted.id,
    });
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
    expect(mockStorageUpload.mock.calls[1][0]).toBe(mockStorageUpload.mock.calls[0][0]);
    expect(mockStorageUpload.mock.calls[0][0]).toMatch(
      new RegExp(
        `^${TEST_COUPLE_UUID}/${TEST_USER_UUID}/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$`,
      ),
    );
    expect(mockStorageUpload.mock.calls[0][2]).toEqual({
      contentType: "image/png",
      upsert: false,
    });
    expect(mockStorageUpload.mock.calls[1][2]).toEqual({
      contentType: "image/png",
      upsert: false,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["PDF", "application/pdf", "contract.pdf"],
    [
      "DOCX",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "contract.docx",
    ],
  ])("keeps %s attachments provider-only and out of chat-image metadata", async (
    _label,
    mediaType,
    fileName,
  ) => {
    const content = `review ${fileName}`;
    mockInsertSingle.mockResolvedValue({
      data: durableUserRow({ content }),
      error: null,
    });
    mockFetch.mockResolvedValue(completedChatResponse());

    const outcome = await useChatStore.getState().sendMessage({
      content,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      images: [{
        base64: "ZG9jdW1lbnQtYnl0ZXM=",
        mediaType,
        previewUrl: `blob:${fileName}`,
        fileName,
      }],
    });

    expect(outcome.userMessage).toBe("persisted");
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
    expect(mockStorageUpload).not.toHaveBeenCalled();
    const insertedPayload = mockInsert.mock.calls.at(-1)?.[0] as {
      metadata?: Record<string, unknown>;
    };
    expect(insertedPayload.metadata).toEqual({
      client_request_id: TEST_CLIENT_REQUEST_UUID,
    });
    const providerPayload = JSON.parse(String(
      (mockFetch.mock.calls.at(-1)?.[1] as RequestInit).body,
    )) as { attachments?: Array<Record<string, unknown>> };
    expect(providerPayload.attachments).toEqual([{
      base64: "ZG9jdW1lbnQtYnl0ZXM=",
      mediaType,
      fileName,
    }]);
  });

  it.each([
    ["PDF", "application/pdf", "contract.pdf"],
    [
      "DOCX",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "contract.docx",
    ],
  ])("rejects a partner-targeted %s before every side effect", async (
    _label,
    mediaType,
    fileName,
  ) => {
    const outcome = await useChatStore.getState().sendMessage({
      content: `send ${fileName} to my partner`,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      target: "partner",
      images: [{
        base64: "ZG9jdW1lbnQtYnl0ZXM=",
        mediaType,
        previewUrl: `blob:${fileName}`,
        fileName,
      }],
    });

    expect(outcome).toEqual({
      userMessage: "not_persisted",
      reason: "validation",
    });
    expect(captureEvent).not.toHaveBeenCalled();
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("stops before database and provider work when an immutable image upload fails", async () => {
    mockStorageUpload.mockResolvedValue({
      error: {
        statusCode: 403,
        error: "Forbidden",
        message: "row-level security policy denied the upload",
      },
    });

    const outcome = await useChatStore.getState().sendMessage({
      content: "review this receipt",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        previewUrl: "blob:image-preview",
        fileName: "receipt.png",
      }],
    });

    expect(outcome).toEqual({
      userMessage: "not_persisted",
      reason: "storage",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().isSending).toBe(false);
  });

  it("pre-reconciles a requested key and skips both image upload and insert for its exact row", async () => {
    const reconciled = durableUserRow({
      metadata: {
        client_request_id: TEST_CLIENT_REQUEST_UUID,
        imagePaths: [
          `${TEST_COUPLE_UUID}/${TEST_USER_UUID}/60000000-0000-5000-8000-000000000001.png`,
        ],
      },
    });
    mockReconcileMaybeSingle.mockResolvedValue({ data: reconciled, error: null });
    mockFetch.mockResolvedValue(completedChatResponse());

    const outcome = await useChatStore.getState().sendMessage({
      content: reconciled.content,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        previewUrl: "blob:image-preview",
        fileName: "receipt.png",
      }],
    });

    expect(outcome).toEqual({
      userMessage: "persisted",
      userMessageId: reconciled.id,
    });
    expect(mockReconcileMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().messages.filter(
      (message) => message.id === reconciled.id,
    )).toHaveLength(1);
  });

  it("pre-reconciles a partner retry only when the exact recipient is still bound", async () => {
    const reconciled = durableUserRow({
      metadata: {
        client_request_id: TEST_CLIENT_REQUEST_UUID,
        target: "partner",
        partner_recipient_id: TEST_OTHER_USER_UUID,
      },
    });
    mockReconcileMaybeSingle.mockResolvedValue({ data: reconciled, error: null });

    const outcome = await useChatStore.getState().sendMessage({
      content: reconciled.content,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      target: "partner",
      partnerRecipientId: TEST_OTHER_USER_UUID,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual({ userMessage: "persisted", userMessageId: reconciled.id });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a partner retry row bound to a different recipient", async () => {
    mockReconcileMaybeSingle.mockResolvedValue({
      data: durableUserRow({
        metadata: {
          client_request_id: TEST_CLIENT_REQUEST_UUID,
          target: "partner",
          partner_recipient_id: TEST_CONFIRMED_ACTION_UUID,
        },
      }),
      error: null,
    });

    const outcome = await useChatStore.getState().sendMessage({
      content: "retry this exact message",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      target: "partner",
      partnerRecipientId: TEST_OTHER_USER_UUID,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual({ userMessage: "not_persisted", reason: "validation" });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["sender id", { sender_id: TEST_OTHER_USER_UUID }],
    ["sender role", { sender_type: "groom" }],
    ["content", { content: "different content" }],
    ["visibility", { visibility: "bride_private" }],
    [
      "target",
      {
        metadata: {
          client_request_id: TEST_CLIENT_REQUEST_UUID,
          target: "partner",
        },
      },
    ],
    [
      "confirmed action",
      {
        metadata: {
          client_request_id: TEST_CLIENT_REQUEST_UUID,
          confirmed_amora_action_id: TEST_CONFIRMED_ACTION_UUID,
        },
      },
    ],
    [
      "partner recipient on an AI row",
      {
        metadata: {
          client_request_id: TEST_CLIENT_REQUEST_UUID,
          partner_recipient_id: TEST_OTHER_USER_UUID,
        },
      },
    ],
  ])("rejects a pre-reconciled row with mismatched %s", async (
    _field,
    mismatch,
  ) => {
    mockReconcileMaybeSingle.mockResolvedValue({
      data: durableUserRow(mismatch),
      error: null,
    });

    const outcome = await useChatStore.getState().sendMessage({
      content: "retry this exact message",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      target: "ai",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual({
      userMessage: "not_persisted",
      reason: "validation",
    });
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState().isSending).toBe(false);
  });

  it("deduplicates a durable user row when realtime arrives before the insert response", async () => {
    const persisted = durableUserRow();
    let releaseInsert!: (value: unknown) => void;
    mockInsertSingle.mockImplementation(() => new Promise((resolve) => {
      releaseInsert = resolve;
    }));
    mockFetch.mockResolvedValue(completedChatResponse());

    const send = useChatStore.getState().sendMessage({
      content: persisted.content,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockInsertSingle).toHaveBeenCalledTimes(1));

    useChatStore.setState({
      messages: [{
        id: persisted.id,
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_USER_UUID,
        sender_role: "bride",
        content: persisted.content,
        metadata: persisted.metadata,
        visibility: "shared",
        created_at: persisted.created_at,
      }],
    });
    releaseInsert({ data: persisted, error: null });
    await send;

    expect(useChatStore.getState().messages.filter(
      (message) => message.id === persisted.id,
    )).toHaveLength(1);
  });

  it("reports a durable user message when only the provider phase fails", async () => {
    mockFetch.mockResolvedValue(retryableChatHttpResponse());

    const outcome = await useChatStore.getState().sendMessage({
      content: "저장은 하고 AI만 다시 시도해줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "bride_private",
    });

    expect(outcome).toEqual({
      userMessage: "persisted",
      userMessageId: "user-message-1",
    });
    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      userMessageId: "user-message-1",
      canRetry: true,
    }));
  });

  it("turns the preview-stub API code into a truthful consumer message without a dead retry", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      error: "preview_stub_api_disabled",
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));

    await useChatStore.getState().sendMessage({
      content: "날짜 없이 먼저 맞출 기준을 알려줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
    });

    expect(useChatStore.getState().error).toBe(
      "현재 미리보기에서는 AI 답변을 생성하지 않아요. 입력한 내용은 계정의 준비 기록에 남지 않았어요.",
    );
    expect(useChatStore.getState().error).not.toContain("preview_stub_api_disabled");
    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: false,
      requestBody: "",
      unavailableReason: "현재 미리보기에서는 같은 요청을 재시도할 수 없어요.",
    }));
  });

  it("binds the durable user row and provider request to the same idempotency key", async () => {
    mockFetch.mockResolvedValue(completedChatResponse());

    await useChatStore.getState().sendMessage({
      content: "한 번만 저장해줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
    });

    const insertedPayload = mockInsert.mock.calls.at(-1)?.[0] as {
      metadata?: { client_request_id?: string };
    };
    const providerPayload = JSON.parse(String(
      (mockFetch.mock.calls.at(-1)?.[1] as RequestInit).body,
    ));
    expect(insertedPayload.metadata?.client_request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(providerPayload.clientRequestId).toBe(insertedPayload.metadata?.client_request_id);
  });

  it("reconciles any committed user message when its insert response is lost", async () => {
    const reconciledMessage = {
      ...insertedMessage,
      id: "44444444-4444-4444-8444-444444444444",
      content: "응답이 유실돼도 중복 저장하지 마",
      visibility: "shared",
    };
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { code: "NETWORK_RESPONSE_LOST", message: "response lost" },
    });
    const recoveryQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    recoveryQuery.select.mockReturnValue(recoveryQuery);
    recoveryQuery.eq.mockReturnValue(recoveryQuery);
    recoveryQuery.maybeSingle.mockImplementation(async () => {
      const requestId = recoveryQuery.eq.mock.calls.find(
        ([column]) => column === "metadata->>client_request_id",
      )?.[1];
      return {
        data: {
          ...reconciledMessage,
          metadata: { client_request_id: requestId },
        },
        error: null,
      };
    });
    mockSupabase.from
      .mockImplementationOnce(() => ({ insert: mockInsert }))
      .mockImplementationOnce(() => recoveryQuery);
    mockFetch.mockResolvedValue(completedChatResponse());

    const outcome = await useChatStore.getState().sendMessage({
      content: reconciledMessage.content,
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
    });

    expect(recoveryQuery.eq).toHaveBeenCalledWith(
      "metadata->>client_request_id",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(outcome).toEqual({
      userMessage: "persisted",
      userMessageId: reconciledMessage.id,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
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
      .mockResolvedValueOnce(retryableChatHttpResponse())
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
      .mockResolvedValueOnce(retryableChatHttpResponse())
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
      metadata: expect.objectContaining({
        confirmed_amora_action_id:
          "22222222-2222-4222-8222-222222222222",
      }),
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
      maybeSingle: vi.fn(),
    };
    recoveryQuery.select.mockReturnValue(recoveryQuery);
    recoveryQuery.eq.mockReturnValue(recoveryQuery);
    recoveryQuery.maybeSingle.mockImplementation(async () => {
      const requestId = recoveryQuery.eq.mock.calls.find(
        ([column]) => column === "metadata->>client_request_id",
      )?.[1];
      return {
        data: {
          ...reconciledMessage,
          metadata: {
            client_request_id: requestId,
            confirmed_amora_action_id: confirmedActionId,
          },
        },
        error: null,
      };
    });
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
      "metadata->>client_request_id",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
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

  it("does not offer an immutable retry when the SSE terminal marks the request non-retryable", async () => {
    mockFetch.mockResolvedValue(failedChatStreamResponse({
      code: "PRIVACY_CONTEXT_CHANGED",
      message: "개인정보 설정이 바뀌어 답변을 표시하지 않았어요.",
      retryable: false,
      retryPolicy: "new_message",
    }));

    await useChatStore.getState().sendMessage({
      content: "이전 요청을 그대로 다시 실행하면 안 돼",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "bride_private",
    });

    expect(useChatStore.getState().error).toContain("개인정보 설정");
    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: false,
      requestBody: "",
      unavailableReason: expect.stringContaining("새 메시지"),
    }));

    await useChatStore.getState().retryFailedMessage();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("honors a JSON privacy terminal as new-message-only without exposing server detail", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      error: "private privacy epoch mismatch detail",
      code: "AMORA_PRIVACY_CONTEXT_CHANGED",
      retryable: true,
      retryPolicy: "new_message",
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));

    await useChatStore.getState().sendMessage({
      content: "개인정보 설정 변경 뒤 안전하게 새 요청으로 안내해 줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "bride_private",
    });

    expect(useChatStore.getState().error).not.toContain("private privacy epoch mismatch detail");
    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: false,
      content: "",
      requestBody: "",
      unavailableReason: expect.stringContaining("새 메시지"),
    }));
  });

  it.each([
    ["legacy", JSON.stringify({ code: "LEGACY_HTTP_503" })],
    ["malformed", "not-json"],
  ])("fails closed for a %s HTTP terminal without an explicit replay contract", async (
    _label,
    body,
  ) => {
    mockFetch.mockResolvedValue(new Response(body, { status: 503 }));

    await useChatStore.getState().sendMessage({
      content: "재시도 계약이 없으면 새 메시지로 안내해 줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
    });

    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: false,
      content: "",
      requestBody: "",
      unavailableReason: expect.stringContaining("새 메시지"),
    }));
  });

  it("keeps the exact immutable retry across streamed and repeated JSON memory failures", async () => {
    mockFetch
      .mockResolvedValueOnce(failedChatStreamResponse({
        code: "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED",
        message: "답변 저장을 확인하는 중이에요.",
        retryable: true,
        retryPolicy: "same_request",
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "private memory reconciliation detail",
        code: "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED",
        retryable: false,
        retryPolicy: "same_request",
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(completedChatResponse());

    await useChatStore.getState().sendMessage({
      content: "저장 확인 후 같은 요청으로 이어가 줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
    });

    const firstBody = (mockFetch.mock.calls[0][1] as RequestInit).body;
    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: true,
      requestBody: firstBody,
      unavailableReason: null,
    }));

    await useChatStore.getState().retryFailedMessage();
    expect((mockFetch.mock.calls[1][1] as RequestInit).body).toBe(firstBody);
    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: true,
      requestBody: firstBody,
      unavailableReason: null,
    }));
    expect(useChatStore.getState().error).not.toContain("private memory reconciliation detail");

    await useChatStore.getState().retryFailedMessage();
    expect((mockFetch.mock.calls[2][1] as RequestInit).body).toBe(firstBody);
    expect(useChatStore.getState().failedRequest).toBeNull();
  });

  it("fails closed for a legacy SSE terminal without an explicit replay contract", async () => {
    mockFetch.mockResolvedValue(failedChatStreamResponse({
      code: "LEGACY_TERMINAL",
      message: "요청을 완료하지 못했어요.",
    }));

    await useChatStore.getState().sendMessage({
      content: "구버전 응답은 보수적으로 처리해 줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });

    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: false,
      content: "",
      requestBody: "",
    }));
  });

  it("blocks a duplicate retry while the first retry is in flight", async () => {
    mockFetch.mockResolvedValueOnce(retryableChatHttpResponse());
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
      .mockResolvedValueOnce(retryableChatHttpResponse())
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
    mockFetch.mockResolvedValueOnce(retryableChatHttpResponse());
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
      partnerRecipientId: TEST_OTHER_USER_UUID,
    });

    expect(useChatStore.getState().failedRequest).toBeNull();
  });

  it("clears retry material on store reset/logout", async () => {
    mockFetch.mockResolvedValueOnce(retryableChatHttpResponse());
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
    mockFetch.mockResolvedValueOnce(retryableChatHttpResponse());
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
    mockFetch.mockResolvedValueOnce(retryableChatHttpResponse());
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
