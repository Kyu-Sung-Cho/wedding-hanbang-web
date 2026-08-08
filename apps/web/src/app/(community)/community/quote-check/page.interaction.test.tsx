// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getQuoteCheckItems } from "@/lib/amora/quoteCheck";
import AmoraQuoteCheckPage from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("AmoraQuoteCheckPage interaction", () => {
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

  it("counts only explicit included or unused decisions", async () => {
    const itemCount = getQuoteCheckItems("studio", "other").length;

    await act(async () => root.render(<AmoraQuoteCheckPage />));

    const firstGroup = container.querySelector<HTMLElement>('[role="group"]');
    expect(firstGroup).toBeTruthy();
    expect(container.textContent).toContain(`정리 0/${itemCount}`);

    const [includedButton, notNeededButton, unknownButton] =
      Array.from(firstGroup?.querySelectorAll<HTMLButtonElement>("button") ?? []);

    expect(unknownButton.getAttribute("aria-pressed")).toBe("true");

    await act(async () => includedButton.click());
    expect(includedButton.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain(`정리 1/${itemCount}`);

    await act(async () => notNeededButton.click());
    expect(notNeededButton.getAttribute("aria-pressed")).toBe("true");
    expect(includedButton.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain(`정리 1/${itemCount}`);

    await act(async () => unknownButton.click());
    expect(unknownButton.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain(`정리 0/${itemCount}`);
  });
});
