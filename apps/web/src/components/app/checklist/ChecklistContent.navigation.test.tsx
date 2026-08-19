// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/**
 * 2026-08-19 — 검색창이 스스로 제시한 예시가 0건을 냈다. placeholder는 "계약 취소"였는데
 * 그 연속 문자열은 저장소에서 placeholder 자신이 유일했다. 앱이 시킨 대로 치면 빈 화면이
 * 나온다. 예시어는 실제로 결과가 나오는 말이어야 한다.
 */
describe("검색 예시어가 실제로 결과를 낸다", () => {
  it("placeholder에 적힌 말이 항목이나 tip에 실재한다", async () => {
    const { CATEGORY_CHECKLISTS } = await import("@hanbang/shared/constants");
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/checklist/ChecklistContent.tsx"),
      "utf8",
    );

    // 실제 검색 대상은 라벨·tip·항목에 **별칭**까지 더한 문자열이다(:118-119).
    // 건초더미를 그와 똑같이 만들지 않으면 이 테스트가 거짓 실패를 낸다.
    const aliasStart = source.indexOf("CATEGORY_SEARCH_ALIASES");
    const aliasBlock = source.slice(aliasStart, source.indexOf("};", aliasStart));
    const aliases = [...aliasBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    const haystack = [
      ...CATEGORY_CHECKLISTS.flatMap((category) => [
        category.label,
        category.tip,
        ...category.items.map((item) => item.label),
      ]),
      ...aliases,
    ].join("\n");

    const placeholder = source.match(/placeholder="예: ([^"]+)"/)?.[1];
    expect(placeholder, "검색 placeholder를 찾지 못했다").toBeTruthy();

    for (const term of placeholder!.split(",").map((t) => t.trim())) {
      expect(haystack.includes(term), `검색 예시 "${term}"가 0건을 낸다`).toBe(true);
    }
  });
});
