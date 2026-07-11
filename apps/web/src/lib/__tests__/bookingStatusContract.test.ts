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

describe("booking consumer status contract", () => {
  it("preserves every server lifecycle status on mobile", () => {
    expect(mobileBookings).toContain('| "in_service"');
    expect(mobileBookings).toContain('| "service_completed"');
    expect(mobileBookings).toContain('| "contract_sent"');
    expect(mobileBookings).toContain('| "contract_signed"');
    expect(mobileBookings).toContain('| "deposit_paid"');
    expect(mobileBookings).toContain('| "settled"');
    expect(mobileBookings).toContain("isExpiredWithoutCompletion");
    expect(mobileBookings).not.toMatch(
      /return booking\.status === "completed" \|\| parseBookingDate\(booking\.booking_date\) < today/
    );
  });

  it("keeps same-day requests upcoming on web using the local date-only contract", () => {
    expect(webBookings).toContain("isLocalDateOnlyBefore");
    expect(webBookings).not.toContain("new Date(b.bookingDate)");
  });

  it("shows the exact future date before a weekly slot request is sent", () => {
    expect(webVendor).toContain("nextLocalDateForDatabaseWeekday");
    expect(webVendor).toContain("요청 보내기");
    expect(webVendor).not.toContain("변경/취소는 방문일 1일 전까지 가능합니다");
  });
});
