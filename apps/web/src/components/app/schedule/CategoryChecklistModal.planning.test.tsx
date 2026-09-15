// @vitest-environment jsdom

import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressItem } from "@/types/database.types";

const mocks = vi.hoisted(() => ({
  progress: {} as Record<string, ProgressItem>,
  updateJourney: vi.fn(),
  ownerId: "owner-a",
  coupleId: "couple-a",
  listeners: new Set<() => void>(),
}));
vi.mock("@/stores/authStore", () => {
  const getState = () => ({
    isDemo: false,
    user: { id: mocks.ownerId },
    profile: { id: mocks.ownerId, couple_id: mocks.coupleId, role: "bride" },
    couple: { id: mocks.coupleId, bride_id: mocks.ownerId, groom_id: null },
    journey: { id: `journey-${mocks.coupleId}`, couple_id: mocks.coupleId, progress: mocks.progress },
    updateJourney: mocks.updateJourney,
  });
  return { useAuthStore: Object.assign(getState, {
    getState,
    subscribe: (listener: () => void) => { mocks.listeners.add(listener); return () => { mocks.listeners.delete(listener); }; },
  }) };
});
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => {
    void prefetch;
    return <a href={typeof href === "string" ? href : "#"} {...props}>{children}</a>;
  },
}));

import CategoryChecklistModal from "./CategoryChecklistModal";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { checklistItemTag, groupChecklistItems, PREPARATION_PROGRESS_STATUS_LABELS } from "@hanbang/shared/constants";

const testEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

