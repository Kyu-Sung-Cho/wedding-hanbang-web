import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
import ExistingSessionReturn from "./ExistingSessionReturn";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("existing member login return", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "existing-member" } }, error: null });
    window.history.replaceState({}, "", "/login?mode=signup");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("continues a verified member to the protected lounge from the signup entry", async () => {
    await act(async () => root.render(<ExistingSessionReturn mode="signup" />));
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith("/wedding/lounge");
  });
  it("preserves an internal invite or planning destination", async () => {
    window.history.replaceState({}, "", "/login?redirect=%2Fwedding%2Fchat%2Fboard%3Fview%3Dsaved");
    await act(async () => root.render(<ExistingSessionReturn mode="login" />));
    expect(mocks.replace).toHaveBeenCalledWith("/wedding/chat/board?view=saved");
  });
  it.each(["https://attacker.example", "//attacker.example", "/login", "/api/auth/callback"])("rejects unsafe or looping destination %s", async (destination) => {
    window.history.replaceState({}, "", `/login?redirect=${encodeURIComponent(destination)}`);
    await act(async () => root.render(<ExistingSessionReturn mode="login" />));
    expect(mocks.replace).toHaveBeenCalledWith("/wedding/lounge");
  });
  it.each(["?error=verify_failed", "#error=access_denied", "?type=recovery", "?code=callback-code"])("leaves callback and recovery state visible: %s", async (suffix) => {
    window.history.replaceState({}, "", `/login${suffix}`);
    await act(async () => root.render(<ExistingSessionReturn mode="login" />));
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("leaves signed-out visitors in the requested signup flow", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await act(async () => root.render(<ExistingSessionReturn mode="signup" />));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("keeps login usable if the verification request fails", async () => {
    mocks.getUser.mockRejectedValue(new Error("network unavailable"));
    await act(async () => root.render(<ExistingSessionReturn mode="login" />));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("does not navigate on an auth error even if a stale user is returned", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "stale" } }, error: { message: "expired" } });
    await act(async () => root.render(<ExistingSessionReturn mode="login" />));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("cancels a late lookup when the user opens password recovery", async () => {
    let resolveUser: (value: unknown) => void = () => {};
    mocks.getUser.mockReturnValue(new Promise((resolve) => { resolveUser = resolve; }));
    await act(async () => root.render(<ExistingSessionReturn mode="login" />));
    await act(async () => root.render(<ExistingSessionReturn mode="forgot" />));
    await act(async () => resolveUser({ data: { user: { id: "existing" } }, error: null }));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
