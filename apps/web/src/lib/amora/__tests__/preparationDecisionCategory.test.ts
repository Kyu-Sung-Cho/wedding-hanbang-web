import { describe, expect, it } from "vitest";
import { preparationCategory } from "../preparationBoard";
import { preparationDecisionCategory } from "../preparationDecisionCategory";

describe("decision-only category metadata", () => {
  it.each([null, undefined, "", "unknown", "__proto__", "constructor", "budget ", "BUDGET"])("leaves unknown stored key %s unclassified", key => {
    expect(preparationDecisionCategory(key)).toBeUndefined();
  });

  it.each(["budget", "schedule", "plan", "general"])("does not add decision domain %s to task checklist categories", key => {
    expect(preparationDecisionCategory(key)).toBeDefined();
    expect(preparationCategory(key)).toBeUndefined();
  });
});
