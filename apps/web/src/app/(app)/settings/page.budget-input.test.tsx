// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

vi.mock("@/components/app/TodayOnePreferenceControl", () => ({ default: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const journey: WeddingJourney = {
  id: "synthetic-journey", couple_id: "synthetic-couple", wedding_date: null, venue: null,
  total_budget: 33_000_001, progress: {}, state_revision: 1,
  created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z",
};

describe("settings exact total-budget editing", () => {
  let container: HTMLDivElement;
  let root: Root;
  let original: ReturnType<typeof useAuthStore.getState>;
  const updateJourney = vi.fn<ReturnType<typeof useAuthStore.getState>["updateJourney"]>();

  beforeEach(() => {
    original = useAuthStore.getState();
    useAuthStore.setState({ user: null, profile: null, partner: null, couple: null, journey, isDemo: true, updateJourney });
    updateJourney.mockResolvedValue({ status: "applied", journey });
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(original); container.remove(); vi.clearAllMocks();
  });
  async function openEditor() {
    await act(async () => root.render(<SettingsPage />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="설정 예산 수정"]')?.click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="설정 예산(만원 단위)"]');
    expect(input).not.toBeNull();
    return input!;
  }
  async function save(value: string) {
    const input = await openEditor();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="설정 예산 저장"]')?.click());
  }

  it("keeps the last won through grouped display and reopening the edit field", async () => {
    await act(async () => root.render(<SettingsPage />));
    expect(container.textContent).toContain("3,300만1원");
    expect(container.textContent).not.toContain("₩3,300");
    const input = await openEditor();
    expect(input.value).toBe("3300.0001");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="설정 예산 저장"]')?.click());
    expect(updateJourney).toHaveBeenCalledWith({ total_budget: 33_000_001 });
  });

  it.each(["3300.1234", "3,300.1234"])("saves %s만원 as exact won instead of truncating the fraction", async (input) => {
    await save(input);
    expect(updateJourney).toHaveBeenCalledWith({ total_budget: 33_001_234 });
  });

  it.each(["-1", "0", "100000.0001", "3300.12345", "33,00", "1e5"])("does not submit invalid or over-limit input %s", async (input) => {
    await save(input);
    expect(updateJourney).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("만원");
  });
});
