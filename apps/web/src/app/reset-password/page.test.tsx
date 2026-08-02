import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));

import ResetPasswordPage from "./page";

describe("password recovery URL privacy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: {
        signOut: mocks.signOut,
        updateUser: mocks.updateUser,
        verifyOtp: mocks.verifyOtp,
      },
    });
    window.history.replaceState(
      {},
      "",
      "/reset-password?redirect=%2Flogin#access_token=page-access-marker&refresh_token=page-refresh-marker&type=recovery",
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("scrubs implicit-flow tokens but refuses an ordinary session as recovery authority", async () => {
    await act(async () => root.render(<ResetPasswordPage />));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("복구 링크가 만료되었거나 유효하지 않습니다.");
    });
    expect(window.location.href).toBe(
      "http://localhost:3000/reset-password?redirect=%2Flogin",
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("scrubs but refuses an OAuth/PKCE code on the password recovery route", async () => {
    window.history.replaceState(
      {},
      "",
      "/reset-password?code=pkce-recovery-marker&redirect=%2Flogin",
    );

    await act(async () => root.render(<ResetPasswordPage />));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("복구 링크가 만료되었거나 유효하지 않습니다.");
    });
    expect(window.location.href).toBe(
      "http://localhost:3000/reset-password?redirect=%2Flogin",
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("clears and verifies a one-time hashed recovery token", async () => {
    window.history.replaceState(
      {},
      "",
      "/reset-password?redirect=%2Flogin#token_hash=hashed-recovery-marker&type=recovery",
    );

    await act(async () => root.render(<ResetPasswordPage />));

    await vi.waitFor(() => {
      expect(mocks.verifyOtp).toHaveBeenCalledWith({
        token_hash: "hashed-recovery-marker",
        type: "recovery",
      });
    });
    expect(window.location.href).toBe(
      "http://localhost:3000/reset-password?redirect=%2Flogin",
    );
    expect(container.textContent).toContain("새 비밀번호 설정");
  });

  it("revokes all refresh sessions after a successful password change", async () => {
    window.history.replaceState(
      {},
      "",
      "/reset-password#token_hash=hashed-recovery-marker&type=recovery",
    );
    await act(async () => root.render(<ResetPasswordPage />));
    await vi.waitFor(() => expect(container.querySelector("form")).not.toBeNull());

    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setValue || inputs.length !== 2) throw new Error("password inputs not rendered");

    await act(async () => {
      setValue.call(inputs[0], "StrongPass1!");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(inputs[1], "StrongPass1!");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    const redirectTimer = vi.spyOn(window, "setTimeout").mockReturnValue(
      1 as unknown as ReturnType<typeof setTimeout>,
    );
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "StrongPass1!" });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
    redirectTimer.mockRestore();
  });

  it("shows a generic retry path when the one-time recovery token is invalid", async () => {
    window.history.replaceState(
      {},
      "",
      "/reset-password#token_hash=hashed-recovery-marker&type=recovery",
    );
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: new Error("provider error containing hashed-recovery-marker"),
    });

    await act(async () => root.render(<ResetPasswordPage />));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("복구 링크가 만료되었거나 유효하지 않습니다.");
    });
    expect(container.textContent).not.toContain("hashed-recovery-marker");
    expect(window.location.href).not.toContain("hashed-recovery-marker");
  });
});
