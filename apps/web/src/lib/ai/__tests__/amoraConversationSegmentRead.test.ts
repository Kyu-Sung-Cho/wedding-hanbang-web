import { describe, expect, it } from "vitest";

import { isAmoraConversationSegmentReadEnabled } from "@/lib/ai/amoraConversationSegmentRead";

describe("isAmoraConversationSegmentReadEnabled", () => {
  it("enables the cutover only for the exact string true", () => {
    expect(isAmoraConversationSegmentReadEnabled("true")).toBe(true);

    for (const value of [undefined, null, false, true, "false", "TRUE", "1", " true"] as const) {
      expect(isAmoraConversationSegmentReadEnabled(value)).toBe(false);
    }
  });
});
