import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthSessionSync } from "./useAuthSessionSync";
import { communityPostDraftKey } from "@/lib/community/viewerPrivacyCache";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useCommunityStore } from "@/stores/communityStore";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: vi.fn(),
    },
  }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useAuthSessionSync();
  return null;
}

// 탭으로 돌아오는 순간 서버가 한 번 못 답해도(쓰기 차단 창의 503 등) 쓰던 화면은 그대로여야 한다.
describe("포커스로 인증을 다시 확인할 때 서버가 5xx 를 줘도 로그인한 화면을 비우지 않는다", () => {
  const draftKey = communityPostDraftKey("u1");
  let host: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    useAuthStore.getState().reset();
    useChatStore.getState().reset();
    useCommunityStore.getState().reset();

    useAuthStore.setState({
      user: { id: "u1", email: "test@example.com" },
      profile: { id: "u1", name: "테스터", couple_id: "c1", role: "bride" } as never,
      couple: { id: "c1" } as never,
      journey: { id: "j1", couple_id: "c1" } as never,
      isInitialized: true,
      isLoading: false,
      isDemo: false,
    });
    useChatStore.setState({ messages: [{ id: "m1" } as never], initialLoadDone: true });
    useCommunityStore.getState().bindViewer("u1");
    localStorage.setItem(draftKey, "draft");

    fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function expectScreenKept() {
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me");
    expect(useAuthStore.getState().user?.id).toBe("u1");
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().initialLoadDone).toBe(true);
    expect(useCommunityStore.getState().viewerId).toBe("u1");
    expect(localStorage.getItem(draftKey)).toBe("draft");
  }

  it("focus", async () => {
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expectScreenKept();
  });

  it("visibilitychange", async () => {
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expectScreenKept();
  });

  it("진짜 401 이면 예전처럼 비운다", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(localStorage.getItem(draftKey)).toBeNull();
  });
});
