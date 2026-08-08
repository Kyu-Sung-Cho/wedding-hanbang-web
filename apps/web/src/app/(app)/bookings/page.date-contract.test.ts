// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/(app)/bookings/page.tsx"),
  "utf8",
);

describe("booking page date contract", () => {
  it("classifies date-only records by the Korea calendar day", () => {
    expect(source).toContain("classifyBookingDate");
    expect(source).toContain("formatBookingDate");
    expect(source).not.toMatch(/new Date\(booking\.bookingDate\)/);
  });
});
