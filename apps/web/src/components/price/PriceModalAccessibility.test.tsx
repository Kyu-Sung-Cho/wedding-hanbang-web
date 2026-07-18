// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceVendor } from "@/lib/price/catalog";

import { AddToComboModal } from "./AddToComboModal";
import { AuthGateModal } from "./AuthGateModal";
import { BudgetFinderModal } from "./BudgetFinderModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("price modal keyboard accessibility", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("focuses, traps, closes, and restores focus for the auth gate", async () => {
    const onClose = vi.fn();
    const openingControl = document.createElement("button");
    openingControl.textContent = "save vendor";
    document.body.insertBefore(openingControl, container);

    await act(async () => {
      root.render(<AuthGateModal open={false} redirectPath="/price/studio/sample" onClose={onClose} />);
      await Promise.resolve();
    });
    openingControl.focus();

    await act(async () => {
      root.render(<AuthGateModal open redirectPath="/price/studio/sample" onClose={onClose} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const first = focusable[0];
    const last = focusable.at(-1);
    expect(document.activeElement).toBe(first);

    last?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);

    first?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    }));
    expect(document.activeElement).toBe(last);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<AuthGateModal open={false} redirectPath="/price/studio/sample" onClose={onClose} />);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(openingControl);
  });

  it("keeps keyboard focus inside the budget finder and restores its trigger", async () => {
    const onClose = vi.fn();
    const openingControl = document.createElement("button");
    openingControl.textContent = "find a budget";
    document.body.insertBefore(openingControl, container);
    const props = {
      catalog: { studio: [], dress: [], makeup: [] },
      agencies: [],
      onClose,
      onChoose: vi.fn(),
    } as const;

    await act(async () => {
      root.render(<BudgetFinderModal open={false} {...props} />);
      await Promise.resolve();
    });
    openingControl.focus();

    await act(async () => {
      root.render(<BudgetFinderModal open {...props} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const first = focusable[0];
    const last = focusable.at(-1);
    expect(document.activeElement).toBe(first);

    last?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<BudgetFinderModal open={false} {...props} />);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(openingControl);
  });

  it("keeps keyboard focus inside add-to-combo and restores its trigger", async () => {
    const onClose = vi.fn();
    const openingControl = document.createElement("button");
    openingControl.textContent = "add studio";
    document.body.insertBefore(openingControl, container);
    const vendor: PriceVendor = {
      id: "vendor-1",
      slug: "sample-studio",
      name: "샘플 스튜디오",
      aliases: [],
      category: "studio",
      regionCode: "seoul",
      offers: [{
        id: "offer-1",
        agencyId: "agency-1",
        agencyName: "샘플 대행사",
        minimumKrw: 1_000_000,
        maximumKrw: 1_200_000,
        priceNote: null,
        baseSpec: "기본 구성",
        options: [],
      }],
    };
    const onAdd = vi.fn();

    await act(async () => {
      root.render(<AddToComboModal vendor={null} onClose={onClose} onAdd={onAdd} />);
      await Promise.resolve();
    });
    openingControl.focus();

    await act(async () => {
      root.render(<AddToComboModal vendor={vendor} onClose={onClose} onAdd={onAdd} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const first = focusable[0];
    const last = focusable.at(-1);
    expect(document.activeElement).toBe(first);

    last?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<AddToComboModal vendor={null} onClose={onClose} onAdd={onAdd} />);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(openingControl);
  });
});
