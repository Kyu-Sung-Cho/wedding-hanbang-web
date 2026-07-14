import { describe, expect, it, vi } from "vitest";
import { saveAutomaticDissatisfaction } from "../automaticFeedback";

describe("saveAutomaticDissatisfaction", () => {
  it.each(["bride_private", "groom_private"] as const)(
    "does not persist raw %s conversation text",
    async (visibility) => {
      const persist = vi.fn().mockResolvedValue(undefined);

      await expect(saveAutomaticDissatisfaction({
        userId: "user-private",
        coupleId: "couple-private",
        signal: "correction",
        visibility,
      }, persist)).resolves.toBe(false);

      expect(persist).not.toHaveBeenCalled();
    }
  );

  it("persists only a structured signal for shared conversations", async () => {
    const sharedCanary = "SHARED_AUTOSAVE_RAW_CANARY_34ae10";
    const persist = vi.fn().mockResolvedValue(undefined);

    await expect(saveAutomaticDissatisfaction({
      userId: "user-shared",
      coupleId: "couple-shared",
      signal: "frustration",
      visibility: "shared",
    }, persist)).resolves.toBe(true);

    expect(persist).toHaveBeenCalledWith({
      user_id: "user-shared",
      couple_id: "couple-shared",
      message_id: null,
      rating: "bad",
      category: "frustration",
      correction: null,
      message_content: null,
    });
    expect(JSON.stringify(persist.mock.calls)).not.toContain(sharedCanary);
  });
});
