import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  formatPolicyVersionKorean,
} from "./policyVersions";

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

describe("canonical signup policy versions", () => {
  it("uses one canonical revision for both public display and trusted evidence", () => {
    expect(formatPolicyVersionKorean(CURRENT_TERMS_VERSION)).toBe("2026년 8월 2일");
    expect(formatPolicyVersionKorean(CURRENT_PRIVACY_VERSION)).toBe("2026년 8월 2일");

    const terms = source("../../app/terms/page.tsx");
    expect(terms).toContain("formatPolicyVersionKorean(CURRENT_TERMS_VERSION)");
    expect(terms).not.toContain("2026년 7월 17일");

    const privacy = source("../../app/privacy/page.tsx");
    expect(privacy).toContain("formatPolicyVersionKorean(CURRENT_PRIVACY_VERSION)");
  });
});
