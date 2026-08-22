import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  buildTodayOneActionBody,
  canRenderTodayOneFallback,
  getTodayOneNativeKindPresentation,
  getTodayOneNativeRoute,
  isTodayOneCareCardCurrent,
  parseTodayOneEnvelope,
  parseTodayOnePreferenceEnvelope,
} from "../lib/todayOneCare.mjs";
import { buildVerifiedChecklistDeepLink } from "../lib/scheduleChecklistNavigation.mjs";
import { canOfferFamilyMomentPersonalization } from "../lib/amoraPersonalization.mjs";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const HERE = dirname(fileURLToPath(import.meta.url));

test("the home fallback appears only after the current owner and couple are verified", () => {
  const ownerA = "10000000-0000-4000-8000-000000000001";
  const ownerB = "10000000-0000-4000-8000-000000000002";
  const coupleA = "20000000-0000-4000-8000-000000000001";
  const coupleB = "20000000-0000-4000-8000-000000000002";

  assert.equal(canRenderTodayOneFallback(ownerA, ownerA, coupleA, coupleA), true);
  assert.equal(canRenderTodayOneFallback(ownerA, ownerB, coupleA, coupleA), false);
  assert.equal(canRenderTodayOneFallback(ownerA, ownerA, coupleA, coupleB), false);
  assert.equal(canRenderTodayOneFallback(ownerA, ownerA, coupleA, null), false);
  assert.equal(canRenderTodayOneFallback(null, ownerA, coupleA, coupleA), false);
  assert.equal(
    canRenderTodayOneFallback("not-an-owner", "not-an-owner", coupleA, coupleA),
    false,
  );
});

test("today-one envelopes fail closed around the shared validated result", () => {
  const result = {
    version: 2,
    state: "daily_limit",
    recipientUserId: USER_ID,
    claimedForDate: "2026-08-02",
  };

  assert.deepEqual(parseTodayOneEnvelope({ available: false }), {
    available: false,
  });
  assert.deepEqual(
    parseTodayOneEnvelope({ available: true, result, error: "다시 확인해 주세요." }),
    { available: true, result, error: "다시 확인해 주세요." },
  );
  assert.equal(
    parseTodayOneEnvelope({ available: false, result }),
    null,
  );
  assert.equal(
    parseTodayOneEnvelope({ available: true, result, injected: true }),
    null,
  );
  assert.equal(
    parseTodayOneEnvelope({ available: true, result, error: "x".repeat(241) }),
    null,
  );
});

test("an expired today-one card is never kept across the local day boundary", () => {
  const card = { expiresAt: "2026-08-15T15:00:00.000Z" };
  assert.equal(
    isTodayOneCareCardCurrent(card, Date.parse("2026-08-15T14:59:59.999Z")),
    true,
  );
  assert.equal(
    isTodayOneCareCardCurrent(card, Date.parse("2026-08-15T15:00:00.000Z")),
    false,
  );
  assert.equal(isTodayOneCareCardCurrent({ expiresAt: "not-a-date" }, Date.now()), false);
  assert.equal(isTodayOneCareCardCurrent(card, Number.NaN), false);
});

test("today-one preference envelope enforces opt-in and the fixed daily limit", () => {
  const enabled = {
    enabled: true,
    optedInAt: "2026-08-02T01:00:00.000Z",
    pausedUntil: null,
    dailyLimit: 1,
  };

  assert.deepEqual(
    parseTodayOnePreferenceEnvelope({ available: true, preference: enabled }),
    { available: true, preference: enabled },
  );
  assert.deepEqual(parseTodayOnePreferenceEnvelope({ available: false }), {
    available: false,
  });
  const disabled = {
    enabled: false,
    optedInAt: null,
    pausedUntil: null,
    dailyLimit: 1,
  };
  assert.deepEqual(
    parseTodayOnePreferenceEnvelope({ available: true, preference: disabled }),
    { available: true, preference: disabled },
  );
  assert.equal(
    parseTodayOnePreferenceEnvelope({
      available: true,
      preference: { ...enabled, dailyLimit: 2 },
    }),
    null,
  );
  assert.equal(
    parseTodayOnePreferenceEnvelope({
      available: true,
      preference: { ...enabled, enabled: false },
    }),
    null,
  );
  assert.equal(
    parseTodayOnePreferenceEnvelope({
      available: true,
      preference: { ...enabled, extra: "unsafe" },
    }),
    null,
  );
});

