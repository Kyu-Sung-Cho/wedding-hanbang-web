import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithOAuth: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("framer-motion", () => ({ motion: { div: "div" } }));
vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));
vi.mock("@/components/auth/TurnstileWidget", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));

import LoginPage from "./page";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("login return journey", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: { signInWithOAuth: mocks.signInWithOAuth },
    });
    mocks.fetch.mockResolvedValue(new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", mocks.fetch);
    window.history.replaceState({}, "", "/login?redirect=%2Fprice%2Fwishlist");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("sends the requested internal destination through the OAuth callback", async () => {
    await act(async () => root.render(<LoginPage />));
    const googleButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Google"));
    expect(googleButton).toBeDefined();

    await act(async () => {
      googleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/api/auth/callback?redirect=%2Fprice%2Fwishlist",
      },
    });
  });

  it("drops an external destination before starting OAuth", async () => {
    window.history.replaceState(
      {},
      "",
      "/login?redirect=https%3A%2F%2Fattacker.example%2Fsteal",
    );
    await act(async () => root.render(<LoginPage />));
    const googleButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Google"));

    await act(async () => {
      googleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/api/auth/callback" },
    });
  });

  it("does not render arbitrary callback or fragment error text", async () => {
    const privateMarker = "private-provider-detail-bride@example.com";
    window.history.replaceState(
      {},
      "",
      `/login?error=${encodeURIComponent(privateMarker)}#error_description=${encodeURIComponent(privateMarker)}`,
    );

    await act(async () => root.render(<LoginPage />));

    expect(container.textContent).not.toContain(privateMarker);
    expect(container.textContent).toContain("로그인에 실패했습니다.");
  });

  it("gives every password visibility control an accessible name", async () => {
    await act(async () => root.render(<LoginPage />));

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

  it("requires both policy checkboxes and sends exact consent booleans in email signup", async () => {
    window.history.replaceState({}, "", "/login?mode=signup");
    await act(async () => root.render(<LoginPage />));

    const form = container.querySelector("form");
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    const checkboxes = [...(form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])];
    expect(checkboxes).toHaveLength(2);
    expect(container.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();

    const name = form?.querySelector<HTMLInputElement>('input[placeholder="이름 *"]');
    const email = form?.querySelector<HTMLInputElement>('input[type="email"]');
    const password = form?.querySelector<HTMLInputElement>('input[placeholder="비밀번호 *"]');
    const passwordConfirm = form?.querySelector<HTMLInputElement>('input[placeholder="비밀번호 확인 *"]');
    expect(name && email && password && passwordConfirm && submit).toBeTruthy();

    await act(async () => {
      setInputValue(name!, "Sample User");
      setInputValue(email!, "sample@example.test");
      setInputValue(password!, "Strong1!");
      setInputValue(passwordConfirm!, "Strong1!");
    });
    expect(submit?.disabled).toBe(true);

    await act(async () => {
      checkboxes[0]?.click();
      checkboxes[1]?.click();
    });
    expect(submit?.disabled).toBe(false);

    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/auth/signup",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const requestInit = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      email: "sample@example.test",
      password: "Strong1!",
      name: "Sample User",
      turnstileToken: "",
      termsAgreed: true,
      privacyAgreed: true,
      termsVersion: "2026-08-02",
      privacyVersion: "2026-08-02",
    });
  });
});
