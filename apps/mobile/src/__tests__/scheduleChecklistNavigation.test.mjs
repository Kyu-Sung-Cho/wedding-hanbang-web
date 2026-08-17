import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  buildVerifiedChecklistDeepLinkFocusTarget,
} from "../lib/scheduleChecklistNavigation.mjs";

test("a verified checklist deep link focuses its exact laid-out category once", () => {
  const deepLink = {
    categoryKey: "venue",
    handledKey: [
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000001",
      "venue",
    ].join(":"),
  };

  assert.deepEqual(buildVerifiedChecklistDeepLinkFocusTarget({
    deepLink,
    laidOutCategoryKey: "venue",
    layoutY: 640,
    focusedHandledKey: null,
  }), {
    categoryKey: "venue",
    handledKey: deepLink.handledKey,
    scrollY: 632,
  });

  assert.equal(buildVerifiedChecklistDeepLinkFocusTarget({
    deepLink,
    laidOutCategoryKey: "venue",
    layoutY: 640,
    focusedHandledKey: deepLink.handledKey,
  }), null);
});

test("checklist focus ignores unrelated, missing, or invalid layouts", () => {
  const deepLink = {
    categoryKey: "venue",
    handledKey: [
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000001",
      "venue",
    ].join(":"),
  };

  for (const input of [
    {
      deepLink: null,
      laidOutCategoryKey: "venue",
      layoutY: 640,
      focusedHandledKey: null,
    },
    {
      deepLink,
      laidOutCategoryKey: "meeting",
      layoutY: 640,
      focusedHandledKey: null,
    },
    {
      deepLink,
      laidOutCategoryKey: "venue",
      layoutY: Number.NaN,
      focusedHandledKey: null,
    },
    {
      deepLink,
      laidOutCategoryKey: "venue",
      layoutY: -1,
      focusedHandledKey: null,
    },
  ]) {
    assert.equal(buildVerifiedChecklistDeepLinkFocusTarget(input), null);
  }
});

test("the same category can focus again for a different verified couple", () => {
  const categoryKey = "venue";
  const previousHandledKey = [
    "10000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000001",
    categoryKey,
  ].join(":");
  const nextHandledKey = [
    "10000000-0000-4000-8000-000000000002",
    "20000000-0000-4000-8000-000000000002",
    categoryKey,
  ].join(":");

  assert.deepEqual(buildVerifiedChecklistDeepLinkFocusTarget({
    deepLink: { categoryKey, handledKey: nextHandledKey },
    laidOutCategoryKey: categoryKey,
    layoutY: 24,
    focusedHandledKey: previousHandledKey,
  }), {
    categoryKey,
    handledKey: nextHandledKey,
    scrollY: 16,
  });
});

test("the checklist screen waits for stable layout, then scrolls and focuses the exact header", () => {
  const scheduleSource = readFileSync(fileURLToPath(new URL(
    "../../app/schedule/index.tsx",
    import.meta.url,
  )), "utf8");

  assert.match(scheduleSource, /ref=\{checklistScrollRef\}/);
  assert.match(
    scheduleSource,
    /onLayout=\{\(event\) => handleChecklistCategoryLayout\(\s*cat\.key,\s*event\.nativeEvent\.layout\.y,?\s*\)\}/,
  );
  assert.match(scheduleSource, /ref=\{\(node\) => setChecklistCategoryHeaderRef\(cat\.key, node\)\}/);
  assert.match(scheduleSource, /approvalInitialReadSettled/);
  assert.match(scheduleSource, /scrollTo\(\{ y: target\.scrollY, animated: false \}\)/);
  assert.match(scheduleSource, /AccessibilityInfo\.sendAccessibilityEvent\(header, "focus"\)/);
  assert.match(scheduleSource, /Platform\.OS === "web"[\s\S]{0,80}header\.focus\(\)/);
  assert.match(scheduleSource, /onPointerDown=\{cancelPendingChecklistDeepLinkFocus\}/);
  assert.match(scheduleSource, /onTouchStart=\{cancelPendingChecklistDeepLinkFocus\}/);
  assert.match(scheduleSource, /onScrollBeginDrag=\{cancelPendingChecklistDeepLinkFocus\}/);
  assert.match(scheduleSource, /accessible\s+collapsable=\{false\}/);
  assert.match(scheduleSource, /focusedChecklistDeepLinkRef\.current = null;[\s\S]{0,180}checklistCategoryLayoutRef\.current\.clear\(\)/);
  assert.match(scheduleSource, /cancelPendingChecklistDeepLinkFocus\(\);[\s\S]{0,160}setExpandedKey\(/);
});

test("only a verified canonical checklist category can become a focus request", async () => {
  const { buildVerifiedChecklistDeepLink } = await import(
    "../lib/scheduleChecklistNavigation.mjs"
  );
  const verifiedIdentity = {
    ownerId: "10000000-0000-4000-8000-000000000001",
    coupleId: "20000000-0000-4000-8000-000000000001",
  };
  const base = {
    checklistOnly: true,
    availableCategoryKeys: ["meeting", "venue"],
    verifiedIdentity,
  };

  assert.equal(buildVerifiedChecklistDeepLink({
    ...base,
    requestedCategoryKey: "reserve",
  }), null);
  assert.equal(buildVerifiedChecklistDeepLink({
    ...base,
    requestedCategoryKey: ["venue"],
  }), null);
  assert.equal(buildVerifiedChecklistDeepLink({
    ...base,
    checklistOnly: false,
    requestedCategoryKey: "venue",
  }), null);
});
