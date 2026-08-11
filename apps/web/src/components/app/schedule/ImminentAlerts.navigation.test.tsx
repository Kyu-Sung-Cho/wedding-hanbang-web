// @vitest-environment jsdom

import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, as, prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string; prefetch?: boolean }) => {
    void prefetch;
    return <a href={as ?? (typeof href === "string" ? href : "#")} {...props}>{children}</a>;
  },
}));

import ImminentAlerts from "./ImminentAlerts";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

describe("ImminentAlerts checklist navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("opens the matching full checklist page rather than a modal", async () => {
    await act(async () => root.render(
      <ImminentAlerts items={[{
        key: "meeting",
        label: "부모님 첫 만남",
        icon: "Users",
        status: "in_progress",
        doneCount: 2,
        totalCount: 6,
        deadlineDaysLeft: 12,
        hasScheduledEvent: false,
        urgency: "urgent",
      }]} />,
    ));

    const link = Array.from(container.querySelectorAll("a")).find((anchor) =>
      anchor.textContent?.includes("부모님 첫 만남"),
    );
    expect(link?.getAttribute("href")).toBe("/wedding/checklist/meeting");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="imminent-checklist-items"]',
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("#imminent-checklist-items")).not.toBeNull();

    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("#imminent-checklist-items")).toBeNull();
  });
});
