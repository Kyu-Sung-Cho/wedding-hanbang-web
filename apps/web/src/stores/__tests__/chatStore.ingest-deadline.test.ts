import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../chatStore";
import { useAuthStore } from "../authStore";
import type { ChatSendOutcome, WeddingContext } from "@/types/chat.types";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const mockIngest = vi.fn<(init?: RequestInit) => Promise<Response>>();
const mockProvider = vi.fn<(init?: RequestInit) => Promise<Response>>();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function sendParams() {
  return {
    content: "이번 주 예산을 확인하고 싶어요",
    senderId: USER_ID,
    senderRole: "bride" as const,
    coupleId: COUPLE_ID,
    senderName: "감사 사용자",
    weddingContext: {} as WeddingContext,
    visibility: "shared" as const,
    clientRequestId: REQUEST_ID,
  };
}

function canonicalPayload() {
  return {
    outcome: "persisted",
    reused: true,
    effectiveVisibility: "shared",
    safetyPrivacyRedirected: false,
    message: {
      id: "40000000-0000-4000-8000-000000000001",
      couple_id: COUPLE_ID,
      sender_id: USER_ID,
      sender_type: "bride",
      role: "user",
      content: sendParams().content,
      visibility: "shared",
      created_at: "2026-09-19T00:00:00.000Z",
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "none",
        provider_attachment_count: 0,
      },
    },
  };
}

function providerResponse() {
  return new Response(`data: ${JSON.stringify({
    type: "done",
    fullContent: "저장된 질문을 확인했어요.",
    metadata: { serverMessageId: "50000000-0000-4000-8000-000000000001" },
  })}\n\n`);
}

