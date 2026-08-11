// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import ChecklistCategoryPage, { generateMetadata, generateStaticParams } from "./page";

describe("checklist category page", () => {
  it("prebuilds every canonical checklist category exactly once", () => {
    const params = generateStaticParams();
    expect(params).toHaveLength(CATEGORY_CHECKLISTS.length);
    expect(new Set(params.map(({ categoryKey }) => categoryKey)).size).toBe(
      CATEGORY_CHECKLISTS.length,
    );
  });

  it("returns the dedicated category view and canonical metadata", async () => {
    const element = await ChecklistCategoryPage({
      params: Promise.resolve({ categoryKey: "meeting" }),
    });
    expect(element.props.categoryKey).toBe("meeting");

    const metadata = await generateMetadata({
      params: Promise.resolve({ categoryKey: "meeting" }),
    });
    expect(metadata.title).toContain("부모님 첫 만남");
    expect(metadata.alternates?.canonical).toBe(
      "https://hanbang.ai/wedding/checklist/meeting",
    );
  });

  it.each(["unknown", "reserve", "__proto__"])(
    "fails closed for an unknown category: %s",
    async (categoryKey) => {
      await expect(
        ChecklistCategoryPage({ params: Promise.resolve({ categoryKey }) }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );
});
