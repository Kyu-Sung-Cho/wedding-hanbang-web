import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../chatStore";
import type { WeddingContext } from "@/types/chat.types";

const mockFetch = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/analytics", () => ({
  captureEvent: vi.fn(),
}));

describe("useChatStore quota warning", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    mockFetch.mockReset();
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
