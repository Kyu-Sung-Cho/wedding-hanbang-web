// @vitest-environment jsdom

import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, as, prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string; prefetch?: boolean }) => {
    void prefetch;
    return <a href={as ?? (typeof href === "string" ? href : "#")} {...props}>{children}</a>;
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ journey: { progress: {} } }),
}));

import ChecklistContent from "./ChecklistContent";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

describe("ChecklistContent category deep links", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function render() {
    await act(async () => root.render(<ChecklistContent />));
  }

  it("opens each category as a dedicated shareable page instead of a modal", async () => {
    await render();

    const categoryLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="부모님 첫 만남 체크리스트 페이지 열기"]',
    );
    expect(categoryLink?.getAttribute("href")).toBe("/wedding/checklist/meeting");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("새로 추가된 8개 분야는 시작하면 진행률에 반영돼요.");
    expect(container.textContent).toContain("새로 추가됨 · 10개 · 시작하면 진행률 반영");
  });

  it("finds plain-language categories by familiar wedding terms", async () => {
    await render();

    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).not.toBeNull();
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      valueSetter?.call(search, "상견례");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(
      container.querySelector('a[aria-label="부모님 첫 만남 체크리스트 페이지 열기"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('a[aria-label="결혼식장 체크리스트 페이지 열기"]'),
    ).toBeNull();
  });
});
