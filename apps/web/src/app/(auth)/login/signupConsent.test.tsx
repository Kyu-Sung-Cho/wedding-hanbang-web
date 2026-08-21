import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 이 화면에는 약관·개인정보 처리방침 링크가 **한 개도 없었다**. 646줄 전체에
// "약관"·"개인정보"·"terms"·"privacy" 가 0건이었고, 그 상태로 계정이 만들어졌다.
// 약관 제2조는 "본 약관에 동의하고 계정을 만든 이용자"를 회원으로 정의한다.
// 소셜 경로도 계정을 만드므로 같은 게이트 뒤에 있어야 한다.

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

function findButton(container: HTMLElement, text: string) {
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  );
}

async function click(el: Element | undefined) {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("가입 동의", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: { signInWithOAuth: mocks.signInWithOAuth },
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/login?mode=signup");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("가입 화면이 약관과 처리방침 전문으로 가는 길을 준다", async () => {
    await act(async () => root.render(<LoginPage />));

    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/terms");
    expect(hrefs).toContain("/privacy");
    expect(container.textContent).toContain("이용약관 동의");
    expect(container.textContent).toContain("개인정보 처리방침 동의");
    expect(container.textContent).toContain("[필수]");
  });

  it("동의 전에는 잠기고, 필수 2개만 체크하면 열린다 — 마케팅은 선택이다", async () => {
    await act(async () => root.render(<LoginPage />));

    // 이름·비밀번호를 채운다
    const inputs = [...container.querySelectorAll("input")];
    const nameInput = inputs.find((i) => i.placeholder?.includes("이름"));
    const passwordInputs = inputs.filter((i) => i.type === "password");
    const setValue = (el: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      if (nameInput) setValue(nameInput, "김한방");
      passwordInputs.forEach((el) => setValue(el, "Hanbang!2026"));
    });

    // 아직 동의 전이므로 잠겨 있다
    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled"))
      .toBe(true);

    await click(findButton(container, "이용약관 동의"));
    await click(findButton(container, "개인정보 처리방침 동의"));

    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled"))
      .toBe(false);
    // 마케팅은 켜지지 않은 채로 통과해야 한다
    const marketing = findButton(container, "마케팅 정보 수신 동의");
    expect(marketing?.getAttribute("aria-pressed")).toBe("false");
  });

  it("동의 없이 소셜 가입을 누르면 계정 생성이 시작되지 않는다", async () => {
    await act(async () => root.render(<LoginPage />));

    await click(findButton(container, "Google"));

    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "이용약관과 개인정보 처리방침에 동의해주세요.",
    );
  });

  it("동의한 뒤에는 소셜 가입이 진행된다", async () => {
    await act(async () => root.render(<LoginPage />));

    await click(findButton(container, "이용약관 동의"));
    await click(findButton(container, "개인정보 처리방침 동의"));
    await click(findButton(container, "Google"));

    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1);
  });
});
