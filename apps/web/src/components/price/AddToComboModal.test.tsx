// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceVendor } from "@/lib/price/catalog";

import { AddToComboModal } from "./AddToComboModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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
    options: [{
      id: "option-1",
      name: "원본 구매",
      minimumKrw: 100_000,
      maximumKrw: 300_000,
      unit: null,
      condition: null,
      rawText: "원본 구매 10~30만원",
      isEffectivelyMandatory: false,
    }],
  }],
};

describe("add-to-combo price truthfulness", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("shows the full published range instead of presenting the minimum as an expected total", async () => {
    await act(async () => {
      root.render(<AddToComboModal vendor={vendor} onClose={vi.fn()} onAdd={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("기본·옵션 공시가 합계");
    expect(container.textContent).toContain("100~120만원");
    expect(container.textContent).not.toContain("예상 합계");
  });

  it("explains an invalid direct quote instead of silently falling back to the published price", async () => {
    await act(async () => {
      root.render(<AddToComboModal vendor={vendor} onClose={vi.fn()} onAdd={vi.fn()} />);
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="직접 입력한 기본 견적(만원)"]',
    );
    expect(input).not.toBeNull();

    await act(async () => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "1.2.3");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-describedby")).toBe("combo-custom-quote-error");
    expect(container.textContent).toContain("0~10억원 범위의 금액을 만원 단위 숫자로 입력해 주세요");
    const addButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "이 가격으로 담기");
    expect(addButton?.disabled).toBe(true);
  });

  it("identifies a direct quote and selected option range as the source of the total", async () => {
    await act(async () => {
      root.render(<AddToComboModal vendor={vendor} onClose={vi.fn()} onAdd={vi.fn()} />);
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="직접 입력한 기본 견적(만원)"]',
    );
    const option = container.querySelector<HTMLInputElement>('input[type="checkbox"]');

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "150");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      option?.click();
    });

    expect(container.textContent).toContain("입력 견적·옵션 공시가 합계");
    expect(container.textContent).toContain("160~180만원");
  });
});
