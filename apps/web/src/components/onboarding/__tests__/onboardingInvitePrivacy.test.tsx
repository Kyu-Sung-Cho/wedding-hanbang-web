import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingPage from "@/app/(auth)/onboarding/page";
import { useOnboardingStore } from "@/stores/onboardingStore";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const A_INVITE_CODE = "WH-A-SECRET";

const authHarness = vi.hoisted(() => ({
  listener: null as null | ((
    event: string,
    session: { user: { id: string } } | null,
  ) => void),
  unsubscribe: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (
        listener: (
          event: string,
          session: { user: { id: string } } | null,
        ) => void,
      ) => {
        authHarness.listener = listener;
        return {
          data: {
            subscription: { unsubscribe: authHarness.unsubscribe },
          },
        };
      },
    },
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

describe("onboarding invite result privacy", () => {
  let root: Root;
  let container: HTMLDivElement;
  let canonicalOwnerUserId: string;
  let onboardingResponse: Record<string, unknown>;
  const writeText = vi.fn(async (value: string) => {
    void value;
  });
  const execCommand = vi.fn(() => true);

  beforeEach(() => {
    canonicalOwnerUserId = USER_A;
    onboardingResponse = { inviteCode: A_INVITE_CODE };
    authHarness.listener = null;
    authHarness.unsubscribe.mockClear();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    execCommand.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === "/api/auth/me") {
        return new Response(JSON.stringify({
          user: { id: canonicalOwnerUserId },
          profile: null,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/onboarding") {
        return new Response(JSON.stringify(onboardingResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    useOnboardingStore.setState({ ownerUserId: USER_A });
    useOnboardingStore.getState().reset();
    useOnboardingStore.setState({
      ownerUserId: USER_A,
      currentStep: 5,
      role: "bride",
      coupleAction: "create",
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useOnboardingStore.getState().clearOwner();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("writes zero A invite secrets when auth becomes B immediately before copy", async () => {
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(A_INVITE_CODE);
    const retainedCopyButton = findButton(container, "코드 복사하기");
    expect(authHarness.listener).not.toBeNull();

    canonicalOwnerUserId = USER_B;
    await act(async () => {
      authHarness.listener?.("SIGNED_IN", { user: { id: USER_B } });
      retainedCopyButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(A_INVITE_CODE);
  });

  it("writes zero A invite secrets when the canonical session is already B", async () => {
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const copyButton = findButton(container, "코드 복사하기");
    canonicalOwnerUserId = USER_B;
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(A_INVITE_CODE);
  });

  it("does not use the fallback after the account changes during clipboard access", async () => {
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    writeText.mockImplementationOnce(async () => {
      canonicalOwnerUserId = USER_B;
      throw new Error("clipboard unavailable");
    });
    await act(async () => {
      findButton(container, "코드 복사하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenNthCalledWith(1, A_INVITE_CODE);
    expect(writeText).toHaveBeenNthCalledWith(2, "");
    expect(execCommand).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(A_INVITE_CODE);
  });

  it("clears the copied A invite when canonical auth becomes B during a successful clipboard write", async () => {
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    writeText.mockImplementation(async (value: string) => {
      if (value === A_INVITE_CODE) canonicalOwnerUserId = USER_B;
    });
    await act(async () => {
      findButton(container, "코드 복사하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenNthCalledWith(1, A_INVITE_CODE);
    expect(writeText).toHaveBeenNthCalledWith(2, "");
    expect(execCommand).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(A_INVITE_CODE);
    expect(container.textContent).not.toContain("복사 완료!");
  });

  it("clears A's fallback copy and hides its result when auth becomes B inside execCommand", async () => {
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const fallbackWrites: string[] = [];
    writeText.mockRejectedValue(new Error("clipboard unavailable"));
    execCommand.mockImplementation(() => {
      const textArea = document.querySelector("textarea");
      fallbackWrites.push(textArea?.value ?? "missing-textarea");
      if (fallbackWrites.length === 1) canonicalOwnerUserId = USER_B;
      return true;
    });
    await act(async () => {
      findButton(container, "코드 복사하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenNthCalledWith(1, A_INVITE_CODE);
    expect(writeText).toHaveBeenNthCalledWith(2, "");
    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(fallbackWrites).toEqual([A_INVITE_CODE, ""]);
    expect(container.textContent).not.toContain(A_INVITE_CODE);
    expect(container.textContent).not.toContain("복사 완료!");
  });

  it("copies once when the rendered, stored, result, and canonical owners all agree", async () => {
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "코드 복사하기").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(A_INVITE_CODE);
    expect(execCommand).not.toHaveBeenCalled();
    expect(container.textContent).toContain("복사 완료!");
  });

  it("does not reopen A's invite after canonical auth becomes B before pending continuation", async () => {
    onboardingResponse = {
      inviteCode: A_INVITE_CODE,
      planChange: {
        status: "pending_partner",
        summary: "A 계정만의 비공개 계획",
      },
    };
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("A 계정만의 비공개 계획");

    canonicalOwnerUserId = USER_B;
    await act(async () => {
      findButton(container, "확인하고 계속하기").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain(A_INVITE_CODE);
    expect(container.textContent).not.toContain("A 계정만의 비공개 계획");
  });

  it("does not continue from A's invite when canonical auth becomes B first", async () => {
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(A_INVITE_CODE);

    canonicalOwnerUserId = USER_B;
    await act(async () => {
      findButton(container, "결혼 준비 계속하기").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain(A_INVITE_CODE);
  });
});
