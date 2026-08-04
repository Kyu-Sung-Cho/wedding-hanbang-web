import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

import MobileLandingMenu from "./MobileLandingMenu";

const items = [
  { label: "어떻게 정리되나요", href: "#how-it-works" },
  { label: "함께와 비공개", href: "#privacy" },
] as const;

describe("MobileLandingMenu", () => {
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

  async function openMenu() {
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    await act(async () => {
      if (!details) return;
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    return details;
  }

  it("closes after a destination is selected", async () => {
    await act(async () => root.render(<MobileLandingMenu items={items} />));
    const details = await openMenu();
    const summary = container.querySelector("summary");

    expect(summary?.getAttribute("aria-expanded")).toBe("true");
    expect(summary?.getAttribute("aria-label")).toBe("주요 메뉴 닫기");

    const destination = [...container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "어떻게 정리되나요",
    );
    await act(async () => {
      destination?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(details?.open).toBe(false);
    expect(summary?.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape and returns focus to the menu control", async () => {
    await act(async () => root.render(<MobileLandingMenu items={items} />));
    const details = await openMenu();
    const summary = container.querySelector<HTMLElement>("summary");

    await act(async () => {
      details?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(details?.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(summary?.getAttribute("aria-label")).toBe("주요 메뉴 열기");
  });
});
