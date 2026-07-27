import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", () => ({ motion: { div: "div" } }));
vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import DemoLoginPage from "./page";

describe("demo login accessibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
});
