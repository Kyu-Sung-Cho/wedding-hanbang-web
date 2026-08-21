import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 나중에 합류한 사람이 결혼 날짜를 입력하면, 두 슬롯이 다 차 있어 그 변경은
// 항상 고영향이다 — 서버는 200 안에서 `planChange.status: "pending_partner"`
// 라고 답한다. 이건 드문 경우가 아니라 **두 번째 사람의 정상 경로**다.
//
// 중립 준비 공간 분기가 그 판정을 읽기 전에 무조건 redirect 해서, 사용자는
// 날짜를 입력하고도 아무 말을 못 듣고 채팅으로 넘어갔다. 홈은 계속
// "결혼식 날짜를 알려주세요"라고 말한다 — 정상 동작하는 승인 경계가
// **데이터 유실로 읽힌다.**

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", () => ({
  motion: { div: "div", button: "button", span: "span", p: "p" },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));

import OnboardingPage from "../page";

const PENDING_SUMMARY = "결혼식 날짜를 2027년 5월 22일로 바꾸는 변경";

function stubFetch(onboardingBody: Record<string, unknown>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      if (String(url).includes("/api/onboarding")) {
        return { ok: true, json: async () => onboardingBody };
      }
      return {
        ok: true,
        json: async () => ({
          user: { id: "u1", email: "a@b.com" },
          profile: null,
          capabilities: { neutralPreparationSpace: true },
        }),
      };
    }),
  );
  return calls;
}

async function renderNeutral() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<OnboardingPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

/** 중립 화면에서 날짜와 초대 코드를 넣고 "함께 시작하기"를 누른다. */
async function joinWithCode(container: HTMLElement) {
  // 초대 코드 입력은 "초대 코드로 함께 시작하기"를 눌러야 나타난다.
  const revealButton = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("초대 코드로 함께 시작하기"),
  );
  expect(revealButton, "합류 선택 버튼이 있어야 한다").toBeTruthy();
  await act(async () => {
    revealButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]');
  const codeInput = container.querySelector("#neutral-partner-code") as HTMLInputElement | null;
  expect(dateInput, "날짜 입력이 있어야 한다").toBeTruthy();
  expect(codeInput, "초대 코드 입력이 있어야 한다").toBeTruthy();

  const setValue = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  await act(async () => {
    setValue(dateInput as HTMLInputElement, "2027-05-22");
    setValue(codeInput as HTMLInputElement, "WH-ABC123");
  });

  const joinButton = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("이 코드로 함께 시작하기"),
  );
  expect(joinButton, "합류 버튼이 있어야 한다").toBeTruthy();
  await act(async () => {
    joinButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("중립 합류: 상대 확인 대기를 말한다", () => {
  let cleanup: Array<() => void> = [];
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    vi.unstubAllGlobals();
  });

  it("pending_partner 면 리다이렉트 전에 안내를 보여준다", async () => {
    stubFetch({
      success: true,
      planChange: { status: "pending_partner", summary: PENDING_SUMMARY },
    });
    const { container, root } = await renderNeutral();
    cleanup.push(() => act(() => root.unmount()));

    await joinWithCode(container);

    const text = container.textContent ?? "";
    expect(text).toContain("파트너 확인을 요청했어요");
    expect(text).toContain(PENDING_SUMMARY);
    expect(text).toContain(
      "아직 계획에는 반영되지 않았어요. 두 사람이 모두 확인하면 자동으로 반영됩니다.",
    );
    // 승인 대기는 실패가 아니다.
    expect(text).not.toContain("실패");
  });

  it("보류된 입력도 말한다", async () => {
    const deferred = "입력한 준비 현황과 결혼식 선호는 이번 요청에 반영되지 않았어요.";
    stubFetch({
      success: true,
      planChange: { status: "applied" },
      routineProgress: { status: "deferred", message: deferred },
    });
    const { container, root } = await renderNeutral();
    cleanup.push(() => act(() => root.unmount()));

    await joinWithCode(container);

    expect(container.textContent ?? "").toContain(deferred);
  });

  // 대조군 — 이게 없으면 위 테스트가 "안내가 항상 뜬다"로도 통과한다.
  it("바로 반영된 경우에는 안내를 띄우지 않는다", async () => {
    stubFetch({ success: true, planChange: { status: "applied" } });
    const { container, root } = await renderNeutral();
    cleanup.push(() => act(() => root.unmount()));

    await joinWithCode(container);

    expect(container.textContent ?? "").not.toContain("파트너 확인을 요청했어요");
  });
});
