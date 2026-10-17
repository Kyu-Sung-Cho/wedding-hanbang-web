// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";

const mocks = vi.hoisted(() => ({ pathname: "/wedding/lounge" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ profile: { name: "김지은", avatar_url: null }, journey: null, signOut: vi.fn() }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Tailwind `md`(48rem). 이 아래에서만 사이드바가 서랍(모달)이다.
const DESKTOP_QUERY = "(min-width: 48rem)";

/** 화면 폭 판정을 직접 쥐는 matchMedia. jsdom 에는 원래 없다. */
function stubDesktop(initial: boolean) {
  const state = { matches: initial, queries: [] as string[], listeners: new Set<() => void>() };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      state.queries.push(query);
      return {
        media: query,
        get matches() {
          return state.matches;
        },
        addEventListener: (_type: string, listener: () => void) => {
          state.listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: () => void) => {
          state.listeners.delete(listener);
        },
      };
    },
  });
  return {
    state,
    setDesktop(next: boolean) {
      state.matches = next;
      for (const listener of [...state.listeners]) listener();
    },
  };
}

function Harness({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <>
      <button type="button" id="opener">메뉴 열기</button>
      <Sidebar isOpen={isOpen} onClose={onClose} />
    </>
  );
}

describe("사이드바 서랍의 키보드·화면 낭독기 처리", () => {
  let container: HTMLDivElement;
  let root: Root;
  const close = vi.fn();

  beforeEach(() => {
    close.mockReset();
    mocks.pathname = "/wedding/lounge";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(window, "matchMedia");
    document.body.style.overflow = "";
  });

  async function show(isOpen: boolean) {
    await act(async () => root.render(<Harness isOpen={isOpen} onClose={close} />));
  }
  async function press(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    await act(async () => {
      document.dispatchEvent(event);
    });
    return event;
  }
  const opener = () => container.querySelector<HTMLButtonElement>("#opener")!;
  const aside = () => container.querySelector("aside")!;
  const closeButton = () => container.querySelector<HTMLButtonElement>("[data-sidebar-close]")!;

  /** 폰 폭에서 열기 버튼에 포커스가 있던 채로 서랍을 연다. */
  async function openOnPhone() {
    const media = stubDesktop(false);
    await show(false);
    opener().focus();
    await show(true);
    return media;
  }

  it("폰 폭에서 열면 서랍은 대화상자로 알려지고, 닫기 버튼이 포커스를 받고, 뒷배경은 가려진다", async () => {
    await openOnPhone();
    expect(aside().getAttribute("role")).toBe("dialog");
    expect(aside().getAttribute("aria-modal")).toBe("true");
    expect(aside().getAttribute("aria-label")).toBe("메뉴");
    expect(document.activeElement).toBe(closeButton());
    expect(closeButton().getAttribute("aria-label")).toBe("메뉴 닫기");
    expect(document.body.style.overflow).toBe("hidden");
    expect(container.querySelector(".inset-0")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("폰 폭에서 Escape 는 서랍을 닫는다", async () => {
    await openOnPhone();
    const event = await press("Escape");
    expect(close).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("닫으면 대화상자 표시와 스크롤 잠금이 풀리고 포커스가 열기 버튼으로 돌아간다", async () => {
    await openOnPhone();
    await show(false);
    expect(aside().hasAttribute("role")).toBe(false);
    expect(aside().hasAttribute("aria-modal")).toBe(false);
    expect(aside().hasAttribute("aria-label")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener());
  });

  it("폰 폭에서 Tab 은 서랍 안에서만 돈다", async () => {
    await openOnPhone();
    const focusable = [...aside().querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    expect(first.getAttribute("aria-label")).toBe("웨딩한방 홈으로 이동");
    expect(last.textContent).toBe("로그아웃");

    last.focus();
    const forward = await press("Tab");
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = await press("Tab", { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("넓은 화면에 열린 상태가 남아도 고정 열 그대로다: 대화상자 아님, 스크롤 안 잠김, Escape 무시, 포커스 그대로", async () => {
    stubDesktop(true);
    await show(false);
    opener().focus();
    await show(true);
    expect(aside().hasAttribute("role")).toBe(false);
    expect(aside().hasAttribute("aria-modal")).toBe(false);
    expect(aside().hasAttribute("aria-label")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener());
    await press("Escape");
    expect(close).not.toHaveBeenCalled();
  });

  it("화면 폭 판정을 모르는 환경은 데스크톱으로 본다", async () => {
    expect(typeof window.matchMedia).toBe("undefined");
    await show(false);
    opener().focus();
    await show(true);
    expect(aside().hasAttribute("role")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener());
    await press("Escape");
    expect(close).not.toHaveBeenCalled();
  });

  it("Tailwind md 경계(48rem)로만 판정한다", async () => {
    const media = await openOnPhone();
    expect([...new Set(media.state.queries)]).toEqual([DESKTOP_QUERY]);
  });

  it("폰에서 연 채 창을 넓히면 모달이 풀리고, 다시 좁히면 돌아온다", async () => {
    const media = await openOnPhone();
    expect(aside().getAttribute("role")).toBe("dialog");

    await act(async () => media.setDesktop(true));
    expect(aside().hasAttribute("role")).toBe(false);
    expect(aside().hasAttribute("aria-modal")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    await press("Escape");
    expect(close).not.toHaveBeenCalled();

    await act(async () => media.setDesktop(false));
    expect(aside().getAttribute("role")).toBe("dialog");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("그리기를 마치면 화면 폭 변화 구독을 끊는다", async () => {
    const media = stubDesktop(false);
    const own = document.createElement("div");
    document.body.appendChild(own);
    const ownRoot = createRoot(own);
    await act(async () => ownRoot.render(<Sidebar isOpen={false} onClose={close} />));
    expect(media.state.listeners.size).toBe(1);
    await act(async () => ownRoot.unmount());
    own.remove();
    expect(media.state.listeners.size).toBe(0);
  });

  it("열려 있는 동안 경로가 바뀌면(뒤로가기 등) 닫는다. 처음 그릴 때와 닫혀 있을 때는 부르지 않는다", async () => {
    mocks.pathname = "/wedding/lounge";
    await show(true);
    expect(close).not.toHaveBeenCalled();

    mocks.pathname = "/wedding/chat";
    await show(true);
    expect(close).toHaveBeenCalledTimes(1);

    close.mockClear();
    await show(false);
    mocks.pathname = "/wedding/budget";
    await show(false);
    expect(close).not.toHaveBeenCalled();
  });
});
