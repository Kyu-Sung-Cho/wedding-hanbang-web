// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 웨딩홀·상담 문의 코드의 두 경계.
 *
 * 1) 2026-11-16 파운더 결정(D-79, 원문 선택 "모두 그만 쓰기"): 한국소비자원 참가격 자료를 어디서도 읽지 않는다.
 *    비교는 운영자가 출처 주소와 확인일을 적어 넣은 `hall_listings` 만 쓴다. 대체 경로로라도 공시 표를 읽지 않는다.
 * 2) 보내는 일은 운영자가 한다(D-75 미정). 이 코드는 메일·문자·메신저를 직접 보내지 않고 바깥 주소를 부르지 않는다.
 *
 * 주석까지 읽는다. 이 영역에서는 그 이름을 적을 일 자체가 없다.
 */

const WEB = process.cwd();
const ROOT = resolve(WEB, "../..");

const SCANNED_DIRS = [
  "apps/web/src/lib/invitation",
  "apps/web/src/app/api/invitation",
  "apps/web/src/app/(admin)/admin/halls",
  "apps/web/src/app/(admin)/admin/inquiries",
  "packages/shared/src/invitation",
];
const SCANNED_FILES = ["supabase/migrations/20261117090000_hall_listings_and_inquiries.sql"];

const SERVER_DIRS = ["apps/web/src/lib/invitation", "apps/web/src/app/api/invitation"];

const PRICE_DISCLOSURE = [
  /official_prices?\b/,
  /official_price_options/,
  /official_agency_packages/,
  /price_snapshots/,
  /\bv_public_/,
  /lib\/price\//,
  /lookup_public_price_vendors/,
  /get_market_price/,
  /getMarketMedian/,
];

const OUTBOUND = [
  /from\s+["'](?:resend|nodemailer|twilio|@sendgrid\/[^"']+|solapi)["']/,
  /@\/lib\/resend/,
  /alimtalk/i,
  /\bsendSms\b|\bsendEmail\b|\bsendMail\b/,
  /\bfetch\s*\(/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__") walk(path, out);
    } else if (/\.(ts|tsx|mts|mjs|sql)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const rel = (path: string) => relative(ROOT, path).split("\\").join("/");

describe("hall inquiry code boundaries", () => {
  const files = [
    ...SCANNED_DIRS.flatMap((dir) => walk(resolve(ROOT, dir))),
    ...SCANNED_FILES.map((file) => resolve(ROOT, file)),
  ];

  it("reads the expected files", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((file) => rel(file).endsWith("hallRepository.ts"))).toBe(true);
    expect(files.some((file) => rel(file).endsWith(".sql"))).toBe(true);
  });

  it("never reads the retired public price disclosure tables (D-79)", () => {
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return PRICE_DISCLOSURE.filter((pattern) => pattern.test(text)).map((pattern) => `${rel(file)} ${pattern}`);
    });
    expect(hits).toEqual([]);
  });

  it("never sends mail, texts or messages from server code, and never calls outside hosts", () => {
    const server = files.filter((file) => SERVER_DIRS.some((dir) => rel(file).startsWith(dir)));
    expect(server.length).toBeGreaterThan(20);
    const hits = server.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return OUTBOUND.filter((pattern) => pattern.test(text)).map((pattern) => `${rel(file)} ${pattern}`);
    });
    expect(hits).toEqual([]);
  });
});
