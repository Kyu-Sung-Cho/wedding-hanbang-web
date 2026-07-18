import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("framer-motion", () => ({ motion: { div: "div" } }));
vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));
vi.mock("@/components/auth/TurnstileWidget", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));

import LoginPage from "./page";

describe("login return journey", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: { signInWithOAuth: mocks.signInWithOAuth },
    });
    window.history.replaceState({}, "", "/login?redirect=%2Fprice%2Fwishlist");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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
});
