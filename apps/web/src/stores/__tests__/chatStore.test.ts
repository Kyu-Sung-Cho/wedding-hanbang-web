import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildConfirmedActionRecoveryRequest,
  buildUnansweredMessageRecoveryRequest,
  isRecoveryAnswered,
  reconcileAmoraCrisisRecoveryMessages,
  syncToolResult,
  useChatStore,
} from "../chatStore";
import type { WeddingContext } from "@/types/chat.types";
import { useAuthStore } from "../authStore";
import { captureEvent } from "@/lib/analytics";
import { createChatImageObjectPathV2 } from "@/lib/chat/attachmentStorage";

const mockFetch = vi.fn();
const mockIngestFetch = vi.fn();
const mockGlobalFetch = vi.fn(
  (input: RequestInfo | URL, init?: RequestInit) => (
    String(input) === "/api/chat/messages"
      ? mockIngestFetch(input, init)
      : mockFetch(input, init)
  ),
);
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
const mockAuthGetUser = vi.fn(async () => ({
  data: { user: { id: TEST_USER_UUID } },
}));
let mockRealtimeInsertHandler: ((payload: { new: Record<string, unknown> }) => void) | null = null;
let mockRealtimeUpdateHandler: ((payload: { new: Record<string, unknown> }) => void) | null = null;
const mockRealtimeChannel: Record<string, unknown> = {};
mockRealtimeChannel.on = vi.fn((
  event: string,
  filter: Record<string, unknown>,
  callback: (payload: { new: Record<string, unknown> }) => void,
) => {
  if (event === "postgres_changes" && filter.event === "INSERT") {
    mockRealtimeInsertHandler = callback;
  }
  if (event === "postgres_changes" && filter.event === "UPDATE") {
    mockRealtimeUpdateHandler = callback;
  }
  return mockRealtimeChannel;
});
mockRealtimeChannel.subscribe = vi.fn((callback: (status: string) => void) => {
  callback("SUBSCRIBED");
  return mockRealtimeChannel;
});
mockRealtimeChannel.send = vi.fn(async () => ({ status: "ok" }));
const mockChannel = vi.fn(() => mockRealtimeChannel);
const mockRemoveChannel = vi.fn();

const mockSupabase = {
  auth: {
    getUser: mockAuthGetUser,
  },
  storage: {
    from: vi.fn(() => ({ upload: mockStorageUpload, remove: mockStorageRemove })),
  },
  from: mockFrom,
  channel: mockChannel,
  removeChannel: mockRemoveChannel,
};

function createDeferredResult<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createDeferredQuery<T>(promise: Promise<T>) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gt", "or", "order", "limit"] as const) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(() => promise);
  query.maybeSingle = vi.fn(() => promise);
  query.then = promise.then.bind(promise);
  return query;
}

const TEST_COUPLE_UUID = "20000000-0000-4000-8000-000000000001";
const TEST_USER_UUID = "10000000-0000-4000-8000-000000000001";
const TEST_OTHER_USER_UUID = "10000000-0000-4000-8000-000000000002";
const TEST_CLIENT_REQUEST_UUID = "30000000-0000-4000-8000-000000000001";
const TEST_CONFIRMED_ACTION_UUID = "40000000-0000-4000-8000-000000000001";

