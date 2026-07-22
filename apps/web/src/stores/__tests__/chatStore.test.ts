import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../chatStore";
import type { WeddingContext } from "@/types/chat.types";
import { useAuthStore } from "../authStore";

const mockFetch = vi.fn();
const mockInsertSingle = vi.fn();

const mockSupabase = {
  from: vi.fn(() => ({
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: mockInsertSingle,
      })),
    })),
  })),
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockSupabase,
}));

vi.mock("@/lib/analytics", () => ({
  captureEvent: vi.fn(),
}));

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
