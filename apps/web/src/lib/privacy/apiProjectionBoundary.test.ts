import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_CLIENT_SELECT,
  CONGRATULATORY_MONEY_PRIVATE_SELECT,
  COUPLE_PRIVATE_SELECT,
  VENDOR_BOOKING_PRIVATE_SELECT,
  VENDOR_MESSAGE_PRIVATE_SELECT,
  WEDDING_JOURNEY_PRIVATE_SELECT,
} from "./privateDataSelects";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? routeFiles(path)
      : entry.name === "route.ts" ? [path] : [];
  });
}

describe("API database projection boundary", () => {
  it("forbids wildcard and implicit full-row selects in every API route", () => {
    const apiRoot = resolve(process.cwd(), "src/app/api");
    const violations = routeFiles(apiRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const reasons = [
        /\.select\(\s*\)/u.test(source) ? "implicit" : null,
        /\.select\(\s*["'`]\*/u.test(source) ? "wildcard" : null,
      ].filter(Boolean);
      return reasons.map((reason) =>
        `${relative(apiRoot, file).replaceAll("\\", "/")}:${reason}`
      );
    });

    expect(violations).toEqual([]);
  });

  it("keeps shared private projections closed and reviewable", () => {
    expect(COUPLE_PRIVATE_SELECT.split(", ")).toEqual([
      "id", "invite_code", "bride_id", "groom_id", "membership_sealed_at", "created_at", "updated_at",
    ]);
    expect(WEDDING_JOURNEY_PRIVATE_SELECT.split(", ")).toEqual([
      "id", "couple_id", "wedding_date", "venue", "total_budget", "progress", "created_at", "updated_at",
    ]);
    expect(VENDOR_BOOKING_PRIVATE_SELECT.split(", ")).toEqual([
      "id", "vendor_id", "couple_id", "product_id", "booking_date", "booking_time", "booking_type",
      "bride_name", "groom_name", "contact_phone", "status", "contract_status", "payment_status",
      "amount", "is_paid", "memo", "created_at", "updated_at",
    ]);
    expect(VENDOR_MESSAGE_PRIVATE_SELECT.split(", ")).toEqual([
      "id", "vendor_id", "customer_id", "server_provenance_version", "sender_type", "content",
      "is_read", "booking_id", "created_at",
    ]);
    expect(CONGRATULATORY_MONEY_PRIVATE_SELECT.split(", ")).toEqual([
      "id", "couple_id", "guest_name", "amount", "side", "relation", "method", "memo",
      "received_at", "created_at", "updated_at",
    ]);
    expect(CHAT_MESSAGE_CLIENT_SELECT.split(", ")).toEqual([
      "id", "couple_id", "sender_id", "sender_type", "role", "content", "metadata", "visibility", "created_at",
    ]);
  });
});