describe("booking projection local sync", () => {
  it.each([{ budget: 800_000 }, { spent: 200_000 }, { budget: 0, spent: 0 }])("merges a custom category receipt without dropping omitted fields: %j", (amounts) => {
    const custom = { category: "custom_photo", label: "포토부스", status: "completed", budget: 700_000,
      spent: 100_000, payer: "bride_parents", checklist: [{ id: "confirmed", done: true }], notes: "계약 확인 완료" };
    const ring = { category: "ring", status: "in_progress", budget: 3_000_000 };
    useAuthStore.setState({ journey: { total_budget: 35_000_000, progress: { custom_photo: custom, ring } } as never });
    syncToolResult({ toolName: "add_custom_category", toolInput: { label: "포토부스", ...amounts },
      toolOutput: { key: "custom_photo", label: "포토부스", created: false }, success: true, displayMessage: "" });
    expect(useAuthStore.getState().journey?.progress).toEqual({ custom_photo: { ...custom, ...amounts }, ring });
    expect(custom).toMatchObject({ budget: 700_000, spent: 100_000, status: "completed" });
    expect(useAuthStore.getState().journey?.total_budget).toBe(35_000_000);
  });

  it("creates a new custom category and does not mutate it for a failed receipt", () => {
    useAuthStore.setState({ journey: { progress: {} } as never });
    const result = { toolName: "add_custom_category", toolInput: { label: "포토부스", budget: 500_000 },
      toolOutput: { key: "custom_photo" }, success: true, displayMessage: "" };
    syncToolResult(result);
    const journey = useAuthStore.getState().journey;
    expect(journey?.progress.custom_photo).toEqual({ category: "custom_photo", label: "포토부스", status: "in_progress", budget: 500_000 });
    syncToolResult({ ...result, toolInput: { ...result.toolInput, spent: 0 }, success: false });
    expect(useAuthStore.getState().journey).toBe(journey);
  });

  it.each(["not_started", "in_progress", "completed"])("keeps the budget and checklist when a task becomes %s", (status) => {
    const venue = {
      category: "venue", status: "in_progress", budget: 12_000_000, spent: 2_000_000,
      checklist: { contract_checked: true }, notes: "확인한 계약 항목",
    };
    const ring = { category: "ring", status: "completed", budget: 3_000_000 };
    useAuthStore.setState({ journey: {
      total_budget: 30_000_000, progress: { venue, ring },
    } as never });
    syncToolResult({
      toolName: "update_task_status", toolInput: { category: "venue", status },
      toolOutput: {}, success: true, displayMessage: "",
    });
    expect(useAuthStore.getState().journey?.progress).toEqual({
      venue: { ...venue, status }, ring,
    });
    expect(useAuthStore.getState().journey?.total_budget).toBe(30_000_000);
    expect(venue.status).toBe("in_progress");
  });

  it("uses canonical budget-plan allocations including zero reserve without adding the remainder twice", () => {
    useAuthStore.setState({ journey: {
      total_budget: 30_000_000,
      progress: {
        venue: { category: "venue", status: "completed", budget: 12_000_000, spent: 2_000_000 },
        ring: { category: "ring", status: "in_progress", budget: 3_000_000 },
        reserve: { category: "reserve", status: "not_started", budget: 8_000_000 },
      },
    } as never });
    syncToolResult({
      toolName: "apply_budget_plan",
      toolInput: { allocations: [{ category: "venue", budget: 27_000_000 }] },
      toolOutput: { total_budget: 30_000_000, allocations: [{ category: "venue", budget: 27_000_000 }, { category: "reserve", budget: 0 }], remainder_to_reserve: 0 },
      success: true,
      displayMessage: "",
    });
    expect(useAuthStore.getState().journey?.progress).toMatchObject({
      venue: { budget: 27_000_000, spent: 2_000_000, status: "completed" },
      ring: { budget: 3_000_000 },
      reserve: { budget: 0 },
    });
    syncToolResult({
      toolName: "apply_budget_plan",
      toolInput: { allocations: [{ category: "venue", budget: 20_000_000 }, { category: "reserve", budget: 1_000_000 }] },
      toolOutput: { total_budget: 30_000_000, allocations: [{ category: "venue", budget: 20_000_000 }, { category: "reserve", budget: 7_000_000 }], remainder_to_reserve: 6_000_000 },
      success: true,
      displayMessage: "",
    });
    expect(useAuthStore.getState().journey?.progress.reserve.budget).toBe(7_000_000);
  });

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
    metadata: {
      client_request_id: TEST_CLIENT_REQUEST_UUID,
      amora_ingest_contract_version: 1 as const,
      ai_response_requested: true,
      provider_attachment_state: "none" as const,
      provider_attachment_count: 0,
    },
    visibility: "shared",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function persistedIngestResponse(
  message: Record<string, unknown>,
  options: {
    effectiveVisibility?: "shared" | "bride_private" | "groom_private";
    safetyPrivacyRedirected?: boolean;
    reused?: boolean;
  } = {},
) {
  return new Response(JSON.stringify({
    outcome: "persisted",
    reused: options.reused ?? false,
    effectiveVisibility: options.effectiveVisibility ?? "shared",
    safetyPrivacyRedirected: options.safetyPrivacyRedirected ?? false,
    message,
  }), {
    status: options.reused ? 200 : 201,
    headers: { "Content-Type": "application/json" },
  });
}

async function defaultIngestFetch(_input: RequestInfo | URL, init?: RequestInit) {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  const profile = useAuthStore.getState().profile;
  const canonicalSenderId = body.coupleId === TEST_COUPLE_UUID
    ? TEST_USER_UUID
    : profile?.id ?? "user-1";
  const canonicalSenderRole = body.coupleId === TEST_COUPLE_UUID
    ? "bride"
    : profile?.role ?? "bride";
  const providerAttachmentManifest = Array.isArray(body.providerAttachmentManifest)
    ? body.providerAttachmentManifest as Array<Record<string, unknown>>
    : [];
  const metadata = {
    client_request_id: body.clientRequestId,
    amora_ingest_contract_version: providerAttachmentManifest.length > 0 ? 2 : 1,
    ai_response_requested: body.target !== "partner",
    provider_attachment_state: body.target === "partner"
      ? "none"
      : Number(body.providerAttachmentCount) > 0
        ? "present"
        : "none",
    provider_attachment_count: body.providerAttachmentCount,
    ...(providerAttachmentManifest.length > 0
      ? {
          provider_attachment_manifest: providerAttachmentManifest.map((entry) => ({
            media_type: entry.mediaType,
            byte_length: entry.byteLength,
            sha256: entry.sha256,
          })),
        }
      : {}),
    ...(body.target === "partner"
      ? {
          target: "partner",
          partner_recipient_id: TEST_OTHER_USER_UUID,
        }
      : {}),
    ...(typeof body.confirmedActionId === "string"
      ? { confirmed_amora_action_id: body.confirmedActionId }
      : {}),
    ...(typeof body.preparationSource === "string" ? { preparation_source: body.preparationSource } : {}),
    ...(Array.isArray(body.imagePaths) ? { imagePaths: body.imagePaths } : {}),
  };
  let insertResult: { data?: Record<string, unknown> | null; error?: unknown } | undefined;
  try {
    insertResult = await mockInsertSingle();
  } catch (error) {
    insertResult = { data: null, error };
  }

  if (insertResult?.error || (insertResult && !insertResult.data)) {
    try {
      const reconciled = await mockReconcileMaybeSingle();
      if (reconciled?.data) {
        return persistedIngestResponse({
          ...(reconciled.data as Record<string, unknown>),
          couple_id: body.coupleId,
          sender_id: canonicalSenderId,
          sender_type: canonicalSenderRole,
          role: "user",
          content: body.content,
          metadata,
          visibility: body.requestedVisibility,
        }, {
          effectiveVisibility: body.requestedVisibility as
            | "shared"
            | "bride_private"
            | "groom_private",
          reused: true,
        });
      }
    } catch {
      // The route returns a same-request retry contract when reconciliation is unknown.
    }
    return new Response(JSON.stringify({
      error: "전송 상태를 안전하게 확인하지 못했어요. 같은 메시지로 다시 시도해 주세요.",
      code: "USER_MESSAGE_PERSISTENCE_UNKNOWN",
      retryable: true,
      retryPolicy: "same_request",
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const row = {
    ...(insertResult?.data ?? {}),
    id: insertResult?.data?.id ?? "user-message-1",
    couple_id: body.coupleId,
    sender_id: canonicalSenderId,
    sender_type: canonicalSenderRole,
    role: "user",
    content: body.content,
    metadata,
    visibility: body.requestedVisibility,
    created_at: insertResult?.data?.created_at ?? "2026-08-03T00:00:00.000Z",
  };
  return persistedIngestResponse(row, {
    effectiveVisibility: body.requestedVisibility as
      | "shared"
      | "bride_private"
      | "groom_private",
  });
}

mockIngestFetch.mockImplementation(defaultIngestFetch);

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
    metadata: {
      client_request_id: TEST_CLIENT_REQUEST_UUID,
      confirmed_amora_action_id: actionId,
    },
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
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      userMessageId: confirmationMessage.id,
      confirmedActionId: actionId,
      recoveryKind: "confirmed_action",
      canRetry: true,
    }));
    expect(JSON.parse(recovery?.requestBody ?? "{}")).toEqual(expect.objectContaining({
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      userMessageId: confirmationMessage.id,
      confirmedActionId: actionId,
      visibility: "shared",
    }));
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-request-id"],
  ])("does not offer %s request-id confirmation recovery", (_label, clientRequestId) => {
    const recovery = buildConfirmedActionRecoveryRequest(
      [
        sourceMessage,
        {
          ...confirmationMessage,
          metadata: {
            confirmed_amora_action_id: actionId,
            ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
          },
        },
      ],
      "couple-1",
    );

    expect(recovery).toBeNull();
  });

  it("loads the newest bounded history and restores chronological display order", () => {
    expect(chatStoreSource).toMatch(
      /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(500\)/,
    );
    expect(chatStoreSource).toMatch(
      /\.or\("metadata->>target\.is\.null,metadata->>target\.neq\.partner"\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(1\)\s*\.maybeSingle\(\)/,
    );
    expect(chatStoreSource).toMatch(
      /const canonicalMessages = boundedRows\s*\.reverse\(\)/,
    );
    expect(chatStoreSource).toContain("latestPrivateCanonicalData");
    expect(chatStoreSource).toContain('.eq("visibility", ownPrivateVisibility)');
    expect(chatStoreSource).toMatch(
      /buildConfirmedActionRecoveryRequest\(allMessages, coupleId\)\s*\?\?\s*buildUnansweredMessageRecoveryRequest\(allMessages, coupleId\)/,
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

describe("unanswered Amora turn recovery", () => {
  const baseUserMessage = {
    id: "70000000-0000-4000-8000-000000000001",
    couple_id: TEST_COUPLE_UUID,
    sender_id: TEST_USER_UUID,
    sender_role: "bride" as const,
    content: "예식장 비교 기준을 이어서 알려줘",
    metadata: {
      client_request_id: TEST_CLIENT_REQUEST_UUID,
      amora_ingest_contract_version: 1 as const,
      ai_response_requested: true,
      provider_attachment_state: "none" as const,
      provider_attachment_count: 0,
    },
    visibility: "shared" as const,
    created_at: "2026-08-03T01:00:00.000Z",
  };

  beforeEach(() => {
    useAuthStore.setState({
      profile: {
        id: TEST_USER_UUID,
        name: "테스터",
        role: "bride",
        couple_id: TEST_COUPLE_UUID,
      } as never,
      journey: null,
    });
  });

  it("offers an explicit text-only resume without calling the provider on load", () => {
    const recovery = buildUnansweredMessageRecoveryRequest(
      [baseUserMessage],
      TEST_COUPLE_UUID,
    );

    expect(recovery).toEqual(expect.objectContaining({
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      userMessageId: baseUserMessage.id,
      recoveryKind: "interrupted_turn",
      canRetry: true,
      attachmentCount: 0,
    }));
    expect(JSON.parse(recovery?.requestBody ?? "{}")).toEqual(expect.objectContaining({
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      userMessageId: baseUserMessage.id,
      visibility: "shared",
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("restores the exact canonical public reference ID after reopening an unanswered turn", () => {
    const recovery = buildUnansweredMessageRecoveryRequest([{
      ...baseUserMessage, metadata: { ...baseUserMessage.metadata, preparation_source: "g.cost-saving.section-3" },
    }], TEST_COUPLE_UUID);
    expect(JSON.parse(recovery!.requestBody)).toEqual(expect.objectContaining({ preparationSource: "g.cost-saving.section-3", userMessageId: baseUserMessage.id }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("cannot recover malformed or private reference bindings", () => {
    expect(buildUnansweredMessageRecoveryRequest([{
      ...baseUserMessage, metadata: { ...baseUserMessage.metadata, preparation_source: "c.venue&memo=secret" },
    }], TEST_COUPLE_UUID)).toBeNull();
    expect(buildUnansweredMessageRecoveryRequest([{
      ...baseUserMessage, visibility: "bride_private", metadata: { ...baseUserMessage.metadata, preparation_source: "c.venue" },
    }], TEST_COUPLE_UUID)).toBeNull();
  });

  it("requires a new message when provider-only attachment bytes are unavailable", () => {
    const recovery = buildUnansweredMessageRecoveryRequest(
      [{
        ...baseUserMessage,
        metadata: {
          ...baseUserMessage.metadata,
          provider_attachment_state: "present" as const,
          provider_attachment_count: 1,
        },
      }],
      TEST_COUPLE_UUID,
    );

    expect(recovery).toEqual(expect.objectContaining({
      recoveryKind: "requires_reattach",
      canRetry: false,
      attachmentCount: 1,
      requestBody: "",
      unavailableReason: expect.stringContaining("다시 첨부"),
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces a cold-start v2 attachment row as reattach-required without auto-running it", () => {
    const recovery = buildUnansweredMessageRecoveryRequest(
      [{
        ...baseUserMessage,
        metadata: {
          ...baseUserMessage.metadata,
          amora_ingest_contract_version: 2 as const,
          provider_attachment_state: "present" as const,
          provider_attachment_count: 1,
          provider_attachment_manifest: [{
            media_type: "image/png",
            byte_length: 5,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          }],
        },
      }],
      TEST_COUPLE_UUID,
    );

    expect(recovery).toEqual(expect.objectContaining({
      recoveryKind: "requires_reattach",
      canRetry: false,
      attachmentCount: 1,
      requestBody: "",
      unavailableReason: expect.stringContaining("다시 첨부"),
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resumes a W2 attachment-discarded row only in the owner's private lane", () => {
    const recovery = buildUnansweredMessageRecoveryRequest(
      [{
        ...baseUserMessage,
        visibility: "bride_private" as const,
        metadata: {
          ...baseUserMessage.metadata,
          provider_attachment_state: "discarded_by_safety_policy" as const,
        },
      }],
      TEST_COUPLE_UUID,
    );

    expect(recovery).toEqual(expect.objectContaining({
      recoveryKind: "interrupted_turn",
      visibility: "bride_private",
      canRetry: true,
    }));
  });

  it.each([
    ["legacy marker", { ...baseUserMessage, metadata: { client_request_id: TEST_CLIENT_REQUEST_UUID } }],
    ["different actor", { ...baseUserMessage, sender_id: TEST_OTHER_USER_UUID }],
    ["partner target", { ...baseUserMessage, metadata: { ...baseUserMessage.metadata, target: "partner" as const } }],
  ])("does not resume a %s row", (_label, candidate) => {
    expect(buildUnansweredMessageRecoveryRequest(
      [candidate],
      TEST_COUPLE_UUID,
    )).toBeNull();
  });

  it("stops recovery after a linked assistant response or a newer canonical lane turn", () => {
    const assistant = {
      ...baseUserMessage,
      id: "70000000-0000-4000-8000-000000000002",
      sender_id: null,
      sender_role: "ai" as const,
      content: "비교 기준을 정리했어요.",
      metadata: { in_reply_to_user_message_id: baseUserMessage.id },
      created_at: "2026-08-03T01:01:00.000Z",
    };
    expect(buildUnansweredMessageRecoveryRequest(
      [baseUserMessage, assistant],
      TEST_COUPLE_UUID,
    )).toBeNull();

    const newerUser = {
      ...baseUserMessage,
      id: "70000000-0000-4000-8000-000000000003",
      sender_id: TEST_OTHER_USER_UUID,
      sender_role: "groom" as const,
      created_at: "2026-08-03T01:02:00.000Z",
    };
    expect(buildUnansweredMessageRecoveryRequest(
      [baseUserMessage, newerUser],
      TEST_COUPLE_UUID,
    )).toBeNull();
  });

  it("clears only the recovery whose durable user row receives the assistant reply", () => {
    const recovery = buildUnansweredMessageRecoveryRequest(
      [baseUserMessage],
      TEST_COUPLE_UUID,
    );
    const unrelatedAssistant = {
      ...baseUserMessage,
      sender_id: null,
      sender_role: "ai" as const,
      metadata: { in_reply_to_user_message_id: "70000000-0000-4000-8000-000000000099" },
    };
    const linkedAssistant = {
      ...unrelatedAssistant,
      metadata: { in_reply_to_user_message_id: baseUserMessage.id },
    };

    expect(isRecoveryAnswered(recovery, [unrelatedAssistant])).toBe(false);
    expect(isRecoveryAnswered(recovery, [linkedAssistant])).toBe(true);
  });
});

describe("chat lifecycle isolation", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    window.localStorage.clear();
    mockFrom.mockReset();
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      void table;
      return defaultChatMessagesTable;
    });
    mockAuthGetUser.mockReset();
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: TEST_USER_UUID } } });
    mockRealtimeInsertHandler = null;
    mockRealtimeUpdateHandler = null;
    mockChannel.mockClear();
    mockRemoveChannel.mockClear();
    mockIngestFetch.mockReset();
    mockIngestFetch.mockImplementation(defaultIngestFetch);
    vi.stubGlobal("fetch", mockGlobalFetch);
    useAuthStore.setState({
      profile: {
        id: TEST_USER_UUID,
        name: "첫 사용자",
        role: "bride",
        couple_id: TEST_COUPLE_UUID,
      } as never,
    });
  });

  describe("durable budget receipt replay", () => {
    const originalRefresh = useAuthStore.getState().refreshJourney;
    const refreshJourney = vi.fn(async () => true);
    const approvedResult = {
      toolName: "update_budget",
      toolInput: { total_budget: 40_000_000 },
      toolOutput: { total_budget: 40_000_000 },
      success: true,
      displayMessage: "총예산을 변경했어요.",
    };
    const send = () => useChatStore.getState().sendMessage({
      content: "승인한 예산 변경을 적용해 주세요.",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      confirmedActionId: TEST_CONFIRMED_ACTION_UUID,
    });
    const response = (results: unknown[], streamedResults: unknown[] = []) => new Response(
      [...streamedResults.map((result) => ({ type: "tool_result", result })), {
        type: "done",
        fullContent: "예산 변경 결과를 다시 불러왔어요.",
        metadata: {
          serverMessageId: "ai-budget-replay",
          replayed: true,
          toolResults: results,
        },
      }].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );

    beforeEach(() => {
      document.cookie = "demo_mode=; Max-Age=0; path=/";
      mockFetch.mockReset();
      refreshJourney.mockReset().mockResolvedValue(true);
      useAuthStore.setState({
        isDemo: false,
        user: { id: TEST_USER_UUID },
        refreshJourney,
        journey: {
          id: "journey-budget-replay",
          couple_id: TEST_COUPLE_UUID,
          total_budget: 50_000_000,
          progress: { venue: { category: "venue", status: "completed", budget: 12_000_000 } },
        },
      } as never);
    });
    afterEach(() => {
      useAuthStore.setState({ refreshJourney: originalRefresh });
      vi.clearAllMocks();
    });

    it("keeps existing custom spend and checklist after a streamed budget update when the authoritative refresh is unavailable", async () => {
      const custom = { category: "custom_photo", label: "포토부스", status: "completed", budget: 700_000,
        spent: 100_000, payer: "bride_parents", checklist: [{ id: "confirmed", done: true }] };
      useAuthStore.setState({ journey: { ...useAuthStore.getState().journey!, progress: { custom_photo: custom } } as never });
      const result = { toolName: "add_custom_category", toolInput: { label: "포토부스", budget: 800_000 },
        toolOutput: { key: "custom_photo", label: "포토부스", created: false }, success: true, displayMessage: "배정액을 변경했어요." };
      refreshJourney.mockResolvedValueOnce(false);
      mockFetch.mockResolvedValueOnce(response([result], [result]));
      await send();
      expect(refreshJourney).toHaveBeenCalledExactlyOnceWith(TEST_USER_UUID);
      expect(useAuthStore.getState().journey?.progress.custom_photo).toEqual({ ...custom, budget: 800_000 });
      expect(useChatStore.getState().error).toContain("최신 준비 정보를 불러오지 못했어요");
      expect(useChatStore.getState().failedRequest).toBeNull();
      expect(useChatStore.getState().messages.find(m => m.id === "ai-budget-replay")?.metadata?.toolResults).toEqual([result]);
    });

    const streamedBudgetResults = [
      approvedResult,
      { toolName: "update_category_budget", toolInput: { category: "venue", budget: 9_000_000 },
        toolOutput: {}, success: true, displayMessage: "배정액을 변경했어요." },
      { toolName: "apply_budget_plan", toolInput: { allocations: [{ category: "venue", budget: 9_000_000 }] },
        toolOutput: { total_budget: 40_000_000, allocations: [{ category: "venue", budget: 9_000_000 }, { category: "reserve", budget: 1_000_000 }], remainder_to_reserve: 0 },
        success: true, displayMessage: "예산 배분을 변경했어요." },
      { toolName: "add_custom_category", toolInput: { label: "포토부스", budget: 800_000 },
        toolOutput: { key: "custom_photo", label: "포토부스", created: false }, success: true, displayMessage: "배정액을 변경했어요." },
    ];
    const latestBudgetJourney = () => ({
      ...useAuthStore.getState().journey!,
      state_revision: 2,
      total_budget: 60_000_000,
      progress: {
        venue: { category: "venue", status: "completed" as const, budget: 15_000_000, spent: 2_000_000,
          payer: "couple" as const, notes: "최신 확인 메모", checklist: [{ id: "contract", label: "계약 확인", done: true }] },
        custom_photo: { category: "custom_photo", label: "포토부스", status: "in_progress" as const,
          budget: 1_200_000, spent: 100_000, payer: "bride_parents" as const, notes: "기존 메모" },
        reserve: { category: "reserve", status: "not_started" as const, budget: 3_000_000 },
      },
    });
    const controlledBudgetStream = () => {
      const ready = createDeferredResult<ReadableStreamDefaultController<Uint8Array>>();
      const body = new ReadableStream<Uint8Array>({ start(controller) { ready.resolve(controller); } });
      const encoder = new TextEncoder();
      return {
        response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
        async emit(event: unknown) { (await ready.promise).enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); },
        async finish(results: unknown[]) {
          const controller = await ready.promise;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done",
            fullContent: "예산 변경 결과를 받았어요.", metadata: { serverMessageId: "ai-budget-replay", toolResults: results },
          })}\n\n`));
          controller.close();
        },
      };
    };

    it.each(streamedBudgetResults.map(result => [result.toolName, result] as const))(
      "preserves a newer canonical journey while the %s provider fetch is waiting",
      async (_toolName, result) => {
        const delayed = createDeferredResult<Response>();
        mockFetch.mockReturnValueOnce(delayed.promise);
        refreshJourney.mockResolvedValueOnce(false);
        const sending = send();
        await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
        const latest = latestBudgetJourney();
        useAuthStore.setState({ journey: latest });
        delayed.resolve(response([result], [result]));
        await sending;
        expect(useAuthStore.getState().journey).toEqual(latest);
        expect(useAuthStore.getState().journey).toBe(latest);
        expect(refreshJourney).toHaveBeenCalledExactlyOnceWith(TEST_USER_UUID);
        expect(useChatStore.getState().error).toContain("최신 준비 정보를 불러오지 못했어요");
        expect(useChatStore.getState().failedRequest).toBeNull();
        expect(useChatStore.getState().messages.find(m => m.id === "ai-budget-replay")?.metadata?.toolResults).toEqual([result]);
      },
    );

    it("keeps an external canonical update between streamed budget tools through the rest of that stream", async () => {
      const stream = controlledBudgetStream();
      mockFetch.mockResolvedValueOnce(stream.response);
      refreshJourney.mockResolvedValueOnce(false);
      const sending = send();
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      await stream.emit({ type: "tool_result", result: streamedBudgetResults[0] });
      await vi.waitFor(() => expect(useChatStore.getState().streamingToolResults).toHaveLength(1));
      expect(useAuthStore.getState().journey?.total_budget).toBe(40_000_000);
      const latest = latestBudgetJourney();
      useAuthStore.setState({ journey: latest });
      for (const result of streamedBudgetResults.slice(1)) await stream.emit({ type: "tool_result", result });
      await stream.finish(streamedBudgetResults);
      await sending;
      expect(useAuthStore.getState().journey).toEqual(latest);
      expect(useAuthStore.getState().journey).toBe(latest);
      expect(refreshJourney).toHaveBeenCalledExactlyOnceWith(TEST_USER_UUID);
      expect(useChatStore.getState().error).toContain("최신 준비 정보를 불러오지 못했어요");
      expect(useChatStore.getState().failedRequest).toBeNull();
      expect(useChatStore.getState().messages.find(m => m.id === "ai-budget-replay")?.metadata?.toolResults).toEqual(streamedBudgetResults);
    });

    it("applies consecutive streamed budget tools without an external journey replacement", async () => {
      const initial = latestBudgetJourney();
      useAuthStore.setState({ journey: initial });
      const stream = controlledBudgetStream();
      mockFetch.mockResolvedValueOnce(stream.response);
      refreshJourney.mockResolvedValueOnce(false);
      const sending = send();
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      for (let index = 0; index < streamedBudgetResults.length; index += 1) {
        await stream.emit({ type: "tool_result", result: streamedBudgetResults[index] });
        await vi.waitFor(() => expect(useChatStore.getState().streamingToolResults).toHaveLength(index + 1));
      }
      await stream.finish(streamedBudgetResults);
      await sending;
      expect(useAuthStore.getState().journey).toEqual({ ...initial, total_budget: 40_000_000, progress: {
        ...initial.progress,
        venue: { ...initial.progress.venue, budget: 9_000_000 },
        custom_photo: { ...initial.progress.custom_photo, budget: 800_000 },
        reserve: { ...initial.progress.reserve, budget: 1_000_000 },
      } });
      expect(refreshJourney).toHaveBeenCalledExactlyOnceWith(TEST_USER_UUID);
      expect(useChatStore.getState().error).toContain("최신 준비 정보를 불러오지 못했어요");
      expect(useChatStore.getState().failedRequest).toBeNull();
    });

    it.each(["update_budget", "update_category_budget", "apply_budget_plan", "add_custom_category"])(
      "refreshes the latest journey for a done-only %s receipt after an interrupted response",
      async (toolName) => {
        mockFetch.mockResolvedValueOnce(new Response("", { status: 200 }));
        await send();
        expect(useChatStore.getState().failedRequest?.confirmedActionId).toBe(TEST_CONFIRMED_ACTION_UUID);
        const localUpdate = vi.spyOn(useAuthStore.getState(), "updateJourneyLocal");
        mockFetch.mockResolvedValueOnce(response([{ ...approvedResult, toolName }]));
        refreshJourney.mockImplementationOnce(async () => {
          useAuthStore.setState({ journey: { ...useAuthStore.getState().journey!, total_budget: 60_000_000 } });
          return true;
        });
        try {
          await useChatStore.getState().retryFailedMessage();
          expect(refreshJourney).toHaveBeenCalledExactlyOnceWith(TEST_USER_UUID);
          expect(useAuthStore.getState().journey?.total_budget).toBe(60_000_000);
          // A historical receipt must not overwrite a newer budget with its old input.
          expect(localUpdate).not.toHaveBeenCalled();
          expect(useChatStore.getState().failedRequest).toBeNull();
          expect(mockIngestFetch).toHaveBeenCalledTimes(1);
          expect(JSON.parse(mockFetch.mock.calls[1][1].body).clientRequestId).toBe(TEST_CLIENT_REQUEST_UUID);
        } finally {
          localUpdate.mockRestore();
        }
      },
    );

    it("does not apply a tool result twice when done also carries the receipt", async () => {
      const localUpdate = vi.spyOn(useAuthStore.getState(), "updateJourneyLocal");
      mockFetch.mockResolvedValueOnce(response([approvedResult], [approvedResult]));
      try {
        await send();
        expect(localUpdate).toHaveBeenCalledTimes(1);
        expect(refreshJourney).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().messages.find((m) => m.id === "ai-budget-replay")?.metadata?.toolResults)
          .toEqual([approvedResult]);
      } finally {
        localUpdate.mockRestore();
      }
    });

    it.each([
      ["failed mutation", [{ ...approvedResult, success: false }]],
      ["read-only result", [{ ...approvedResult, toolName: "get_budget_summary" }]],
      ["missing success", [{ toolName: "update_budget" }]],
      ["malformed receipt", [null, "update_budget"]],
    ])("does not refresh or mutate for %s", async (_label, results) => {
      const journey = useAuthStore.getState().journey;
      mockFetch.mockResolvedValueOnce(response(results));
      await send();
      expect(refreshJourney).not.toHaveBeenCalled();
      expect(useAuthStore.getState().journey).toBe(journey);
    });

    it("keeps a partial failure receipt intact while refreshing successful changes once", async () => {
      const results = [approvedResult, { ...approvedResult, toolName: "add_custom_category", success: false }];
      mockFetch.mockResolvedValueOnce(response(results));
      await send();
      expect(refreshJourney).toHaveBeenCalledTimes(1);
      expect(useChatStore.getState().messages.find((m) => m.id === "ai-budget-replay")?.metadata?.toolResults)
        .toEqual(results);
    });

    it.each(["unavailable", "thrown"])("reports a %s journey read without marking the committed action for execution again", async (failure) => {
      const journey = useAuthStore.getState().journey;
      mockFetch.mockResolvedValueOnce(response([approvedResult]));
      if (failure === "thrown") refreshJourney.mockRejectedValueOnce(new Error("offline"));
      else refreshJourney.mockResolvedValueOnce(false);
      await send();
      expect(refreshJourney).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().journey).toBe(journey);
      expect(useChatStore.getState().error).toContain("최신 준비 정보를 불러오지 못했어요");
      expect(useChatStore.getState().failedRequest).toBeNull();
      expect(useChatStore.getState().messages.some((m) => m.id === "ai-budget-replay")).toBe(true);
    });

    it("ignores a done-only receipt that arrives after the couple changed", async () => {
      const delayed = createDeferredResult<Response>();
      mockFetch.mockReturnValueOnce(delayed.promise);
      const sending = send();
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      useAuthStore.setState({ profile: { ...useAuthStore.getState().profile!, couple_id: "other-couple" } });
      const journey = useAuthStore.getState().journey;
      delayed.resolve(response([approvedResult]));
      await sending;
      expect(refreshJourney).not.toHaveBeenCalled();
      expect(useAuthStore.getState().journey).toBe(journey);
      expect(useChatStore.getState().messages.some((m) => m.id === "ai-budget-replay")).toBe(false);
    });

    it("does not change a new session's notice or retry after a replay refresh settles", async () => {
      const delayed = createDeferredResult<boolean>();
      refreshJourney.mockReturnValueOnce(delayed.promise);
      mockFetch.mockResolvedValueOnce(response([approvedResult]));
      const sending = send();
      await vi.waitFor(() => expect(refreshJourney).toHaveBeenCalledTimes(1));
      useAuthStore.setState({ profile: { ...useAuthStore.getState().profile!, id: TEST_OTHER_USER_UUID } });
      useChatStore.setState({ error: "새 계정 안내", failedRequest: { clientRequestId: "new-request" } as never });
      delayed.resolve(false);
      await sending;
      expect(useChatStore.getState().error).toBe("새 계정 안내");
      expect(useChatStore.getState().failedRequest?.clientRequestId).toBe("new-request");
    });
  });

  it.each([
    ["stale couple", TEST_USER_UUID, "20000000-0000-4000-8000-000000000099"],
    ["stale sender", TEST_OTHER_USER_UUID, TEST_COUPLE_UUID],
  ])("rejects %s call arguments before analytics or persistence", async (
    _label,
    senderId,
    coupleId,
  ) => {
    const outcome = await useChatStore.getState().sendMessage({
      content: "이전 화면의 질문",
      senderId,
      senderRole: "bride",
      coupleId,
      senderName: "이전 사용자",
      weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual({ userMessage: "not_persisted", reason: "validation" });
    expect(captureEvent).not.toHaveBeenCalled();
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockIngestFetch).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState().isSending).toBe(false);
  });

  it("fails closed before analytics, upload, or ingest when exact attachment hashing fails", async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn().mockRejectedValue(new Error("digest unavailable")),
      },
    });

    try {
      const outcome = await useChatStore.getState().sendMessage({
        content: "첨부를 확인해줘",
        senderId: TEST_USER_UUID,
        senderRole: "bride",
        coupleId: TEST_COUPLE_UUID,
        senderName: "첫 사용자",
        weddingContext: {} as WeddingContext,
        images: [{
          base64: "aGVsbG8=",
          mediaType: "image/png",
          previewUrl: "blob:digest-failure",
        }],
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
      });

      expect(outcome).toEqual({ userMessage: "not_persisted", reason: "validation" });
      expect(captureEvent).not.toHaveBeenCalled();
      expect(mockStorageUpload).not.toHaveBeenCalled();
      expect(mockIngestFetch).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(useChatStore.getState().error).toMatch(/안전하게.*다시 첨부/);
      expect(useChatStore.getState().isSending).toBe(false);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });

  it("does not append an old couple poll result after the chat lifecycle resets", async () => {
    const delayed = createDeferredResult<{
      data: Array<Record<string, unknown>>;
      error: null;
    }>();
    mockFrom.mockReturnValueOnce(createDeferredQuery(delayed.promise));
    useChatStore.setState({ initialLoadDone: true });

    const polling = useChatStore.getState().pollNewMessages(TEST_COUPLE_UUID);
    useChatStore.getState().reset();
    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    delayed.resolve({
      data: [{
        id: "70000000-0000-4000-8000-000000000010",
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_USER_UUID,
        sender_type: "bride",
        role: "user",
        content: "이전 계정의 공유 대화",
        metadata: null,
        visibility: "shared",
        created_at: "2026-08-03T03:00:00.000Z",
      }],
      error: null,
    });
    await polling;

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().initialLoadDone).toBe(false);
  });

  it("does not replace a new session with an old couple load result", async () => {
    const delayedMessages = createDeferredResult<{
      data: Array<Record<string, unknown>>;
      error: null;
    }>();
    const immediate = <T,>(value: T) => createDeferredQuery(Promise.resolve(value));
    let chatQueryCount = 0;
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "my_profile_chat_state") {
        return immediate({
          data: { shared_chat_cleared_at: null, private_chat_cleared_at: null },
          error: null,
        });
      }
      if (table === "chat_messages") {
        chatQueryCount += 1;
        if (chatQueryCount === 2) return createDeferredQuery(delayedMessages.promise);
        return immediate({ data: null, error: null });
      }
      return defaultChatMessagesTable;
    });

    const loading = useChatStore.getState().loadMessages(TEST_COUPLE_UUID);
    useChatStore.getState().reset();
    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    delayedMessages.resolve({
      data: [{
        id: "70000000-0000-4000-8000-000000000011",
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_USER_UUID,
        sender_type: "bride",
        role: "user",
        content: "이전 계정의 전체 대화",
        metadata: null,
        visibility: "shared",
        created_at: "2026-08-03T03:01:00.000Z",
      }],
      error: null,
    });
    await loading;

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().initialLoadDone).toBe(false);
    expect(useChatStore.getState().isLoading).toBe(false);
  });

  it("ignores an old couple realtime insert after the chat lifecycle resets", () => {
    const unsubscribe = useChatStore.getState().subscribeToMessages(TEST_COUPLE_UUID);
    expect(mockRealtimeInsertHandler).not.toBeNull();

    useChatStore.getState().reset();
    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    mockRealtimeInsertHandler?.({
      new: {
        id: "70000000-0000-4000-8000-000000000012",
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_USER_UUID,
        sender_type: "bride",
        role: "user",
        content: "이전 계정의 실시간 공유 대화",
        metadata: null,
        visibility: "shared",
        created_at: "2026-08-03T03:02:00.000Z",
      },
    });

    expect(useChatStore.getState().messages).toEqual([]);
    unsubscribe();
  });

  it("stops an old send after upload when the account and couple change", async () => {
    const delayedUpload = createDeferredResult<{ error: null }>();
    mockStorageUpload.mockReset();
    mockStorageUpload.mockReturnValueOnce(delayedUpload.promise);
    mockStorageRemove.mockReset();
    mockStorageRemove.mockResolvedValueOnce({ error: null });
    mockIngestFetch.mockClear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(completedChatResponse("이전 계정의 답변"));
    document.cookie = "demo_mode=; Max-Age=0; path=/";

    const sending = useChatStore.getState().sendMessage({
      content: "이전 계정의 첨부 질문",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        previewUrl: "blob:old-account-image",
      }],
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockStorageUpload).toHaveBeenCalledTimes(1));

    useChatStore.getState().reset();
    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    const newSessionMessage = {
      id: "70000000-0000-4000-8000-000000000020",
      couple_id: "20000000-0000-4000-8000-000000000002",
      sender_id: TEST_OTHER_USER_UUID,
      sender_role: "groom" as const,
      content: "새 계정의 대화",
      metadata: null,
      visibility: "groom_private" as const,
      created_at: "2026-08-04T01:00:00.000Z",
    };
    useChatStore.setState({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      error: "새 세션 상태",
      isLoading: true,
      isSending: true,
    });

    delayedUpload.resolve({ error: null });
    await sending;

    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove).toHaveBeenCalledWith([
      expect.stringMatching(new RegExp(`^${TEST_COUPLE_UUID}/${TEST_USER_UUID}/`)),
    ]);
    expect(mockIngestFetch).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState()).toMatchObject({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      error: "새 세션 상태",
      isLoading: true,
      isSending: true,
    });
  });

  it("ignores an old upload failure after the account and couple change", async () => {
    const delayedUpload = createDeferredResult<{ error: null }>();
    mockStorageUpload.mockReset();
    mockStorageUpload.mockReturnValueOnce(delayedUpload.promise);
    mockIngestFetch.mockClear();
    document.cookie = "demo_mode=; Max-Age=0; path=/";

    const sending = useChatStore.getState().sendMessage({
      content: "이전 계정의 실패할 첨부 질문",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        previewUrl: "blob:old-account-failed-image",
      }],
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockStorageUpload).toHaveBeenCalledTimes(1));

    useChatStore.getState().reset();
    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    useChatStore.setState({
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
    });

    delayedUpload.reject(new Error("old upload failed"));
    await sending;

    expect(mockIngestFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState()).toMatchObject({
      messages: [],
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
    });
  });

  it("ignores an old attachment digest failure after the account changes", async () => {
    const delayedDigest = createDeferredResult<ArrayBuffer>();
    const originalCrypto = globalThis.crypto;
    const digest = vi.fn(() => delayedDigest.promise);
    vi.stubGlobal("crypto", { subtle: { digest } });
    mockStorageUpload.mockReset();
    mockIngestFetch.mockClear();
    document.cookie = "demo_mode=; Max-Age=0; path=/";

    const sending = useChatStore.getState().sendMessage({
      content: "이전 계정의 해시 실패 질문",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        previewUrl: "blob:old-digest-image",
      }],
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(digest).toHaveBeenCalledTimes(1));

    useChatStore.getState().reset();
    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    useChatStore.setState({
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
    });

    delayedDigest.reject(new Error("old digest failed"));
    await sending;
    vi.stubGlobal("crypto", originalCrypto);

    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockIngestFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState()).toMatchObject({
      messages: [],
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
    });
  });

  it("ignores a delayed ingest result after the account and couple change", async () => {
    const delayedIngest = createDeferredResult<Response>();
    mockIngestFetch.mockReset();
    mockIngestFetch.mockReturnValueOnce(delayedIngest.promise);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(completedChatResponse("이전 계정의 답변"));
    document.cookie = "demo_mode=; Max-Age=0; path=/";

    const sending = useChatStore.getState().sendMessage({
      content: "이전 계정의 질문",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockIngestFetch).toHaveBeenCalledTimes(1));

    useChatStore.getState().reset();
    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    const newSessionMessage = {
      id: "70000000-0000-4000-8000-000000000021",
      couple_id: "20000000-0000-4000-8000-000000000002",
      sender_id: TEST_OTHER_USER_UUID,
      sender_role: "groom" as const,
      content: "새 계정의 대화",
      metadata: null,
      visibility: "groom_private" as const,
      created_at: "2026-08-04T01:01:00.000Z",
    };
    const newSessionRetry = {
      clientRequestId: "30000000-0000-4000-8000-000000000002",
      userMessageId: "70000000-0000-4000-8000-000000000022",
      coupleId: "20000000-0000-4000-8000-000000000002",
      content: "새 계정의 재시도",
      visibility: "groom_private" as const,
      confirmedActionId: null,
      attachmentCount: 0,
      canRetry: true,
      unavailableReason: null,
      requestBody: "{}",
      isDemo: false,
    };
    useChatStore.setState({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      failedRequest: newSessionRetry,
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
      isStreaming: true,
    });

    delayedIngest.resolve(persistedIngestResponse(durableUserRow({
      content: "이전 계정의 질문",
    })));
    await sending;

    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState()).toMatchObject({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      failedRequest: newSessionRetry,
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
      isStreaming: true,
    });
  });

  it("ignores an old server safety result after attachment cleanup crosses sessions", async () => {
    const delayedCleanup = createDeferredResult<{ error: null }>();
    mockStorageUpload.mockReset();
    mockStorageUpload.mockResolvedValueOnce({ error: null });
    mockStorageRemove.mockReset();
    mockStorageRemove.mockReturnValueOnce(delayedCleanup.promise);
    mockIngestFetch.mockReset();
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      outcome: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
      safetyResolution: "non_immediate_safety",
      rawDisclosurePersisted: false,
      rawDisclosureVisibility: null,
      response: "이전 계정의 안전 안내",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    document.cookie = "demo_mode=; Max-Age=0; path=/";

    const sending = useChatStore.getState().sendMessage({
      content: "서버에서 안전 전환할 이전 계정 질문",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        previewUrl: "blob:old-server-safety-image",
      }],
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockStorageRemove).toHaveBeenCalledTimes(1));

    useChatStore.getState().reset();
    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    const newSessionMessage = {
      id: "70000000-0000-4000-8000-000000000025",
      couple_id: "20000000-0000-4000-8000-000000000002",
      sender_id: TEST_OTHER_USER_UUID,
      sender_role: "groom" as const,
      content: "새 계정의 안전한 대화",
      metadata: null,
      visibility: "groom_private" as const,
      created_at: "2026-08-04T01:03:00.000Z",
    };
    useChatStore.setState({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
    });

    delayedCleanup.resolve({ error: null });
    await sending;

    expect(useChatStore.getState()).toMatchObject({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
    });
  });

  it("does not append an old persisted row after privacy cleanup crosses sessions", async () => {
    const delayedCleanup = createDeferredResult<{ error: null }>();
    mockStorageUpload.mockReset();
    mockStorageUpload.mockResolvedValueOnce({ error: null });
    mockStorageRemove.mockReset();
    mockStorageRemove.mockReturnValueOnce(delayedCleanup.promise);
    mockIngestFetch.mockReset();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({
      content: "서버가 비공개로 전환할 이전 계정 질문",
      visibility: "bride_private",
      metadata: {
        client_request_id: TEST_CLIENT_REQUEST_UUID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "discarded_by_safety_policy",
        provider_attachment_count: 0,
      },
    }), {
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
    }));
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(completedChatResponse("이전 계정의 답변"));
    document.cookie = "demo_mode=; Max-Age=0; path=/";

    const sending = useChatStore.getState().sendMessage({
      content: "서버가 비공개로 전환할 이전 계정 질문",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        previewUrl: "blob:old-private-cleanup-image",
      }],
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockStorageRemove).toHaveBeenCalledTimes(1));

    useChatStore.getState().reset();
    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    const newSessionMessage = {
      id: "70000000-0000-4000-8000-000000000026",
      couple_id: "20000000-0000-4000-8000-000000000002",
      sender_id: TEST_OTHER_USER_UUID,
      sender_role: "groom" as const,
      content: "새 계정의 비공개 대화",
      metadata: null,
      visibility: "groom_private" as const,
      created_at: "2026-08-04T01:04:00.000Z",
    };
    useChatStore.setState({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
      isStreaming: true,
    });

    delayedCleanup.resolve({ error: null });
    await sending;

    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState()).toMatchObject({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
      isStreaming: true,
    });
  });

  it("ignores a delayed provider result after an account and couple switch", async () => {
    const delayedProvider = createDeferredResult<Response>();
    mockIngestFetch.mockReset();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({
      content: "이전 계정의 AI 질문",
    })));
    mockFetch.mockReset();
    mockFetch.mockReturnValueOnce(delayedProvider.promise);
    document.cookie = "demo_mode=; Max-Age=0; path=/";

    const sending = useChatStore.getState().sendMessage({
      content: "이전 계정의 AI 질문",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const providerSignal = (mockFetch.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    expect(providerSignal.aborted).toBe(false);

    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    expect(providerSignal.aborted).toBe(true);
    const newSessionMessage = {
      id: "70000000-0000-4000-8000-000000000023",
      couple_id: "20000000-0000-4000-8000-000000000002",
      sender_id: TEST_OTHER_USER_UUID,
      sender_role: "groom" as const,
      content: "새 계정의 진행 중인 대화",
      metadata: null,
      visibility: "groom_private" as const,
      created_at: "2026-08-04T01:02:00.000Z",
    };
    const newSessionRetry = {
      clientRequestId: "30000000-0000-4000-8000-000000000003",
      userMessageId: "70000000-0000-4000-8000-000000000024",
      coupleId: "20000000-0000-4000-8000-000000000002",
      content: "새 계정의 재시도",
      visibility: "groom_private" as const,
      confirmedActionId: null,
      attachmentCount: 0,
      canRetry: true,
      unavailableReason: null,
      requestBody: "{}",
      isDemo: false,
    };
    useChatStore.setState({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      failedRequest: newSessionRetry,
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
      isStreaming: true,
      isRetrying: true,
      streamingContent: "새 세션 응답",
      suggestions: ["새 세션 제안"],
    });

    delayedProvider.resolve(completedChatResponse("이전 계정의 늦은 AI 답변"));
    await sending;

    expect(useChatStore.getState()).toMatchObject({
      messages: [newSessionMessage],
      artifactVisibility: "groom_private",
      failedRequest: newSessionRetry,
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
      isStreaming: true,
      isRetrying: true,
      streamingContent: "새 세션 응답",
      suggestions: ["새 세션 제안"],
    });
  });

  it("aborts an in-flight provider request when the chat lifecycle resets", async () => {
    mockIngestFetch.mockReset();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({
      content: "reset 중단 질문",
    })));
    mockFetch.mockReset();
    mockFetch.mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("provider signal missing"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      })
    ));
    document.cookie = "demo_mode=; Max-Age=0; path=/";

    const sending = useChatStore.getState().sendMessage({
      content: "reset 중단 질문",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const providerSignal = (mockFetch.mock.calls[0][1] as RequestInit).signal as AbortSignal;

    useChatStore.getState().reset();
    await sending;

    expect(providerSignal.aborted).toBe(true);
    expect(useChatStore.getState()).toMatchObject({
      messages: [],
      failedRequest: null,
      error: null,
      isSending: false,
      isStreaming: false,
      isRetrying: false,
      streamingContent: "",
      streamingToolResults: [],
    });
  });

  it("does not clear a new session retry when an old journey refresh settles", async () => {
    const delayedRefresh = createDeferredResult<void>();
    const originalRefreshJourney = useAuthStore.getState().refreshJourney;
    const refreshJourney = vi.fn(() => delayedRefresh.promise);
    useAuthStore.setState({ refreshJourney } as never);
    mockIngestFetch.mockReset();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({
      content: "이전 계정의 예산 질문",
    })));
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
          })}\n\n`,
        ));
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: "done",
            fullContent: "예산을 반영했어요.",
            metadata: { serverMessageId: "ai-old-refresh-1" },
          })}\n\n`,
        ));
        controller.close();
      },
    });
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    document.cookie = "demo_mode=; Max-Age=0; path=/";

    const sending = useChatStore.getState().sendMessage({
      content: "이전 계정의 예산 질문",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "첫 사용자",
      weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(refreshJourney).toHaveBeenCalledTimes(1));

    useAuthStore.setState({
      profile: {
        id: TEST_OTHER_USER_UUID,
        name: "다음 사용자",
        role: "groom",
        couple_id: "20000000-0000-4000-8000-000000000002",
      } as never,
    });
    const newSessionRetry = {
      clientRequestId: "30000000-0000-4000-8000-000000000004",
      userMessageId: "70000000-0000-4000-8000-000000000027",
      coupleId: "20000000-0000-4000-8000-000000000002",
      content: "새 계정의 재시도",
      visibility: "groom_private" as const,
      confirmedActionId: null,
      attachmentCount: 0,
      canRetry: true,
      unavailableReason: null,
      requestBody: "{}",
      isDemo: false,
    };
    useChatStore.setState({
      failedRequest: newSessionRetry,
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
      isStreaming: true,
      isRetrying: true,
      streamingContent: "새 세션 응답",
    });

    delayedRefresh.resolve();
    await sending;
    useAuthStore.setState({ refreshJourney: originalRefreshJourney } as never);

    expect(useChatStore.getState()).toMatchObject({
      failedRequest: newSessionRetry,
      artifactVisibility: "groom_private",
      error: "새 세션 오류",
      isLoading: true,
      isSending: true,
      isStreaming: true,
      isRetrying: true,
      streamingContent: "새 세션 응답",
    });
  });

  it("aborts the old view and ignores late SSE after a successful reset while keeping Realtime alive", async () => {
    const delayedProvider = createDeferredResult<Response>();
    mockIngestFetch.mockReset();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({ content: "SYNTHETIC_OLD_QUESTION" })));
    mockFetch.mockReset();
    mockFetch.mockReturnValueOnce(delayedProvider.promise);
    document.cookie = "demo_mode=; Max-Age=0; path=/";
    const unsubscribe = useChatStore.getState().subscribeToMessages(TEST_COUPLE_UUID);
    const sending = useChatStore.getState().sendMessage({
      content: "SYNTHETIC_OLD_QUESTION", senderId: TEST_USER_UUID, senderRole: "bride",
      coupleId: TEST_COUPLE_UUID, senderName: "합성 사용자", weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const signal = (mockFetch.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true, clearedAt: "2026-08-03T03:04:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await useChatStore.getState().clearMessages(TEST_COUPLE_UUID, "view_reset_shared");
    expect(signal.aborted).toBe(true);
    // An already-buffered network response can still resolve despite abort.
    delayedProvider.resolve(completedChatResponse());
    await sending;
    expect(useChatStore.getState()).toMatchObject({
      messages: [], isStreaming: false, isSending: false, isRetrying: false,
      streamingContent: "", streamingToolResults: [], failedRequest: null, suggestions: [],
    });
    mockRealtimeInsertHandler?.({ new: {
      id: "70000000-0000-4000-8000-000000000089", couple_id: TEST_COUPLE_UUID,
      sender_id: TEST_OTHER_USER_UUID, sender_type: "groom", role: "user",
      content: "SYNTHETIC_NEW_REALTIME_MESSAGE", metadata: {}, visibility: "shared",
      created_at: "2026-08-03T03:05:00.000Z",
    } });
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(["SYNTHETIC_NEW_REALTIME_MESSAGE"]);
    unsubscribe();
  });

  it.each([
    ["empty cursor", null, "2026-08-03T03:04:00.000Z", "2026-08-03T03:06:00.000Z"],
    ["microseconds", "2026-08-03T03:04:00.123100Z", "2026-08-03T03:04:00.123500Z", "2026-08-03T03:04:00.123900Z"],
  ])("invalidates this tab's old SSE when another tab has already written a newer reset cursor: %s", async (_precision, appliedCursor, ackCursor, otherTabCursor) => {
    useChatStore.setState({ sharedClearedAt: appliedCursor });
    const delayedProvider = createDeferredResult<Response>();
    const resetAck = createDeferredResult<Response>();
    mockIngestFetch.mockReset();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({ content: "SYNTHETIC_OTHER_TAB_OLD_QUESTION" })));
    mockFetch.mockReset();
    mockFetch.mockReturnValueOnce(delayedProvider.promise);
    const sending = useChatStore.getState().sendMessage({
      content: "SYNTHETIC_OTHER_TAB_OLD_QUESTION", senderId: TEST_USER_UUID, senderRole: "bride",
      coupleId: TEST_COUPLE_UUID, senderName: "합성 사용자", weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const signal = (mockFetch.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    mockIngestFetch.mockReturnValueOnce(resetAck.promise);
    const clearing = useChatStore.getState().clearMessages(TEST_COUPLE_UUID, "view_reset_shared");
    // A different tab commits T2 while this tab still waits for its T1 response.
    window.localStorage.setItem(`hanbang.chatClearedAt.${TEST_USER_UUID}.${TEST_COUPLE_UUID}.shared`, otherTabCursor!);
    expect(useChatStore.getState().sharedClearedAt).toBe(appliedCursor);
    resetAck.resolve(new Response(JSON.stringify({ clearedAt: ackCursor })));
    await clearing;
    delayedProvider.resolve(completedChatResponse("SYNTHETIC_OTHER_TAB_STALE_ANSWER", {
      serverMessageId: "70000000-0000-4000-8000-000000000086",
      serverCreatedAt: "2026-08-03T03:03:00.000Z",
    }));
    await sending;
    expect(useChatStore.getState()).toMatchObject({
      messages: [], sharedClearedAt: otherTabCursor,
      isStreaming: false, streamingContent: "", failedRequest: null,
    });
    expect(signal.aborted).toBe(true);
  });

  it("keeps a newer reset cursor and active request when reset acknowledgements arrive backwards", async () => {
    const firstAck = createDeferredResult<Response>();
    const secondAck = createDeferredResult<Response>();
    mockIngestFetch.mockReset();
    mockIngestFetch.mockReturnValueOnce(firstAck.promise).mockReturnValueOnce(secondAck.promise);
    const firstReset = useChatStore.getState().clearMessages(TEST_COUPLE_UUID, "view_reset_shared");
    const secondReset = useChatStore.getState().clearMessages(TEST_COUPLE_UUID, "view_reset_shared");
    secondAck.resolve(new Response(JSON.stringify({ clearedAt: "2026-08-03T03:06:00.000Z" })));
    await secondReset;
    const delayedProvider = createDeferredResult<Response>();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({
      content: "SYNTHETIC_NEW_VIEW_QUESTION", created_at: "2026-08-03T03:07:00.000Z",
    })));
    mockFetch.mockReset();
    mockFetch.mockReturnValueOnce(delayedProvider.promise);
    const sending = useChatStore.getState().sendMessage({
      content: "SYNTHETIC_NEW_VIEW_QUESTION", senderId: TEST_USER_UUID, senderRole: "bride",
      coupleId: TEST_COUPLE_UUID, senderName: "합성 사용자", weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const signal = (mockFetch.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    firstAck.resolve(new Response(JSON.stringify({ clearedAt: "2026-08-03T03:04:00.000Z" })));
    await firstReset;
    expect(signal.aborted).toBe(false);
    expect(useChatStore.getState()).toMatchObject({ sharedClearedAt: "2026-08-03T03:06:00.000Z", isStreaming: true });
    expect(window.localStorage.getItem(`hanbang.chatClearedAt.${TEST_USER_UUID}.${TEST_COUPLE_UUID}.shared`))
      .toBe("2026-08-03T03:06:00.000Z");
    expect(useChatStore.getState().messages.map((message) => message.content)).toContain("SYNTHETIC_NEW_VIEW_QUESTION");
    delayedProvider.resolve(completedChatResponse());
    await sending;
  });

  it.each([
    ["milliseconds", "2026-08-03T03:04:00.000Z", "2026-08-03T03:05:00.000Z"],
    ["microseconds", "2026-08-03T03:04:00.123100Z", "2026-08-03T03:04:00.123900Z"],
  ])("preserves a Realtime message newer than the server reset while its HTTP acknowledgement is delayed: %s", async (_precision, resetAt, createdAt) => {
    const ack = createDeferredResult<Response>();
    mockIngestFetch.mockReturnValueOnce(ack.promise);
    const unsubscribe = useChatStore.getState().subscribeToMessages(TEST_COUPLE_UUID);
    const clearing = useChatStore.getState().clearMessages(TEST_COUPLE_UUID, "view_reset_shared");
    const row = {
      id: "70000000-0000-4000-8000-000000000088", couple_id: TEST_COUPLE_UUID,
      sender_id: TEST_OTHER_USER_UUID, sender_type: "groom", role: "user",
      content: "SYNTHETIC_AFTER_RESET_COMMIT", metadata: {}, visibility: "shared",
      created_at: createdAt,
    };
    mockRealtimeInsertHandler?.({ new: row });
    ack.resolve(new Response(JSON.stringify({ clearedAt: resetAt })));
    await clearing;
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([row.id]);
    unsubscribe();
  });

  it.each([
    ["milliseconds", "2026-08-03T03:04:00.000Z", "2026-08-03T03:06:00.000Z"],
    ["microseconds", "2026-08-03T03:04:00.123100Z", "2026-08-03T03:04:00.123900Z"],
  ])("keeps a newer view reset when an older shared-clear acknowledgement arrives late: %s", async (_precision, olderResetAt, newerResetAt) => {
    const acceptAck = createDeferredResult<Response>();
    mockFetch.mockReset();
    mockFetch.mockReturnValueOnce(acceptAck.promise);
    const accepting = useChatStore.getState().respondToClearRequest("clear-request", "accept");
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({ clearedAt: newerResetAt })));
    await useChatStore.getState().clearMessages(TEST_COUPLE_UUID, "view_reset_shared");

    const delayedProvider = createDeferredResult<Response>();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({
      content: "SYNTHETIC_AFTER_SHARED_CLEAR", created_at: "2026-08-03T03:07:00.000Z",
    })));
    mockFetch.mockReturnValueOnce(delayedProvider.promise);
    const sending = useChatStore.getState().sendMessage({
      content: "SYNTHETIC_AFTER_SHARED_CLEAR", senderId: TEST_USER_UUID, senderRole: "bride",
      coupleId: TEST_COUPLE_UUID, senderName: "합성 사용자", weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const signal = (mockFetch.mock.calls[1][1] as RequestInit).signal as AbortSignal;
    acceptAck.resolve(new Response(JSON.stringify({ clearedAt: olderResetAt })));
    await accepting;
    expect(useChatStore.getState().sharedClearedAt).toBe(newerResetAt);
    expect(window.localStorage.getItem(`hanbang.chatClearedAt.${TEST_USER_UUID}.${TEST_COUPLE_UUID}.shared`))
      .toBe(newerResetAt);
    expect(signal.aborted).toBe(false);
    expect(useChatStore.getState().messages.map((message) => message.content)).toContain("SYNTHETIC_AFTER_SHARED_CLEAR");
    delayedProvider.resolve(completedChatResponse("SYNTHETIC_NEW_SHARED_REPLY", {
      serverCreatedAt: "2026-08-03T03:08:00.000Z",
    }));
    await sending;
    expect(useChatStore.getState().messages.map((message) => message.content)).toContain("SYNTHETIC_NEW_SHARED_REPLY");
  });

  it.each([false, true])("fences old SSE when accepting shared clear with a newer other-tab cursor: %s", async (otherTab) => {
    const delayedProvider = createDeferredResult<Response>();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({ content: "SYNTHETIC_BEFORE_ACCEPT" })));
    mockFetch.mockReset();
    mockFetch.mockReturnValueOnce(delayedProvider.promise);
    const sending = useChatStore.getState().sendMessage({
      content: "SYNTHETIC_BEFORE_ACCEPT", senderId: TEST_USER_UUID, senderRole: "bride",
      coupleId: TEST_COUPLE_UUID, senderName: "합성 사용자", weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const signal = (mockFetch.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    if (otherTab) window.localStorage.setItem(`hanbang.chatClearedAt.${TEST_USER_UUID}.${TEST_COUPLE_UUID}.shared`, "2026-08-03T03:06:00.000Z");
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ clearedAt: "2026-08-03T03:04:00.000Z" })));
    await useChatStore.getState().respondToClearRequest("clear-request", "accept");
    delayedProvider.resolve(completedChatResponse("SYNTHETIC_STALE_ACCEPT_REPLY", {
      serverCreatedAt: "2026-08-03T03:03:00.000Z",
    }));
    await sending;
    expect(signal.aborted).toBe(true);
    expect(useChatStore.getState()).toMatchObject({
      messages: [], isStreaming: false, isSending: false, streamingContent: "",
      sharedClearedAt: otherTab ? "2026-08-03T03:06:00.000Z" : "2026-08-03T03:04:00.000Z",
    });
  });

  it("applies accepted Realtime clears to the old SSE while preserving the request-time card and later messages", async () => {
    const delayedProvider = createDeferredResult<Response>();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({ content: "SYNTHETIC_BEFORE_REALTIME_CLEAR" })));
    mockFetch.mockReset();
    mockFetch.mockReturnValueOnce(delayedProvider.promise);
    const unsubscribe = useChatStore.getState().subscribeToMessages(TEST_COUPLE_UUID);
    const sending = useChatStore.getState().sendMessage({
      content: "SYNTHETIC_BEFORE_REALTIME_CLEAR", senderId: TEST_USER_UUID, senderRole: "bride",
      coupleId: TEST_COUPLE_UUID, senderName: "합성 사용자", weddingContext: {} as WeddingContext,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const clearCard = {
      ...durableUserRow(), id: "70000000-0000-4000-8000-000000000080",
      content: "SYNTHETIC_CLEAR_REQUEST", created_at: "2026-08-03T03:04:00.000Z",
      metadata: { clearRequest: { status: "pending" } },
    };
    mockRealtimeInsertHandler?.({ new: clearCard });
    mockRealtimeInsertHandler?.({ new: {
      ...durableUserRow(), id: "70000000-0000-4000-8000-000000000081",
      content: "SYNTHETIC_AFTER_CLEAR_REQUEST", created_at: "2026-08-03T03:05:00.000Z",
    } });
    mockRealtimeUpdateHandler?.({ new: {
      ...clearCard, metadata: { clearRequest: { status: "accepted", clearedAt: clearCard.created_at } },
    } });
    delayedProvider.resolve(completedChatResponse("SYNTHETIC_STALE_REALTIME_REPLY", {
      serverCreatedAt: "2026-08-03T03:03:00.000Z",
    }));
    await sending;
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      "SYNTHETIC_CLEAR_REQUEST", "SYNTHETIC_AFTER_CLEAR_REQUEST",
    ]);
    expect(useChatStore.getState()).toMatchObject({
      sharedClearedAt: clearCard.created_at, isStreaming: false, isSending: false,
    });
    unsubscribe();
  });

  it("ignores a shared-clear response from a previous account binding", async () => {
    const acceptAck = createDeferredResult<Response>();
    mockFetch.mockReset();
    mockFetch.mockReturnValueOnce(acceptAck.promise);
    const accepting = useChatStore.getState().respondToClearRequest("clear-request", "accept");
    useChatStore.getState().reset();
    useAuthStore.setState({ profile: {
      id: TEST_OTHER_USER_UUID, role: "groom", couple_id: TEST_COUPLE_UUID,
    } as never });
    useChatStore.setState({ sharedClearedAt: "2026-08-03T03:06:00.000Z", error: "SYNTHETIC_NEW_ACCOUNT_STATE" });
    acceptAck.resolve(new Response(JSON.stringify({ clearedAt: "2026-08-03T03:04:00.000Z" })));
    expect(await accepting).toMatchObject({ ok: false });
    expect(useChatStore.getState()).toMatchObject({ sharedClearedAt: "2026-08-03T03:06:00.000Z", error: "SYNTHETIC_NEW_ACCOUNT_STATE" });
    expect(window.localStorage.getItem(`hanbang.chatClearedAt.${TEST_OTHER_USER_UUID}.${TEST_COUPLE_UUID}.shared`)).toBeNull();
  });

  it.each(["rejected", "malformed"])("preserves the active response and pending state after a %s shared-clear acknowledgement", async (kind) => {
    useChatStore.setState({ isStreaming: true, streamingContent: "SYNTHETIC_ACTIVE_RESPONSE", error: "SYNTHETIC_EXISTING_NOTICE" });
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(kind === "rejected"
      ? { error: "SYNTHETIC_CLEAR_ERROR" } : { clearedAt: "invalid" }), { status: kind === "rejected" ? 503 : 200 }));
    expect(await useChatStore.getState().respondToClearRequest("clear-request", "accept")).toMatchObject({ ok: false });
    expect(useChatStore.getState()).toMatchObject({ isStreaming: true, streamingContent: "SYNTHETIC_ACTIVE_RESPONSE", error: "SYNTHETIC_EXISTING_NOTICE", sharedClearedAt: null });
  });

  it("excludes reset history before the polling limit so an empty view can recover its next message", async () => {
    const freshRow = {
      ...durableUserRow(), id: "70000000-0000-4000-8000-000000000087",
      content: "SYNTHETIC_FRESH_POLLED_MESSAGE", created_at: "2026-08-03T03:05:00.000Z",
    };
    const hiddenRows = Array.from({ length: 60 }, (_, index) => ({
      ...freshRow, id: `hidden-${index}`, created_at: "2026-08-03T03:03:00.000Z",
    }));
    const filters: string[] = [];
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gt", "order"]) query[method] = vi.fn(() => query);
    query.or = vi.fn((filter: string) => { filters.push(filter); return query; });
    query.limit = vi.fn(async (limit: number) => ({
      data: (filters.includes("visibility.neq.shared,created_at.gt.2026-08-03T03:04:00.000Z")
        ? [freshRow] : [...hiddenRows, freshRow]).slice(0, limit),
      error: null,
    }));
    mockFrom.mockReturnValue(query);
    useChatStore.setState({ initialLoadDone: true, sharedClearedAt: "2026-08-03T03:04:00.000Z", messages: [] });
    await useChatStore.getState().pollNewMessages(TEST_COUPLE_UUID);
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([freshRow.id]);
  });

  it("keeps an active response when the view reset fails", async () => {
    useChatStore.setState({ isStreaming: true, streamingContent: "SYNTHETIC_IN_PROGRESS" });
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "합성 초기화 실패" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    }));
    await expect(useChatStore.getState().clearMessages(TEST_COUPLE_UUID, "view_reset_shared")).rejects.toThrow();
    expect(useChatStore.getState()).toMatchObject({ isStreaming: true, streamingContent: "SYNTHETIC_IN_PROGRESS" });
  });

  it("removes the hidden interrupted-turn recovery when the user starts a new shared chat", async () => {
    const userMessageId = "70000000-0000-4000-8000-000000000013";
    useChatStore.setState({
      messages: [{
        id: userMessageId,
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_USER_UUID,
        sender_role: "bride",
        content: "이전 질문",
        metadata: {
          client_request_id: TEST_CLIENT_REQUEST_UUID,
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
        },
        visibility: "shared",
        created_at: "2026-08-03T03:03:00.000Z",
      }],
      failedRequest: {
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
        userMessageId,
        coupleId: TEST_COUPLE_UUID,
        content: "이전 질문",
        visibility: "shared",
        confirmedActionId: null,
        attachmentCount: 0,
        canRetry: true,
        unavailableReason: null,
        requestBody: "{}",
        isDemo: false,
        recoveryKind: "interrupted_turn",
      },
      error: "질문은 저장됐지만 답변이 시작되지 않았어요.",
      artifactVisibility: "shared",
    });
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      clearedAt: "2026-08-03T03:04:00.000Z",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await useChatStore.getState().clearMessages(TEST_COUPLE_UUID, "view_reset_shared");

    expect(useChatStore.getState()).toMatchObject({
      messages: [],
      failedRequest: null,
      error: null,
      artifactVisibility: null,
    });
  });

  it("keeps an interrupted private recovery when only the shared view is reset", async () => {
    const userMessageId = "70000000-0000-4000-8000-000000000019";
    useChatStore.setState({
      messages: [{
        id: userMessageId,
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_USER_UUID,
        sender_role: "bride",
        content: "개인 대화의 중단된 질문",
        metadata: {
          client_request_id: TEST_CLIENT_REQUEST_UUID,
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
        },
        visibility: "bride_private",
        created_at: "2026-08-03T03:03:00.000Z",
      }],
      failedRequest: {
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
        userMessageId,
        coupleId: TEST_COUPLE_UUID,
        content: "개인 대화의 중단된 질문",
        visibility: "bride_private",
        confirmedActionId: null,
        attachmentCount: 0,
        canRetry: true,
        unavailableReason: null,
        requestBody: "{}",
        isDemo: false,
        recoveryKind: "interrupted_turn",
      },
      error: "개인 질문은 저장됐지만 답변이 시작되지 않았어요.",
      artifactVisibility: "bride_private",
    });
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      clearedAt: "2026-08-03T03:04:00.000Z",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await useChatStore.getState().clearMessages(TEST_COUPLE_UUID, "view_reset_shared");

    expect(useChatStore.getState()).toMatchObject({
      failedRequest: expect.objectContaining({
        userMessageId,
        visibility: "bride_private",
      }),
      error: "개인 질문은 저장됐지만 답변이 시작되지 않았어요.",
      artifactVisibility: "bride_private",
    });
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([userMessageId]);
  });

  it("does not restore a recovery whose source turn is hidden by the server clear cursor", async () => {
    const userMessageId = "70000000-0000-4000-8000-000000000014";
    const oldRow = {
      id: userMessageId,
      couple_id: TEST_COUPLE_UUID,
      sender_id: TEST_USER_UUID,
      sender_type: "bride",
      role: "user",
      content: "이미 정리한 질문",
      metadata: {
        client_request_id: TEST_CLIENT_REQUEST_UUID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "none",
        provider_attachment_count: 0,
      },
      visibility: "shared",
      created_at: "2026-08-03T03:03:00.000Z",
    };
    useChatStore.setState({
      failedRequest: {
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
        userMessageId,
        coupleId: TEST_COUPLE_UUID,
        content: oldRow.content,
        visibility: "shared",
        confirmedActionId: null,
        attachmentCount: 0,
        canRetry: true,
        unavailableReason: null,
        requestBody: "{}",
        isDemo: false,
        recoveryKind: "interrupted_turn",
      },
      error: "이전 복구 안내",
      artifactVisibility: "shared",
    });
    const immediate = <T,>(value: T) => createDeferredQuery(Promise.resolve(value));
    let chatQueryCount = 0;
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "my_profile_chat_state") {
        return immediate({
          data: {
            shared_chat_cleared_at: "2026-08-03T03:04:00.000Z",
            private_chat_cleared_at: null,
          },
          error: null,
        });
      }
      if (table === "chat_messages") {
        chatQueryCount += 1;
        if (chatQueryCount === 2) return immediate({ data: [oldRow], error: null });
        return immediate({ data: oldRow, error: null });
      }
      return defaultChatMessagesTable;
    });

    await useChatStore.getState().loadMessages(TEST_COUPLE_UUID);

    expect(useChatStore.getState()).toMatchObject({
      messages: [],
      failedRequest: null,
      error: null,
      artifactVisibility: null,
    });
  });

  // 2026-09-03: 안전 홀드 안내 카드는 원문을 저장하지 않는 계약이라 DB 에 없다.
  // 그런데 loadMessages 가 목록을 DB 결과로 통째로 덮어써서, 다른 화면에 갔다
  // 돌아오면 112·119 안내까지 사라졌다. 같은 입력(같은 카드)을 두 조건으로 넣어
  // 남는 경우와 지워지는 경우가 갈리는지로 잰다.
  it.each([
    ["before the user's own reset", false, true],
    ["after the user's own reset", true, false],
  ])("keeps a local safety guidance card across a history reload %s", async (
    _label,
    clearedAfterCard,
    expectedToSurvive,
  ) => {
    // 시계는 실행 시각을 쓴다. 다른 테스트가 남긴 초기화 커서(localStorage 포함)가
    // 과거에 있어도 이 카드가 그 뒤라는 것이 확실해야 두 갈래가 갈린다.
    const cardCreatedAt = new Date().toISOString();
    const sharedClearedAt = clearedAfterCard
      ? new Date(Date.now() + 60_000).toISOString()
      : null;
    const safetyCardId = `amora-crisis-preflight:${TEST_COUPLE_UUID}:${TEST_CLIENT_REQUEST_UUID}`;
    useChatStore.setState({
      messages: [{
        id: safetyCardId,
        couple_id: TEST_COUPLE_UUID,
        sender_id: null,
        sender_role: "ai",
        content: "안전을 위해 이 내용은 상대방에게 공유하거나 저장하지 않았어요.",
        metadata: {
          pinned_safety_card: true,
          persistence_status: "ephemeral_local_only",
          memory_eligible: false,
        },
        visibility: "shared",
        created_at: cardCreatedAt,
      }],
    });
    const immediate = <T,>(value: T) => createDeferredQuery(Promise.resolve(value));
    let chatQueryCount = 0;
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "my_profile_chat_state") {
        return immediate({
          data: {
            shared_chat_cleared_at: sharedClearedAt,
            private_chat_cleared_at: null,
          },
          error: null,
        });
      }
      if (table === "chat_messages") {
        chatQueryCount += 1;
        if (chatQueryCount === 2) return immediate({ data: [], error: null });
        return immediate({ data: null, error: null });
      }
      return defaultChatMessagesTable;
    });

    await useChatStore.getState().loadMessages(TEST_COUPLE_UUID);

    expect(useChatStore.getState().messages.some(
      (message) => message.id === safetyCardId,
    )).toBe(expectedToSurvive);
  });

  it("does not keep another couple's local safety card on reload", async () => {
    const foreignCardId = "amora-crisis-preflight:20000000-0000-4000-8000-000000000099:x";
    useChatStore.setState({
      messages: [{
        id: foreignCardId,
        couple_id: "20000000-0000-4000-8000-000000000099",
        sender_id: null,
        sender_role: "ai",
        content: "다른 커플의 안내 카드",
        metadata: {
          pinned_safety_card: true,
          persistence_status: "ephemeral_local_only",
        },
        visibility: "shared",
        created_at: new Date().toISOString(),
      }],
    });
    const immediate = <T,>(value: T) => createDeferredQuery(Promise.resolve(value));
    let chatQueryCount = 0;
    mockFrom.mockImplementation((table?: string): Record<string, unknown> => {
      if (table === "my_profile_chat_state") {
        return immediate({
          data: { shared_chat_cleared_at: null, private_chat_cleared_at: null },
          error: null,
        });
      }
      if (table === "chat_messages") {
        chatQueryCount += 1;
        if (chatQueryCount === 2) return immediate({ data: [], error: null });
        return immediate({ data: null, error: null });
      }
      return defaultChatMessagesTable;
    });

    await useChatStore.getState().loadMessages(TEST_COUPLE_UUID);

    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("removes an interrupted-turn recovery when a newer canonical realtime turn arrives", () => {
    const userMessageId = "70000000-0000-4000-8000-000000000015";
    useChatStore.setState({
      messages: [{
        id: userMessageId,
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_USER_UUID,
        sender_role: "bride",
        content: "답변이 중단된 질문",
        metadata: {
          client_request_id: TEST_CLIENT_REQUEST_UUID,
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
        },
        visibility: "shared",
        created_at: "2026-08-03T03:05:00.000Z",
      }],
      failedRequest: {
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
        userMessageId,
        coupleId: TEST_COUPLE_UUID,
        content: "답변이 중단된 질문",
        visibility: "shared",
        confirmedActionId: null,
        attachmentCount: 0,
        canRetry: true,
        unavailableReason: null,
        requestBody: "{}",
        isDemo: false,
        recoveryKind: "interrupted_turn",
      },
      error: "질문은 저장됐지만 답변이 시작되지 않았어요.",
      artifactVisibility: "shared",
    });
    const unsubscribe = useChatStore.getState().subscribeToMessages(TEST_COUPLE_UUID);

    mockRealtimeInsertHandler?.({
      new: {
        id: "70000000-0000-4000-8000-000000000016",
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_OTHER_USER_UUID,
        sender_type: "groom",
        role: "user",
        content: "새로 시작한 질문",
        metadata: {
          client_request_id: "90000000-0000-4000-8000-000000000002",
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
        },
        visibility: "shared",
        created_at: "2026-08-03T03:06:00.000Z",
      },
    });

    expect(useChatStore.getState()).toMatchObject({
      failedRequest: null,
      error: null,
      artifactVisibility: null,
    });
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      userMessageId,
      "70000000-0000-4000-8000-000000000016",
    ]);
    unsubscribe();
  });

  it("removes an interrupted-turn recovery when polling finds a newer canonical turn", async () => {
    const userMessageId = "70000000-0000-4000-8000-000000000017";
    useChatStore.setState({
      initialLoadDone: true,
      messages: [{
        id: userMessageId,
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_USER_UUID,
        sender_role: "bride",
        content: "폴링 전에 중단된 질문",
        metadata: {
          client_request_id: TEST_CLIENT_REQUEST_UUID,
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
        },
        visibility: "shared",
        created_at: "2026-08-03T03:07:00.000Z",
      }],
      failedRequest: {
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
        userMessageId,
        coupleId: TEST_COUPLE_UUID,
        content: "폴링 전에 중단된 질문",
        visibility: "shared",
        confirmedActionId: null,
        attachmentCount: 0,
        canRetry: true,
        unavailableReason: null,
        requestBody: "{}",
        isDemo: false,
        recoveryKind: "interrupted_turn",
      },
      error: "질문은 저장됐지만 답변이 시작되지 않았어요.",
      artifactVisibility: "shared",
    });
    mockFrom.mockReturnValueOnce(createDeferredQuery(Promise.resolve({
      data: [{
        id: "70000000-0000-4000-8000-000000000018",
        couple_id: TEST_COUPLE_UUID,
        sender_id: TEST_OTHER_USER_UUID,
        sender_type: "groom",
        role: "user",
        content: "폴링으로 찾은 새 질문",
        metadata: {
          client_request_id: "90000000-0000-4000-8000-000000000003",
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
        },
        visibility: "shared",
        created_at: "2026-08-03T03:08:00.000Z",
      }],
      error: null,
    })));

    await useChatStore.getState().pollNewMessages(TEST_COUPLE_UUID);

    expect(useChatStore.getState()).toMatchObject({
      failedRequest: null,
      error: null,
      artifactVisibility: null,
    });
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      userMessageId,
      "70000000-0000-4000-8000-000000000018",
    ]);
  });
});

describe("Amora crisis reload recovery", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    mockFetch.mockReset();
    mockIngestFetch.mockClear();
    mockGlobalFetch.mockClear();
    mockInsert.mockClear();
    mockInsertSingle.mockReset();
    mockStorageUpload.mockClear();
    vi.mocked(captureEvent).mockClear();
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
    vi.stubGlobal("fetch", mockGlobalFetch);
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

  it("holds a shared AI crisis disclosure before every durable or network side effect", async () => {
    const disclosure = "남편이 지금 칼을 들고 협박해";

    const outcome = await useChatStore.getState().sendMessage({
      content: disclosure,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "aGVscA==",
        mediaType: "image/png",
        fileName: "help.png",
        previewUrl: "blob:help",
      }],
      target: "ai",
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
    }));
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(captureEvent).not.toHaveBeenCalled();

    const safetyCard = useChatStore.getState().messages.find(
      (candidate) => candidate.metadata?.response_origin === "client_deterministic_crisis_preflight",
    );
    expect(safetyCard).toEqual(expect.objectContaining({
      sender_id: null,
      sender_role: "ai",
      visibility: "bride_private",
      content: expect.stringContaining("112"),
      metadata: expect.objectContaining({
        pinned_safety_card: true,
        safety_classification: "interpersonal_danger",
        raw_disclosure_persisted: false,
      }),
    }));
    expect(JSON.stringify(safetyCard?.metadata)).not.toContain(disclosure);
    expect(useChatStore.getState().messages.some(
      (candidate) => candidate.content === disclosure,
    )).toBe(false);
  });

  it("holds a direct-partner crisis before recipient validation or delivery", async () => {
    const outcome = await useChatStore.getState().sendMessage({
      content: "나 지금 죽고 싶어",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "partner",
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: true,
    }));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState().error).toBeNull();
  });

  it("moves non-immediate relationship safety content to private before storage", async () => {
    const disclosure = "작년에 신랑이 칼 들고 죽인다고 했는데 지금은 안전해";
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({
        id: "50000000-0000-4000-8000-000000000099",
        content: disclosure,
        visibility: "bride_private",
        created_at: "2026-08-03T00:00:00.000Z",
      }), {
        effectiveVisibility: "bride_private",
        safetyPrivacyRedirected: true,
      }));
    mockFetch.mockResolvedValueOnce(completedChatResponse("안전하게 정리해볼게요"));

    const outcome = await useChatStore.getState().sendMessage({
      content: disclosure,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      images: [{
        base64: "aGVscA==",
        mediaType: "image/png",
        fileName: "sensitive.png",
        previewUrl: "blob:sensitive",
      }],
      target: "ai",
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "persisted",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
    }));
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockIngestFetch).toHaveBeenCalledWith(
      "/api/chat/messages",
      expect.objectContaining({ method: "POST" }),
    );
    const ingestPayload = JSON.parse(String(
      (mockIngestFetch.mock.calls[0]?.[1] as RequestInit).body,
    ));
    expect(ingestPayload).toEqual({
      coupleId: TEST_COUPLE_UUID,
      content: disclosure,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      requestedVisibility: "shared",
      target: "ai",
      providerAttachmentCount: 0,
    });
    const providerPayload = JSON.parse(String(
      (mockFetch.mock.calls[0]?.[1] as RequestInit).body,
    ));
    expect(providerPayload.visibility).toBe("bride_private");
    expect(providerPayload.attachments).toBeUndefined();

    const privacyCard = useChatStore.getState().messages.find(
      (candidate) => candidate.metadata?.response_origin
        === "client_deterministic_safety_privacy_preflight",
    );
    expect(privacyCard).toEqual(expect.objectContaining({
      visibility: "bride_private",
      content: expect.stringContaining("나만 상담"),
      metadata: expect.objectContaining({
        memory_eligible: false,
        raw_disclosure_persisted: true,
        raw_disclosure_shared: false,
        raw_disclosure_persistence: "private_only",
      }),
    }));
    expect(JSON.stringify(privacyCard?.metadata)).not.toContain(disclosure);
  });

  // 2026-09-17 운영 재검사: 이 문장이 상대 호칭 뒤 `맞았` 하나로 안전 신호가 되어
  // 나만 레인으로 옮겨지고 "긴급 안전 안내" 카드가 붙었으며 확인 표식도 버려졌다.
  it("keeps an ordinary \"신랑 말이 맞았어\" decision in the shared lane", async () => {
    const decision = "어제 결혼식장 고르는 문제로 신랑이랑 얘기했는데 결국 신랑 말이 맞았어. 그 식장으로 하자.";
    mockFetch.mockResolvedValueOnce(completedChatResponse("그 식장으로 정리해볼게요"));

    const outcome = await useChatStore.getState().sendMessage({
      content: decision,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "ai",
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      confirmedActionId: TEST_CONFIRMED_ACTION_UUID,
    });

    // 비공개로 옮겨졌을 때만 effectiveVisibility·safetyPrivacyRedirected 가 붙는다.
    expect(outcome).toEqual({
      userMessage: "persisted",
      userMessageId: "user-message-1",
    });
    const ingestPayload = JSON.parse(String(
      (mockIngestFetch.mock.calls[0]?.[1] as RequestInit).body,
    ));
    expect(ingestPayload).toEqual(expect.objectContaining({
      content: decision,
      requestedVisibility: "shared",
      target: "ai",
      confirmedActionId: TEST_CONFIRMED_ACTION_UUID,
    }));
    const providerPayload = JSON.parse(String(
      (mockFetch.mock.calls[0]?.[1] as RequestInit).body,
    ));
    expect(providerPayload.visibility).toBe("shared");

    const messages = useChatStore.getState().messages;
    expect(messages.some((message) => message.metadata?.response_origin
      === "client_deterministic_safety_privacy_preflight")).toBe(false);
    expect(messages.some((message) => message.metadata?.pinned_safety_card === true)).toBe(false);
    expect(useChatStore.getState().artifactVisibility).toBe("shared");
  });

  it("honors a server safety fallback without calling the provider or copying raw text", async () => {
    const rawText = "웨딩 체크리스트를 알려줘";
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      outcome: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
      safetyResolution: "immediate_crisis",
      classification: "interpersonal_danger",
      response: "고정 안전 안내와 112 연락 기준",
      rawDisclosurePersisted: false,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const outcome = await useChatStore.getState().sendMessage({
      content: rawText,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "ai",
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
    }));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    const safetyCard = useChatStore.getState().messages.find(
      (message) => message.id.startsWith("amora-server-crisis-preflight:"),
    );
    expect(safetyCard).toEqual(expect.objectContaining({
      visibility: "bride_private",
      content: expect.stringContaining("112"),
      metadata: expect.objectContaining({
        pinned_safety_card: true,
        raw_disclosure_persisted: false,
        raw_disclosure_shared: false,
      }),
    }));
    expect(JSON.stringify(safetyCard)).not.toContain(rawText);
  });

  it("truthfully warns when a retried partner disclosure was already delivered and stored", async () => {
    const rawText = "평범한 일정 질문";
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      outcome: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: true,
      safetyResolution: "immediate_crisis",
      classification: "interpersonal_danger",
      response: "고정 안전 안내",
      rawDisclosurePersisted: true,
      rawDisclosureVisibility: "shared",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const outcome = await useChatStore.getState().sendMessage({
      content: rawText,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "partner",
      partnerRecipientId: TEST_OTHER_USER_UUID,
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "ephemeral_safety",
      partnerDeliveryHeld: true,
    }));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    const safetyCard = useChatStore.getState().messages.find(
      (message) => message.id.startsWith("amora-server-crisis-preflight:"),
    );
    expect(safetyCard).toEqual(expect.objectContaining({
      content: expect.stringContaining("이미 상대방에게 전달·저장됐어요"),
      metadata: expect.objectContaining({
        raw_disclosure_persisted: true,
        raw_disclosure_shared: true,
        raw_disclosure_persistence: "shared",
      }),
    }));
    expect(JSON.stringify(safetyCard)).not.toContain(rawText);
  });

  it("does not claim non-persistence when the server cannot verify an earlier retry", async () => {
    const rawText = "평범한 예산 질문";
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      outcome: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
      safetyResolution: "immediate_crisis",
      classification: "interpersonal_danger",
      response: "고정 안전 안내",
      rawDisclosurePersisted: null,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await useChatStore.getState().sendMessage({
      content: rawText,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "ai",
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });

    const safetyCard = useChatStore.getState().messages.find(
      (message) => message.id.startsWith("amora-server-crisis-preflight:"),
    );
    expect(safetyCard).toEqual(expect.objectContaining({
      content: expect.stringContaining("이전 저장·전달 여부를 지금 확인하지 못했어요"),
      metadata: expect.objectContaining({
        raw_disclosure_persistence: "unknown",
      }),
    }));
    expect(safetyCard?.metadata).not.toHaveProperty("raw_disclosure_persisted");
    expect(JSON.stringify(safetyCard)).not.toContain(rawText);
  });

  it("discards an already-uploaded image when the server newly redirects the message to W2 private safety", async () => {
    const content = "Please help me understand this conversation screenshot";
    mockStorageUpload.mockResolvedValueOnce({ error: null });
    mockStorageRemove.mockResolvedValueOnce({ error: null });
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({
      content,
      visibility: "bride_private",
      metadata: {
        client_request_id: TEST_CLIENT_REQUEST_UUID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "discarded_by_safety_policy",
        provider_attachment_count: 0,
      },
    }), {
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
    }));
    mockFetch.mockResolvedValueOnce(completedChatResponse("private safety guidance"));

    const outcome = await useChatStore.getState().sendMessage({
      content,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      target: "ai",
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      images: [{
        base64: "aW1hZ2UtYnl0ZXM=",
        mediaType: "image/png",
        fileName: "conversation.png",
        previewUrl: "blob:conversation",
      }],
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "persisted",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
    }));
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove).toHaveBeenCalledWith([
      expect.stringMatching(new RegExp(
        `^${TEST_COUPLE_UUID}/${TEST_USER_UUID}/[0-9a-f-]+\\.png$`,
      )),
    ]);
    const providerPayload = JSON.parse(String(
      (mockFetch.mock.calls.at(-1)?.[1] as RequestInit).body,
    )) as Record<string, unknown>;
    expect(providerPayload.visibility).toBe("bride_private");
    expect(providerPayload).not.toHaveProperty("attachments");
  });

  // 2026-09-26: 화면 사전 판정은 `continue` 였는데 서버만 나만 레인으로 옮긴 경우. 화면 판정으로
  // 옮겼을 때 만드는 "나만 상담으로 옮겼어요" 카드를 서버 판정 기준으로도 만들고, 답을 기다리기
  // 전에 화면에 알린다(앱 chat.tsx 의 서버 전환 카드와 같은 동작).
  it("adds the private-lane notice card and reports the redirect before the answer when only the server moves the message", async () => {
    const content = "예식장 계약금 환불이 안 된대요";
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(durableUserRow({
      content,
      visibility: "bride_private",
    }), {
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
    }));
    mockFetch.mockResolvedValueOnce(completedChatResponse("나만 상담에서 이어갈게요"));
    const providerCallsWhenReported: number[] = [];
    const onSafetyPrivacyRedirect = vi.fn(() => {
      providerCallsWhenReported.push(mockFetch.mock.calls.length);
    });

    const outcome = await useChatStore.getState().sendMessage({
      content,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "ai",
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      onSafetyPrivacyRedirect,
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "persisted",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
    }));
    // 화면 사전 판정은 함께 대화였다 — 옮긴 것은 서버다.
    const ingestPayload = JSON.parse(String(
      (mockIngestFetch.mock.calls[0]?.[1] as RequestInit).body,
    ));
    expect(ingestPayload.requestedVisibility).toBe("shared");
    expect(onSafetyPrivacyRedirect).toHaveBeenCalledTimes(1);
    expect(onSafetyPrivacyRedirect).toHaveBeenCalledWith("bride_private");
    // 아모라 답 요청보다 먼저 알렸다.
    expect(providerCallsWhenReported).toEqual([0]);

    const privacyCards = useChatStore.getState().messages.filter(
      (candidate) => candidate.metadata?.pinned_safety_card === true
        && candidate.content.includes("나만 상담으로 옮겼어요"),
    );
    expect(privacyCards).toHaveLength(1);
    expect(privacyCards[0]).toEqual(expect.objectContaining({
      id: `amora-safety-privacy-preflight:${TEST_COUPLE_UUID}:${TEST_CLIENT_REQUEST_UUID}`,
      visibility: "bride_private",
      sender_role: "ai",
      metadata: expect.objectContaining({
        memory_eligible: false,
        persistence_status: "ephemeral_local_only",
        raw_disclosure_persisted: true,
        raw_disclosure_shared: false,
        raw_disclosure_persistence: "private_only",
      }),
    }));
    expect(JSON.stringify(privacyCards[0]?.metadata)).not.toContain(content);
  });

  it("does not add the server notice card or report a redirect when the server keeps the message shared", async () => {
    mockFetch.mockResolvedValueOnce(completedChatResponse("정리해볼게요"));
    const onSafetyPrivacyRedirect = vi.fn();

    await useChatStore.getState().sendMessage({
      content: "예식장 계약금 환불이 안 된대요",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "ai",
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      onSafetyPrivacyRedirect,
    });

    expect(onSafetyPrivacyRedirect).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages.some(
      (candidate) => candidate.content.includes("나만 상담으로 옮겼어요"),
    )).toBe(false);
  });

  // 호출자가 요청 id 를 주지 않는 첫 전송이다. 이때 화면 사전 판정 카드와 서버 요청은 **서로 다른
  // id** 를 만들어서, id 로 걸러 내는 중복 방지가 두 카드를 못 합친다(요청 id 를 주면 두 카드의
  // id 가 같아져 이 경로가 가려진다 — 변형 검사로 확인했다).
  it("keeps a single notice card when the screen preflight already moved the message and the server agrees", async () => {
    const disclosure = "작년에 신랑이 칼 들고 죽인다고 했는데 지금은 안전해";
    mockIngestFetch.mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return persistedIngestResponse(durableUserRow({
        content: disclosure,
        visibility: "bride_private",
        metadata: {
          client_request_id: body.clientRequestId,
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
        },
      }), {
        effectiveVisibility: "bride_private",
        safetyPrivacyRedirected: true,
      });
    });
    mockFetch.mockResolvedValueOnce(completedChatResponse("안전하게 정리해볼게요"));

    const outcome = await useChatStore.getState().sendMessage({
      content: disclosure,
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "ai",
      visibility: "shared",
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "persisted",
      safetyPrivacyRedirected: true,
    }));
    expect(useChatStore.getState().messages.filter(
      (candidate) => candidate.content.includes("나만 상담으로 옮겼어요"),
    )).toHaveLength(1);
  });

  it("deduplicates a retried local safety card without persisting the raw text", async () => {
    const params = {
      content: "나 지금 죽고 싶어",
      senderId: TEST_USER_UUID,
      senderRole: "bride" as const,
      coupleId: TEST_COUPLE_UUID,
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      target: "ai" as const,
      visibility: "shared" as const,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    };

    const first = await useChatStore.getState().sendMessage(params);
    const second = await useChatStore.getState().sendMessage(params);

    expect(second).toEqual(first);
    expect(useChatStore.getState().messages.filter(
      (candidate) => candidate.metadata?.response_origin === "client_deterministic_crisis_preflight",
    )).toHaveLength(1);
    expect(mockInsert).not.toHaveBeenCalled();
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
      /filter\(\(m\) => \([\s\S]*m\.sender_role === "ai"[\s\S]*&& !isSafetyScopedChatMessage\(m\)[\s\S]*\)\)/,
    );
    expect(chatContentSource).toMatch(
      /const isCommunityFallbackEligible = !isSafetyScopedChatMessage\(msg\)[\s\S]*canConsiderCommunityFallback/,
    );
    expect(chatContentSource).toMatch(/data-amora-safety-card="true"/);
    expect(chatContentSource).toMatch(/role="alert"/);
  });

  it("moves both web chat surfaces to the private AI lane after a local safety hold", () => {
    const contentBranch = chatContentSource.slice(
      chatContentSource.indexOf('if (outcome?.userMessage === "ephemeral_safety")'),
      chatContentSource.indexOf('if (outcome?.userMessage === "ephemeral_safety")') + 500,
    );
    const panelBranch = chatSidePanelSource.slice(
      chatSidePanelSource.indexOf('if (outcome?.userMessage === "ephemeral_safety")'),
      chatSidePanelSource.indexOf('if (outcome?.userMessage === "ephemeral_safety")') + 500,
    );

    expect(contentBranch).toContain('setActiveTab("private")');
    expect(contentBranch).toContain('setMessageTarget("ai")');
    expect(panelBranch).toContain('setActiveScope("private")');
    expect(panelBranch).toContain('setMessageTarget("ai")');
  });

  it("routes non-immediate safety content through the private lane on both web surfaces", () => {
    const contentSend = chatContentSource.slice(
      chatContentSource.indexOf("const crisisPreflight = planAmoraCrisisDelivery"),
      chatContentSource.indexOf("const crisisPreflight = planAmoraCrisisDelivery") + 8_000,
    );
    const panelSend = chatSidePanelSource.slice(
      chatSidePanelSource.indexOf("const crisisPreflight = planAmoraCrisisDelivery"),
      chatSidePanelSource.indexOf("const crisisPreflight = planAmoraCrisisDelivery") + 8_000,
    );

    expect(contentSend).toContain(
      'const isPrivateSafetyRoute = crisisPreflight.disposition === "private_safety_route"',
    );
    expect(contentSend).toContain('setActiveTab("private")');
    // 비공개 안전 레인에서도 첨부 "목록"은 넘어간다 — 스토어가 그 갈래의 첨부를
    // 통째로 버리므로 전송은 0건이고, 안내 카드만 첨부를 보내지 않았다고 말할 수
    // 있게 된다. 목록조차 안 넘기면 사진이 아무 말 없이 사라진다.
    expect(contentSend).toContain(
      "images: (canTransmitAttachments || isPrivateSafetyRoute)",
    );
    expect(panelSend).toContain(
      'const isPrivateSafetyRoute = crisisPreflight.disposition === "private_safety_route"',
    );
    expect(panelSend).toContain('setActiveScope("private")');
    expect(panelSend).toContain("visibility: effectiveVisibility");
  });

  it("keeps an existing private crisis local-only without copying raw text", async () => {
    const outcome = await useChatStore.getState().sendMessage({
      content: "지금 죽고 싶어",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "bride_private",
    });

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
    }));
    const answer = useChatStore.getState().messages.find(
      (candidate) => candidate.sender_role === "ai",
    );
    expect(answer?.metadata).toEqual(expect.objectContaining({
      response_origin: "client_deterministic_crisis_preflight",
      raw_disclosure_persisted: false,
      memory_eligible: false,
    }));
    expect(JSON.stringify(answer?.metadata)).not.toContain("죽고 싶어");
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("useChatStore quota warning", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useAuthStore.setState({
      isDemo: false,
      journey: null,
      profile: {
        id: "user-1",
        couple_id: "couple-1",
        role: "bride",
      } as never,
    });
    mockFetch.mockReset();
    mockIngestFetch.mockClear();
    mockGlobalFetch.mockClear();
    mockInsertSingle.mockReset();
    vi.stubGlobal("fetch", mockGlobalFetch);
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

  it("aborts an initial greeting and preserves the next session on reset", async () => {
    const delayedProvider = createDeferredResult<Response>();
    mockFetch.mockReturnValueOnce(delayedProvider.promise);

    const greeting = useChatStore.getState().requestInitialGreeting({
      coupleId: "couple-1",
      senderRole: "bride",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const providerSignal = (mockFetch.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    const nextSessionMessage = {
      id: "next-session-greeting-message",
      couple_id: "couple-2",
      sender_id: "user-2",
      sender_role: "groom" as const,
      content: "next session",
      metadata: null,
      visibility: "shared" as const,
      created_at: "2026-08-04T02:00:00.000Z",
    };

    useChatStore.getState().reset();
    useChatStore.setState({
      messages: [nextSessionMessage],
      error: "next session error",
      isStreaming: true,
      streamingContent: "next session stream",
    });
    const wasAborted = providerSignal.aborted;
    delayedProvider.resolve(completedChatResponse("old greeting"));
    await greeting;

    expect(wasAborted).toBe(true);
    expect(useChatStore.getState()).toMatchObject({
      messages: [nextSessionMessage],
      error: "next session error",
      isStreaming: true,
      streamingContent: "next session stream",
    });
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

  it("aborts mediation before stale tool results can mutate the next account", async () => {
    const delayedProvider = createDeferredResult<Response>();
    mockFetch.mockReturnValueOnce(delayedProvider.promise);
    const encoder = new TextEncoder();
    const oldMediationStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: "tool_result",
            result: {
              toolName: "update_budget",
              toolInput: { total_budget: 99_000_000 },
              toolOutput: { total_budget: 99_000_000 },
              success: true,
              displayMessage: "예산을 변경했어요.",
            },
          })}\n\n`,
        ));
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: "done",
            fullContent: "old mediation",
            metadata: { serverMessageId: "old-mediation-message" },
          })}\n\n`,
        ));
        controller.close();
      },
    });

    const mediation = useChatStore.getState().requestMediation({
      coupleId: "couple-1",
      senderRole: "bride",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      conflictContext: "예산 상한선을 두고 의견이 달라요.",
    });
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const providerSignal = (mockFetch.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    const nextSessionMessage = {
      id: "next-session-mediation-message",
      couple_id: "couple-2",
      sender_id: "user-2",
      sender_role: "groom" as const,
      content: "next session",
      metadata: null,
      visibility: "shared" as const,
      created_at: "2026-08-04T02:01:00.000Z",
    };

    useAuthStore.setState({
      profile: {
        id: "user-2",
        couple_id: "couple-2",
        role: "groom",
      } as never,
      journey: {
        id: "journey-2",
        couple_id: "couple-2",
        total_budget: 12_000_000,
        progress: {},
      } as never,
    });
    useChatStore.setState({
      messages: [nextSessionMessage],
      error: "next session error",
      isStreaming: true,
      streamingContent: "next session stream",
    });
    const wasAborted = providerSignal.aborted;
    delayedProvider.resolve(new Response(oldMediationStream, { status: 200 }));
    await mediation;

    expect(wasAborted).toBe(true);
    expect(useAuthStore.getState().journey?.total_budget).toBe(12_000_000);
    expect(useChatStore.getState()).toMatchObject({
      messages: [nextSessionMessage],
      error: "next session error",
      isStreaming: true,
      streamingContent: "next session stream",
    });
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

  it.each([
    "지금 상대가 나를 죽이겠다고 협박하고 있어",
    "작년에 상대가 칼로 협박했는데 지금은 안전해",
  ])("holds a safety-related mediation summary locally: %s", async (rawSummary) => {
    await useChatStore.getState().requestMediation({
      coupleId: "couple-1",
      senderRole: "bride",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      conflictContext: rawSummary,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(useChatStore.getState().isStreaming).toBe(false);
    const safetyCard = useChatStore.getState().messages.find(
      (message) => message.metadata?.pinned_safety_card === true,
    );
    expect(safetyCard).toEqual(expect.objectContaining({
      visibility: "bride_private",
      content: expect.stringContaining("보내지 않았어요"),
      metadata: expect.objectContaining({
        memory_eligible: false,
        raw_disclosure_persisted: false,
        raw_disclosure_shared: false,
      }),
    }));
    expect(JSON.stringify(safetyCard)).not.toContain(rawSummary);
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
    mockIngestFetch.mockClear();
    mockGlobalFetch.mockClear();
    mockInsertSingle.mockReset();
    vi.stubGlobal("fetch", mockGlobalFetch);
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
    useAuthStore.setState({
      profile: {
        id: "user-1",
        couple_id: "couple-1",
        role: "bride",
      } as never,
    });
    mockFetch.mockReset();
    mockIngestFetch.mockReset();
    mockIngestFetch.mockImplementation(defaultIngestFetch);
    mockGlobalFetch.mockClear();
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
    vi.stubGlobal("fetch", mockGlobalFetch);
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

  it("sends a partner row through the server safety ingest without invoking the provider", async () => {
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
    expect(mockIngestFetch).toHaveBeenCalledTimes(1);
    const ingestBody = JSON.parse(String(
      (mockIngestFetch.mock.calls[0]?.[1] as RequestInit).body,
    ));
    expect(ingestBody).toEqual({
      coupleId: "couple-1",
      content: "only for my linked partner",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      requestedVisibility: "shared",
      target: "partner",
      providerAttachmentCount: 0,
    });
    expect(mockInsert).not.toHaveBeenCalled();
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

  it("keeps the same request id when the server cannot prove a failed insert was absent", async () => {
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

    expect(outcome).toEqual({
      userMessage: "persistence_unknown",
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(useChatStore.getState().messages).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not destructively remove an immutable image when server persistence is unknown", async () => {
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

    expect(outcome).toEqual({
      userMessage: "persistence_unknown",
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
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
    expect(useChatStore.getState().error).toMatch(/전송 상태.*확인/);
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
    const expectedV2Path = await createChatImageObjectPathV2({
      coupleId: TEST_COUPLE_UUID,
      senderId: TEST_USER_UUID,
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      attachmentIndex: 0,
      mediaType: "image/png",
      sha256: "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c",
    });
    expect(mockStorageUpload.mock.calls[0][0]).toBe(expectedV2Path);
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
    const ingestPayload = JSON.parse(String(
      (mockIngestFetch.mock.calls.at(-1)?.[1] as RequestInit).body,
    )) as Record<string, unknown>;
    expect(ingestPayload.clientRequestId).toBe(TEST_CLIENT_REQUEST_UUID);
    expect(ingestPayload).not.toHaveProperty("imagePaths");
    expect(ingestPayload.providerAttachmentManifest).toEqual([{
      mediaType,
      byteLength: 14,
      sha256: "55de2faa25d78c66f09eae87ddc2bdb9eae481b263dd6381791455c849222a27",
    }]);
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

  it("removes only the newly created first image when a later image upload fails", async () => {
    mockStorageUpload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        error: {
          statusCode: 403,
          error: "Forbidden",
          message: "row-level security policy denied the upload",
        },
      });
    mockStorageRemove.mockResolvedValueOnce({ error: null });

    const outcome = await useChatStore.getState().sendMessage({
      content: "review these receipts",
      senderId: TEST_USER_UUID,
      senderRole: "bride",
      coupleId: TEST_COUPLE_UUID,
      senderName: "Tester",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
      images: [{
        base64: "Zmlyc3QtaW1hZ2U=",
        mediaType: "image/png",
        previewUrl: "blob:first-image",
        fileName: "first.png",
      }, {
        base64: "c2Vjb25kLWltYWdl",
        mediaType: "image/jpeg",
        previewUrl: "blob:second-image",
        fileName: "second.jpg",
      }],
    });

    expect(outcome).toEqual({
      userMessage: "not_persisted",
      reason: "storage",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove).toHaveBeenCalledWith([
      mockStorageUpload.mock.calls[0][0],
    ]);
    expect(mockStorageRemove.mock.calls[0][0]).not.toContain(
      mockStorageUpload.mock.calls[1][0],
    );
    expect(mockIngestFetch).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("removes the newly created first image when decoding a later image fails", async () => {
    const originalAtob = globalThis.atob;
    let atobCallCount = 0;
    vi.stubGlobal("atob", vi.fn((value: string) => {
      atobCallCount += 1;
      if (atobCallCount === 4) throw new Error("later image decode failed");
      return originalAtob(value);
    }));
    mockStorageUpload.mockResolvedValueOnce({ error: null });
    mockStorageRemove.mockResolvedValueOnce({ error: null });

    try {
      const outcome = await useChatStore.getState().sendMessage({
        content: "review these receipts",
        senderId: TEST_USER_UUID,
        senderRole: "bride",
        coupleId: TEST_COUPLE_UUID,
        senderName: "Tester",
        weddingContext: {} as WeddingContext,
        visibility: "shared",
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
        images: [{
          base64: "Zmlyc3QtaW1hZ2U=",
          mediaType: "image/png",
          previewUrl: "blob:first-image",
          fileName: "first.png",
        }, {
          base64: "c2Vjb25kLWltYWdl",
          mediaType: "image/jpeg",
          previewUrl: "blob:second-image",
          fileName: "second.jpg",
        }],
      });

      expect(outcome).toEqual({
        userMessage: "not_persisted",
        reason: "storage",
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
      });
      expect(mockStorageUpload).toHaveBeenCalledTimes(1);
      expect(mockStorageRemove).toHaveBeenCalledWith([
        mockStorageUpload.mock.calls[0][0],
      ]);
      expect(mockIngestFetch).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("atob", originalAtob);
    }
  });

  it("removes the newly created first image when deriving a later image path fails", async () => {
    const originalCrypto = globalThis.crypto;
    let digestCallCount = 0;
    vi.stubGlobal("crypto", {
      randomUUID: originalCrypto.randomUUID.bind(originalCrypto),
      subtle: {
        digest: vi.fn(async (...args: Parameters<SubtleCrypto["digest"]>) => {
          digestCallCount += 1;
          if (digestCallCount === 4) throw new Error("later image path failed");
          return originalCrypto.subtle.digest(...args);
        }),
      },
    });
    mockStorageUpload.mockResolvedValueOnce({ error: null });
    mockStorageRemove.mockResolvedValueOnce({ error: null });

    try {
      const outcome = await useChatStore.getState().sendMessage({
        content: "review these receipts",
        senderId: TEST_USER_UUID,
        senderRole: "bride",
        coupleId: TEST_COUPLE_UUID,
        senderName: "Tester",
        weddingContext: {} as WeddingContext,
        visibility: "shared",
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
        images: [{
          base64: "Zmlyc3QtaW1hZ2U=",
          mediaType: "image/png",
          previewUrl: "blob:first-image",
          fileName: "first.png",
        }, {
          base64: "c2Vjb25kLWltYWdl",
          mediaType: "image/jpeg",
          previewUrl: "blob:second-image",
          fileName: "second.jpg",
        }],
      });

      expect(outcome).toEqual({
        userMessage: "not_persisted",
        reason: "storage",
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
      });
      expect(mockStorageUpload).toHaveBeenCalledTimes(1);
      expect(mockStorageRemove).toHaveBeenCalledWith([
        mockStorageUpload.mock.calls[0][0],
      ]);
      expect(mockIngestFetch).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });

  it.each([400, 401, 403, 409, 413, 415, 422])(
    "removes a newly created image when ingest definitively rejects it with %s",
    async (status) => {
      mockStorageUpload.mockResolvedValueOnce({ error: null });
      mockStorageRemove.mockResolvedValueOnce({ error: null });
      mockIngestFetch.mockReset();
      mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        error: "첨부 메시지를 저장할 수 없어요.",
        code: "CHAT_MESSAGE_INVALID",
      }), {
        status,
        headers: { "Content-Type": "application/json" },
      }));

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
        reason: "validation",
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
      });
      expect(mockStorageRemove).toHaveBeenCalledWith([
        mockStorageUpload.mock.calls[0][0],
      ]);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each([408, 429, 500])(
    "keeps a newly created image when ingest persistence is uncertain with %s",
    async (status) => {
      mockStorageUpload.mockResolvedValueOnce({ error: null });
      mockStorageRemove.mockResolvedValueOnce({ error: null });
      mockIngestFetch.mockReset();
      mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        error: "메시지 저장 상태를 확인할 수 없어요.",
        retryPolicy: "same_request",
      }), {
        status,
        headers: { "Content-Type": "application/json" },
      }));

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
        userMessage: "persistence_unknown",
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
      });
      expect(mockStorageRemove).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it("keeps a newly created image when ingest transport fails ambiguously", async () => {
    mockStorageUpload.mockResolvedValueOnce({ error: null });
    mockStorageRemove.mockResolvedValueOnce({ error: null });
    mockIngestFetch.mockReset();
    mockIngestFetch.mockRejectedValueOnce(new Error("connection reset after request write"));

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
      userMessage: "persistence_unknown",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never removes a duplicate image path owned by an earlier request", async () => {
    mockStorageUpload.mockResolvedValueOnce({
      error: {
        statusCode: 409,
        error: "Duplicate",
        message: "The resource already exists",
      },
    });
    mockStorageRemove.mockResolvedValueOnce({ error: null });
    mockIngestFetch.mockReset();
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: "첨부 메시지를 저장할 수 없어요.",
      code: "CHAT_MESSAGE_CONFLICT",
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }));

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
      reason: "validation",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts an exact canonical row reconciled by the server ingest boundary", async () => {
    const reconciled = durableUserRow();
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(reconciled, {
      reused: true,
    }));
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
    });

    expect(outcome).toEqual({
      userMessage: "persisted",
      userMessageId: reconciled.id,
    });
    expect(mockIngestFetch).toHaveBeenCalledTimes(1);
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().messages.filter(
      (message) => message.id === reconciled.id,
    )).toHaveLength(1);
  });

  it.each([408, 429, 500, 502, 504])(
    "reuses the same request id after an uncertain ingest HTTP %s",
    async (status) => {
      mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        code: "EDGE_OR_RATE_FAILURE",
      }), {
        status,
        headers: { "Content-Type": "application/json" },
      }));

      const outcome = await useChatStore.getState().sendMessage({
        content: "keep this idempotency key",
        senderId: TEST_USER_UUID,
        senderRole: "bride",
        coupleId: TEST_COUPLE_UUID,
        senderName: "Tester",
        weddingContext: {} as WeddingContext,
        visibility: "shared",
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
      });

      expect(outcome).toEqual({
        userMessage: "persistence_unknown",
        clientRequestId: TEST_CLIENT_REQUEST_UUID,
      });
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it("accepts a partner retry only when the server reconciles the exact bound row", async () => {
    const reconciled = durableUserRow({
      metadata: {
        client_request_id: TEST_CLIENT_REQUEST_UUID,
        amora_ingest_contract_version: 1,
        ai_response_requested: false,
        provider_attachment_state: "none",
        target: "partner",
        partner_recipient_id: TEST_OTHER_USER_UUID,
        provider_attachment_count: 0,
      },
    });
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(reconciled, {
      reused: true,
    }));

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

  it("rejects a partner retry when the server reports a request binding conflict", async () => {
    mockIngestFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: "같은 요청 식별자가 다른 메시지에 이미 사용됐어요.",
      code: "USER_MESSAGE_REQUEST_CONFLICT",
      retryable: false,
      retryPolicy: "new_message",
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }));

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

    expect(outcome).toEqual({
      userMessage: "not_persisted",
      reason: "validation",
      clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
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
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse(
      durableUserRow(mismatch),
    ));

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

    expect(outcome).toEqual(expect.objectContaining({
      userMessage: "not_persisted",
      reason: "validation",
    }));
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

  it("hides the futile retry and the 'send a new message' subtitle when a cap arrives over HTTP", async () => {
    // 2026-09-04 브라우저 실측: 커플 하루 상한이 스트림 전 HTTP 로 왔고, 서버는 원장 때문에
    // same_request 재시도를 허용한다. 화면은 "내일 다시" 라고 말하면서 밑에 "다시 보내도 같은
    // 결과예요. 새 메시지로 이어가 주세요" 부제를 붙였다 — 다음 행동은 새 메시지가 아니라 내일이다.
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      error: "오늘 이 대화에서 쓸 수 있는 상담 횟수를 다 썼어요. 내일 다시 이어서 도와드릴게요.",
      code: "COST_GUARD_COUPLE_DAILY",
      retryable: true,
      retryPolicy: "same_request",
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));

    await useChatStore.getState().sendMessage({
      content: "우리 예산 현황 알려줘",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
    });

    expect(useChatStore.getState().error).toBe(
      "오늘 이 대화에서 쓸 수 있는 상담 횟수를 다 썼어요. 내일 다시 이어서 도와드릴게요.",
    );
    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: false,
      // 빈 문자열 = 부제 없음. 일반 부제("새 메시지로 이어가 주세요")가 붙으면 안 된다.
      unavailableReason: "",
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

    const ingestPayload = JSON.parse(String(
      (mockIngestFetch.mock.calls.at(-1)?.[1] as RequestInit).body,
    )) as { clientRequestId?: string };
    const providerPayload = JSON.parse(String(
      (mockFetch.mock.calls.at(-1)?.[1] as RequestInit).body,
    ));
    expect(ingestPayload.clientRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(providerPayload.clientRequestId).toBe(ingestPayload.clientRequestId);
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
    mockReconcileMaybeSingle.mockResolvedValue({
      data: reconciledMessage,
      error: null,
    });
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

    expect(mockIngestFetch).toHaveBeenCalledTimes(1);
    expect(mockReconcileMaybeSingle).toHaveBeenCalledTimes(1);
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
    expect(JSON.parse(String(
      (mockIngestFetch.mock.calls[0]?.[1] as RequestInit).body,
    ))).toEqual(expect.objectContaining({
      confirmedActionId: "22222222-2222-4222-8222-222222222222",
    }));

    await useChatStore.getState().retryFailedMessage();

    expect((mockFetch.mock.calls[1][1] as RequestInit).body).toBe(firstBody);
    expect(JSON.parse(String((mockFetch.mock.calls[1][1] as RequestInit).body))).toEqual(
      expect.objectContaining({ confirmedActionId: "22222222-2222-4222-8222-222222222222" }),
    );
  });

  it("keeps only the public ID in ingest and an immutable provider retry", async () => {
    mockFetch.mockResolvedValueOnce(retryableChatHttpResponse()).mockResolvedValueOnce(completedChatResponse());
    await useChatStore.getState().sendMessage({
      content: "안내에서 무엇부터 확인할까요?", senderId: "user-1", senderRole: "bride", coupleId: "couple-1",
      senderName: "테스터", weddingContext: {} as WeddingContext, visibility: "shared", preparationSource: "g.cost-saving.section-3",
    });
    const ingest = JSON.parse(String((mockIngestFetch.mock.calls[0][1] as RequestInit).body));
    const firstBody = (mockFetch.mock.calls[0][1] as RequestInit).body;
    expect(ingest).toEqual(expect.objectContaining({ content: "안내에서 무엇부터 확인할까요?", preparationSource: "g.cost-saving.section-3" }));
    expect(JSON.parse(String(firstBody))).toEqual(expect.objectContaining({ preparationSource: "g.cost-saving.section-3" }));
    expect(JSON.parse(String(firstBody))).not.toHaveProperty("referenceText");
    await useChatStore.getState().retryFailedMessage();
    expect((mockFetch.mock.calls[1][1] as RequestInit).body).toBe(firstBody);
    expect(mockIngestFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a saved-row source mismatch before calling the provider", async () => {
    mockIngestFetch.mockResolvedValueOnce(persistedIngestResponse({
      id: "user-message-1", couple_id: "couple-1", sender_id: "user-1", sender_type: "bride", role: "user",
      content: "안내 확인", visibility: "shared", metadata: {
        client_request_id: TEST_CLIENT_REQUEST_UUID, amora_ingest_contract_version: 1, ai_response_requested: true,
        provider_attachment_state: "none", provider_attachment_count: 0, preparation_source: "c.studio",
      },
    }));
    const result = await useChatStore.getState().sendMessage({
      content: "안내 확인", senderId: "user-1", senderRole: "bride", coupleId: "couple-1", senderName: "테스터",
      weddingContext: {} as WeddingContext, preparationSource: "c.venue", clientRequestId: TEST_CLIENT_REQUEST_UUID,
    });
    expect(result).toEqual(expect.objectContaining({ userMessage: "not_persisted", reason: "validation" }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    { preparationSource: "c.venue&memo=secret" },
    { preparationSource: "c.venue", visibility: "bride_private" as const },
    { preparationSource: "c.venue", target: "partner" as const },
    { preparationSource: "c.venue", confirmedActionId: "22222222-2222-4222-8222-222222222222" },
  ])("rejects a malformed or incompatible source before persistence: %j", async extra => {
    const result = await useChatStore.getState().sendMessage({
      content: "안내 확인", senderId: "user-1", senderRole: "bride", coupleId: "couple-1", senderName: "테스터",
      weddingContext: {} as WeddingContext, ...extra,
    });
    expect(result).toEqual(expect.objectContaining({ userMessage: "not_persisted", reason: "validation" }));
    expect(mockIngestFetch).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
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
    mockReconcileMaybeSingle.mockResolvedValue({
      data: reconciledMessage,
      error: null,
    });
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
    expect(mockIngestFetch).toHaveBeenCalledTimes(1);
    expect(mockReconcileMaybeSingle).toHaveBeenCalledTimes(1);
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

  // 2026-09-03: 여기가 뒤집혔다. `!res.ok` 는 항상 스트림 시작 전 실패이고 서버가
  // 클레임까지 풀어 두므로, 재시도 판정이 실려 오지 않은 일시적 상태 코드는 같은
  // 요청을 다시 보낼 수 있다. 전에는 이 경우를 "입력을 확인하라" 로 닫아, 서버가
  // 본문에 "같은 요청으로 다시 시도해주세요" 라고 쓴 504 에서도 버튼이 사라졌다.
  it.each([
    ["legacy", JSON.stringify({ code: "LEGACY_HTTP_503" }), 503],
    ["malformed", "not-json", 503],
    ["gateway", "<html>Bad Gateway</html>", 502],
    ["timeout", "", 504],
    ["request timeout", "", 408],
  ])("offers the same request again for a %s transient HTTP terminal", async (
    _label,
    body,
    status,
  ) => {
    mockFetch.mockResolvedValue(new Response(body, { status }));

    await useChatStore.getState().sendMessage({
      content: "일시적 실패면 같은 요청으로 다시 보내게 해 줘",
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
    expect(useChatStore.getState().error).toContain("잠시 후 다시 시도");
    expect(useChatStore.getState().error).not.toContain("첨부파일을 확인");
  });

  it.each([
    ["legacy", JSON.stringify({ code: "LEGACY_HTTP_422" })],
    ["malformed", "not-json"],
  ])("fails closed for a %s permanent HTTP terminal without an explicit replay contract", async (
    _label,
    body,
  ) => {
    mockFetch.mockResolvedValue(new Response(body, { status: 422 }));

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

  it("still fails closed when a 5xx explicitly says a new message is required", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      error: "개인정보 설정이 바뀌어 같은 요청을 다시 보낼 수 없어요.",
      code: "AMORA_PRIVACY_CONTEXT_CHANGED",
      retryable: false,
      retryPolicy: "new_message",
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));

    await useChatStore.getState().sendMessage({
      content: "서버가 명시한 판정이 상태 코드보다 앞서야 해",
      senderId: "user-1",
      senderRole: "bride",
      coupleId: "couple-1",
      senderName: "테스터",
      weddingContext: {} as WeddingContext,
      visibility: "shared",
    });

    expect(useChatStore.getState().failedRequest).toEqual(expect.objectContaining({
      canRetry: false,
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
