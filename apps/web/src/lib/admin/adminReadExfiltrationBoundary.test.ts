import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeNames = ["admins", "bookings", "customers", "registrations", "vendors"] as const;
const routeSources = Object.fromEntries(routeNames.map((name) => [
  name,
  readFileSync(resolve(process.cwd(), `src/app/api/admin/${name}/route.ts`), "utf8"),
])) as Record<(typeof routeNames)[number], string>;

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? routeFiles(path)
      : entry.name === "route.ts" ? [path] : [];
  });
}

describe("admin PII read exfiltration boundary", () => {
  it.each(routeNames)("rate limits %s after binding the admin user ID", (name) => {
    expect(routeSources[name]).toContain("checkAdminReadRateLimit(request, userId");
    expect(routeSources[name]).toMatch(/!authorized\s*\|\|\s*!userId/u);
  });

  it.each(routeNames)("does not use wildcard selects in %s", (name) => {
    expect(routeSources[name]).not.toMatch(/\.select\(\s*["'`]\*/u);
  });

  it("rate limits every admin GET before privileged work", () => {
    const apiRoot = resolve(process.cwd(), "src/app/api/admin");
    const missingRateLimit = routeFiles(apiRoot)
      .filter((file) => /export async function GET/u.test(readFileSync(file, "utf8")))
      .filter((file) => !/check(?:AdminRead)?RateLimit/u.test(readFileSync(file, "utf8")))
      .map((file) => relative(apiRoot, file).replaceAll("\\", "/"));
    expect(missingRateLimit).toEqual([]);
  });

  it("durably rate limits every admin mutation route", () => {
    const apiRoot = resolve(process.cwd(), "src/app/api/admin");
    const missingRateLimit = routeFiles(apiRoot)
      .filter((file) => /export async function (?:POST|PUT|PATCH|DELETE)/u.test(
        readFileSync(file, "utf8"),
      ))
      .filter((file) => !/check(?:AdminMutation)?RateLimit/u.test(readFileSync(file, "utf8")))
      .map((file) => relative(apiRoot, file).replaceAll("\\", "/"));
    expect(missingRateLimit).toEqual([]);
  });

  it("does not wildcard-select privileged admin tables", () => {
    const apiRoot = resolve(process.cwd(), "src/app/api/admin");
    const wildcardSelects = routeFiles(apiRoot)
      .filter((file) => /\.select\(\s*["'`]\*/u.test(readFileSync(file, "utf8")))
      .map((file) => relative(apiRoot, file).replaceAll("\\", "/"));
    expect(wildcardSelects).toEqual([]);
  });

  it("minimizes preregistration fields and bounds its page", () => {
    const source = routeSources.registrations;
    expect(source).toContain('.select("id,email,source,created_at", { count: "exact" })');
    expect(source).toContain("maxLimit: 200");
    expect(source).toContain('dailyCountsScope: "returned_page"');
  });

  it("bounds customer relationship fan-out to IDs on the returned page", () => {
    const source = routeSources.customers;
    expect(source).toContain("maxLimit: 100");
    expect(source).toContain('.in("id", coupleIds)');
    expect(source).toContain('.in("couple_id", coupleIds)');
  });

  it("returns only the vendor fields used by the review UI", () => {
    expect(routeSources.vendors).toContain(
      '"id,name,category,owner_name,phone,email,address,business_number,price_range,description,tags,status,created_at"',
    );
  });

  it("makes partial list scope visible to administrators", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/(admin)/admin/page.tsx"), "utf8");
    expect(page).toContain("개인정보 과다 조회");
    expect(page).toContain("최근 100건");
  });
});
