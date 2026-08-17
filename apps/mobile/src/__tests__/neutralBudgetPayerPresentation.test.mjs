import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  resolveBudgetPayerOptions,
} from "../lib/neutralBudgetPayerPresentation.mjs";

const legacy = [
  { value: "couple", label: "두 사람" },
  { value: "bride_parents", label: "예비 신부 가족" },
  { value: "groom_parents", label: "예비 신랑 가족" },
  { value: "both_parents", label: "두 가족" },
];

const scheduleSource = readFileSync(fileURLToPath(
  new URL("../../app/schedule/index.tsx", import.meta.url),
), "utf8");
const topicSummarySource = readFileSync(fileURLToPath(
  new URL("../components/planning/PreparationTopicSummary.tsx", import.meta.url),
), "utf8");

test("neutral preparation members see payer labels relative to themselves", () => {
  assert.deepEqual(resolveBudgetPayerOptions({
    memberModelVersion: 2,
    viewerRole: "bride",
  }), [
    { value: "couple", label: "두 사람" },
    { value: "bride_parents", label: "내 가족" },
    { value: "groom_parents", label: "파트너 가족" },
    { value: "both_parents", label: "두 가족" },
  ]);
  assert.deepEqual(resolveBudgetPayerOptions({
    memberModelVersion: 2,
    viewerRole: "groom",
  }), [
    { value: "couple", label: "두 사람" },
    { value: "bride_parents", label: "파트너 가족" },
    { value: "groom_parents", label: "내 가족" },
    { value: "both_parents", label: "두 가족" },
  ]);
});

test("legacy labels remain exact and unknown context fails closed", () => {
  assert.deepEqual(resolveBudgetPayerOptions({
    memberModelVersion: 1,
    viewerRole: null,
  }), legacy);
  assert.equal(resolveBudgetPayerOptions({
    memberModelVersion: 2,
    viewerRole: null,
  }), null);
  assert.equal(resolveBudgetPayerOptions({
    memberModelVersion: null,
    viewerRole: "bride",
  }), null);
});

test("the budget screen resolves the exact member model before presenting payer keys", () => {
  const source = readFileSync(fileURLToPath(
    new URL("../../app/budget/index.tsx", import.meta.url),
  ), "utf8");

  assert.match(source, /EXPO_PUBLIC_AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED/u);
  assert.match(source, /member_model_version/u);
  assert.match(source, /resolveBudgetPayerOptions/u);
  assert.match(source, /payerOptions\.map/u);
  assert.match(source, /payerOptions\.find/u);
  assert.doesNotMatch(source, /const PAYER_OPTIONS/u);
});

test("the preparation topic keeps the same identity-bound payer presentation", () => {
  assert.match(scheduleSource, /EXPO_PUBLIC_AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED/u);
  assert.match(scheduleSource, /member_model_version/u);
  assert.match(scheduleSource, /verifiedPayerPresentationContextRef/u);
  assert.match(scheduleSource, /setTopicPayerPresentationContext\(null\)/u);
  assert.match(
    scheduleSource,
    /buildPreparationTopicPresentation\(\s*topicView,\s*undefined,\s*topicPayerPresentationContext,?\s*\)/u,
  );
  assert.match(
    scheduleSource,
    /payerPresentationContext=\{topicPayerPresentationContext\}/u,
  );
  assert.match(
    topicSummarySource,
    /buildPreparationTopicPresentation\(\s*view,\s*messageReferenceRead,\s*payerPresentationContext,?\s*\)/u,
  );
});
