import { describe, expect, it, vi } from "vitest";

const { createAdminClientSpy } = vi.hoisted(() => ({
  createAdminClientSpy: vi.fn(() => {
    throw new Error("disabled feedback learning must not read chat_feedback");
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientSpy,
}));

import { loadFeedbackLessons } from "../feedbackLessons";

describe("loadFeedbackLessons", () => {
  it("fails closed without reading raw feedback from any couple", async () => {
    await expect(loadFeedbackLessons("couple-requesting-context")).resolves.toEqual([]);
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });
});
