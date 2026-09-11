import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmoraActionItem } from "@/lib/amora/actions";
import type { ProgressItem } from "@/types/database.types";
import { CHECKLIST_MAP } from "@/constants/checklists";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "user-a" }, profile: { id: "user-a", couple_id: "couple-a" },
    partner: null as { id: string; name: string; couple_id: string } | null,
    journey: { couple_id: "couple-a", progress: {} as Record<string, ProgressItem> },
    isInitialized: true, isLoading: false, isDemo: false,
    updateJourney: vi.fn(),
  },
  publishAuth: () => {},
  actions: [] as AmoraActionItem[], loading: false, error: null as string | null,
  refresh: vi.fn(), open_count: 0, truncated: false,
}));
vi.mock("@/stores/authStore", async () => {
  const { create } = await import("zustand");
  const useAuthStore = create(() => ({ ...mocks.auth }));
  mocks.publishAuth = () => useAuthStore.setState({ ...mocks.auth }, true);
  return { useAuthStore };
});
vi.mock("@/hooks/useAmoraPreparationActions", () => ({ useAmoraPreparationActions: () => mocks }));
vi.mock("next/link", () => ({
  default: ({ children, href, as, prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string; prefetch?: boolean }) => {
    void prefetch;
    return <a href={as ?? href} {...props}>{children}</a>;
  },
}));
import AmoraMissions from "./AmoraMissions";

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

