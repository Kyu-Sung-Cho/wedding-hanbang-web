import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/vendors/[id]/availability/route.ts"),
  "utf8"
);
const webDetailSource = readFileSync(
  join(process.cwd(), "src/app/(app)/vendors/[id]/page.tsx"),
  "utf8"
);

describe("retired public vendor availability contract", () => {
  it("returns only the retired response without availability or booking queries", () => {
    expect(routeSource).toContain("vendorCatalogRetiredResponse");
    expect(routeSource).not.toMatch(/vendor_products|vendor_bookings|booking_time|capacity|checkRateLimit|createAdminClient|\.from\(/);
  });

  it("does not render an availability client from the retired vendor detail", () => {
    expect(webDetailSource).toContain('<PublicBetaUnavailable feature="vendor" />');
    expect(webDetailSource).not.toMatch(/availability|vendor_bookings|fetch\(|supabase/);
  });
});
