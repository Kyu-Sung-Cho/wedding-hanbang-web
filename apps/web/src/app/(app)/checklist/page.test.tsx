// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
}));

vi.mock("next/navigation", () => ({ redirect }));

import ChecklistPage from "./page";

describe("legacy checklist category links", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("redirects a valid category query to its dedicated canonical page", async () => {
    await expect(
      ChecklistPage({
        searchParams: Promise.resolve({ category: "meeting", from: "guide" }),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/wedding/checklist/meeting?from=guide",
    );
  });

  it("preserves repeated non-category query values", async () => {
    await expect(
      ChecklistPage({
        searchParams: Promise.resolve({
          category: ["meeting", "venue"],
          source: ["guide", "schedule"],
        }),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/wedding/checklist/meeting?source=guide&source=schedule",
    );
  });

  it("renders the overview instead of redirecting an invalid category", async () => {
    const element = await ChecklistPage({
      searchParams: Promise.resolve({ category: "reserve" }),
    });
    expect(element.type).toBeDefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});