describe("planning checklist sheet", () => {
  let root: Root;
  let container: HTMLDivElement;
  let trigger: HTMLButtonElement;
  const onClose = vi.fn();

  beforeEach(() => {
    testEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mocks.progress = {};
    mocks.ownerId = "owner-a";
    mocks.coupleId = "couple-a";
    mocks.updateJourney.mockReset().mockResolvedValue({ status: "applied" });
    onClose.mockReset();
    container = document.createElement("div");
    trigger = document.createElement("button");
    document.body.append(trigger, container);
    trigger.focus();
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    trigger.remove();
    document.body.style.overflow = "";
    vi.useRealTimers();
    testEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });
  async function render(categoryKey = "greeting", isOpen = true) {
    await act(async () => root.render(<CategoryChecklistModal categoryKey={categoryKey} isOpen={isOpen} onClose={onClose} presentation="planning" />));
    await act(async () => vi.runOnlyPendingTimers());
  }
  function dialog() { return document.querySelector<HTMLElement>('[data-planning-sheet]')!; }
  function checkboxes() { return Array.from(dialog().querySelectorAll<HTMLButtonElement>('[role="checkbox"]')); }
  async function switchOwner(ownerId: string, progress: Record<string, ProgressItem>, flush = true) {
    await act(async () => {
      mocks.ownerId = ownerId;
      mocks.coupleId = `couple-${ownerId}`;
      mocks.progress = progress;
      for (const listener of mocks.listeners) listener();
      root.render(<CategoryChecklistModal categoryKey="greeting" isOpen onClose={onClose} presentation="planning" />);
    });
    if (flush) await act(async () => vi.runOnlyPendingTimers());
  }

  it.each(["reject", "applied", "pending_partner"])("ignores old owner %s after another owner's checklist opens", async outcome => {
    let settle!: (value: { status: string }) => void;
    let reject!: (error: Error) => void;
    mocks.updateJourney.mockImplementationOnce(() => new Promise((resolve, fail) => { settle = resolve; reject = fail; }));
    await render();
    await act(async () => checkboxes()[0].click());
    const nextProgress = { greeting: { category: "greeting", status: "in_progress" as const, checklist: CHECKLIST_MAP.greeting.items.map((item, index) => ({ ...item, done: index === 1 })) } };
    await switchOwner("owner-b", nextProgress);
    const before = checkboxes().map(button => button.getAttribute("aria-checked"));
    await act(async () => { if (outcome === "reject") reject(new Error("A의 늦은 실패")); else settle({ status: outcome }); });
    expect(checkboxes().map(button => button.getAttribute("aria-checked"))).toEqual(before);
    expect(dialog().textContent).not.toMatch(/A의 늦은 실패|체크 상태를 저장했어요|상대방에게 확인을 요청했어요/);
    expect(checkboxes().every(button => !button.disabled)).toBe(true);
    await act(async () => checkboxes()[0].click());
    expect(mocks.updateJourney.mock.calls[1][0].progress.greeting.checklist[1].done).toBe(true);
  });

  it("does not expose or save A's custom rows during B's initial merge timer", async () => {
    mocks.progress.greeting = { category: "greeting", status: "in_progress", checklist: [{ id: "greeting_only_a", label: "A에게만 있는 기록", done: true }] };
    await render();
    const staleButton = checkboxes()[0];
    await switchOwner("owner-b", {}, false);
    expect(dialog().textContent).not.toContain("A에게만 있는 기록");
    await act(async () => staleButton.click());
    expect(mocks.updateJourney).not.toHaveBeenCalled();
    const exclude = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes("우리는 이건 안 해요"))!;
    await act(async () => exclude.click());
    expect(mocks.updateJourney).not.toHaveBeenCalled();
    await act(async () => vi.runOnlyPendingTimers());
    expect(checkboxes()).toHaveLength(CHECKLIST_MAP.greeting.items.length);
  });

  it("invalidates a pending save when A to B to A happens before a render", async () => {
    let reject!: (error: Error) => void;
    mocks.updateJourney.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await render();
    await act(async () => checkboxes()[0].click());
    await act(async () => {
      for (const owner of ["owner-b", "owner-a"]) {
        mocks.ownerId = owner;
        for (const listener of mocks.listeners) listener();
      }
      mocks.progress = { greeting: { category: "greeting", status: "completed", checklist: CHECKLIST_MAP.greeting.items.map(item => ({ ...item, done: true })) } };
      root.render(<CategoryChecklistModal categoryKey="greeting" isOpen onClose={onClose} presentation="planning" />);
    });
    await act(async () => vi.runOnlyPendingTimers());
    await act(async () => reject(new Error("옛 A 저장 실패")));
    expect(checkboxes().every(button => button.getAttribute("aria-checked") === "true")).toBe(true);
    expect(dialog().textContent).not.toContain("옛 A 저장 실패");
  });

  it("clears the old checklist on a couple-only change for the same user", async () => {
    mocks.progress.greeting = { category: "greeting", status: "in_progress", checklist: [{ id: "greeting_old_couple", label: "예전 커플의 기록", done: true }] };
    await render();
    await switchOwner("owner-a", {}, false);
    expect(dialog().textContent).not.toContain("예전 커플의 기록");
    await act(async () => vi.runOnlyPendingTimers());
    await act(async () => checkboxes()[0].click());
    expect(mocks.updateJourney.mock.calls[0][0].progress.greeting.checklist).toHaveLength(CHECKLIST_MAP.greeting.items.length);
  });

  it("observes A to B to A even when the canonical progress object is unchanged", async () => {
    let settle!: (value: { status: string }) => void;
    mocks.updateJourney.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    await render();
    await act(async () => checkboxes()[0].click());
    await act(async () => {
      for (const owner of ["owner-b", "owner-a"]) {
        mocks.ownerId = owner;
        for (const listener of mocks.listeners) listener();
      }
      root.render(<CategoryChecklistModal categoryKey="greeting" isOpen onClose={onClose} presentation="planning" />);
    });
    await act(async () => vi.runOnlyPendingTimers());
    await act(async () => settle({ status: "applied" }));
    expect(checkboxes().every(button => button.getAttribute("aria-checked") === "false")).toBe(true);
    expect(dialog().textContent).not.toContain("체크 상태를 저장했어요");
  });

  it("waits for a fresh canonical checklist before allowing a same-owner click", async () => {
    await render();
    mocks.progress = { greeting: { category: "greeting", status: "in_progress", checklist: CHECKLIST_MAP.greeting.items.map((item, index) => ({ ...item, done: index === 1 })) } };
    await act(async () => root.render(<CategoryChecklistModal categoryKey="greeting" isOpen onClose={onClose} presentation="planning" />));
    expect(checkboxes()[0].disabled).toBe(true);
    await act(async () => checkboxes()[0].click());
    expect(mocks.updateJourney).not.toHaveBeenCalled();
    await act(async () => vi.runOnlyPendingTimers());
    await act(async () => checkboxes()[0].click());
    expect(mocks.updateJourney.mock.calls[0][0].progress.greeting.checklist[1].done).toBe(true);
  });

  it.each(["another-category", "reopened"])("ignores a pending failure in a %s sheet", async mode => {
    let reject!: (error: Error) => void;
    mocks.updateJourney.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await render();
    await act(async () => checkboxes()[0].click());
    const category = mode === "another-category" ? "housing" : "greeting";
    if (mode === "reopened") await render("greeting", false);
    mocks.progress = { [category]: { category, status: "completed", checklist: CHECKLIST_MAP[category].items.map(item => ({ ...item, done: true })) } };
    await render(category);
    await act(async () => reject(new Error("닫힌 시트의 실패")));
    expect(checkboxes()).toHaveLength(CHECKLIST_MAP[category].items.length);
    expect(checkboxes().every(button => button.getAttribute("aria-checked") === "true")).toBe(true);
    expect(dialog().textContent).not.toContain("닫힌 시트의 실패");
  });

  it.each(["venue", "greeting", "housing", "registration"])("keeps every canonical %s item and its display order in the scroll body", async (categoryKey) => {
    await render(categoryKey);
    const expected = groupChecklistItems(categoryKey, CHECKLIST_MAP[categoryKey].items).flatMap(group => group.items);
    expect(checkboxes()).toHaveLength(CHECKLIST_MAP[categoryKey].items.length);
    expect(checkboxes().map(button => button.getAttribute("aria-labelledby")?.split("-").at(-2))).toEqual(expected.map(item => item.id));
    for (const button of checkboxes()) expect(button.closest('[data-planning-body]')).not.toBeNull();
    expect(mocks.updateJourney).not.toHaveBeenCalled();
  });

  it.each(["venue", "greeting", "housing", "registration"])("offers independent %s category and item questions without changing checks", async (categoryKey) => {
    await render(categoryKey);
    const links = Array.from(dialog().querySelectorAll<HTMLAnchorElement>('a[href*="amoraSource="]'));
    expect(links.map(link => link.getAttribute("href"))).toEqual([
      ...groupChecklistItems(categoryKey, CHECKLIST_MAP[categoryKey].items).flatMap(group => group.items).map(item => `/chat?amoraSource=c.${categoryKey}.${item.id}`),
      `/chat?amoraSource=c.${categoryKey}`,
    ]);
    const before = checkboxes().map(button => button.getAttribute("aria-checked"));
    for (const link of links) {
      expect(link.closest('[role="checkbox"]')).toBeNull();
      expect(link.getAttribute("aria-label")).toBeTruthy();
      link.addEventListener("click", event => event.preventDefault());
      await act(async () => link.click());
    }
    expect(checkboxes().map(button => button.getAttribute("aria-checked"))).toEqual(before);
    expect(mocks.updateJourney).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("체크 상태는 바뀌지 않아요");
  });

  it("portals with labelled dialog, traps focus, closes on Escape and restores the opener", async () => {
    await render();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.getElementById(dialog().getAttribute("aria-labelledby")!)?.textContent).toBe(CHECKLIST_MAP.greeting.label);
    const close = dialog().querySelector<HTMLButtonElement>('[data-planning-close]')!;
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");
    const links = dialog().querySelectorAll<HTMLAnchorElement>('a[href]');
    const last = links[links.length - 1];
    last.focus();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(close);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    await render("greeting", false);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps category-only completion distinct from checked items", async () => {
    mocks.progress.greeting = { category: "greeting", status: "completed" };
    await render();
    expect(dialog().textContent).toContain("분야 상태로 표시함 · 항목은 확인 전");
    expect(dialog().textContent).not.toContain("다음 할 일");
    expect(dialog().querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBeNull();
    expect(checkboxes().every(button => button.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it.each([
    ["not_started", undefined, "아직"],
    ["in_progress", { category: "greeting", status: "in_progress", checklist: CHECKLIST_MAP.greeting.items.map((item, index) => ({ ...item, done: index === 0 })) }, "준비 중"],
    ["completed", { category: "greeting", status: "completed" }, "완료"],
    ["not_applicable", { category: "greeting", status: "not_applicable" }, "안 해요"],
  ] as const)("names the %s status with the shared preparation label", async (status, saved, label) => {
    if (saved) mocks.progress.greeting = saved as ProgressItem;
    await render();
    const chip = dialog().querySelector("h2")?.nextElementSibling?.firstElementChild;
    expect(chip?.textContent).toBe(PREPARATION_PROGRESS_STATUS_LABELS[status]);
    expect(chip?.textContent).toBe(label);
    expect(dialog().textContent).not.toMatch(/진행 중|시작 전|해당 없음/);
  });

  it("keeps the conditional tag when a conditional item becomes next", async () => {
    const items = CHECKLIST_MAP.greeting.items;
    const conditional = items.find(item => checklistItemTag(item.id) === "해당 시")!;
    mocks.progress.greeting = { category: "greeting", status: "in_progress", checklist: items.map(item => ({ ...item, done: item.id !== conditional.id })) };
    await render();
    const next = checkboxes().find(button => button.getAttribute("aria-labelledby")?.includes(conditional.id))!;
    expect(next.textContent).toContain("다음 할 일");
    expect(next.textContent).toContain("해당 시");
    expect(document.getElementById(next.getAttribute("aria-labelledby")!)?.getAttribute("aria-label")).toBe(conditional.label);
  });

  it("rolls a failed check back, announces the error, and retries with note-free canonical IDs", async () => {
    mocks.updateJourney.mockRejectedValueOnce(new Error("연결을 확인해 주세요."));
    await render("housing");
    const first = checkboxes()[0];
    await act(async () => first.click());
    expect(first.getAttribute("aria-checked")).toBe("false");
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain("연결을 확인해 주세요.");
    await act(async () => first.click());
    expect(first.getAttribute("aria-checked")).toBe("true");
    const saved = mocks.updateJourney.mock.calls[1][0].progress.housing.checklist;
    expect(saved.map((item: { id: string }) => item.id)).toEqual(CHECKLIST_MAP.housing.items.map(item => item.id));
    expect(saved.every((item: { note?: string }) => !Object.hasOwn(item, "note"))).toBe(true);
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
  });

  it("preserves saved custom items and all checks when excluding a category", async () => {
    mocks.progress.greeting = { category: "greeting", status: "in_progress", checklist: [
      { ...CHECKLIST_MAP.greeting.items[0], done: true },
      { id: "greeting_custom", label: "우리 가족에게 미리 연락하기", done: true },
    ] };
    await render();
    expect(checkboxes()).toHaveLength(CHECKLIST_MAP.greeting.items.length + 1);
    expect(dialog().querySelector('a[href*="amoraSource=c.greeting.greeting_custom"]')).toBeNull();
    const exclude = Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes("우리는 이건 안 해요"))!;
    await act(async () => exclude.click());
    const saved = mocks.updateJourney.mock.calls[0][0].progress.greeting;
    expect(saved.status).toBe("not_applicable");
    expect(saved.checklist.find((item: { id: string }) => item.id === "greeting_custom").done).toBe(true);
    expect(saved.checklist.find((item: { id: string }) => item.id === CHECKLIST_MAP.greeting.items[0].id).done).toBe(true);
  });

  it("keeps source links outside checkboxes and never saves when navigating to a guide", async () => {
    await render("registration");
    const links = Array.from(dialog().querySelectorAll<HTMLAnchorElement>('a[href]:not([href*="amoraSource="])'));
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) {
      expect(link.closest('[role="checkbox"]')).toBeNull();
      expect(link.getAttribute("href")).toMatch(/^\/(manners|etiquette)\//);
    }
    expect(mocks.updateJourney).not.toHaveBeenCalled();
  });

  it("keeps compact question actions named, keyboard reachable and independent from checking", async () => {
    await render("greeting");
    const before = checkboxes().map(button => button.getAttribute("aria-checked"));
    for (const item of CHECKLIST_MAP.greeting.items) {
      const link = dialog().querySelector<HTMLAnchorElement>(`a[href="/chat?amoraSource=c.greeting.${item.id}"]`)!;
      expect(link.getAttribute("aria-label")).toBe(`${item.label} 아모라에 질문하기`);
      expect(link.getAttribute("title")).toBe(`${item.label} 아모라에 질문하기`);
      expect(link.closest('[role="checkbox"]')).toBeNull();
      expect(link.tabIndex).toBe(0);
      link.focus();
      expect(document.activeElement).toBe(link);
      link.addEventListener("click", event => event.preventDefault(), { once: true });
      await act(async () => link.click());
    }
    expect(checkboxes().map(button => button.getAttribute("aria-checked"))).toEqual(before);
    expect(mocks.updateJourney).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("질문 초안을 확인한 뒤 직접 보내요. 체크 상태는 바뀌지 않아요.");
  });
});
