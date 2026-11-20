import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import AmoraPermissionsPage from "./page";

// 허락 규칙 화면(25장 3절). 표와 같은 화면의 알림·기억 조절을 본다. 조절 칸 셋은 각자의 시험이 따로 잰다.

const mocks = vi.hoisted(() => ({ isDemo: false }));

vi.mock("next/link", () => ({
  default: ({ children, href, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => {
    void prefetch;
    return <a href={typeof href === "string" ? href : ""} {...props}>{children}</a>;
  },
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (state: { isDemo: boolean }) => unknown) => selector({ isDemo: mocks.isDemo }),
}));
vi.mock("@/components/app/AmoraPushPreferenceRow", () => ({ default: () => <div data-control="push" /> }));
vi.mock("@/components/app/TodayOnePreferenceControl", () => ({ default: () => <div data-control="today-one" /> }));
vi.mock("@/components/app/AmoraCarePreferenceControl", () => ({ default: () => <div data-control="care" /> }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<AmoraPermissionsPage />); });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.isDemo = false;
});

describe("/settings/amora-permissions", () => {
  it("알아서·물어보고·하지 않는 일을 오늘 쓸 수 있는 것만 보인다", async () => {
    const view = await render();
    const section = (key: string) => view.querySelector(`[data-permission-section="${key}"]`)?.textContent ?? "";
    expect(section("auto")).toContain("준비 기록 읽기");
    expect(section("ask")).toContain("예산과 일정, 할 일, 조건 저장하기");
    expect(section("never")).toContain("업체에 직접 보내기");
    expect(section("never")).toContain("두 분 계정으로 로그인하기");
    // 인터넷 찾기(갈래 3)와 맡은 일(갈래 4)은 아직 없다.
    expect(view.textContent).not.toContain("인터넷에서 찾아보기");
    expect(view.textContent).not.toContain("맡은 일");
  });

  it("같은 화면에서 앱 알림, 오늘의 한 가지, 먼저 알려 주기, 기억을 정한다", async () => {
    const view = await render();
    for (const control of ["push", "today-one", "care"]) {
      expect(view.querySelector(`[data-control="${control}"]`)).not.toBeNull();
    }
    const memoryLink = [...view.querySelectorAll("a")].find((anchor) => anchor.textContent?.includes("아모라가 기억하는 것 보기"));
    expect(memoryLink?.getAttribute("href")).toMatch(/\/settings\/amora-memory$/);
  });

  it("체험 모드에서는 표만 보이고 조절 칸은 그리지 않는다", async () => {
    mocks.isDemo = true;
    const view = await render();
    expect(view.querySelector('[data-permission-section="auto"]')).not.toBeNull();
    expect(view.querySelector("[data-control]")).toBeNull();
  });
});
