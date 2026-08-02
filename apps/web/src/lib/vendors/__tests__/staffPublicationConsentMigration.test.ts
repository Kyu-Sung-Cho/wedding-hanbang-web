import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260802160000_require_vendor_staff_publication_consent.sql",
  ),
  "utf8",
);

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("vendor staff publication consent fence", () => {
  it("defaults legacy staff to private without fabricating consent", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS public_profile_consent_at timestamptz");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS public_profile_consent_version text");
    expect(migration).not.toMatch(/UPDATE\s+public\.vendor_staff[\s\S]*public_profile_consent/iu);
  });

  it("requires current explicit consent for staff and schedule public RLS", () => {
    expect(migration).toContain('CREATE POLICY "Public can view active consented staff"');
    expect(migration).toContain('CREATE POLICY "Public can view consented staff timeslots"');
    expect(migration.match(/public_profile_consent_at IS NOT NULL/gu)?.length).toBeGreaterThanOrEqual(4);
    expect(migration.match(/public_profile_consent_version = '2026-08-02'/gu)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(migration).toContain(
      "REVOKE SELECT (public_profile_consent_at, public_profile_consent_version)",
    );
  });

  it.each([
    "src/app/api/vendors/[id]/staff/route.ts",
    "src/app/api/community/vendor-tags/[name]/route.ts",
    "src/lib/ai/tools/vendorTools.ts",
    "src/lib/ai/tools/bookingTools.ts",
  ])("filters service-role staff reads in %s", (path) => {
    const value = source(path);
    expect(value).toContain('.not("public_profile_consent_at", "is", null)');
    expect(value).toContain("CURRENT_VENDOR_STAFF_PUBLICATION_CONSENT_VERSION");
  });
});