describe("chat message ingest deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useChatStore.getState().reset();
    mockIngest.mockReset();
    mockProvider.mockReset();
    document.cookie = "demo_mode=; Max-Age=0; path=/";
    useAuthStore.setState({
      profile: { id: USER_ID, couple_id: COUPLE_ID, role: "bride" } as never,
    });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/chat/messages") return mockIngest(init);
      if (String(input) === "/api/chat") return mockProvider(init);
      throw new Error("Unexpected network destination in test");
    });
  });

  afterEach(() => {
    useChatStore.getState().reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("unlocks a stalled ingest after 30 seconds and preserves its request id as unknown", async () => {
    const stalled = deferred<Response>();
    mockIngest.mockReturnValue(stalled.promise);
    let outcome: ChatSendOutcome | undefined;
    const send = useChatStore.getState().sendMessage(sendParams()).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(useChatStore.getState().isSending).toBe(false);
    expect(outcome).toEqual({ userMessage: "persistence_unknown", clientRequestId: REQUEST_ID });
    expect(useChatStore.getState().error).toContain("확인할 수 없어요");
    expect(mockProvider).not.toHaveBeenCalled();
    expect(mockIngest.mock.calls[0][0]?.signal?.aborted).toBe(true);
    await send;
  });

  it("includes a stalled response body in the original 30 second deadline", async () => {
    const headers = deferred<Response>();
    const body = deferred<unknown>();
    mockIngest.mockReturnValue(headers.promise);
    let outcome: ChatSendOutcome | undefined;
    const send = useChatStore.getState().sendMessage(sendParams()).then((result) => { outcome = result; });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(outcome).toBeUndefined();
    headers.resolve(Object.assign(new Response(null, { status: 201 }), { json: () => body.promise }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(useChatStore.getState().isSending).toBe(false);
    expect(outcome).toEqual({ userMessage: "persistence_unknown", clientRequestId: REQUEST_ID });
    expect(mockProvider).not.toHaveBeenCalled();
    expect(mockIngest.mock.calls[0][0]?.signal?.aborted).toBe(true);
    await send;
  });

  it("accepts canonical reconciliation on the same request without repeating the provider phase", async () => {
    mockIngest.mockReturnValueOnce(deferred<Response>().promise);
    const first = useChatStore.getState().sendMessage(sendParams());
    await vi.advanceTimersByTimeAsync(30_000);
    const uncertain = await first;
    expect(uncertain).toEqual({ userMessage: "persistence_unknown", clientRequestId: REQUEST_ID });
    expect(mockProvider).not.toHaveBeenCalled();
    if (uncertain.userMessage !== "persistence_unknown") throw new Error("Expected same-request retry");

    mockIngest.mockResolvedValueOnce(new Response(JSON.stringify(canonicalPayload())));
    mockProvider.mockResolvedValueOnce(providerResponse());
    const retried = await useChatStore.getState().sendMessage({
      ...sendParams(), clientRequestId: uncertain.clientRequestId,
    });

    expect(retried).toEqual({ userMessage: "persisted", userMessageId: canonicalPayload().message.id });
    const bodies = mockIngest.mock.calls.map(([init]) => JSON.parse(String(init?.body)));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(mockProvider).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().messages.filter((message) => message.sender_role === "bride")).toHaveLength(1);
    expect(useChatStore.getState().failedRequest).toBeNull();
    expect(useChatStore.getState().isSending).toBe(false);
  });

  it.each(["headers", "body"])("ignores late %s from an expired attempt while the same-request reconciliation is pending", async (stage) => {
    const oldHeaders = deferred<Response>();
    const oldBody = deferred<unknown>();
    const retryHeaders = deferred<Response>();
    mockIngest.mockReturnValueOnce(stage === "headers"
      ? oldHeaders.promise
      : Promise.resolve(Object.assign(new Response(null, { status: 201 }), { json: () => oldBody.promise })));
    const first = useChatStore.getState().sendMessage(sendParams());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await first).toEqual({ userMessage: "persistence_unknown", clientRequestId: REQUEST_ID });
    mockIngest.mockReturnValueOnce(retryHeaders.promise);
    const retry = useChatStore.getState().sendMessage(sendParams());
    await vi.advanceTimersByTimeAsync(0);

    oldHeaders.resolve(new Response(JSON.stringify(canonicalPayload())));
    oldBody.resolve(canonicalPayload());
    await vi.advanceTimersByTimeAsync(0);
    expect(useChatStore.getState().isSending).toBe(true);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().error).toBeNull();
    expect(mockProvider).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(await retry).toEqual({ userMessage: "persistence_unknown", clientRequestId: REQUEST_ID });
    expect(useChatStore.getState().isSending).toBe(false);
    expect(mockProvider).not.toHaveBeenCalled();
  });

  it.each(["headers", "body"])("fences late %s after an account reset without clearing the new sender's busy state", async (stage) => {
    const oldHeaders = deferred<Response>();
    const oldBody = deferred<unknown>();
    mockIngest.mockReturnValueOnce(stage === "headers"
      ? oldHeaders.promise
      : Promise.resolve(Object.assign(new Response(null, { status: 201 }), { json: () => oldBody.promise })));
    const oldSend = useChatStore.getState().sendMessage(sendParams());
    await vi.advanceTimersByTimeAsync(0);
    const previousSignal = mockIngest.mock.calls[0][0]?.signal;
    useChatStore.getState().reset();
    const nextUser = "10000000-0000-4000-8000-000000000002";
    useAuthStore.setState({ profile: { id: nextUser, couple_id: COUPLE_ID, role: "groom" } as never });
    mockIngest.mockReturnValueOnce(deferred<Response>().promise);
    const nextSend = useChatStore.getState().sendMessage({
      ...sendParams(), senderId: nextUser, senderRole: "groom", clientRequestId: "30000000-0000-4000-8000-000000000002",
    });
    oldHeaders.resolve(new Response(JSON.stringify(canonicalPayload())));
    oldBody.resolve(canonicalPayload());
    await vi.advanceTimersByTimeAsync(0);

    expect(await oldSend).toEqual({ userMessage: "not_persisted", reason: "unexpected" });
    expect(previousSignal?.aborted).toBe(true);
    expect(useChatStore.getState().isSending).toBe(true);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().error).toBeNull();
    expect(mockProvider).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await nextSend).toEqual({ userMessage: "persistence_unknown", clientRequestId: "30000000-0000-4000-8000-000000000002" });
  });
});
