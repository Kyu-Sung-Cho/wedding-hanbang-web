import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mobileBookings = readFileSync(
  join(process.cwd(), "../mobile/app/bookings/index.tsx"),
  "utf8"
);
const webBookings = readFileSync(
  join(process.cwd(), "src/app/(app)/bookings/page.tsx"),
  "utf8"
);
const webVendor = readFileSync(
  join(process.cwd(), "src/app/(app)/vendors/[id]/page.tsx"),
  "utf8"
);

describe("booking consumer retirement contract", () => {
  it("does not interpret backend lifecycle states on mobile", () => {
    expect(mobileBookings).toContain('<PublicBetaUnavailable feature="booking" />');
    expect(mobileBookings).not.toMatch(/in_service|service_completed|contract_signed|deposit_paid|settled|vendor_bookings/);
  });

  it("does not interpret booking dates or statuses on web", () => {
    expect(webBookings).toContain('<PublicBetaUnavailable feature="booking" />');
    expect(webBookings).not.toMatch(/isLocalDateOnlyBefore|bookingDate|vendor_bookings|status/);
  });

  it("does not expose a date or submission flow from the retired vendor detail", () => {
    expect(webVendor).toContain('<PublicBetaUnavailable feature="vendor" />');
    expect(webVendor).not.toMatch(/nextLocalDateForDatabaseWeekday|요청 보내기|변경\/취소|BOOKING_REQUESTS_ENABLED/);
  });
});
