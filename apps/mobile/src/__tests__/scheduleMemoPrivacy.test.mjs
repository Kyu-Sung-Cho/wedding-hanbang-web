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
    // 이 검사의 뜻은 **공용 sanitizer 를 쓴다**는 것이지 import 를 하나만 한다는
    // 것이 아니다. 예전 정규식은 이름 하나짜리 형태만 허용해서 같은 모듈에서
    // 다른 것을 함께 가져오면 깨졌다(2026-08-25 daysUntilWedding 을 추가하다 걸렸다).
    // 이름이 목록 안에 있는지로 바꾼다.
    /import\s*\{[^}]*sanitizeUserFacingScheduleMemo[^}]*\}\s*from\s*["']@hanbang\/shared["']/,
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
