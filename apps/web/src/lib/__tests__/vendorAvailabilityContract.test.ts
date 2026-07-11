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

describe("authoritative public vendor availability contract", () => {
  it("validates active entities and returns aggregate-only booking data", () => {
    expect(routeSource).toContain('from("vendor_products")');
    expect(routeSource).toContain('.eq("is_active", true)');
    expect(routeSource).toContain('select("booking_time", { count: "exact" })');
    expect(routeSource).not.toMatch(/select\([^\n]*(?:customer_id|user_id|email|phone)/);
    expect(routeSource).toContain("capacity > 0");
    expect(routeSource).toContain("checkRateLimitPersistent");
    expect(routeSource).toContain("availability_booking_rows_truncated");
    expect(routeSource).toContain("availability_slot_rows_truncated");
  });

  it("makes the web UI render the server aggregate instead of RLS-partial counts", () => {
    expect(webDetailSource).toContain("/availability?");
    expect(webDetailSource).toContain("availabilitySlots");
    expect(webDetailSource).not.toMatch(/from\(["']vendor_bookings["']\)/);
  });
});
