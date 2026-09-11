// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressItem } from "@/types/database.types";

const mocks = vi.hoisted(() => ({
  pathname: "/checklist",
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
  progress: {} as Record<string, ProgressItem>,
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
  useAuthStore: () => ({ journey: { progress: mocks.progress } }),
}));

vi.mock("@/components/app/schedule/CategoryChecklistModal", () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? <button type="button" data-testid="modal-close" onClick={onClose}>닫기</button> : null
  ),
}));

import ChecklistContent from "./ChecklistContent";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";

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
    mocks.progress = {};
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

  it("offers a source-bound Amora link for every category alongside its checklist and guide", async () => {
    await render();
    for (const category of CATEGORY_CHECKLISTS) {
      const open = container.querySelector(`button[aria-label="${category.label} 체크리스트 열기"]`)!;
      const link = open.closest("li")?.querySelector<HTMLAnchorElement>('a[href*="amoraSource="]');
      expect(link?.getAttribute("href")).toBe(`/chat?amoraSource=c.${category.key}`);
      expect(link?.closest("button")).toBeNull();
      expect(link?.getAttribute("aria-label")).toContain(category.label);
    }
    expect(container.textContent).toContain("질문 초안을 확인한 뒤 직접 보내요");
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="modal-close"]')).toBeNull();
  });

  it("groups every category once in preparation order and keeps every category in the flat view", async () => {
    await render();
    const stages = container.querySelectorAll('[data-checklist-stage]');
    expect(stages).toHaveLength(5);
    expect(stages[0].querySelectorAll('button[aria-label$="체크리스트 열기"]')).toHaveLength(2);
    expect(stages[1].querySelectorAll('button[aria-label$="체크리스트 열기"]')).toHaveLength(5);
    expect(stages[2].querySelectorAll('button[aria-label$="체크리스트 열기"]')).toHaveLength(2);
    expect(stages[3].querySelectorAll('button[aria-label$="체크리스트 열기"]')).toHaveLength(8);
    expect(stages[4].querySelectorAll('button[aria-label$="체크리스트 열기"]')).toHaveLength(4);
    expect(container.querySelectorAll('button[aria-label$="체크리스트 열기"]')).toHaveLength(CATEGORY_CHECKLISTS.length);

    const flatView = container.querySelector<HTMLButtonElement>('button[aria-label="전체 분야 펼쳐보기"]');
    expect(flatView).not.toBeNull();
    await act(async () => flatView?.click());
    expect(flatView?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll('[data-checklist-stage]')).toHaveLength(0);
    expect(container.querySelectorAll('button[aria-label$="체크리스트 열기"]')).toHaveLength(CATEGORY_CHECKLISTS.length);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("searches across stages without changing the overall progress denominator", async () => {
    await render();
    const progressLabel = container.querySelector('[aria-label="전체 체크리스트 진행률"]')?.getAttribute("aria-valuenow");
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(search, "상견례");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll('[data-checklist-stage]')).toHaveLength(1);
    expect(container.querySelector('[aria-label="전체 체크리스트 진행률"]')?.getAttribute("aria-valuenow")).toBe(progressLabel);
    const disabledStage = container.querySelector<HTMLButtonElement>('button[aria-label^="2단계 예산·업체 확정"]');
    expect(disabledStage?.disabled).toBe(true);
  });

  it("keeps declared completion separate from counted items and excludes skipped categories in every summary", async () => {
    const meeting = CATEGORY_CHECKLISTS.find((category) => category.key === "meeting")!;
    const venue = CATEGORY_CHECKLISTS.find((category) => category.key === "venue")!;
    const greeting = CATEGORY_CHECKLISTS.find((category) => category.key === "greeting")!;
    mocks.progress = {
      greeting: { category: "greeting", status: "completed" },
      meeting: { category: "meeting", status: "not_applicable" },
      venue: { category: "venue", status: "in_progress", checklist: [{ ...venue.items[0], done: true }] },
    };
    await render();
    const total = CATEGORY_CHECKLISTS.reduce((sum, category) => sum + category.items.length, 0) - meeting.items.length;
    const overall = container.querySelector<HTMLProgressElement>('[aria-label="전체 체크리스트 진행률"]');
    expect(overall?.value).toBe(Math.round(100 / total));
    expect(container.textContent).toContain(`1개 완료 · ${total - 1}개 남음`);
    const firstStage = container.querySelector('[data-checklist-stage="family"]');
    expect(firstStage?.textContent).toContain(`0/${greeting.items.length}개`);
    expect(container.querySelector('button[aria-current="step"]')?.getAttribute("aria-label")).toBe("2단계 예산·업체 확정 보기");
    const declaration = container.querySelector('button[aria-label="배우자 부모님께 첫인사 체크리스트 열기"]');
    expect(declaration?.textContent).toContain("완료로 표시함");
    expect(declaration?.textContent).toContain("항목은 확인 전");
    expect(declaration?.querySelector("progress")).toBeNull();

    const completed = container.querySelector<HTMLButtonElement>('[aria-label="상태 필터"] button:nth-child(3)');
    await act(async () => completed?.click());
    expect(container.querySelectorAll('button[aria-label$="체크리스트 열기"]')).toHaveLength(1);
    expect(overall?.value).toBe(Math.round(100 / total));
  });

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

  it("restores focus to search when resetting an empty result", async () => {
    await render();
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(search, "존재하지않는준비항목");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const reset = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent === "전체 목록 보기")!;
    expect(reset).toBeDefined();
    reset.focus();
    await act(async () => reset.click());

    expect(reset.isConnected).toBe(false);
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
    expect(container.querySelectorAll('button[aria-label$="체크리스트 열기"]')).toHaveLength(CATEGORY_CHECKLISTS.length);
    expect(mocks.replace).not.toHaveBeenCalled();
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
