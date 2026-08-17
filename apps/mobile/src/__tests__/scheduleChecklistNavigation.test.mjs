import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  buildChecklistDeepLinkParams,
  buildVerifiedChecklistDeepLink,
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

test("an action-bound checklist link accepts only the exact current action revision", () => {
  const verifiedIdentity = {
    ownerId: "10000000-0000-4000-8000-000000000001",
    coupleId: "20000000-0000-4000-8000-000000000001",
  };
  const availableActions = [{
    id: "act_exact_meeting_step",
    categoryKey: "meeting",
    sourceRevision: 7,
  }, {
    id: "act_other_meeting_step",
    categoryKey: "meeting",
    sourceRevision: 2,
  }];
  const base = {
    checklistOnly: true,
    requestedCategoryKey: "meeting",
    requestedActionId: "act_exact_meeting_step",
    requestedActionRevision: "7",
    availableCategoryKeys: ["meeting", "venue"],
    availableActions,
    verifiedIdentity,
  };

  assert.deepEqual(buildVerifiedChecklistDeepLink(base), {
    categoryKey: "meeting",
    actionId: "act_exact_meeting_step",
    actionRevision: 7,
    handledKey: [
      verifiedIdentity.ownerId,
      verifiedIdentity.coupleId,
      "meeting",
      "act_exact_meeting_step",
      "7",
    ].join(":"),
  });
  assert.deepEqual(buildVerifiedChecklistDeepLink({
    ...base,
    requestedActionId: "act_legacy_meeting_step",
    requestedActionRevision: "none",
    availableActions: [{
      id: "act_legacy_meeting_step",
      categoryKey: "meeting",
      sourceRevision: null,
    }],
  }), {
    categoryKey: "meeting",
    actionId: "act_legacy_meeting_step",
    actionRevision: null,
    handledKey: [
      verifiedIdentity.ownerId,
      verifiedIdentity.coupleId,
      "meeting",
      "act_legacy_meeting_step",
      "none",
    ].join(":"),
  });

  for (const override of [
    { requestedActionRevision: "6" },
    { requestedActionRevision: "07" },
    { requestedActionRevision: ["7"] },
    { requestedActionId: "act_missing" },
    { requestedActionId: ["act_exact_meeting_step"] },
    { requestedCategoryKey: "venue" },
    { availableActions: [] },
    { availableActions: [availableActions[0], availableActions[0]] },
  ]) {
    assert.equal(buildVerifiedChecklistDeepLink({ ...base, ...override }), null);
  }
});

test("undefined Expo action params preserve an ordinary verified category link", () => {
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const coupleId = "20000000-0000-4000-8000-000000000001";
  assert.deepEqual(buildVerifiedChecklistDeepLink({
    checklistOnly: true,
    requestedCategoryKey: "meeting",
    requestedActionId: undefined,
    requestedActionRevision: undefined,
    availableCategoryKeys: ["meeting"],
    availableActions: [],
    verifiedIdentity: { ownerId, coupleId },
  }), {
    categoryKey: "meeting",
    handledKey: `${ownerId}:${coupleId}:meeting`,
  });
});

test("home serializes one canonical checklist action binding without exposing nullable ambiguity", () => {
  assert.deepEqual(buildChecklistDeepLinkParams({
    categoryKey: "meeting",
    actionId: "act_exact_meeting_step",
    actionRevision: 7,
  }), {
    category: "meeting",
    action: "act_exact_meeting_step",
    actionRevision: "7",
  });
  assert.deepEqual(buildChecklistDeepLinkParams({
    categoryKey: "meeting",
    actionId: "act_legacy_meeting_step",
    actionRevision: null,
  }), {
    category: "meeting",
    action: "act_legacy_meeting_step",
    actionRevision: "none",
  });
  assert.deepEqual(buildChecklistDeepLinkParams({ categoryKey: "meeting" }), {
    category: "meeting",
  });

  for (const invalid of [
    { categoryKey: "" },
    { categoryKey: "meeting", actionId: "bad action", actionRevision: 1 },
    { categoryKey: "meeting", actionId: "act_missing_revision" },
    { categoryKey: "meeting", actionRevision: 1 },
    { categoryKey: "meeting", actionId: "act_zero", actionRevision: 0 },
  ]) {
    assert.equal(buildChecklistDeepLinkParams(invalid), null);
  }
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

test("home and topic wire the same verified action identity through the checklist route", () => {
  const homeSource = readFileSync(fileURLToPath(new URL(
    "../components/dashboard/WeddingHomeExperience.tsx",
    import.meta.url,
  )), "utf8");
  const scheduleSource = readFileSync(fileURLToPath(new URL(
    "../../app/schedule/index.tsx",
    import.meta.url,
  )), "utf8");

  assert.match(homeSource, /buildChecklistDeepLinkParams\(\{/);
  assert.match(homeSource, /actionId:\s*focus\.actionId/);
  assert.match(homeSource, /actionRevision:\s*focus\.actionRevision/);
  assert.match(
    scheduleSource,
    /useLocalSearchParams<\{[\s\S]{0,160}action\?: string;[\s\S]{0,80}actionRevision\?: string/,
  );
  assert.match(scheduleSource, /requestedActionId/);
  assert.match(scheduleSource, /requestedActionRevision/);
  assert.match(scheduleSource, /availableActions:\s*normalizedTopicOpenActions/);
  assert.match(scheduleSource, /preferredActionRef:/);
  assert.match(scheduleSource, /verifiedChecklistDeepLink\?\.actionId/);
  assert.match(
    scheduleSource,
    /\}, \[[\s\S]{0,220}requestedActionId,[\s\S]{0,80}requestedActionRevision,[\s\S]{0,80}requestedCategoryKey,[\s\S]{0,80}scheduleSessionFenceRef/,
  );
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
