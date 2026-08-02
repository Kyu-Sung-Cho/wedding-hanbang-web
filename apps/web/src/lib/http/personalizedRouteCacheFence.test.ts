import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PRIVATE_JSON_ROUTES = [
  "src/app/api/admin/admins/route.ts",
  "src/app/api/admin/bookings/route.ts",
  "src/app/api/admin/customers/route.ts",
  "src/app/api/admin/insights/route.ts",
  "src/app/api/admin/registrations/route.ts",
  "src/app/api/admin/reports/route.ts",
  "src/app/api/admin/vendors/route.ts",
  "src/app/api/amora/actions/route.ts",
  "src/app/api/amora/actions/[id]/route.ts",
  "src/app/api/bookings/mine/route.ts",
  "src/app/api/community/cohort/route.ts",
  "src/app/api/community/cohort/[id]/contracts/route.ts",
  "src/app/api/community/cohort/[id]/messages/route.ts",
  "src/app/api/community/cohort/[id]/timeline/route.ts",
  "src/app/api/community/profile/route.ts",
  "src/app/api/couple/code/route.ts",
  "src/app/api/messages/threads/route.ts",
  "src/app/api/money/route.ts",
  "src/app/api/vendors/[id]/photos/route.ts",
] as const;

describe("personalized route cache fence", () => {
  it.each(PRIVATE_JSON_ROUTES)("uses a response wrapper that cannot cache %s", (path) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(source).toMatch(/(?:Admin|Private)NextResponse as NextResponse/);
    expect(source).not.toMatch(/import\s*\{[^}]*\bNextResponse\b[^}]*\}\s*from\s*["']next\/server["']/);
  });

  it("marks every OAuth callback redirect private and non-cacheable", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/auth/callback/route.ts"),
      "utf8",
    );
    expect(source).toContain(
      'const PRIVATE_NO_STORE = "private, no-store, max-age=0, must-revalidate"',
    );
    expect(source.match(/NextResponse\.redirect\(/g)).toHaveLength(1);
    expect(source).not.toContain("return NextResponse.redirect(");
  });
});
