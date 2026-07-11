import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const protectedRoutes = [
  "apps/web/src/app/api/auth/callback/route.ts",
  "apps/web/src/app/api/amora/quote-check/[id]/public/route.ts",
  "apps/web/src/app/api/money/route.ts",
  "apps/web/src/app/api/chat/check-couple-conflict/route.ts",
  "apps/web/src/app/api/chat/clear-request/route.ts",
];

describe("consumer API error redaction", () => {
  it.each(protectedRoutes)("%s never serializes or logs raw exception messages", (path) => {
    const source = read(path);

    expect(source).not.toContain("error.message");
    expect(source).not.toContain("sessionError.message");
    expect(source).not.toContain("profileError.message");
    expect(source).not.toContain("err instanceof Error");
    expect(source).not.toContain("String(err)");
  });

  it("uses stable machine codes for server failures", () => {
    expect(read(protectedRoutes[0])).toContain("session_exchange_failed");
    expect(read(protectedRoutes[0])).toContain("callback_failed");
    expect(read(protectedRoutes[1])).toContain("quote_check_unavailable");
    expect(read(protectedRoutes[2])).toContain("money_create_failed");
    expect(read(protectedRoutes[3])).toContain("conflict_check_failed");
    expect(read(protectedRoutes[4])).toContain("clear_request_failed");
  });
});
