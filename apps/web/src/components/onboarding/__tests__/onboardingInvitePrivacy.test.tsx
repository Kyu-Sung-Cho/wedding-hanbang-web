import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingPage from "@/app/(auth)/onboarding/page";
import { useOnboardingStore } from "@/stores/onboardingStore";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
/**
 * A 계정의 초대 코드. 값은 아무거나여도 되지만 **형식은 진짜여야 한다** —
 * `InviteCodePanel` 이 `^WH-[A-Z0-9]{6,12}$`(DB 의 `join_couple` 과 같은 규칙,
 * packages/shared/src/contracts/coupleInviteCode.ts)에 맞지 않으면 `return null`
 * 로 통째로 사라진다. 예전 값 `WH-A-SECRET` 은 하이픈이 하나 더 있어 그 규칙에
 * 걸렸고, 코드가 화면에 아예 없으니 "계정이 바뀌면 코드가 사라진다"를 보는
 * 이 파일의 단언들이 전부 거저 통과할 뻔했다.
 */
const A_INVITE_CODE = "WH-ASECRET1";

/**
 * 복사에 성공했을 때 패널이 켜는 표시. `InviteCodePanel` 의 COPY_LABELS.code.done
 * 과 같은 값이어야 한다 — 여기가 어긋나면 "성공 표시가 남아 있으면 안 된다"는
 * 아래 단언들이 없는 문자열을 찾으며 늘 통과한다. 실제로 그랬다: main 이 이 문구를
 * `복사 완료!` 에서 바꾼 뒤로 두 단언이 죽은 채 초록불이었다.
 */
const COPIED_LABEL = "코드 복사됨";

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

/**
 * "다음"은 두 자리에 있다 — 스텝을 넘기는 하단 CTA와, 마지막 스텝 안에서 국면을
 * (단계 선택 → 19항목) 넘기는 버튼. 여기서 필요한 것은 뒤쪽이다.
 */
function findLastButton(container: HTMLElement, label: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"))
    .filter((candidate) => candidate.textContent?.includes(label));
  const button = buttons[buttons.length - 1];
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
      // 저장 직후 앱은 초대 코드의 기한을 여기서 읽는다. 모르는 주소로 두면 이
      // 가짜 fetch 가 던지고, 그 예외는 화면이 조용히 삼킨다 — 검사가 아무것도
      // 눈치채지 못한 채 다음 사람에게 함정으로 남는다. 기한은 이 파일의 관심사가
      // 아니므로 "없음"을 준다.
      if (url === "/api/couple/code") {
        return new Response(JSON.stringify({ inviteCodeExpiresAt: null }), {
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
      // 마지막 스텝은 두 국면이다(단계 선택 → 19항목). 단계를 하나 고르고 "다음"을
      // 눌러야 저장 버튼이 나온다 — main이 나눈 화면이고, 이 검사는 저장 경로를 본다.
      findButton(container, "이제 막 시작했어요").click();
    });

    await act(async () => {
      findLastButton(container, "다음").click();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(A_INVITE_CODE);
    const retainedCopyButton = findButton(container, "코드 복사");
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
      // 마지막 스텝은 두 국면이다(단계 선택 → 19항목). 단계를 하나 고르고 "다음"을
      // 눌러야 저장 버튼이 나온다 — main이 나눈 화면이고, 이 검사는 저장 경로를 본다.
      findButton(container, "이제 막 시작했어요").click();
    });

    await act(async () => {
      findLastButton(container, "다음").click();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const copyButton = findButton(container, "코드 복사");
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
      // 마지막 스텝은 두 국면이다(단계 선택 → 19항목). 단계를 하나 고르고 "다음"을
      // 눌러야 저장 버튼이 나온다 — main이 나눈 화면이고, 이 검사는 저장 경로를 본다.
      findButton(container, "이제 막 시작했어요").click();
    });

    await act(async () => {
      findLastButton(container, "다음").click();
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
      findButton(container, "코드 복사").click();
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
      // 마지막 스텝은 두 국면이다(단계 선택 → 19항목). 단계를 하나 고르고 "다음"을
      // 눌러야 저장 버튼이 나온다 — main이 나눈 화면이고, 이 검사는 저장 경로를 본다.
      findButton(container, "이제 막 시작했어요").click();
    });

    await act(async () => {
      findLastButton(container, "다음").click();
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
      findButton(container, "코드 복사").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenNthCalledWith(1, A_INVITE_CODE);
    expect(writeText).toHaveBeenNthCalledWith(2, "");
    expect(execCommand).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(A_INVITE_CODE);
    expect(container.textContent).not.toContain(COPIED_LABEL);
  });

  it("clears A's fallback copy and hides its result when auth becomes B inside execCommand", async () => {
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      // 마지막 스텝은 두 국면이다(단계 선택 → 19항목). 단계를 하나 고르고 "다음"을
      // 눌러야 저장 버튼이 나온다 — main이 나눈 화면이고, 이 검사는 저장 경로를 본다.
      findButton(container, "이제 막 시작했어요").click();
    });

    await act(async () => {
      findLastButton(container, "다음").click();
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
      findButton(container, "코드 복사").click();
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
    expect(container.textContent).not.toContain(COPIED_LABEL);
  });

  it("copies once when the rendered, stored, result, and canonical owners all agree", async () => {
    await act(async () => {
      root.render(<OnboardingPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      // 마지막 스텝은 두 국면이다(단계 선택 → 19항목). 단계를 하나 고르고 "다음"을
      // 눌러야 저장 버튼이 나온다 — main이 나눈 화면이고, 이 검사는 저장 경로를 본다.
      findButton(container, "이제 막 시작했어요").click();
    });

    await act(async () => {
      findLastButton(container, "다음").click();
    });

    await act(async () => {
      findButton(container, "시작하기").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, "코드 복사").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(A_INVITE_CODE);
    expect(execCommand).not.toHaveBeenCalled();
    expect(container.textContent).toContain(COPIED_LABEL);
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
      // 마지막 스텝은 두 국면이다(단계 선택 → 19항목). 단계를 하나 고르고 "다음"을
      // 눌러야 저장 버튼이 나온다 — main이 나눈 화면이고, 이 검사는 저장 경로를 본다.
      findButton(container, "이제 막 시작했어요").click();
    });

    await act(async () => {
      findLastButton(container, "다음").click();
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
      // 마지막 스텝은 두 국면이다(단계 선택 → 19항목). 단계를 하나 고르고 "다음"을
      // 눌러야 저장 버튼이 나온다 — main이 나눈 화면이고, 이 검사는 저장 경로를 본다.
      findButton(container, "이제 막 시작했어요").click();
    });

    await act(async () => {
      findLastButton(container, "다음").click();
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
