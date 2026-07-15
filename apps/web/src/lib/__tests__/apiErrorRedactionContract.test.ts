import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const protectedRoutes = [
  "apps/web/src/app/api/auth/callback/route.ts",
  "apps/web/src/app/api/amora/quote-check/[id]/public/route.ts",
  "apps/web/src/app/api/money/route.ts",
  "apps/web/src/app/api/money/retiredResponse.ts",
  "apps/web/src/app/api/chat/check-couple-conflict/route.ts",
  "apps/web/src/app/api/chat/clear-request/route.ts",
  "apps/web/src/app/api/auth/me/route.ts",
  "apps/web/src/app/api/admin/vendors/route.ts",
  "apps/web/src/app/api/admin/customers/route.ts",
  "apps/web/src/app/api/admin/admins/route.ts",
];

describe("consumer API error redaction", () => {
  it.each(protectedRoutes)("%s never serializes or logs raw exception messages", (path) => {
    const source = read(path);

    expect(source).not.toContain("error.message");
    expect(source).not.toContain("sessionError.message");
    expect(source).not.toContain("profileError.message");
    expect(source).not.toContain("err instanceof Error");
    expect(source).not.toContain("String(err)");
    expect(source).not.toMatch(/\b[\w$]*(?:Err|Error)\??\.message\b/);
    expect(source).not.toMatch(/console\.error\([^\n]*,\s*err\s*\)/);
  });

  it("uses stable machine codes for failures and retired endpoints", () => {
    expect(read(protectedRoutes[0])).toContain("session_exchange_failed");
    expect(read(protectedRoutes[0])).toContain("callback_failed");
    expect(read(protectedRoutes[1])).toContain("quote_check_public_read_retired");
    expect(read(protectedRoutes[2])).toContain("congratulatoryMoneyRetiredResponse");
    expect(read(protectedRoutes[3])).toContain("congratulatory_money_retired");
    expect(read(protectedRoutes[4])).toContain("conflict_check_failed");
    expect(read(protectedRoutes[5])).toContain("clear_request_failed");
    expect(read(protectedRoutes[6])).toContain("PROFILE_UNAVAILABLE");
    expect(read(protectedRoutes[6])).toContain("ACCOUNT_STATE_UNAVAILABLE");
    expect(read(protectedRoutes[7])).toContain("ADMIN_VENDOR_HISTORY_UNAVAILABLE");
    expect(read(protectedRoutes[8])).toContain("ADMIN_CUSTOMER_LIST_UNAVAILABLE");
    expect(read(protectedRoutes[8])).toMatch(/if \(couplesErr \|\| journeysErr\)/);
    expect(read(protectedRoutes[9])).toContain("ADMIN_LIST_UNAVAILABLE");
  });
});
