import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../lib/vendorAvailability.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const module = { exports: {} };
new Function("exports", "module", compiled.outputText)(module.exports, module);
const {
  availableHoursFromOccupancy,
  databaseWeekdayForLocalDate,
  localDateString,
  parsePublicAvailabilityPayload,
} = module.exports;

test("mobile converts Sunday/Monday to the database Monday-zero convention", () => {
  assert.equal(databaseWeekdayForLocalDate(new Date(2026, 6, 19)), 6);
  assert.equal(databaseWeekdayForLocalDate(new Date(2026, 6, 20)), 0);
  assert.equal(localDateString(new Date(2026, 6, 20)), "2026-07-20");
});

test("mobile includes other customers in product capacity without receiving their identity", () => {
  const counts = [
    {
      date: "2026-07-20",
      time: "10:00",
      productId: "11111111-1111-4111-8111-111111111111",
      staffId: null,
      bookedCount: 2,
    },
    {
      date: "2026-07-20",
      time: "11:00",
      productId: "22222222-2222-4222-8222-222222222222",
      staffId: null,
      bookedCount: 1,
    },
  ];

  assert.deepEqual(availableHoursFromOccupancy(
    [{ hour: 10, maxBookings: 2 }, { hour: 11, maxBookings: 2 }],
    counts,
    "2026-07-20",
    { productId: "11111111-1111-4111-8111-111111111111" },
  ), [11]);
});

test("mobile rejects malformed or mismatched availability payloads instead of assuming zero", () => {
  assert.equal(parsePublicAvailabilityPayload({
    from: "2026-07-20",
    to: "2026-07-20",
    timezone: "Asia/Seoul",
    counts: [{
      date: "2026-07-20",
      time: "10:00",
      productId: null,
      staffId: null,
      bookedCount: 0,
    }],
  }, "2026-07-20"), null);
  assert.equal(parsePublicAvailabilityPayload({
    from: "2026-07-21",
    to: "2026-07-21",
    timezone: "Asia/Seoul",
    counts: [],
  }, "2026-07-20"), null);
});

test("legacy mobile vendor detail redirects to the canonical disclosure explorer", () => {
  const screenPath = fileURLToPath(new URL("../../app/vendors/[id].tsx", import.meta.url));
  const source = readFileSync(screenPath, "utf8");
  assert.doesNotMatch(source, /\.from\(["']vendor_bookings["']\)/);
  assert.doesNotMatch(source, /\/api\/vendors/);
  assert.match(source, /Redirect href="\/market-prices"/);
});

test("legacy mobile discovery cannot render a second vendor truth surface", () => {
  const listPath = fileURLToPath(new URL("../../app/vendors/index.tsx", import.meta.url));
  const detailPath = fileURLToPath(new URL("../../app/vendors/[id].tsx", import.meta.url));
  const listSource = readFileSync(listPath, "utf8");
  const detailSource = readFileSync(detailPath, "utf8");

  for (const source of [listSource, detailSource]) {
    assert.doesNotMatch(source, /\.from\(["']vendors["']\)/);
    assert.doesNotMatch(source, /\.from\(["']vendor_products["']\)/);
    assert.doesNotMatch(source, /\/api\/vendors/);
    assert.match(source, /Redirect href="\/market-prices"/);
  }
});
