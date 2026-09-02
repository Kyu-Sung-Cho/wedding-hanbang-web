import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 콜드 로드가 느린 이유의 절반은 여기 있었다.
//
// 앱 셸이 `/api/auth/me` 를 이미 보낸 직후, supabase-js 가 저장된 세션으로
// INITIAL_SESSION 을 쏜다. 그 순간 스토어는 아직 비어 있어 "로그인 상태가 새로
// 생겼다"로 보이고, 이 훅이 같은 요청을 하나 더 얹었다. 화면이 열리기까지
// `/api/auth/me` 가 두 번 나갔고, `initialize` 는 순번을 올려 **먼저 나간 요청의
// 결과를 버리므로** 늦게 시작한 쪽을 처음부터 다시 기다렸다.
//
// 포커스·가시성 갱신도 같은 일을 한다. 느린 로딩을 보다 탭을 옮겼다 돌아오면
// 거의 끝나가던 요청이 버려지고 기다림이 리셋됐다 — "가끔 영영 안 끝난다"의 정체다.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type AuthChangeHandler = (
  event: string,
  session: { user: { id: string } } | null,
) => void;

const mocks = vi.hoisted(() => ({
  handlers: [] as AuthChangeHandler[],
  initialize: vi.fn(),
  authState: {
    user: null as { id: string } | null,
    isInitialized: false,
    isLoading: false,
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (handler: AuthChangeHandler) => {
        mocks.handlers.push(handler);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: {
    getState: () => ({
      ...mocks.authState,
      initialize: mocks.initialize,
      reset: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/chatStore", () => ({
  useChatStore: { getState: () => ({ reset: vi.fn() }) },
}));

vi.mock("@/stores/communityStore", () => ({
  useCommunityStore: { getState: () => ({ reset: vi.fn(), bindViewer: vi.fn() }) },
}));

import { useAuthSessionSync } from "../useAuthSessionSync";

function Probe() {
  useAuthSessionSync(true);
  return null;
}

describe("useAuthSessionSync", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    mocks.handlers.length = 0;
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.authState = { user: null, isInitialized: false, isLoading: false };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function mount() {
    await act(async () => {
      root.render(<Probe />);
    });
  }

  async function emitSession(userId: string | null) {
    await act(async () => {
      for (const handler of mocks.handlers) {
        handler("INITIAL_SESSION", userId ? { user: { id: userId } } : null);
      }
    });
  }

  it("첫 조회가 도는 중이면 같은 질문을 한 번 더 보내지 않는다", async () => {
    // 앱 셸이 보낸 그 요청이 곧 같은 세션을 들고 온다 — 서버는 방금 그 쿠키로
    // 이 페이지를 내보냈다.
    mocks.authState = { user: null, isInitialized: false, isLoading: true };
    await mount();

    await emitSession("user-1");

    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("첫 조회가 끝난 뒤 로그인하면 그때는 다시 물어본다", async () => {
    // 로그인 직후처럼 초기화가 이미 끝난 뒤 세션이 생기는 경우는 막으면 안 된다.
    mocks.authState = { user: null, isInitialized: true, isLoading: false };
    await mount();

    await emitSession("user-1");

    expect(mocks.initialize).toHaveBeenCalledWith({ force: true });
  });

  it("로딩 중에 탭을 옮겼다 돌아와도 기다림을 처음부터 되돌리지 않는다", async () => {
    mocks.authState = { user: null, isInitialized: false, isLoading: true };
    await mount();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("화면이 열린 뒤의 포커스 갱신은 그대로 동작한다", async () => {
    mocks.authState = { user: { id: "user-1" }, isInitialized: true, isLoading: false };
    await mount();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(mocks.initialize).toHaveBeenCalledWith({ force: true });
  });
});
