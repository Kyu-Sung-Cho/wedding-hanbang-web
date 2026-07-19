import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const scheduleSource = readFileSync(
  new URL("../../app/schedule/index.tsx", import.meta.url),
  "utf8",
);
const sharedSource = readFileSync(
  new URL("../../../../packages/shared/src/utils/scheduleMemo.ts", import.meta.url),
  "utf8",
);

test("mobile schedule load and edit both use the shared legacy-id sanitizer", () => {
  assert.match(
    scheduleSource,
    /import\s*\{\s*sanitizeUserFacingScheduleMemo\s*\}\s*from\s*["']@hanbang\/shared["']/,
  );
  assert.match(scheduleSource, /memo:\s*sanitizeUserFacingScheduleMemo\(event\.memo\)/);
  assert.match(
    scheduleSource,
    /setFormMemo\(sanitizeUserFacingScheduleMemo\(evt\.memo\)\s*\?\?\s*["']["']\)/,
  );
});

test("the shared sanitizer targets only the retired generated booking prefix", () => {
  assert.match(sharedSource, /\^\(예약 자동 등록\)/);
  assert.match(sharedSource, /booking/);
  assert.match(sharedSource, /\[0-9a-f-\]\{8,36\}/);
  assert.match(sharedSource, /memo\.replace\(LEGACY_BOOKING_MEMO_ID_PATTERN,\s*["']\$1["']\)/);
});