test("today-one native navigation maps every exact shared contract route", () => {
  assert.equal(getTodayOneNativeRoute("/schedule"), "/schedule");
  assert.equal(getTodayOneNativeRoute("/budget"), "/budget");
  assert.equal(getTodayOneNativeRoute("/dashboard"), "/dashboard");
  assert.equal(getTodayOneNativeRoute("//evil.example"), null);
  assert.equal(getTodayOneNativeRoute("/schedule?next=https://evil.example"), null);
  assert.equal(getTodayOneNativeRoute("/(tabs)/chat"), null);
});

test("today-one native kind presentation distinguishes confirmed decisions", () => {
  assert.deepEqual(getTodayOneNativeKindPresentation("schedule_moment"), {
    recordLabel: "일정",
    icon: "schedule",
  });
  assert.deepEqual(getTodayOneNativeKindPresentation("budget_guardrail"), {
    recordLabel: "예산",
    icon: "budget",
  });
  assert.deepEqual(getTodayOneNativeKindPresentation("decision_follow_up"), {
    recordLabel: "결정",
    icon: "decision",
  });
  assert.equal(getTodayOneNativeKindPresentation("unknown"), null);
});

test("today-one action body carries both optimistic-concurrency revisions", () => {
  assert.deepEqual(
    buildTodayOneActionBody(
      {
        id: "20000000-0000-4000-8000-000000000001",
        revision: 4,
        sourceRevision: 9,
      },
      "dismiss",
    ),
    {
      cardId: "20000000-0000-4000-8000-000000000001",
      expectedRevision: 4,
      expectedSourceRevision: 9,
      action: "dismiss",
    },
  );
  assert.equal(
    buildTodayOneActionBody(
      {
        id: "not-a-uuid",
        revision: 4,
        sourceRevision: 9,
      },
      "dismiss",
    ),
    null,
  );
  assert.equal(
    buildTodayOneActionBody(
      {
        id: "20000000-0000-4000-8000-000000000001",
        revision: 4,
        sourceRevision: 9,
      },
      "unknown",
    ),
    null,
  );
});

