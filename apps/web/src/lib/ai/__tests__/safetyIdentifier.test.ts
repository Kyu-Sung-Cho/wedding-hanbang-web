import { describe, expect, it } from "vitest";
import { createSafetyIdentifier } from "@/lib/ai/safetyIdentifier";

describe("createSafetyIdentifier", () => {
  it("returns a stable privacy-preserving 64-character hash", () => {
    const first = createSafetyIdentifier("user@example.com");
    const second = createSafetyIdentifier("user@example.com");

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("user@example.com");
  });

  it("omits empty identifiers", () => {
    expect(createSafetyIdentifier("  ")).toBeUndefined();
  });
});
