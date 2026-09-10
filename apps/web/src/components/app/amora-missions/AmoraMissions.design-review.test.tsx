import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmoraActionItem } from "@/lib/amora/actions";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "mission-design-user" },
    profile: { id: "mission-design-user", couple_id: "mission-design-couple" },
    partner: null,
    journey: { couple_id: "mission-design-couple", progress: {} },
    isInitialized: true, isLoading: false, isDemo: false,
  },
  actions: [] as AmoraActionItem[],
  open_count: 0,
  loading: false,
  error: null,
  truncated: false,
  refresh: vi.fn(),
}));

vi.mock("@/stores/authStore", () => ({ useAuthStore: () => mocks.auth }));
vi.mock("@/hooks/useAmoraPreparationActions", () => ({ useAmoraPreparationActions: () => mocks }));
vi.mock("next/link", () => ({
  default: ({ children, href, as, prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string; prefetch?: boolean }) => {
    void prefetch;
    return <a href={as ?? href} {...props}>{children}</a>;
  },
}));

import AmoraMissions from "./AmoraMissions";

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

function sharedAction(index: number): AmoraActionItem {
  return {
    id: `mission-design-${index}`,
    title: `담당자와 일정 확인 ${index}`,
    status: "open",
    priority: "medium",
    source: "manual",
    href: "/schedule",
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
  };
}

describe("미션 화면의 제목과 공유 할 일 이동", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.actions = [sharedAction(1), sharedAction(2), sharedAction(3)];
    mocks.open_count = 3;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function render() {
    await act(async () => root.render(<AmoraMissions />));
  }

  it("라운지에서는 실행할 미션을 단계 설명보다 먼저 읽고 조작할 수 있다", async () => {
    await act(async () => root.render(<AmoraMissions embedded />));
    const missions = container.querySelector('section[aria-labelledby="missions-heading"]')!;
    const path = container.querySelector('section[aria-labelledby="mission-path-title"]')!;
    expect(missions.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('#mission-path-title')).toHaveLength(1);
    expect(path.querySelectorAll('button[aria-label$="단계 보기"]')).toHaveLength(5);
  });

  it("내장 미션에서도 예정일을 한 번 표시하고 날짜 해석이나 체크리스트 날짜를 만들지 않는다", async () => {
    for (const dueDate of ["2026-09-15", "다음 상담 후, 두 사람이 가능한 날"]) {
      mocks.actions = [{ ...sharedAction(1), dueDate }];
      mocks.open_count = 1;
      await act(async () => root.render(<AmoraMissions embedded />));
      const cards = container.querySelectorAll('section[aria-labelledby="missions-heading"] article');
      const dateLines = [...cards[0].querySelectorAll("p")].filter(line => line.textContent?.startsWith("예정일 "));
      expect(dateLines).toHaveLength(1);
      expect(dateLines[0].textContent).toBe(`예정일 ${dueDate}`);
      expect(cards[1].textContent).not.toContain("예정일");
      expect(cards[0].textContent).not.toMatch(/지연|일 남음|D-|마감/);
    }
    mocks.actions = [sharedAction(1)];
    await act(async () => root.render(<AmoraMissions embedded />));
    expect(container.querySelector('section[aria-labelledby="missions-heading"]')?.textContent).not.toContain("예정일");
  });

  it("공유 할 일과 체크리스트 제안이 섞인 카드의 제목에 전체 공유 할 일 수를 붙이지 않는다", async () => {
    await render();
    const section = container.querySelector('section[aria-labelledby="missions-heading"]')!;
    const cards = section.querySelectorAll("article");
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("공유 할 일");
    expect(cards[1].textContent).toContain("체크리스트에서 제안");
    expect(section.querySelector("h2")?.textContent).toContain("오늘 이어갈 준비");
    expect(section.querySelector("h2")?.textContent).not.toContain("공유 할 일 3개");
    expect(section.textContent).toContain("공유 할 일 3개 남았어요");
  });

  it("나머지 공유 할 일은 결정 목록 대신 보드의 공유 할 일 화면으로 안내한다", async () => {
    await render();
    const link = [...container.querySelectorAll("a")].find(item => item.textContent?.includes("모든 공유 할 일 보기"));
    expect(link?.getAttribute("href")).toBe("/wedding/chat/board?view=tasks");
    const firstCard = container.querySelector('section[aria-labelledby="missions-heading"] article')!;
    expect(firstCard.querySelector("a")?.getAttribute("href")).toBe("/wedding/schedule");
  });

  it("보이는 카드에 공유 할 일을 모두 담았으면 추가 목록을 요구하지 않는다", async () => {
    mocks.actions = [sharedAction(1)];
    mocks.open_count = 1;
    await render();
    expect(container.textContent).not.toContain("모든 공유 할 일 보기");
    const section = container.querySelector('section[aria-labelledby="missions-heading"]')!;
    expect(section.querySelectorAll("article")).toHaveLength(2);
    expect(section.querySelector('button[aria-label$="체크리스트 열기"]')).not.toBeNull();
  });

  it("완료한 공유 할 일 카드도 공유 할 일 목록에서 다시 확인한다", async () => {
    mocks.actions = [{ ...sharedAction(1), status: "done" }];
    mocks.open_count = 0;
    await render();
    const completed = [...container.querySelectorAll("article")].find(card => card.querySelector("h3")?.textContent === "담당자와 일정 확인 1");
    expect(completed).toBeDefined();
    const links = [...completed!.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(0);
    expect(links.every(link => link.getAttribute("href") === "/wedding/chat/board?view=tasks")).toBe(true);
    expect(container.querySelector('a[href="/wedding/chat/board"]')).not.toBeNull();
  });
});
