import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../authStore";
import { useChatStore } from "../chatStore";
import {
  bindChatComposerSession,
  createEmptyComposerDrafts,
  isChatComposerLeaseCurrent,
  resetChatComposerSession,
  updateChatComposerDrafts,
  useChatComposerStore,
} from "../chatComposerStore";
import type { Profile } from "@/types/database.types";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const NOW = "2026-09-19T00:00:00.000Z";
const mockDelete = vi.fn<(init?: RequestInit) => Promise<Response>>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function profile(id = "actor-a"): Profile {
  return {
    id, couple_id: COUPLE_ID, role: "bride", name: id, avatar_url: null,
    onboarding_completed: true, onboarding_step: 5, is_admin: false,
    created_at: NOW, updated_at: NOW,
  };
}

function bindCurrent() {
  const { profile: current, couple, isDemo } = useAuthStore.getState();
  return bindChatComposerSession(JSON.stringify([current?.id ?? null, couple?.id ?? null, current?.role ?? null, isDemo]));
}

function populate(privateRetry = true) {
  const lease = bindCurrent();
  updateChatComposerDrafts(lease, (drafts) => ({
    ...drafts,
    private_ai: {
      ...drafts.private_ai, input: "개인 초안", retryClientRequestId: privateRetry ? REQUEST_ID : null,
      safetyRecovery: { input: "개인 안전 복구", clientRequestId: REQUEST_ID },
    },
    shared_ai: { ...drafts.shared_ai, input: "공유 초안", retryClientRequestId: REQUEST_ID },
    shared_partner: { ...drafts.shared_partner, input: "파트너 미전송 초안" },
  }));
  return lease;
}

