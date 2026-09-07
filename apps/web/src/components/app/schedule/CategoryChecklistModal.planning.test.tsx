// @vitest-environment jsdom

import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressItem } from "@/types/database.types";

const mocks = vi.hoisted(() => ({
  progress: {} as Record<string, ProgressItem>,
  updateJourney: vi.fn(),
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ journey: { progress: mocks.progress }, updateJourney: mocks.updateJourney }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => {
    void prefetch;
    return <a href={typeof href === "string" ? href : "#"} {...props}>{children}</a>;
  },
}));

import CategoryChecklistModal from "./CategoryChecklistModal";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { checklistItemTag, groupChecklistItems } from "@hanbang/shared/constants";

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

  it.each(["venue", "greeting", "housing", "registration"])("keeps every canonical %s item and its display order in the scroll body", async (categoryKey) => {
    await render(categoryKey);
    const expected = groupChecklistItems(categoryKey, CHECKLIST_MAP[categoryKey].items).flatMap(group => group.items);
    expect(checkboxes()).toHaveLength(CHECKLIST_MAP[categoryKey].items.length);
    expect(checkboxes().map(button => button.getAttribute("aria-labelledby")?.split("-").at(-2))).toEqual(expected.map(item => item.id));
    for (const button of checkboxes()) expect(button.closest('[data-planning-body]')).not.toBeNull();
    expect(mocks.updateJourney).not.toHaveBeenCalled();
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
    const exclude = Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes("우리는 이건 안 해요"))!;
    await act(async () => exclude.click());
    const saved = mocks.updateJourney.mock.calls[0][0].progress.greeting;
    expect(saved.status).toBe("not_applicable");
    expect(saved.checklist.find((item: { id: string }) => item.id === "greeting_custom").done).toBe(true);
    expect(saved.checklist.find((item: { id: string }) => item.id === CHECKLIST_MAP.greeting.items[0].id).done).toBe(true);
  });

  it("keeps source links outside checkboxes and never saves when navigating to a guide", async () => {
    await render("registration");
    const links = Array.from(dialog().querySelectorAll<HTMLAnchorElement>('a[href]'));
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) {
      expect(link.closest('[role="checkbox"]')).toBeNull();
      expect(link.getAttribute("href")).toMatch(/^\/(manners|etiquette)\//);
    }
    expect(mocks.updateJourney).not.toHaveBeenCalled();
  });
});