test("mobile surfaces use authenticated API, owner validation, in-app-only copy, and explicit opt-in", async () => {
  const [cardSource, helperSource, preferenceSource, dashboardSource, experienceSource, settingsSource] = await Promise.all([
    readFile(resolve(HERE, "../components/dashboard/TodayOneCareCard.tsx"), "utf8"),
    readFile(resolve(HERE, "../lib/todayOneCare.mjs"), "utf8"),
    readFile(resolve(HERE, "../components/settings/TodayOnePreferenceControl.tsx"), "utf8"),
    readFile(resolve(HERE, "../../app/(tabs)/lounge.tsx"), "utf8"),
    readFile(resolve(HERE, "../components/dashboard/WeddingHomeExperience.tsx"), "utf8"),
    readFile(resolve(HERE, "../../app/settings/index.tsx"), "utf8"),
  ]);

  assert.match(cardSource, /const response = await apiFetchForExpectedUser\(expectedUserId, path/);
  assert.match(cardSource, /readRawResponse\(userId, "\/api\/amora\/today-one"/);
  assert.match(cardSource, /validateCompatibleTodayOneCareResponse\([^,]+,\s*userId\)/s);
  assert.match(cardSource, /isTodayOneCareCardCurrent\(result\.card,\s*Date\.now\(\)\)/);
  assert.match(cardSource, /TODAY_ONE_CARE_CONTRACT_VERSION_HEADER/);
  assert.match(cardSource, /\[TODAY_ONE_CARE_CONTRACT_VERSION_HEADER\]:\s*String\(TODAY_ONE_CARE_CONTRACT_VERSION\)/);
  assert.match(cardSource, /buildTodayOneActionBody/);
  assert.match(cardSource, /getTodayOneNativeKindPresentation\(card\.kind\)/);
  assert.ok(
    cardSource.indexOf("getTodayOneNativeRoute(card.nextAction.href)")
      < cardSource.indexOf('readRawResponse(userId, "/api/amora/today-one", {\n        method: "POST"'),
    "open_source destination must be validated before the card is consumed",
  );
  assert.match(helperSource, /expectedSourceRevision:\s*card\.sourceRevision/);
  assert.match(cardSource, /inFlightAction\.current/);
  assert.match(cardSource, /if \(inFlightAction\.current\) return;/);
  assert.match(cardSource, /loadGeneration\.current \+= 1;[\s\S]*loadController\.current\?\.abort\(\)/);
  assert.match(cardSource, /finally \{[\s\S]*inFlightAction\.current = false;[\s\S]*setPendingAction\(null\)/);
  assert.match(cardSource, /외부 알림 아님/);
  assert.match(cardSource, /아직 확인되지 않은 점/);
  assert.match(preferenceSource, /\/api\/amora\/today-one\/preferences/);
  assert.match(preferenceSource, /apiFetchForExpectedUser\(\s*ownerUserId/);
  assert.match(preferenceSource, /saveMode\(nextEnabled \? "enable" : "disable"\)/);
  assert.match(preferenceSource, /하루 최대 1건/);
  assert.match(preferenceSource, /푸시·문자·이메일 알림은 보내지 않아요/);
  assert.match(preferenceSource, /saveInFlight\.current/);
  assert.match(preferenceSource, /ownerUserId/);
  assert.match(cardSource, /supabase\.auth\.onAuthStateChange/);
  assert.match(preferenceSource, /supabase\.auth\.onAuthStateChange/);
  assert.match(dashboardSource, /<TodayOneCareCard/);
  assert.match(
    dashboardSource,
    /currentIdentity\?\.coupleId === expectedIdentity\.coupleId[\s\S]{0,180}setTodayOneResumeRefreshVersion/,
  );
  assert.match(
    dashboardSource,
    /refreshVersion=\{careRefreshVersion \+ todayOneResumeRefreshVersion\}/,
  );
  assert.match(cardSource, /fallback = null/);
  assert.match(cardSource, /expectedOwnerUserId = null/);
  assert.match(cardSource, /expectedCoupleId = null/);
  assert.match(cardSource, /\.from\("profiles"\)[\s\S]{0,180}\.select\("couple_id"\)/);
  assert.match(
    cardSource,
    /canRenderTodayOneFallback\(\s*expectedOwnerUserId,\s*verifiedSessionUserId,\s*expectedCoupleId,\s*verifiedSessionCoupleId,\s*\)/,
  );
  assert.ok(
    cardSource.indexOf("setVerifiedSessionCoupleId(identity.coupleId)")
      < cardSource.indexOf('readRawResponse(userId, "/api/amora/today-one"'),
    "the verified owner and couple must wake the fallback before the API response arrives",
  );
  assert.match(
    cardSource,
    /result\.state === "none"\) return \{ kind: "fallback" \}/,
  );
  assert.match(
    cardSource,
    /view\.kind === "unavailable"\s*\|\| view\.kind === "loading"\s*\|\| view\.kind === "fallback"[\s\S]{0,80}return canRenderFallback \? fallback : null/,
  );
  assert.match(
    cardSource,
    /view\.kind === "error" \|\| view\.kind === "stale"\)[\s\S]{0,220}canRenderFallback \? fallback : null/,
    "a verified deterministic focus must remain visible while TodayOne offers recovery",
  );
  assert.match(dashboardSource, /renderTodayOneCare=\{\(companionFallback, focus\) =>/);
  assert.match(dashboardSource, /<AmoraMediationOutcomeFollowUp/);
  assert.match(dashboardSource, /<AmoraActionFollowUpV2/);
  assert.match(dashboardSource, /loadingFallback=\{companionFallback\}/);
  assert.match(
    dashboardSource,
    /if \(!data\?\.coupleId\) return companionFallback/,
    "a user without a canonical couple must keep the questionless home entry",
  );
  assert.match(
    dashboardSource,
    /focus\.kind !== "action" \|\| !data\.openAction[\s\S]{0,500}const renderActionCare[\s\S]{0,500}<AmoraActionFollowUpV2/,
    "an action follow-up may claim only the exact action already selected as the grounded home focus",
  );
  assert.match(
    dashboardSource,
    /fallback=\{todayOneBeforeOrdinaryAction\}/,
    "the recipient-private mediation card must preserve exact schedule care before an ordinary action follow-up",
  );
  assert.match(
    dashboardSource,
    /<TodayOneCareCard[\s\S]{0,260}fallback=\{ordinaryActionCare\}/,
    "an unseen exact-date TodayOne card must be checked before an ordinary open action is claimed",
  );
  assert.match(
    dashboardSource,
    /if \(focus\.claimBeforeCare\) return renderActionCare\(mediatedCare\)/,
    "a confirmed seven-day action must keep the grounded home priority before optional care claims",
  );
  assert.match(
    dashboardSource,
    /if \(!data\?\.coupleId\) return companionFallback/,
    "the no-couple branch must render the safe onboarding fallback",
  );
  assert.match(
    dashboardSource,
    /expectedOwnerUserId=\{data\.ownerUserId\}/,
  );
  assert.match(experienceSource, /renderTodayOneCare\(companionFallback, focus\)/);
  assert.match(experienceSource, /accessibilityLabel="아모라 준비 포커스"/);
  assert.doesNotMatch(experienceSource, /accessibilityLabel="아모라가 오늘 같이 볼 한 가지"/);
  assert.match(settingsSource, /<TodayOnePreferenceControl/);
  assert.match(experienceSource, /label: "준비 포커스"/);
  assert.doesNotMatch(experienceSource, /label: "오늘의 한 가지"/);
});

test("schedule care opens its checklist only after the current couple is verified", async () => {
  const [cardSource, scheduleSource] = await Promise.all([
    readFile(resolve(HERE, "../components/dashboard/TodayOneCareCard.tsx"), "utf8"),
    readFile(resolve(HERE, "../../app/schedule/index.tsx"), "utf8"),
  ]);

  assert.match(cardSource, /const \[careExpanded, setCareExpanded\] = useState\(false\)/);
  assert.match(cardSource, /const care = card\.kind === "schedule_moment" \? card\.care : undefined/);
  assert.match(cardSource, /\{care\.guidance\}/);
  assert.match(
    cardSource,
    /care\.checklist\s*\.slice\(0, careExpanded \? care\.checklist\.length : 3\)/,
  );
  assert.match(cardSource, /\{care\.script\}/);
  assert.match(cardSource, /\{care\.question\}/);
  assert.match(cardSource, /care\.evidence\.refs\.map\(\(ref\) => ref\.label\)\.join/);
  assert.match(cardSource, /care\.evidence\.limitations\.map/);
  assert.match(
    cardSource,
    /router\.push\(\{\s*pathname:\s*"\/checklist",\s*params:\s*\{\s*category:\s*care\.relatedChecklist\.categoryKey\s*\}/,
  );
  assert.match(cardSource, /accessibilityLabel=\{`\$\{care\.relatedChecklist\.categoryLabel\} 체크리스트 열기`\}/);
  assert.match(
    cardSource,
    /const relatedBudget = care\?\.relatedBudget;[\s\S]*?\{relatedBudget \? \([\s\S]*?pathname:\s*"\/budget"[\s\S]*?category:\s*relatedBudget\.categoryKey[\s\S]*?\) : null\}/,
    "budget opens only when the validated care contract explicitly supplies a budget destination",
  );
  assert.doesNotMatch(
    cardSource,
    /pathname:\s*"\/budget"[\s\S]{0,160}category:\s*care\.relatedChecklist\.categoryKey/,
  );
  assert.match(cardSource, /careChecklistButton:[\s\S]*?minHeight:\s*44/);

  const request = {
    checklistOnly: true,
    requestedCategoryKey: "meeting",
    availableCategoryKeys: ["meeting", "venue"],
  };
  assert.equal(buildVerifiedChecklistDeepLink({
    ...request,
    verifiedIdentity: null,
  }), null);
  assert.deepEqual(buildVerifiedChecklistDeepLink({
    ...request,
    verifiedIdentity: {
      ownerId: "10000000-0000-4000-8000-000000000001",
      coupleId: "20000000-0000-4000-8000-000000000001",
    },
  }), {
    categoryKey: "meeting",
    handledKey: [
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000001",
      "meeting",
    ].join(":"),
  });

  const categoriesCommit = scheduleSource.indexOf("setCategories(cats)");
  const verifiedDeepLink = scheduleSource.indexOf(
    "buildVerifiedChecklistDeepLink({",
    categoriesCommit,
  );
  assert.ok(
    categoriesCommit >= 0 && verifiedDeepLink > categoriesCommit,
    "the requested category must be applied after verified checklist data commits",
  );
});

test("only an upcoming verified family care card can open owner-private coordination personalization", async () => {
  assert.equal(canOfferFamilyMomentPersonalization("sanggyeonrye", "d3"), true);
  assert.equal(canOfferFamilyMomentPersonalization("family_greeting", "d1"), true);
  assert.equal(canOfferFamilyMomentPersonalization("sanggyeonrye", "dAfter"), false);
  assert.equal(canOfferFamilyMomentPersonalization("venue_tour", "d1"), false);
  assert.equal(canOfferFamilyMomentPersonalization(null, "d1"), false);

  const cardSource = await readFile(
    resolve(HERE, "../components/dashboard/TodayOneCareCard.tsx"),
    "utf8",
  );
  assert.match(cardSource, /<AmoraPersonalizationSheet/);
  assert.match(cardSource, /entryPoint="family_moment"/);
  assert.match(
    cardSource,
    /const familyMomentContext = care[\s\S]{0,320}momentType: care\.momentType,\s*attentionWindow: care\.attentionWindow/,
  );
  assert.match(
    cardSource,
    /care\.momentType === "sanggyeonrye" \|\| care\.momentType === "family_greeting"/,
    "dress care must never open the family coordination control",
  );
  assert.match(cardSource, /familyMomentContext=\{familyMomentContext \?\? undefined\}/);
  assert.match(
    cardSource,
    /canOfferFamilyMomentPersonalization\(care\.momentType, care\.attentionWindow\)/,
  );
  assert.match(cardSource, /async function openFamilyMomentPersonalization\(\)/);
  assert.match(cardSource, /const identity = await currentVerifiedIdentity\(\)/);
  assert.match(
    cardSource,
    /canRenderTodayOneFallback\(\s*expectedOwnerUserId,\s*identity\?\.userId \?\? null,\s*expectedCoupleId,\s*identity\?\.coupleId \?\? null/,
  );
  assert.match(cardSource, /setFamilyPersonalizationVisible\(true\)/);
  assert.match(cardSource, /accessibilityLabel="가족 조율 방식 맞추기"/);
  assert.match(cardSource, /가족 조율 방식 맞추기/);
});
