import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithOAuth: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("framer-motion", () => ({ motion: { div: "div" } }));
vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
// 가입·비밀번호 찾기는 Turnstile 위젯이 있는 /login으로 넘긴다(라우터 필요).
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import DemoLoginPage from "./page";

/**
 * React 제어 입력은 `.value` 직접 대입으로는 onChange가 뜨지 않는다
 * (React가 값을 내부에서 추적한다). 네이티브 setter로 넣고 input 이벤트를 쏜다.
 */
function setNativeValue(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function setControlledValue(root: HTMLElement, selector: string, value: string): void {
  const field = root.querySelector<HTMLInputElement>(selector);
  if (!field) throw new Error(`입력을 찾지 못했다: ${selector}`);
  setNativeValue(field, value);
}

describe("demo login accessibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    push.mockReset();
    mocks.signInWithOAuth.mockReset().mockResolvedValue({ error: null });
    mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null });
    mocks.createClient.mockReset().mockReturnValue({
      auth: {
        signInWithOAuth: mocks.signInWithOAuth,
        signInWithPassword: mocks.signInWithPassword,
      },
    });
    window.history.replaceState({}, "", "/demo/login");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("gives every password visibility control an accessible name", async () => {
    await act(async () => root.render(<DemoLoginPage />));

    expect(
      container.querySelector('button[aria-label="비밀번호 표시"]'),
    ).not.toBeNull();

    const signupButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "회원가입");
    await act(async () => {
      signupButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('button[aria-label="비밀번호 확인 표시"]'),
    ).not.toBeNull();
  });

  it("does not render a raw callback error from the URL", async () => {
    const rawCallbackError =
      "@supabase/ssr: Your project's URL and API key are required";
    window.history.replaceState(
      {},
      "",
      `/demo/login?error=${encodeURIComponent(rawCallbackError)}`,
    );

    await act(async () => root.render(<DemoLoginPage />));

    expect(container.textContent).not.toContain("@supabase/ssr");
    expect(container.textContent).not.toContain("API key");
    expect(container.textContent).toContain(
      "로그인 연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("does not render a raw OAuth error from the URL hash", async () => {
    const rawOAuthError = "provider is disabled for project abc";
    window.history.replaceState(
      {},
      "",
      `/demo/login#error_description=${encodeURIComponent(rawOAuthError)}`,
    );

    await act(async () => root.render(<DemoLoginPage />));

    expect(container.textContent).not.toContain(rawOAuthError);
    expect(container.textContent).toContain(
      "로그인 연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("does not render a raw OAuth error code from the URL hash", async () => {
    const rawOAuthError = "invalid_request_with_internal_detail";
    window.history.replaceState(
      {},
      "",
      `/demo/login#error=${encodeURIComponent(rawOAuthError)}`,
    );

    await act(async () => root.render(<DemoLoginPage />));

    expect(container.textContent).not.toContain(rawOAuthError);
    expect(container.textContent).toContain(
      "로그인 연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("does not render a raw provider error from social login", async () => {
    const rawProviderError = "Unsupported provider: provider is not enabled";
    mocks.signInWithOAuth.mockResolvedValueOnce({
      error: { message: rawProviderError },
    });
    await act(async () => root.render(<DemoLoginPage />));
    const googleButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Google"));

    await act(async () => {
      googleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain(rawProviderError);
    expect(container.textContent).toContain(
      "로그인 연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("does not render a thrown SDK error from social login", async () => {
    const rawConfigurationError =
      "@supabase/ssr: Your project's URL and API key are required";
    mocks.createClient.mockImplementationOnce(() => {
      throw new Error(rawConfigurationError);
    });
    await act(async () => root.render(<DemoLoginPage />));
    const googleButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Google"));

    await act(async () => {
      googleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("@supabase/ssr");
    expect(container.textContent).not.toContain("API key");
    expect(container.textContent).toContain(
      "로그인 연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("does not render a thrown SDK error from email login", async () => {
    const rawConfigurationError =
      "@supabase/ssr: Your project's URL and API key are required";
    mocks.createClient.mockImplementationOnce(() => {
      throw new Error(rawConfigurationError);
    });
    await act(async () => root.render(<DemoLoginPage />));
    await act(async () => {
      setControlledValue(container, 'input[type="email"]', "test@example.com");
      setControlledValue(container, 'input[type="password"]', "Strong1!");
    });

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("@supabase/ssr");
    expect(container.textContent).not.toContain("API key");
    expect(container.textContent).toContain(
      "로그인 연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("does not render an unknown provider error from email login", async () => {
    const rawProviderError = "Auth service unavailable in region ap-south-1";
    mocks.signInWithPassword.mockResolvedValueOnce({
      error: { message: rawProviderError },
    });
    await act(async () => root.render(<DemoLoginPage />));
    await act(async () => {
      setControlledValue(container, 'input[type="email"]', "test@example.com");
      setControlledValue(container, 'input[type="password"]', "Strong1!");
    });

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain(rawProviderError);
    expect(container.textContent).toContain(
      "로그인 연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  // 이 화면에는 Turnstile 위젯이 없다. 실키가 발급되면 여기서 보낸 가입·비밀번호
  // 재설정은 토큰 누락으로 영구 실패하므로, 위젯이 있는 /login으로 넘겨야 한다.
  // `6a95dd5b`이 가입만 고치고 비밀번호 찾기는 같은 상태로 남겨 뒀다.
  it.each([
    ["회원가입", "signup"],
    ["비밀번호를 잊으셨나요?", "forgot"],
  ])("'%s'은 위젯이 있는 /login으로 넘긴다", async (tabLabel, mode) => {
    await act(async () => root.render(<DemoLoginPage />));

    const tab = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === tabLabel);
    await act(async () => {
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 리다이렉트는 폼 검증을 통과한 뒤에 일어난다 — 필수 항목을 실제로 채운다.
    await act(async () => {
      setControlledValue(container, 'input[type="email"]', "someone@example.com");
      if (mode === "signup") {
        setControlledValue(container, 'input[placeholder="이름 *"]', "민이");
        const passwords = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
        for (const field of passwords) setNativeValue(field, "Abcdef1!");
      }
    });

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(push).toHaveBeenCalledWith(`/login?mode=${mode}`);
  });
});
