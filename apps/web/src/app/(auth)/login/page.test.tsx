import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_AMORA_PREFILL_STORAGE_KEY,
  rememberDemoAmoraPrefill,
} from "@/lib/chat/demoHandoff";

const HANDOFF_ID = "0f75ca2a-94c1-4d9c-83e3-a45981c98673";
const START_HERE_REDIRECT = `/wedding/chat?startHereHandoff=${HANDOFF_ID}`;
const START_HERE_LOGIN = `/login?mode=signup&redirect=${encodeURIComponent(START_HERE_REDIRECT)}&source=start-here`;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithOAuth: vi.fn(),
  getUser: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("framer-motion", () => ({ motion: { div: "div" } }));
vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));
vi.mock("@/components/auth/TurnstileWidget", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

import LoginPage from "./page";

describe("login return journey", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.createClient.mockReturnValue({
      auth: { signInWithOAuth: mocks.signInWithOAuth, getUser: mocks.getUser },
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
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

  it("returns an already authenticated member through the existing protected destination", async () => {
    window.history.replaceState({}, "", "/login?mode=signup");
    mocks.getUser.mockResolvedValue({ data: { user: { id: "existing-member" } }, error: null });
    await act(async () => root.render(<LoginPage />));
    expect(mocks.replace).toHaveBeenCalledWith("/wedding/lounge");
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
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

  // provider가 Supabase에서 아직 열려 있지 않으면 여기로 온다. 예전에는 그 원문을
  // 그대로 화면에 붙여 사람은 알아볼 수 없고 내부 상태만 드러났다.
  it("keeps a failed social sign-in readable without echoing the provider error", async () => {
    mocks.signInWithOAuth.mockResolvedValue({
      error: { message: "Unsupported provider: provider is not enabled" },
    });
    await act(async () => root.render(<LoginPage />));
    const googleButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Google"));

    await act(async () => {
      googleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Unsupported provider");
    expect(container.textContent).toContain("구글 로그인을 지금 이용할 수 없어요");
    // 막힌 사람에게 남는 길을 같은 문장에서 알려준다.
    expect(container.textContent).toContain("이메일로 로그인");
  });

  it.each([
    ["login", ["이메일", "비밀번호"]],
    ["signup", ["이름", "이메일", "비밀번호", "비밀번호 확인"]],
    ["forgot", ["이메일"]],
  ] as const)("names every rendered %s form input explicitly", async (mode, names) => {
    window.history.replaceState(
      {},
      "",
      `/login?mode=${mode}&redirect=%2Fwedding%2Fchat`,
    );
    await act(async () => root.render(<LoginPage />));

    // placeholder에 의존하지 않고 실제 렌더된 입력마다 명시적 이름을 제공한다.
    const inputs = [...container.querySelectorAll<HTMLInputElement>(
      'form input[type="text"], form input[type="email"], form input[type="password"]',
    )];
    expect(inputs.map((input) => input.getAttribute("aria-label"))).toEqual(names);
    expect(window.location.search).toBe(`?mode=${mode}&redirect=%2Fwedding%2Fchat`);
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each(["login", "signup"] as const)(
    "keeps %s password input names when revealing and hiding their values",
    async (mode) => {
      window.history.replaceState({}, "", `/login?mode=${mode}`);
      vi.stubGlobal("fetch", vi.fn());
      await act(async () => root.render(<LoginPage />));

      const names = mode === "signup" ? ["비밀번호", "비밀번호 확인"] : ["비밀번호"];
      for (const name of names) {
        const input = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
        const showButton = container.querySelector(`button[aria-label="${name} 표시"]`);
        expect(input).not.toBeNull();
        expect(input?.type).toBe("password");
        expect(showButton).not.toBeNull();
        await act(async () => {
          showButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(input?.type).toBe("text");
        expect(input?.getAttribute("aria-label")).toBe(name);

        const hideButton = container.querySelector(`button[aria-label="${name} 숨기기"]`);
        expect(hideButton).not.toBeNull();
        await act(async () => {
          hideButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(input?.type).toBe("password");
        expect(input?.getAttribute("aria-label")).toBe(name);
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
      expect(mocks.replace).not.toHaveBeenCalled();
    },
  );

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

  it("opens a landing signup destination in signup mode", async () => {
    window.history.replaceState(
      {},
      "",
      "/login?mode=signup&redirect=%2Fwedding%2Fchat",
    );

    await act(async () => root.render(<LoginPage />));

    expect(container.querySelector("h1")?.textContent).toBe("회원가입");
    expect(container.querySelector('input[placeholder="이름 *"]')).not.toBeNull();
  });

  it("recognizes a start-here handoff and puts one-tap signup before the email form", async () => {
    rememberDemoAmoraPrefill(window.localStorage, "가입 전에 고른 질문", HANDOFF_ID);
    window.history.replaceState({}, "", START_HERE_LOGIN);

    await act(async () => root.render(<LoginPage />));

    expect(container.textContent).toContain("방금 본 준비를 이어갈게요.");
    expect(container.textContent).toContain("입력창에서 확인한 뒤 직접 보낼 수 있어요");
    // /beta 승인 대기열을 가리키던 문구였다. 가입이 열린 뒤로는 승인 절차가 없다.
    expect(container.textContent).toContain("지금은 가입에 승인 절차가 없고 결제도 요청하지 않아요");
    expect(container.textContent).toContain("서비스 전체에 하루 상한이 있어서");

    // ⚠️ 이 단언은 카카오 버튼을 앵커로 삼고 있었다. 카카오가 게이트 뒤로
    // 들어가 화면에서 사라진 뒤에도 **조용히 통과했다** — `.find()` 가
    // undefined 를 돌려주는데 `expect(undefined).not.toBeNull()` 은 통과하고,
    // `?? Node.DOCUMENT_POSITION_FOLLOWING` 폴백이 기대값을 그대로 만들어 줬다.
    // 원탭 버튼이 화면에 0개여도 초록불이었다.
    //
    // 앵커를 실제로 렌더되는 버튼으로 바꾸고, `toBeDefined()` 와 폴백 제거로
    // 앵커가 없으면 실패하게 만든다. 카카오가 안 보이는 것 자체는
    // socialProviderRender.test.tsx 가 렌더 수준에서 지킨다.
    const oneTapButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Google");
    const emailInput = container.querySelector('input[type="email"]');
    expect(oneTapButton).toBeDefined();
    expect(emailInput).not.toBeNull();
    expect(
      oneTapButton!.compareDocumentPosition(emailInput as Node),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("does not trust a source label without a matching one-time handoff", async () => {
    rememberDemoAmoraPrefill(window.localStorage, "다른 방문자의 질문", HANDOFF_ID);
    rememberDemoAmoraPrefill(window.sessionStorage, "중단된 이전 체험 질문");
    window.history.replaceState(
      {},
      "",
      "/login?mode=signup&redirect=%2Fwedding%2Fchat&source=start-here",
    );

    await act(async () => root.render(<LoginPage />));

    expect(container.textContent).not.toContain("방금 본 준비를 이어갈게요.");
    expect(window.localStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
  });

  it("passes the safe destination into an email signup confirmation", async () => {
    rememberDemoAmoraPrefill(window.localStorage, "가입 전에 고른 질문", HANDOFF_ID);
    window.history.replaceState({}, "", START_HERE_LOGIN);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true }),
    }));
    await act(async () => root.render(<LoginPage />));

    const setInput = (input: HTMLInputElement | undefined, value: string) => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const passwordInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="password"]'),
    );
    await act(async () => {
      setInput(container.querySelector<HTMLInputElement>('input[placeholder="이름 *"]') ?? undefined, "테스트 사용자");
      setInput(container.querySelector<HTMLInputElement>('input[type="email"]') ?? undefined, "test@example.com");
      setInput(passwordInputs[0], "Strong1!");
      setInput(passwordInputs[1], "Strong1!");
    });

    // 필수 동의 없이는 가입이 시작되지 않는다(가입 동의 테스트가 따로 고정한다).
    // 동의 항목은 진짜 체크박스다 — 버튼이 아니다.
    for (const key of ["terms", "privacy", "age14"]) {
      const box = container.querySelector<HTMLInputElement>(`#signup-consent-${key}`);
      await act(async () => {
        box?.click();
      });
    }

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    const requestInit = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      redirect: START_HERE_REDIRECT,
      termsAgreed: true,
      privacyAgreed: true,
      ageOver14Confirmed: true,
      marketingAgreed: false,
    });
    expect(container.textContent).toContain("같은 브라우저에서 인증하면 아모라 화면으로 이어져요");
  });
});
