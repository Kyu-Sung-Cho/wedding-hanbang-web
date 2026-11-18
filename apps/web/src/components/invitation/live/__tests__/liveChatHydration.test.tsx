import { act, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberDemoAmoraPrefill } from "@/lib/chat/demoHandoff";

import LiveChat from "../LiveChat";
import { clearWide, flush, mockApi } from "./liveTestKit";

/**
 * `/chat` 첫 그림은 서버 그림과 같아야 한다(2026-11-17 리드 지시: 하이드레이션 어긋남). 브라우저 저장소에만 있는
 * 인계(체험 초안·개인 할 일 이어가기)는 화면이 붙은 뒤에 읽는다. 첫 그림에서 읽으면 서버는 대화 칸을, 브라우저는
 * 전체 화면 대화를 그려 어긋난다.
 */

const mocks = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mocks.params,
  usePathname: () => "/wedding/chat",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/stores/authStore", () => {
  const state = {
    isDemo: false,
    user: { id: "user-1", email: "user@example.test" },
    profile: { id: "user-1", name: "민지", onboarding_completed: true },
    partner: null,
    journey: null,
  };
  return { useAuthStore: (selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state) };
});

vi.mock("@/stores/chatStore", () => ({
  useChatStore: (selector: (state: { isStreaming: boolean }) => unknown) => selector({ isStreaming: false }),
}));

vi.mock("@/components/app/chat/ChatSidePanel", () => ({
  default: ({ presentation }: { presentation?: string }) => <div data-chat-panel={presentation ?? "overlay"} />,
}));

vi.mock("@/components/app/chat/ChatContent", () => ({ default: () => <div data-full-chat /> }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.params = new URLSearchParams();
  window.sessionStorage.clear();
  clearWide();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

async function hydrate(html: string) {
  container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const recoverable: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container as HTMLDivElement, <LiveChat />, {
      onRecoverableError: (error) => recoverable.push(error),
    });
  });
  await flush();
  return { container: container as HTMLDivElement, recoverable };
}

describe("/chat 첫 그림과 저장소의 인계", () => {
  it("체험 초안이 저장소에 있어도 첫 그림은 저장소를 읽지 않는다. 어긋남 없이 붙은 뒤 전체 화면 대화로 옮긴다", async () => {
    rememberDemoAmoraPrefill(window.sessionStorage, "예산을 같이 봐줘");
    mockApi({});

    const html = renderToString(<LiveChat />);
    expect(html).toContain('data-invitation-screen="live-loading"');
    expect(html).not.toContain("data-full-chat");
    expect(html).not.toContain("data-chat-panel");

    const { container: hydrated, recoverable } = await hydrate(html);
    expect(recoverable).toEqual([]);
    expect(hydrated.querySelector("[data-full-chat]")).not.toBeNull();
    // 대화 칸을 잠깐이라도 달지 않는다(달았다가 바꾸면 첫 인사·보관한 첫마디를 대화 칸이 먼저 가져간다).
    expect(hydrated.querySelector("[data-chat-panel]")).toBeNull();
  });

  it("저장소에 인계가 없으면 붙은 뒤 청첩장 대화 칸을 한 번만 단다", async () => {
    mockApi({});
    const html = renderToString(<LiveChat />);
    const { container: hydrated, recoverable } = await hydrate(html);
    expect(recoverable).toEqual([]);
    expect(hydrated.querySelectorAll('[data-chat-panel="invitation"]')).toHaveLength(1);
    expect(hydrated.querySelector("[data-full-chat]")).toBeNull();
  });

  it("주소의 인계는 서버와 브라우저가 같은 답을 내므로 첫 그림부터 전체 화면 대화다", async () => {
    mocks.params = new URLSearchParams("prefill=%EC%98%88%EC%82%B0");
    mockApi({});
    const html = renderToString(<LiveChat />);
    expect(html).toContain("data-full-chat");
    const { recoverable } = await hydrate(html);
    expect(recoverable).toEqual([]);
  });
});