describe("confirmed raw deletion forgets only matching composer recovery", () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useChatStore.getState().reset();
    resetChatComposerSession();
    localStorage.clear();
    document.cookie = "demo_mode=; Max-Age=0; path=/";
    useAuthStore.setState({ profile: profile() });
    mockDelete.mockReset();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/chat/messages" || init?.method !== "DELETE") {
        throw new Error("Unexpected network operation");
      }
      return mockDelete(init);
    });
  });

  afterEach(() => {
    useAuthStore.getState().reset();
    useChatStore.getState().reset();
    resetChatComposerSession();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("forgets deleted private retry content and safety recovery without clearing shared drafts", async () => {
    const lease = populate();
    const before = useChatComposerStore.getState().drafts;
    mockDelete.mockResolvedValueOnce(new Response(JSON.stringify({ clearedAt: NOW })));
    await useChatStore.getState().clearMessages(COUPLE_ID, "delete_private");

    const drafts = useChatComposerStore.getState().drafts;
    expect(drafts.private_ai).toEqual(createEmptyComposerDrafts().private_ai);
    expect(drafts.shared_ai).toEqual(before.shared_ai);
    expect(drafts.shared_partner).toEqual(before.shared_partner);
    expect(isChatComposerLeaseCurrent(lease)).toBe(false);
  });

  it("retains an ordinary private draft but discards its separate safety recovery", async () => {
    populate(false);
    mockDelete.mockResolvedValueOnce(new Response(JSON.stringify({ clearedAt: NOW })));
    await useChatStore.getState().clearMessages(COUPLE_ID, "delete_private");
    expect(useChatComposerStore.getState().drafts.private_ai).toEqual({
      ...createEmptyComposerDrafts().private_ai, input: "개인 초안",
    });
  });

  it("forgets shared retry content but retains the ordinary partner and private drafts", async () => {
    populate();
    const before = useChatComposerStore.getState().drafts;
    mockDelete.mockResolvedValueOnce(new Response(JSON.stringify({ clearedAt: NOW })));
    await useChatStore.getState().clearMessages(COUPLE_ID, "delete_shared");
    const drafts = useChatComposerStore.getState().drafts;
    expect(drafts.shared_ai).toEqual(createEmptyComposerDrafts().shared_ai);
    expect(drafts.shared_partner).toEqual(before.shared_partner);
    expect(drafts.private_ai).toEqual(before.private_ai);
  });

  it.each(["view_reset_private", "view_reset_shared"] as const)("retains drafts and retry keys for %s", async (mode) => {
    const lease = populate();
    const before = useChatComposerStore.getState().drafts;
    mockDelete.mockResolvedValueOnce(new Response(JSON.stringify({ clearedAt: NOW })));
    await useChatStore.getState().clearMessages(COUPLE_ID, mode);
    expect(useChatComposerStore.getState().drafts).toBe(before);
    expect(isChatComposerLeaseCurrent(lease)).toBe(true);
  });

  it.each([401, 500])("does not discard recovery after HTTP %s", async (status) => {
    const lease = populate();
    const before = useChatComposerStore.getState().drafts;
    mockDelete.mockResolvedValueOnce(new Response(JSON.stringify({ error: "삭제 실패" }), { status }));
    await expect(useChatStore.getState().clearMessages(COUPLE_ID, "delete_private")).rejects.toThrow("삭제 실패");
    expect(useChatComposerStore.getState().drafts).toBe(before);
    expect(isChatComposerLeaseCurrent(lease)).toBe(true);
  });

  it.each([{}, { clearedAt: "invalid" }])("does not discard recovery without a valid server deletion cursor: %j", async (payload) => {
    const lease = populate();
    const before = useChatComposerStore.getState().drafts;
    mockDelete.mockResolvedValueOnce(new Response(JSON.stringify(payload)));
    await useChatStore.getState().clearMessages(COUPLE_ID, "delete_private");
    expect(useChatComposerStore.getState().drafts).toBe(before);
    expect(isChatComposerLeaseCurrent(lease)).toBe(true);
  });

  it("ignores an old owner's successful deletion after A to B to A", async () => {
    populate();
    const ack = deferred<Response>();
    mockDelete.mockReturnValueOnce(ack.promise);
    const deletion = useChatStore.getState().clearMessages(COUPLE_ID, "delete_private");
    useAuthStore.setState({ profile: profile("actor-b") });
    useAuthStore.setState({ profile: profile() });
    const lease = populate();
    const before = useChatComposerStore.getState().drafts;
    ack.resolve(new Response(JSON.stringify({ clearedAt: NOW })));
    await deletion;
    expect(useChatComposerStore.getState().drafts).toBe(before);
    expect(isChatComposerLeaseCurrent(lease)).toBe(true);
  });

  it("does not discard newer recovery when deletion acknowledgments arrive out of order", async () => {
    populate();
    const older = deferred<Response>();
    const newer = deferred<Response>();
    mockDelete.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = useChatStore.getState().clearMessages(COUPLE_ID, "delete_private");
    const second = useChatStore.getState().clearMessages(COUPLE_ID, "delete_private");
    newer.resolve(new Response(JSON.stringify({ clearedAt: "2026-09-19T00:02:00.000Z" })));
    await second;
    expect(useChatComposerStore.getState().drafts.private_ai).toEqual(createEmptyComposerDrafts().private_ai);
    const lease = populate();
    const before = useChatComposerStore.getState().drafts;
    older.resolve(new Response(JSON.stringify({ clearedAt: NOW })));
    await first;
    expect(useChatComposerStore.getState().drafts).toBe(before);
    expect(isChatComposerLeaseCurrent(lease)).toBe(true);
  });

  it("does not let an old acknowledgement borrow a newer cursor from another tab to clear recovery", async () => {
    const ack = deferred<Response>();
    mockDelete.mockReturnValueOnce(ack.promise);
    const deletion = useChatStore.getState().clearMessages(COUPLE_ID, "delete_private");
    localStorage.setItem(`hanbang.chatClearedAt.actor-a.${COUPLE_ID}.private`, "2026-09-19T00:02:00.000Z");
    const lease = populate();
    const before = useChatComposerStore.getState().drafts;
    ack.resolve(new Response(JSON.stringify({ clearedAt: NOW })));
    await deletion;
    expect(useChatComposerStore.getState().drafts).toBe(before);
    expect(isChatComposerLeaseCurrent(lease)).toBe(true);
  });
});
