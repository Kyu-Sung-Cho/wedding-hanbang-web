import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as redirectHelpers from "@/lib/auth/safeRedirect";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), updateUser: vi.fn(), unsubscribe: vi.fn(),
}));

vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: {
    getSession: mocks.getSession,
    updateUser: mocks.updateUser,
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: mocks.unsubscribe } } }),
  } }),
}));

import ResetPasswordPage from "./page";

const PWNED = "유출된 적이 있는 비밀번호는 사용할 수 없어요. 다른 사이트에서 쓰지 않는 새 비밀번호를 입력해 주세요.";
const WEAK = "보안 기준에 맞지 않는 비밀번호예요. 더 길고 추측하기 어려운 새 비밀번호를 입력해 주세요.";
const FALLBACK = "비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.";
const PASSWORD = "Synthetic-New1!";

describe("비밀번호 재설정의 실제 제출 오류 경계", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(globalThis, "setTimeout");
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "synthetic" } }, error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    window.history.replaceState({}, "", "/reset-password?redirect=%2Fsettings");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function prepareForm() {
    await act(async () => root.render(<ResetPasswordPage />));
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
    expect(inputs).toHaveLength(2);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    expect(setter).toBeDefined();
    await act(async () => {
      for (const input of inputs) {
        setter?.call(input, PASSWORD);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(submitButton().disabled).toBe(false);
  }

  function submitButton(): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!button) throw new Error("submit button missing");
    return button;
  }

  async function submit() {
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  }

  it.each(["returned", "thrown"] as const)("%s SDK 약한 비밀번호 오류를 안내하고 다시 제출할 수 있다", async (mode) => {
    const error = Object.assign(new Error("민감한 원문 provider token=secret"), {
      name: "AuthWeakPasswordError", code: "weak_password", reasons: ["pwned"],
    });
    if (mode === "returned") mocks.updateUser.mockResolvedValueOnce({ error });
    else mocks.updateUser.mockRejectedValueOnce(error);
    await prepareForm();
    await submit();
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(container.textContent).toContain(PWNED);
    expect(container.textContent).not.toContain("provider");
    expect(container.textContent).not.toContain("비밀번호 변경 완료");
    expect(submitButton().disabled).toBe(false);
    expect(globalThis.setTimeout).not.toHaveBeenCalledWith(expect.any(Function), 2000);
    await submit();
    expect(mocks.updateUser).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("비밀번호 변경 완료");
  });

  it("반환된 강도 오류에 유출 사실을 덧붙이지 않는다", async () => {
    mocks.updateUser.mockResolvedValueOnce({ error: { code: "weak_password", reasons: ["characters"] } });
    await prepareForm();
    await submit();
    expect(container.textContent).toContain(WEAK);
    expect(container.textContent).not.toContain("유출된 적");
    expect(submitButton().disabled).toBe(false);
  });

  it("같은 비밀번호 거절은 재시도 대신 다른 비밀번호 입력을 안내한다", async () => {
    mocks.updateUser.mockResolvedValueOnce({ error: { code: "same_password", message: "민감한 서버 진단" } });
    await prepareForm();
    await submit();
    expect(container.textContent).toContain("지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.");
    expect(container.textContent).not.toContain("민감한 서버 진단");
    expect(submitButton().disabled).toBe(false);
    expect(globalThis.setTimeout).not.toHaveBeenCalledWith(expect.any(Function), 2000);
  });

  it.each(["returned", "thrown"] as const)("%s 일반 오류의 한글·서버 진단을 노출하지 않는다", async (mode) => {
    const error = new Error("민감한 서버 진단: db=password-secret");
    if (mode === "returned") mocks.updateUser.mockResolvedValueOnce({ error });
    else mocks.updateUser.mockRejectedValueOnce(error);
    await prepareForm();
    await submit();
    expect(container.textContent).toContain(FALLBACK);
    expect(container.textContent).not.toContain("민감한 서버 진단");
    expect(container.textContent).not.toContain("password-secret");
    expect(submitButton().disabled).toBe(false);
    expect(globalThis.setTimeout).not.toHaveBeenCalledWith(expect.any(Function), 2000);
  });

  it("진행 중에는 제출을 잠그고 실패가 확정되면 다시 활성화한다", async () => {
    let resolveUpdate: ((value: { error: unknown }) => void) | undefined;
    mocks.updateUser.mockReturnValueOnce(new Promise<{ error: unknown }>((resolve) => { resolveUpdate = resolve; }));
    await prepareForm();
    await submit();
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toBe("처리 중...");
    await act(async () => resolveUpdate?.({ error: { code: "weak_password", reasons: ["pwned"] } }));
    expect(submitButton().disabled).toBe(false);
    expect(container.textContent).toContain(PWNED);
    expect(globalThis.setTimeout).not.toHaveBeenCalledWith(expect.any(Function), 2000);
  });

  it("정상 변경은 성공 상태와 기존 안전 경로의 2초 이동 예약을 유지한다", async () => {
    const safePath = vi.spyOn(redirectHelpers, "getSameOriginRedirectPath");
    const timeout = vi.mocked(globalThis.setTimeout);
    await prepareForm();
    await submit();
    expect(container.textContent).toContain("비밀번호 변경 완료");
    expect(container.textContent).not.toContain(FALLBACK);
    expect(safePath).toHaveBeenCalledWith("/settings", window.location.origin);
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 2000);
    expect(timeout.mock.calls.filter(([, delay]) => delay === 2000)).toHaveLength(1);
  });

  it("복구 세션이 없으면 비밀번호 변경을 호출하지 않는다", async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await act(async () => root.render(<ResetPasswordPage />));
    expect(container.textContent).toContain("링크를 확인하지 못했어요");
    expect(container.querySelector("form")).toBeNull();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
