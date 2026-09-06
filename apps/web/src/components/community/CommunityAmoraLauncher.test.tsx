// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), pathname: "/wedding" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ initialize: mocks.initialize }) }));
vi.mock("@/lib/previewStub", () => ({ isPreviewStubMode: () => false }));
vi.mock("next/dynamic", () => ({
  default: () => function Panel({ isOpen, onClose }: { isOpen: boolean; onClose(): void }) {
    return isOpen ? <section role="dialog" aria-label="아모라 AI 상담 패널"><button onClick={onClose}>상담 닫기</button></section> : null;
  },
}));

import CommunityAmoraLauncher from "./CommunityAmoraLauncher";

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

describe("커뮤니티 상담 진입의 키보드 복귀", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn());
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.pathname = "/wedding";
    document.cookie = "demo_mode=; Max-Age=0; path=/";
    document.body.style.overflow = "auto";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
    environment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it.each(["Escape", "계속 둘러보기"])("인증 조회 중 버튼이 초점을 잃어도 %s로 안내를 닫으면 돌아온다", async (closeWith) => {
    let resolveAuth!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { resolveAuth = resolve; }));
    await act(async () => root.render(<CommunityAmoraLauncher />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')!;
    trigger.focus();
    await act(async () => trigger.click());
    expect(trigger.disabled).toBe(true);
    // Chrome은 활성 버튼이 disabled가 되면 초점을 잃는다. jsdom에서도 그 상태로 검증한다.
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
    expect(document.activeElement).toBe(document.body);
    await act(async () => resolveAuth(new Response(JSON.stringify({ user: null }), { status: 401 })));
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("로그인 후 이용할 수 있어요");
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => {
      if (closeWith === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === closeWith)!.click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
    expect(document.activeElement).toBe(trigger);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/auth/me?guest_probe=1", expect.objectContaining({ cache: "no-store", credentials: "include" }));
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("상담 패널을 닫으면 새로 나타난 진입 버튼에 초점을 돌려준다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "synthetic-user" } }), { status: 200 }));
    await act(async () => root.render(<CommunityAmoraLauncher />));
    const originalTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')!;
    originalTrigger.focus();
    await act(async () => originalTrigger.click());
    expect(originalTrigger.isConnected).toBe(false);
    const close = container.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
    close.focus();
    await act(async () => close.click());
    const restoredTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')!;
    expect(document.activeElement).toBe(restoredTrigger);
    expect(mocks.initialize).toHaveBeenCalledExactlyOnceWith({ force: true });
  });

  it.each(["network", "server"])("%s 확인 실패는 로그인으로 단정하지 않고 같은 버튼으로 재시도할 수 있다", async (failure) => {
    if (failure === "network") vi.mocked(fetch).mockRejectedValueOnce(new TypeError("synthetic network failure"));
    else vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "private backend detail" }), { status: 500 }));
    await act(async () => root.render(<CommunityAmoraLauncher />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')!;
    await act(async () => trigger.click());
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("연결을 확인하지 못했어요");
    expect(alert?.textContent).not.toContain("private backend detail");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.disabled).toBe(false);
    expect(mocks.initialize).not.toHaveBeenCalled();

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ user: null }), { status: 401 }));
    await act(async () => trigger.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("로그인 후 이용할 수 있어요");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["auth", "initialize"])("%s 응답 전에 작성 화면으로 이동하면 돌아와도 상담창이 다시 열리지 않는다", async (pendingStage) => {
    let resolveAuth!: (response: Response) => void;
    let resolveInitialize!: () => void;
    const signedIn = () => new Response(JSON.stringify({ user: { id: "synthetic-user" } }), { status: 200 });
    if (pendingStage === "auth") vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { resolveAuth = resolve; }));
    else {
      vi.mocked(fetch).mockResolvedValueOnce(signedIn());
      mocks.initialize.mockReturnValueOnce(new Promise<void>(resolve => { resolveInitialize = resolve; }));
    }
    await act(async () => root.render(<CommunityAmoraLauncher />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')!.click());
    mocks.pathname = "/wedding/community/post/write";
    await act(async () => root.render(<CommunityAmoraLauncher />));
    expect(container.childElementCount).toBe(0);
    await act(async () => {
      if (pendingStage === "auth") resolveAuth(signedIn());
      else resolveInitialize();
    });
    mocks.pathname = "/wedding";
    await act(async () => root.render(<CommunityAmoraLauncher />));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')?.disabled).toBe(false);
    if (pendingStage === "auth") expect(mocks.initialize).not.toHaveBeenCalled();
  });
});
