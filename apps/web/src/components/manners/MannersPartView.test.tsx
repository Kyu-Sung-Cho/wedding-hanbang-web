// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MANNERS_PARTS } from "@/lib/manners/data";
import MannersPartView from "./MannersPartView";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

describe("MannersPartView checklist links", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("shows the full label for newly added journey checklist categories", async () => {
    const part = MANNERS_PARTS.find((candidate) => candidate.slug === "planning-timeline");
    expect(part).toBeDefined();

    await act(async () => root.render(<MannersPartView part={part!} />));

    const link = Array.from(container.querySelectorAll("a")).find(
      (candidate) => candidate.textContent?.trim() === "함께 정할 것 체크리스트",
    );
    expect(link?.getAttribute("href")).toBe("/wedding/checklist/foundation");
  });
});
