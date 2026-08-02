// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("public vendor availability disclosure fence", () => {
  it("serializes derived booleans instead of raw capacity and occupancy", () => {
    const detailRoute = source("src/app/api/vendors/[id]/route.ts");
    const staffRoute = source("src/app/api/vendors/[id]/staff/route.ts");
    const availabilityRoute = source("src/app/api/vendors/[id]/availability/route.ts");
    const communityRoute = source("src/app/api/community/vendor-tags/[name]/route.ts");
    const communityPage = source("src/app/(community)/community/vendor/[name]/page.tsx");
    const mobileParser = readFileSync(
      resolve(process.cwd(), "../mobile/src/lib/vendorAvailability.ts"),
      "utf8",
    );

    expect(detailRoute).toContain("timeSlots: toPublicBookingSlots(enrichedTimeslots)");
    expect(detailRoute).toContain("timeSlots: publicProductSlots.get(product.id) ?? []");
    expect(staffRoute).toContain("const slots = toPublicBookingSlots(internalSlots)");
    expect(staffRoute).not.toContain("maxBookings: t.max_bookings");
    expect(availabilityRoute).toContain("slots,");
    expect(availabilityRoute).not.toContain("counts,");
    expect(communityRoute).toContain("vendorSlots = toPublicBookingSlots");
    expect(communityRoute).toContain("staffSlots[staffMember.id] = toPublicBookingSlots");

    expect(communityPage).not.toMatch(/max_bookings|currentBookings|bookedCount/);
    expect(communityPage).not.toContain("잔여 ${slot.remaining}");
    expect(communityPage).toContain("예약 가능");
    expect(mobileParser).not.toMatch(/bookedCount|staffId|productId|maxBookings/);
    expect(mobileParser).toContain("available: boolean");
  });
});