describe("미션 화면의 기록 경계와 탐색", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.auth.user.id = "user-a";
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    mocks.auth.partner = null;
    mocks.auth.journey = { couple_id: "couple-a", progress: {} };
    mocks.auth.isInitialized = true;
    mocks.auth.isLoading = false;
    mocks.auth.isDemo = false;
    mocks.auth.updateJourney.mockReset().mockImplementation(async (updates: { progress: Record<string, ProgressItem> }) => {
      mocks.auth.journey = { ...mocks.auth.journey, ...updates };
      mocks.publishAuth();
      return { status: "applied", journey: mocks.auth.journey };
    });
    mocks.actions = [];
    mocks.loading = false;
    mocks.error = null;
    mocks.open_count = 0;
    mocks.truncated = false;
    mocks.refresh.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });
  async function render(embedded = false) {
    await act(async () => { mocks.publishAuth(); root.render(<AmoraMissions embedded={embedded} />); });
  }

  it("허브는 실제 공유 할 일 수와 우선순위를 보여주고 단계·체크리스트 추천을 중복하지 않는다", async () => {
    mocks.actions = [
      { id: "normal", title: "확인한 견적 정리", status: "open", priority: "medium", source: "manual", href: "/budget", createdAt: "2026-09-01", updatedAt: "2026-09-01" },
      { id: "important", title: "두 사람이 정한 중요한 할 일", status: "open", priority: "high", source: "manual", href: "/schedule", createdAt: "2026-09-01", updatedAt: "2026-09-01" },
    ];
    mocks.open_count = 7;
    await act(async () => { mocks.publishAuth(); root.render(<AmoraMissions hub />); });
    expect(container.querySelector('#shared-missions-title')?.textContent).toContain("공유 할 일7개");
    expect(container.querySelectorAll('button[aria-label$="단계 보기"]')).toHaveLength(0);
    expect(container.textContent).not.toContain("체크리스트에서 이어갈");
    expect(container.querySelector('.divide-y a')?.textContent).toContain("두 사람이 정한 중요한 할 일");
    expect(container.querySelector('.divide-y a')?.getAttribute("href")).toBe("/wedding/chat/board?view=tasks");
    expect(mocks.auth.updateJourney).not.toHaveBeenCalled();

    mocks.error = "unavailable";
    await act(async () => { root.render(<AmoraMissions hub />); });
    expect(container.textContent).not.toContain("두 사람이 정한 중요한 할 일");
    expect(container.querySelector('#shared-missions-title')?.textContent).not.toContain("7개");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("불러오지 못했어요");
    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("허브의 예정일 있는 공유 할 일은 보드로 연결하고 일반 미션의 저장된 실행 링크는 유지한다", async () => {
    const action: AmoraActionItem = {
      id: "task-with-due-date", title: "초대 명단 초안 정리", status: "open", priority: "high",
      source: "manual", href: "/schedule", dueDate: "2026-09-13",
      createdAt: "2026-09-01", updatedAt: "2026-09-01",
    };
    mocks.actions = [action];
    mocks.open_count = 1;
    await act(async () => { mocks.publishAuth(); root.render(<AmoraMissions hub />); });

    const row = [...container.querySelectorAll("a")].find(link => link.textContent?.includes(action.title));
    expect(row?.textContent).toContain("등록한 예정일 · 2026-09-13");
    expect(row?.getAttribute("href")).toBe("/wedding/chat/board?view=tasks");
    const allTasks = [...container.querySelectorAll("a")].find(link => link.textContent?.includes("전체 보기"));
    expect(allTasks?.getAttribute("href")).toBe("/wedding/chat/board?view=tasks");

    await render();
    const mission = [...container.querySelectorAll("article")].find(card => card.querySelector("h3")?.textContent === action.title);
    expect(mission).toBeDefined();
    const executionLinks = [...mission!.querySelectorAll("a")];
    expect(executionLinks.length).toBeGreaterThan(0);
    expect(executionLinks.every(link => link.getAttribute("href") === "/wedding/schedule")).toBe(true);
    expect(action.href).toBe("/schedule");
    expect(action.dueDate).toBe("2026-09-13");
    expect(mocks.auth.updateJourney).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("허브도 계정 전환 중 이전 소유자의 공유 할 일을 가린다", async () => {
    mocks.actions = [{ id: "old", title: "이전 계정 비공개 할 일", status: "open", priority: "high", source: "manual", createdAt: "2026-09-01", updatedAt: "2026-09-01" }];
    mocks.open_count = 1;
    mocks.auth.user.id = "user-b";
    await act(async () => { mocks.publishAuth(); root.render(<AmoraMissions hub />); });
    expect(container.textContent).not.toContain("이전 계정 비공개 할 일");
    expect(container.querySelector('#shared-missions-title')?.textContent).not.toContain("1개");
    expect(container.textContent).toContain("준비 정보를 아직 확인할 수 없어요");
  });

  it("라운지 내장 미션은 단계·체크 시트를 유지하고 보조 파트너 요약을 중복 표시하지 않는다", async () => {
    await render(true);
    expect(container.querySelectorAll('button[aria-label$="단계 보기"]')).toHaveLength(5);
    expect(container.querySelector('aside[aria-label="함께하는 준비 요약"]')).toBeNull();
    expect(container.querySelector('#today-missions-title')?.textContent).toBe("오늘의 미션");
    expect(container.querySelector('a[href="/wedding/chat/board?view=tasks"]')).not.toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('section[aria-labelledby="missions-heading"] button[aria-label$="체크리스트 열기"]')!;
    expect(trigger).not.toBeNull();
    trigger.focus();
    await act(async () => trigger.click());
    expect(document.querySelector('[data-planning-sheet][role="dialog"]')).not.toBeNull();
    expect(mocks.auth.updateJourney).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(trigger);
    mocks.error = "unavailable";
    await render(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("불러오지 못했어요");
    expect(container.textContent).not.toContain("저장된 공유 할 일은 없어요");
  });

  it("빈 공유 할 일과 조회 실패를 구분하고 실패는 다시 불러올 수 있다", async () => {
    await render();
    expect(container.textContent).toContain("저장된 공유 할 일은 없어요");
    mocks.error = "unavailable";
    await render();
    expect(container.textContent).not.toContain("저장된 공유 할 일은 없어요");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("불러오지 못했어요");
    expect(container.querySelector("aside section")?.textContent).not.toContain("0개 완료");
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("다시 불러오기"));
    await act(async () => button?.click());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("오래된 커플 준비 정보와 파트너를 현재 화면에 노출하지 않는다", async () => {
    mocks.auth.journey = { couple_id: "old-couple", progress: { meeting: {
      status: "in_progress", checklist: [{ id: "private", label: "이전 커플의 메모", done: false }],
    } } };
    mocks.auth.partner = { id: "old-partner", couple_id: "old-couple", name: "이전 파트너" };
    await render();
    expect(container.textContent).toContain("준비 정보를 아직 확인할 수 없어요");
    expect(container.textContent).not.toContain("이전 커플의 메모");
    expect(container.textContent).not.toContain("이전 파트너");
    expect(container.querySelector("progress")).toBeNull();
  });

  it("인증 사용자가 바뀌면 이전 프로필에 남은 행동 카드를 가린다", async () => {
    mocks.actions = [{ id: "old", title: "이전 사용자 할 일", status: "open", priority: "medium", source: "manual", createdAt: "2026-09-01", updatedAt: "2026-09-01" }];
    mocks.auth.user.id = "user-b";
    await render();
    expect(container.textContent).not.toContain("이전 사용자 할 일");
    expect(container.querySelector("progress")).toBeNull();
  });

  it("다섯 단계 모두 잠금 없이 살펴보고 실제 체크리스트와 대화·준비 기록으로 연결한다", async () => {
    await render();
    const stages = container.querySelectorAll<HTMLButtonElement>('button[aria-label$="단계 보기"]');
    expect(stages).toHaveLength(5);
    expect([...stages].every((button) => !button.disabled)).toBe(true);
    expect([...stages].every((button) => button.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(container.querySelector("#selected-mission-stage")).toBeNull();
    await act(async () => stages[4].click());
    expect(stages[4].getAttribute("aria-pressed")).toBe("true");
    expect(stages[4].getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('#selected-mission-stage-title')?.textContent).toContain("신혼여행·혼인신고");
    expect(container.querySelector('a[href^="/wedding/checklist?category="]')).not.toBeNull();
    expect(container.querySelector('a[href="/wedding/chat/board"]')).not.toBeNull();
    expect(container.querySelector('a[href="/wedding/chat"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="단계 상세 접기"]')!.click());
    expect(container.querySelector("#selected-mission-stage")).toBeNull();
    expect(stages[4].getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(stages[4]);
    await act(async () => stages[4].click());
    const recommended = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("추천 단계로 돌아가기"))!;
    await act(async () => recommended.click());
    expect(stages[0].getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('#selected-mission-stage-title')?.textContent).toBe("상견례 준비");
    expect(mocks.auth.updateJourney).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("단계 상세를 펼치지 않아도 첫 제안에서 실제 체크리스트를 열고 닫은 뒤 초점을 되돌린다", async () => {
    await render();
    const card = container.querySelector('section[aria-labelledby="missions-heading"] article')!;
    expect(card.querySelector("h3")?.textContent).toBe(`${CHECKLIST_MAP.greeting.label} 준비 이어가기`);
    const trigger = card.querySelector<HTMLButtonElement>("button")!;
    trigger.focus();
    await act(async () => trigger.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const dialog = document.querySelector('[data-planning-sheet][role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(CHECKLIST_MAP.greeting.label);
    expect(dialog?.querySelectorAll('[role="checkbox"]').length).toBe(CHECKLIST_MAP.greeting.items.length);
    expect(container.querySelector("#selected-mission-stage")).toBeNull();
    expect(mocks.auth.updateJourney).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[data-planning-sheet]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  async function openMission(label: string) {
    if (!container.querySelector("#selected-mission-stage")) {
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-current="step"]')!.click());
    }
    const trigger = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.getAttribute("aria-label") === label)!;
    expect(trigger).toBeDefined();
    const categoryList = trigger.closest("details");
    if (categoryList && !categoryList.open) {
      await act(async () => categoryList.querySelector("summary")!.click());
      expect(categoryList.open).toBe(true);
    }
    trigger.focus();
    await act(async () => trigger.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const dialog = document.querySelector<HTMLElement>('[data-planning-sheet][role="dialog"]');
    expect(dialog).not.toBeNull();
    return { dialog: dialog!, trigger };
  }

  it("미션에서 마지막 항목을 저장하면 다음 단계를 추천하고 해제하면 이전 단계로 돌아온다", async () => {
    mocks.auth.journey.progress = Object.fromEntries(["greeting", "meeting"].map(key => [key, {
      status: "completed", checklist: CHECKLIST_MAP[key].items.map((item, index) => ({ ...item, done: key !== "greeting" || index !== CHECKLIST_MAP.greeting.items.length - 1 })),
    }]));
    await render();
    const { dialog, trigger } = await openMission(`${CHECKLIST_MAP.greeting.label} 미션 이어하기`);
    const last = [...dialog.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].at(-1)!;
    await act(async () => last.click());
    await render();
    expect(mocks.auth.updateJourney).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-current="step"]')?.getAttribute("aria-label")).toBe("예산·업체 확정 단계 보기");
    expect(container.querySelector('#selected-mission-stage-title')?.parentElement?.textContent).toContain("2 / 2개 분야 완료");
    await act(async () => last.click());
    await render();
    expect(container.querySelector('[aria-current="step"]')?.getAttribute("aria-label")).toBe("상견례 준비 단계 보기");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[data-planning-sheet]')).toBeNull();
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement).toBe(container.querySelector('button[aria-label="상견례 준비 단계 보기"]'));
  });

  it("저장 실패로 단계를 완료하지 않고 체크를 되돌린 뒤 같은 창에서 재시도한다", async () => {
    mocks.auth.updateJourney.mockRejectedValueOnce(new Error("합성 저장 실패"));
    await render();
    const { dialog } = await openMission(`${CHECKLIST_MAP.greeting.label} 미션 시작`);
    const first = dialog.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    await act(async () => first.click());
    await render();
    expect(first.getAttribute("aria-checked")).toBe("false");
    expect(dialog.textContent).toContain("합성 저장 실패");
    expect(container.querySelector('#selected-mission-stage-title')?.parentElement?.textContent).toContain("0 / 2개 분야 완료");
    await act(async () => first.click());
    await render();
    expect(first.getAttribute("aria-checked")).toBe("true");
    expect(mocks.auth.updateJourney).toHaveBeenCalledTimes(2);
  });

  it("해당 없는 분야도 복구할 수 있고 계정·커플이 바뀌면 열었던 창을 즉시 가린다", async () => {
    mocks.auth.journey.progress = { greeting: { status: "not_applicable" }, meeting: { status: "not_applicable" } };
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="상견례 준비 단계 보기"]')!.click());
    const { dialog } = await openMission(`${CHECKLIST_MAP.greeting.label} 체크리스트 열기`);
    const restore = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("다시 준비 목록에 넣기"))!;
    await act(async () => restore.click());
    await render();
    expect(mocks.auth.journey.progress.greeting.status).toBe("not_started");
    expect(container.querySelector('[aria-current="step"]')?.getAttribute("aria-label")).toBe("상견례 준비 단계 보기");
    mocks.auth.user.id = "user-b";
    await render();
    expect(document.querySelector('[data-planning-sheet]')).toBeNull();
    expect(mocks.auth.updateJourney).toHaveBeenCalledTimes(1);
  });

  it.each(["계정", "커플"])("%s을 A → B → A로 바꿔도 이전 창과 단계 선택이 되살아나지 않는다", async (scopeType) => {
    await render();
    await act(async () => container.querySelectorAll<HTMLButtonElement>('button[aria-label$="단계 보기"]')[4].click());
    await openMission(`${CHECKLIST_MAP.honeymoon.label} 체크리스트 열기`);
    const originalJourney = mocks.auth.journey;
    if (scopeType === "계정") mocks.auth.user.id = "user-b";
    mocks.auth.profile = { id: mocks.auth.user.id, couple_id: "couple-b" };
    mocks.auth.journey = { couple_id: "couple-b", progress: {} };
    await render();
    expect(document.querySelector('[data-planning-sheet]')).toBeNull();
    mocks.auth.user.id = "user-a";
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    mocks.auth.journey = originalJourney;
    await render();
    expect(document.querySelector('[data-planning-sheet]')).toBeNull();
    expect(container.querySelector('button[aria-pressed="true"]')?.getAttribute("aria-label")).toBe("상견례 준비 단계 보기");
    expect(container.querySelector("#selected-mission-stage")).toBeNull();
    expect(mocks.auth.updateJourney).not.toHaveBeenCalled();
  });

  it("데모 표시는 데모 모드에서만 보이고 잘린 목록의 완료 수는 범위를 명시한다", async () => {
    mocks.truncated = true;
    mocks.open_count = 91;
    mocks.actions = [{ id: "done", title: "실제 완료 기록", status: "done", priority: "medium", source: "manual", createdAt: "2026-09-01", updatedAt: "2026-09-01" }];
    await render();
    expect(container.textContent).not.toContain("예시 화면");
    expect(container.textContent).toContain("1개 완료");
    expect(container.textContent).toContain("불러온 목록에서 완료로 표시한 수");
    expect(container.textContent).toContain("공유 할 일 91개 남았어요");
    mocks.auth.isDemo = true;
    await render();
    expect(container.querySelector('[role="note"]')?.textContent).toContain("데모 데이터");
  });
});
