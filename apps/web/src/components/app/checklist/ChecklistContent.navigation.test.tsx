// @vitest-environment jsdom

import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProgressItem } from "@/types/database.types";

vi.mock("next/link", () => ({
  default: ({ children, href, as, prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string; prefetch?: boolean }) => {
    void prefetch;
    return <a href={as ?? (typeof href === "string" ? href : "#")} {...props}>{children}</a>;
  },
}));

const mocks = vi.hoisted(() => ({
  journey: { wedding_date: "2026-10-15", progress: {} as Record<string, ProgressItem> },
  profile: { id: "viewer-profile-id", name: "지은" },
  partner: { id: "partner-profile-id", name: "민준" },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: mocks.journey,
    profile: mocks.profile,
    partner: mocks.partner,
  }),
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T09:00:00+09:00"));
    mocks.journey = { wedding_date: "2026-10-15", progress: {} };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function render() {
    await act(async () => root.render(<ChecklistContent />));
  }

  it("opens each category as a dedicated shareable page instead of a modal", async () => {
    await render();

    const allTab = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.trim() === "전체",
    );
    await act(async () => allTab?.click());

    const categoryLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="부모님 첫 만남 체크리스트 페이지 열기"]',
    );
    expect(categoryLink?.getAttribute("href")).toBe("/wedding/checklist/meeting");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("시작하면 진행률 반영");
  });

  it("separates scope review from execution progress and offers today, week, and all views", async () => {
    await render();

    expect(container.textContent).toContain("준비 범위 검토");
    expect(container.textContent).toContain("실행 완료");
    expect(container.textContent).toContain("0/27개 분야");
    const viewTabs = container.querySelector('[role="tablist"][aria-label="체크리스트 보기"]');
    expect(viewTabs?.textContent).toContain("오늘");
    expect(viewTabs?.textContent).toContain("이번 주");
    expect(viewTabs?.textContent).toContain("전체");
    expect(container.textContent).toContain("아직 검토하지 않은 분야도 전체 완료율에 포함했어요");
    expect(container.textContent).toContain("먼저 검토할 분야");
    expect(container.textContent).toContain("늦은 일로 보지 않고 범위부터 정해요");
  });

  it("surfaces overdue work and can narrow the focus list to my assignments", async () => {
    mocks.journey = {
      wedding_date: "2026-10-15",
      progress: {
        meeting: {
          category: "meeting",
          status: "in_progress",
          checklist: [
            {
              id: "meeting_01",
              label: "양쪽 부모님 첫 만남 날짜 조율",
              done: false,
              state: "blocked",
              dueDate: "2026-08-10",
              assignee: { kind: "member", profileId: "viewer-profile-id" },
            },
            {
              id: "meeting_02",
              label: "장소 정하기",
              done: false,
              state: "waiting",
              dueDate: "2026-08-12",
              assignee: { kind: "member", profileId: "partner-profile-id" },
            },
          ],
        },
      },
    } as typeof mocks.journey;

    await render();
    expect(container.textContent).toContain("양쪽 부모님 첫 만남 날짜 조율");
    expect(container.textContent).toContain("2일 지남");
    expect(container.textContent).toContain("막힘");

    const mine = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.trim() === "내 일",
    );
    await act(async () => mine?.click());
    expect(container.textContent).toContain("양쪽 부모님 첫 만남 날짜 조율");
    expect(container.textContent).not.toContain("장소 정하기");
  });

  it("links to a situation review before excluding optional work", async () => {
    await render();

    const profileLink = Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).find((link) =>
      link.textContent?.includes("우리 상황 설정"),
    );
    expect(profileLink?.getAttribute("href")).toBe("/wedding/settings/wedding-profile");
  });

  it("finds plain-language categories by familiar wedding terms", async () => {
    await render();

    const allTab = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.trim() === "전체",
    );
    await act(async () => allTab?.click());

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
