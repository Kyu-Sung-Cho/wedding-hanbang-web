import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 컴포넌트 단위 테스트는 "내가 렌더한 것"만 본다. 이 테스트는 페이지 전체를
// 실제로 렌더해서, 중립 모드에서 사용자 눈에 닿는 DOM 전체에 성별이 없는지 본다.
// StepIndicator·RoleSelection이 조건부로 새어 나오는 회귀를 여기서 잡는다.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", () => ({
  motion: { div: "div", button: "button", span: "span", p: "p" },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));

import OnboardingPage from "../page";

const GENDERED = ["신부", "신랑", "👰", "🤵"];

async function renderWithCapability(neutralPreparationSpace: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<OnboardingPage />);
  });
  // /api/auth/me 응답이 흘러 들어간 뒤의 상태를 본다
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root, neutralPreparationSpace };
}

describe("중립 온보딩 화면", () => {
  let cleanup: Array<() => void> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
  });

  it("중립 모드에서는 화면 어디에도 성별이 나오지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          user: { id: "u1", email: "a@b.com" },
          profile: null,
          capabilities: { neutralPreparationSpace: true },
        }),
      })),
    );

    const { container, root } = await renderWithCapability(true);
    cleanup.push(() => act(() => root.unmount()));

    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    for (const word of GENDERED) {
      expect(text).not.toContain(word);
    }
    // 중립 화면이 실제로 떴는지 — 없는 화면에서 성별이 안 보이는 건 의미가 없다
    expect(text).toContain("역할을 정하지 않아도 시작할 수 있어요");
  });

  it("플래그가 꺼지면 기존 역할 선택이 그대로 뜬다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          user: { id: "u1", email: "a@b.com" },
          profile: null,
          capabilities: { neutralPreparationSpace: false },
        }),
      })),
    );

    const { container, root } = await renderWithCapability(false);
    cleanup.push(() => act(() => root.unmount()));

    const text = container.textContent ?? "";
    // 기존 경로는 바뀌지 않아야 한다. 이게 "머지해도 아무것도 안 바뀐다"의 증거다.
    expect(text).toContain("신부");
    expect(text).not.toContain("역할을 정하지 않아도 시작할 수 있어요");
  });

  // 아래 두 개가 진짜 함정이었다. 위 테스트들은 fetch를 흘려보낸 뒤를 보므로
  // "판정 전에 무엇이 그려지는가"를 못 본다.

  it("판정이 오기 전 첫 프레임에는 성별이 없다", async () => {
    // 영원히 pending — 응답 전 상태를 그대로 붙잡는다
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<OnboardingPage />);
    });
    cleanup.push(() => act(() => root.unmount()));

    const text = container.textContent ?? "";
    for (const word of GENDERED) {
      expect(text).not.toContain(word);
    }
  });

  it("판정에 실패하면 성별 경로로 흘러가지 않고 다시 시도를 준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));

    const { container, root } = await renderWithCapability(false);
    cleanup.push(() => act(() => root.unmount()));

    const text = container.textContent ?? "";
    for (const word of GENDERED) {
      expect(text).not.toContain(word);
    }
    expect(text).toContain("다시 시도");
  });
});
