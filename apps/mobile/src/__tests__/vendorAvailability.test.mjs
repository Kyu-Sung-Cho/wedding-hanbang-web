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
  availableHoursFromPublicAvailability,
  databaseWeekdayForLocalDate,
  localDateString,
  parsePublicAvailabilityPayload,
} = module.exports;

test("mobile converts Sunday/Monday to the database Monday-zero convention", () => {
  assert.equal(databaseWeekdayForLocalDate(new Date(2026, 6, 19)), 6);
  assert.equal(databaseWeekdayForLocalDate(new Date(2026, 6, 20)), 0);
  assert.equal(localDateString(new Date(2026, 6, 20)), "2026-07-20");
});

test("mobile consumes only server-derived public availability booleans", () => {
  const slots = [
    {
      date: "2026-07-20",
      time: "10:00",
      available: false,
    },
    {
      date: "2026-07-20",
      time: "11:00",
      available: true,
    },
  ];

  assert.deepEqual(availableHoursFromPublicAvailability(
    slots,
    "2026-07-20",
  ), [11]);
});

test("mobile rejects malformed or mismatched availability payloads instead of assuming zero", () => {
  assert.equal(parsePublicAvailabilityPayload({
    from: "2026-07-20",
    to: "2026-07-20",
    timezone: "Asia/Seoul",
    slots: [{
      date: "2026-07-20",
      time: "10:00",
      available: "yes",
    }],
  }, "2026-07-20"), null);
  assert.equal(parsePublicAvailabilityPayload({
    from: "2026-07-21",
    to: "2026-07-21",
    timezone: "Asia/Seoul",
    slots: [],
  }, "2026-07-20"), null);
});

test("legacy mobile vendor detail preserves its UUID through the canonical web route", () => {
  const screenPath = fileURLToPath(new URL("../../app/vendors/[id].tsx", import.meta.url));
  const source = readFileSync(screenPath, "utf8");
  assert.doesNotMatch(source, /\.from\(["']vendor_bookings["']\)/);
  assert.doesNotMatch(source, /\/api\/vendors/);
  assert.match(source, /buildLegacyVendorDetailUrl\(rawId, siteOrigin\)/);
  assert.match(source, /pathname: "\/webview"/);
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
  }
  assert.match(listSource, /Redirect href="\/market-prices"/);
  assert.match(detailSource, /buildLegacyVendorDetailUrl\(rawId, siteOrigin\)/);
});
