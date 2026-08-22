// 소셜 버튼이 **실제로 렌더되는지**를 DOM 에서 본다.
//
// 처음에는 페이지 소스에 `isWebOAuthProviderEnabled("kakao")` 문자열이 있는지만
// 검사했다. 적대적 감사가 뮤테이션으로 실증했듯 그 검사는
//   - 조건을 뒤집어도(`!isWebOAuthProviderEnabled("kakao")`)
//   - 게이트를 주석(`{/* … */}`)으로 만들어도
// 통과한다. 지키려던 것("카카오 버튼이 화면에 없다")을 전혀 못 지켰다.
//
// 운영 실측(2026-08-22): Supabase authorize 가 kakao -> 400
// "provider is not enabled", google/apple -> 302.

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

function buttonLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll("button")]
    .map((button) => button.textContent?.trim() ?? "")
    .filter(Boolean);
}

describe("소셜 로그인 버튼 렌더", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: { signInWithOAuth: mocks.signInWithOAuth },
    });
    window.history.replaceState({}, "", "/login");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  // 이 테스트가 도는 조건 = 운영의 조건이다. NEXT_PUBLIC_*_OAUTH_ENABLED 를
  // 설정하는 곳이 저장소 어디에도 없고(vitest setup 포함), 운영 Vercel env 에도
  // 셋 다 없다. 그러므로 여기서 보이는 것이 사용자가 보는 것이다.
  it("카카오 버튼이 화면에 없다", async () => {
    await act(async () => root.render(<LoginPage />));

    const labels = buttonLabels(container);
    expect(labels, `실제 버튼: ${labels.join(" / ")}`).not.toContain("카카오");
    // 아이콘만 남고 라벨이 사라지는 식으로 빠져나가지 못하게 한다.
    expect(container.innerHTML).not.toContain("FEE500");
  });

  it("잘 되는 Google·Apple 은 그대로 보인다", async () => {
    // 카카오를 숨기려다 이 둘까지 사라지는 것이 더 큰 사고다.
    await act(async () => root.render(<LoginPage />));

    const labels = buttonLabels(container);
    expect(labels).toContain("Google");
    expect(labels).toContain("Apple");
  });

  it("소셜 자리 자체는 남아 있다 — 제목이 빈 자리를 가리키지 않는다", async () => {
    await act(async () => root.render(<LoginPage />));

    // provider 가 하나라도 켜져 있으므로 제목이 보여야 하고,
    expect(container.textContent).toContain("빠르게 로그인하기");
    // 그 아래에 실제 버튼이 있어야 한다.
    const social = buttonLabels(container).filter((l) => ["Google", "Apple", "카카오"].includes(l));
    expect(social.length).toBeGreaterThan(0);
  });

  it("보이는 버튼은 눌리면 실제로 그 provider 로 시작한다", async () => {
    await act(async () => root.render(<LoginPage />));

    const google = [...container.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "Google");
    expect(google).toBeDefined();

    await act(async () => {
      google?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithOAuth.mock.calls[0][0]).toMatchObject({ provider: "google" });
  });
});
