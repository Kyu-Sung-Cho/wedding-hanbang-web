// @vitest-environment jsdom

import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/checklist",
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => {
    void prefetch;
    return <a href={typeof href === "string" ? href : "#"} {...props}>{children}</a>;
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ journey: { progress: {} } }),
}));

vi.mock("@/components/app/schedule/CategoryChecklistModal", () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? <button type="button" data-testid="modal-close" onClick={onClose}>닫기</button> : null
  ),
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
    mocks.pathname = "/checklist";
    mocks.replace.mockReset();
    mocks.searchParams = new URLSearchParams();
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

  it("adds a shareable category query when a category opens", async () => {
    mocks.searchParams = new URLSearchParams("from=dashboard");
    await render();

    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="부모님 첫 만남 체크리스트 열기"]',
    );
    expect(openButton).not.toBeNull();
    await act(async () => openButton?.click());

    expect(mocks.replace).toHaveBeenCalledWith(
      "/checklist?from=dashboard&category=meeting",
      { scroll: false },
    );
    expect(container.querySelector('[data-testid="modal-close"]')).not.toBeNull();
  });

  it("removes only the category query when a deep-linked modal closes", async () => {
    mocks.searchParams = new URLSearchParams("category=meeting&from=guide");
    await render();

    const closeButton = container.querySelector<HTMLButtonElement>('[data-testid="modal-close"]');
    expect(closeButton).not.toBeNull();
    await act(async () => closeButton?.click());

    expect(mocks.replace).toHaveBeenCalledWith("/checklist?from=guide", { scroll: false });
    expect(container.querySelector('[data-testid="modal-close"]')).toBeNull();
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
      container.querySelector('button[aria-label="부모님 첫 만남 체크리스트 열기"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="결혼식장 체크리스트 열기"]'),
    ).toBeNull();
  });
});
