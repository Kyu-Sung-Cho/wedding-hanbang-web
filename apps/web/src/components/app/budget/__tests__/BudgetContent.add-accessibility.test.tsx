// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BudgetContent from "../BudgetContent";
import { useAuthStore } from "@/stores/authStore";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const original = useAuthStore.getState();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useAuthStore.setState({ isDemo: true, journey: {
    id: "synthetic-budget", couple_id: "synthetic-couple", total_budget: 10_000_000,
    wedding_date: null, venue: null, progress: {}, state_revision: 0,
    created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z",
  } });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  useAuthStore.setState(original); vi.unstubAllGlobals();
});

async function openForm() {
  await act(async () => root.render(<BudgetContent />));
  const add = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "새 항목 추가");
  expect(add).toBeTruthy();
  add!.focus();
  await act(async () => add!.click());
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).toBeTruthy();
  return dialog!;
}

it("identifies the category, allocation and recorded-spend inputs by their visible labels", async () => {
  const dialog = await openForm();
  const labels = [...dialog.querySelectorAll("label")];
  for (const text of ["카테고리 이름", "예산 (만원)", "기록 지출 (만원 · 결제 확인과 별도)"]) {
    const label = labels.find(item => item.textContent?.includes(text));
    expect(label, text).toBeTruthy();
    expect(label!.control, `${text} must name a form control`).toBeInstanceOf(HTMLInputElement);
    expect(dialog.contains(label!.control)).toBe(true);
    expect((label!.control as HTMLInputElement).labels).toContain(label);
  }
  expect(new Set(labels.map(label => label.control)).size).toBe(3);
});

it("keeps keyboard focus in the add dialog and Escape restores the opening control", async () => {
  const dialog = await openForm();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  const last = [...dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])")].at(-1)!;
  last.focus();
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  await act(async () => document.dispatchEvent(tab));
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(dialog.querySelector("button"));
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement?.textContent).toBe("새 항목 추가");
  expect(document.body.style.overflow).not.toBe("hidden");
  expect(fetch).not.toHaveBeenCalled();
});

it("offers a named close control without saving a category", async () => {
  const dialog = await openForm();
  const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="새 항목 추가 닫기"]');
  expect(close).toBeTruthy();
  await act(async () => close!.click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(useAuthStore.getState().journey?.progress).toEqual({});
  expect(fetch).not.toHaveBeenCalled();
});

it("allows leaving a destructive category dialog by keyboard without deleting data", async () => {
  const journey = useAuthStore.getState().journey!;
  useAuthStore.setState({ journey: { ...journey, progress: { venue: { budget: 1_000_000, status: "not_started" } } } });
  await act(async () => root.render(<BudgetContent />));
  const trigger = container.querySelector<HTMLButtonElement>('button[title="결혼식장 삭제"]')!;
  expect(trigger).toBeTruthy(); trigger.focus();
  await act(async () => trigger.click());
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog).toBeTruthy();
  expect(document.activeElement?.textContent).toBe("취소");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(useAuthStore.getState().journey?.progress.venue.budget).toBe(1_000_000);
  expect(fetch).not.toHaveBeenCalled();
});
