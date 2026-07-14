import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicCourtListOptions, PublicCourtListPage } from "../api";
import type { PublicCourtCase } from "../types";
import PublicCourtList, { parsePublicCourtQuery } from "../PublicCourtList";

const mocks = vi.hoisted(() => ({
  listPublicCases: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("../api", () => ({
  listPublicCases: mocks.listPublicCases,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, as }: { children: React.ReactNode; href: string; as?: string }) => (
    <a href={as ?? href}>{children}</a>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function publicCase(index: number, overrides: Partial<PublicCourtCase> = {}): PublicCourtCase {
  return {
    id: `post-${index}`,
    title: `공개 사건 ${index}`,
    summary: `공개 요약 ${index}`,
    category: "budget",
    mode: "solo",
    createdAt: new Date(Date.UTC(2026, 0, index)).toISOString(),
    votes: { total: index },
    commentsCount: index,
    commentsEnabled: true,
    safetyLevel: "normal",
    ...overrides,
  };
}

function publicPage(
  posts: PublicCourtCase[],
  total = posts.length,
  page = 1,
): PublicCourtListPage {
  const limit = 6;
  return {
    posts,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasMore: page * limit < total,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PublicCourtList URL state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.listPublicCases.mockReset();
    mocks.replace.mockReset();
    window.history.replaceState({}, "", "/wedding/couple-court/public");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("accepts only known category, mode, sort and canonical page values", () => {
    expect(parsePublicCourtQuery(new URLSearchParams(
      "category=budget&mode=couple&sort=popular&page=12",
    ))).toEqual({ category: "budget", mode: "couple", sort: "popular", page: 12 });

    expect(parsePublicCourtQuery(new URLSearchParams(
      "category=unknown&mode=duo&sort=oldest&page=01",
    ))).toEqual({ category: "all", mode: "all", sort: "latest", page: 1 });
  });

  it("restores filters, sorting and the requested page after a reload", async () => {
    mocks.listPublicCases.mockResolvedValue(publicPage([publicCase(2), publicCase(1)], 8, 2));
    window.history.replaceState(
      {},
      "",
      "/wedding/couple-court/public?category=budget&mode=solo&sort=popular&page=2",
    );

    await act(async () => root.render(<PublicCourtList />));
    await settle();

    expect(container.querySelector<HTMLSelectElement>('select[name="category"]')?.value).toBe("budget");
    expect(container.querySelector<HTMLSelectElement>('select[name="sort"]')?.value).toBe("popular");
    expect(container.querySelectorAll("fieldset button")[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("2 / 2");
    expect(container.textContent).toContain("공개 사건 2");
    expect(container.textContent).not.toContain("공개 사건 8");
    expect(mocks.listPublicCases).toHaveBeenCalledWith({
      category: "budget",
      mode: "solo",
      sort: "popular",
      page: 2,
      limit: 6,
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("resets the page when a filter changes and writes the canonical share URL", async () => {
    const familyPost = publicCase(1, { category: "family" });
    mocks.listPublicCases.mockImplementation(async (options: PublicCourtListOptions) => (
      options.category === "family"
        ? publicPage([familyPost], 1, 1)
        : publicPage([publicCase(8), publicCase(7)], 8, 2)
    ));
    window.history.replaceState({}, "", "/wedding/couple-court/public?page=2");

    await act(async () => root.render(<PublicCourtList />));
    await settle();

    const category = container.querySelector<HTMLSelectElement>('select[name="category"]')!;
    await act(async () => {
      category.value = "family";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/wedding/couple-court/public?category=family",
      { scroll: false },
    );
    expect(container.textContent).toContain("공개 사건 1");
    expect(container.querySelector('nav[aria-label="공개 재판 페이지"]')).toBeNull();
  });

  it("restores state on browser history navigation", async () => {
    mocks.listPublicCases.mockImplementation(async (options: PublicCourtListOptions) => (
      options.mode === "couple"
        ? publicPage([publicCase(11, { mode: "couple" })], 7, 2)
        : publicPage(Array.from({ length: 6 }, (_, index) => publicCase(index + 1)), 14, 1)
    ));

    await act(async () => root.render(<PublicCourtList />));
    await settle();
    mocks.replace.mockClear();

    await act(async () => {
      window.history.pushState({}, "", "/wedding/couple-court/public?mode=couple&page=2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();

    expect(container.querySelectorAll("fieldset button")[2]?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("2 / 2");
    expect(container.textContent).toContain("공개 사건 11");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("removes malformed managed values while preserving unrelated query data", async () => {
    mocks.listPublicCases.mockResolvedValue(publicPage([publicCase(1)]));
    window.history.replaceState(
      {},
      "",
      "/wedding/couple-court/public?category=unknown&mode=duo&sort=oldest&page=01&utm_source=test",
    );

    await act(async () => root.render(<PublicCourtList />));
    await settle();

    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/wedding/couple-court/public?utm_source=test",
      { scroll: false },
    );
  });

  it("clamps an out-of-range page after the result set loads", async () => {
    mocks.listPublicCases.mockResolvedValue(publicPage([publicCase(8), publicCase(7)], 8, 2));
    window.history.replaceState({}, "", "/wedding/couple-court/public?page=999");

    await act(async () => root.render(<PublicCourtList />));
    await settle();

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("2 / 2");
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/wedding/couple-court/public?page=2",
      { scroll: false },
    );
  });

  it("shows a filter-specific empty state when the server finds no global match", async () => {
    mocks.listPublicCases.mockResolvedValue(publicPage([], 0, 1));
    window.history.replaceState({}, "", "/wedding/couple-court/public?category=family");

    await act(async () => root.render(<PublicCourtList />));
    await settle();

    expect(container.textContent).toContain("선택한 조건의 공개 사건은 아직 없어요");
    expect(container.querySelector<HTMLSelectElement>('select[name="category"]')?.value).toBe("family");
  });
});
