import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertPrivacyProductionBuild,
  PrivacyProductionBuildBlocked,
  PRIVACY_CROSS_BORDER_NOTICE_NOT_APPROVED,
} from "./privacyProductionBuildFence";

describe("privacy production build fence", () => {
  it("allows local and preview builds", () => {
    expect(() => assertPrivacyProductionBuild({ environment: {} })).not.toThrow();
    expect(() => assertPrivacyProductionBuild({
      environment: { VERCEL_ENV: "preview" },
    })).not.toThrow();
  });

  it("blocks production until the exact cross-border notice is approved", () => {
    expect(() => assertPrivacyProductionBuild({
      environment: { VERCEL_ENV: "production" },
    })).toThrowError(PrivacyProductionBuildBlocked);

    try {
      assertPrivacyProductionBuild({ environment: { VERCEL_ENV: "production" } });
      throw new Error("expected the privacy release fence to block production");
    } catch (error) {
      expect(error).toBeInstanceOf(PrivacyProductionBuildBlocked);
      expect((error as PrivacyProductionBuildBlocked).code).toBe(
        PRIVACY_CROSS_BORDER_NOTICE_NOT_APPROVED,
      );
    }
  });

  it("never treats an environment flag as legal approval", () => {
    expect(() => assertPrivacyProductionBuild({
      environment: {
        VERCEL_ENV: "production",
        PRIVACY_CROSS_BORDER_NOTICE_APPROVED: "true",
      },
    })).toThrowError(PRIVACY_CROSS_BORDER_NOTICE_NOT_APPROVED);
  });

  it("is wired into Next configuration before the other production release fence", () => {
    const source = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
    const privacyFence = source.indexOf("assertPrivacyProductionBuild();");
    const vendorFence = source.indexOf("assertVendorDisclosureProductionBuild({ repoRoot });");

    expect(privacyFence).toBeGreaterThanOrEqual(0);
    expect(vendorFence).toBeGreaterThan(privacyFence);
  });
});
