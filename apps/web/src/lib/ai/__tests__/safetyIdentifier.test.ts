import { describe, expect, it } from "vitest";
import { createSafetyIdentifier } from "../safetyIdentifier";

describe("createSafetyIdentifier", () => {
  it("returns a stable opaque SHA-256 value without exposing the source id", () => {
    const first = createSafetyIdentifier("user-123");
    const second = createSafetyIdentifier(" user-123 ");
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("user-123");
  });

  it("omits empty scopes", () => {
    expect(createSafetyIdentifier(undefined)).toBeUndefined();
    expect(createSafetyIdentifier("  ")).toBeUndefined();
  });
});
