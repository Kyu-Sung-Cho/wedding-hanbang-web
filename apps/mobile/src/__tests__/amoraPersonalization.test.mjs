import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  buildBlockedOutcomePersonalizationSaveBody,
  buildChangedOutcomePersonalizationSaveBody,
  buildCompletedOutcomePersonalizationSaveBody,
  buildFamilyMomentPersonalizationSaveBody,
  buildProgressivePersonalizationSaveBody,
  buildSinglePersonalizationPreferenceSaveBody,
  buildUncertainOutcomePersonalizationSaveBody,
  loadOwnerAmoraPersonalization,
  parseAmoraPersonalizationConflict,
  parseAmoraPersonalizationEnvelope,
} from "../lib/amoraPersonalization.mjs";

test("home can load only the current owner's explicit personalization without making it mandatory", async () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const calls = [];
  const preferences = await loadOwnerAmoraPersonalization(
    ownerUserId,
    async (expectedUserId, path, options) => {
      calls.push({ expectedUserId, path, options });
      return {
        ok: true,
        async json() {
          return {
            profile: {
              preferences: {
                decisionStart: "compare_first",
                answerDetail: "brief",
                supportOrder: "listen_first",
                workMode: "hybrid",
                familyOrder: "couple_first",
                toneStyle: "calm_clear",
              },
              revision: 8,
              confirmedAt: "2026-08-14T00:00:00.000Z",
              updatedAt: "2026-08-14T00:00:00.000Z",
            },
          };
        },
      };
    },
  );

  assert.deepEqual(calls, [{
    expectedUserId: ownerUserId,
    path: "/api/amora/personalization",
    options: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  }]);
  assert.deepEqual(preferences, {
    decisionStart: "compare_first",
    answerDetail: "brief",
    supportOrder: "listen_first",
    workMode: "hybrid",
    familyOrder: "couple_first",
    toneStyle: "calm_clear",
  });

  assert.equal(
    await loadOwnerAmoraPersonalization(ownerUserId, async () => ({
      ok: false,
      async json() { return { error: "temporarily unavailable" }; },
    })),
    null,
  );
});

test("one explicit settings choice preserves the other five personalization preferences", () => {
  const current = parseAmoraPersonalizationEnvelope({
    profile: {
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "couple_first",
        toneStyle: "warm",
      },
      revision: 21,
      confirmedAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  })?.profile;

  assert.deepEqual(
    buildSinglePersonalizationPreferenceSaveBody(current, {
      field: "toneStyle",
      value: "friendly_honest",
    }),
    {
      expectedRevision: 21,
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "couple_first",
        toneStyle: "friendly_honest",
      },
    },
  );
  assert.equal(
    buildSinglePersonalizationPreferenceSaveBody(current, {
      field: "toneStyle",
      value: "compare_first",
    }),
    null,
  );
  assert.equal(
    buildSinglePersonalizationPreferenceSaveBody(current, {
      field: "toneStyle",
      value: "warm",
      inferredPersonality: "sensitive",
    }),
    null,
  );
});

test("personalization responses accept only the exact recipient-private profile contract", () => {
  const profile = {
    preferences: {
      decisionStart: "recommend_first",
      answerDetail: "brief",
      supportOrder: "listen_first",
      workMode: "together",
      familyOrder: "couple_first",
      toneStyle: "warm",
    },
    revision: 3,
    confirmedAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };

  assert.deepEqual(parseAmoraPersonalizationEnvelope({ profile }), { profile });
  assert.deepEqual(parseAmoraPersonalizationEnvelope({ profile: null }), {
    profile: null,
  });
  assert.equal(
    parseAmoraPersonalizationEnvelope({
      profile: {
        ...profile,
        inferredPersona: "decisive",
      },
    }),
    null,
  );
  assert.equal(
    parseAmoraPersonalizationEnvelope({
      profile: {
        ...profile,
        preferences: {
          ...profile.preferences,
          hiddenRelationshipStyle: "avoidant",
        },
      },
    }),
    null,
  );
});

test("a stale save adopts only the exact canonical current profile before retry", () => {
  const current = {
    preferences: {
      decisionStart: "ask_each_time",
      answerDetail: "adaptive",
      supportOrder: "ask_each_time",
      workMode: "ask_each_time",
      familyOrder: "ask_each_time",
      toneStyle: "adaptive",
    },
    revision: 4,
    confirmedAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:01.000Z",
  };

  assert.deepEqual(parseAmoraPersonalizationConflict({
    error: "다른 화면에서 도움 방식이 바뀌었어요. 새 값을 확인해 주세요.",
    code: "PERSONALIZATION_REVISION_CONFLICT",
    current,
  }), { current });
  assert.equal(parseAmoraPersonalizationConflict({
    error: "conflict",
    code: "PERSONALIZATION_REVISION_CONFLICT",
    current: { ...current, partnerMood: "angry" },
  }), null);
});

test("private first-use chat exposes an optional two-step explicit preference flow", () => {
  const sheetSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraPersonalizationSheet.tsx", import.meta.url)),
    "utf8",
  );
  const starterSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraStarterCard.tsx", import.meta.url)),
    "utf8",
  );
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(sheetSource, /먼저 들어주기/);
  assert.match(sheetSource, /바로 할 일부터/);
  assert.match(sheetSource, /그때마다 물어보기/);
  assert.match(sheetSource, /짧고 핵심만/);
  assert.match(sheetSource, /필요한 만큼 자세히/);
  assert.match(sheetSource, /처음부터 자세히/);
  assert.match(sheetSource, /buildProgressivePersonalizationSaveBody/);
  assert.match(sheetSource, /apiFetchForExpectedUser/);
  assert.match(sheetSource, /\/api\/amora\/personalization/);
  assert.match(sheetSource, /currentVerifiedUserId/);
  assert.doesNotMatch(sheetSource, /TextInput|inferredPersona|personality|attachment|relationshipStyle/u);

  assert.match(starterSource, /activeScope === "private"/);
  assert.match(starterSource, /아모라 도움 방식 맞추기/);
  assert.match(chatSource, /<AmoraPersonalizationSheet/);
  assert.match(chatSource, /expectedOwnerUserId=\{userId\}/);
  assert.match(chatSource, /accessibilityLabel="아모라 도움 방식 다시 맞추기"/);
});

test("progressive choices preserve every unedited preference and reject inferred fields", () => {
  const current = parseAmoraPersonalizationEnvelope({
    profile: {
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "detailed",
        supportOrder: "listen_first",
        workMode: "owner_led",
        familyOrder: "case_by_case",
        toneStyle: "friendly_honest",
      },
      revision: 9,
      confirmedAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  })?.profile;

  assert.deepEqual(
    buildProgressivePersonalizationSaveBody(current, {
      supportOrder: "action_first",
      answerDetail: "brief",
    }),
    {
      expectedRevision: 9,
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "brief",
        supportOrder: "action_first",
        workMode: "owner_led",
        familyOrder: "case_by_case",
        toneStyle: "friendly_honest",
      },
    },
  );
  assert.equal(
    buildProgressivePersonalizationSaveBody(current, {
      supportOrder: "action_first",
      answerDetail: "brief",
      inferredPersona: "decisive",
    }),
    null,
  );
});

test("a blocked outcome changes only the explicitly confirmed help order", () => {
  const current = parseAmoraPersonalizationEnvelope({
    profile: {
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "detailed",
        supportOrder: "ask_each_time",
        workMode: "owner_led",
        familyOrder: "case_by_case",
        toneStyle: "friendly_honest",
      },
      revision: 12,
      confirmedAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  })?.profile;

  assert.deepEqual(
    buildBlockedOutcomePersonalizationSaveBody(current, {
      outcome: "blocked",
      supportOrder: "action_first",
    }),
    {
      expectedRevision: 12,
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "detailed",
        supportOrder: "action_first",
        workMode: "owner_led",
        familyOrder: "case_by_case",
        toneStyle: "friendly_honest",
      },
    },
  );

  assert.equal(
    buildBlockedOutcomePersonalizationSaveBody(current, {
      outcome: "completed",
      supportOrder: "action_first",
    }),
    null,
  );
  assert.equal(
    buildBlockedOutcomePersonalizationSaveBody(current, {
      outcome: "blocked",
      supportOrder: "action_first",
      inferredPersona: "overwhelmed",
    }),
    null,
  );
});

test("the blocked-outcome entry is one explicit private decision and never auto-saves", () => {
  const sheetSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraPersonalizationSheet.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    sheetSource,
    /interface AmoraPersonalizationSheetProps \{[\s\S]{0,320}entryPoint\?:[\s\S]{0,200}\| "blocked_action"/,
  );
  assert.match(sheetSource, /entryPoint = "general"/);
  assert.match(sheetSource, /막혔을 때, 어떻게 먼저 도울까요\?/);
  assert.match(sheetSource, /자동으로 바꾸지 않아요/);
  assert.match(sheetSource, /buildBlockedOutcomePersonalizationSaveBody/);
  assert.match(sheetSource, /outcome: "blocked"/);
  assert.match(sheetSource, />이렇게 맞추기</);
  assert.doesNotMatch(
    sheetSource,
    /useEffect\([\s\S]{0,240}(?:buildBlockedOutcomePersonalizationSaveBody|void save\(\))/,
  );
});

test("an uncertain outcome changes only the explicitly confirmed decision start", () => {
  const current = parseAmoraPersonalizationEnvelope({
    profile: {
      preferences: {
        decisionStart: "ask_each_time",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "couple_first",
        toneStyle: "warm",
      },
      revision: 13,
      confirmedAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  })?.profile;

  assert.deepEqual(
    buildUncertainOutcomePersonalizationSaveBody(current, {
      outcome: "not_sure",
      decisionStart: "recommend_first",
    }),
    {
      expectedRevision: 13,
      preferences: {
        decisionStart: "recommend_first",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "couple_first",
        toneStyle: "warm",
      },
    },
  );
  assert.equal(
    buildUncertainOutcomePersonalizationSaveBody(current, {
      outcome: "blocked",
      decisionStart: "recommend_first",
    }),
    null,
  );
  assert.equal(
    buildUncertainOutcomePersonalizationSaveBody(current, {
      outcome: "not_sure",
      decisionStart: "recommend_first",
      inferredIndecision: true,
    }),
    null,
  );
});

test("the uncertain-outcome entry asks one explicit decision-start question", () => {
  const sheetSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraPersonalizationSheet.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    sheetSource,
    /interface AmoraPersonalizationSheetProps \{[\s\S]{0,320}entryPoint\?:[\s\S]{0,240}\| "uncertain_action"/,
  );
  for (const label of ["추천안 하나부터", "선택지 비교부터", "그때마다 물어보기"]) {
    assert.match(sheetSource, new RegExp(label));
  }
  assert.match(sheetSource, /아직 모르겠을 때, 무엇부터 볼까요\?/);
  assert.match(sheetSource, /결정을 대신하지 않아요/);
  assert.match(sheetSource, /buildUncertainOutcomePersonalizationSaveBody/);
  assert.match(sheetSource, /outcome: "not_sure"/);
  assert.match(sheetSource, /accessibilityLabel="결정 시작 방식 저장하기"/);
});

test("a changed outcome changes only the explicitly confirmed answer detail", () => {
  const current = parseAmoraPersonalizationEnvelope({
    profile: {
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "adaptive",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "couple_first",
        toneStyle: "warm",
      },
      revision: 14,
      confirmedAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  })?.profile;

  assert.deepEqual(
    buildChangedOutcomePersonalizationSaveBody(current, {
      outcome: "changed",
      answerDetail: "brief",
    }),
    {
      expectedRevision: 14,
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "couple_first",
        toneStyle: "warm",
      },
    },
  );
  assert.equal(
    buildChangedOutcomePersonalizationSaveBody(current, {
      outcome: "not_sure",
      answerDetail: "brief",
    }),
    null,
  );
  assert.equal(
    buildChangedOutcomePersonalizationSaveBody(current, {
      outcome: "changed",
      answerDetail: "brief",
      inferredPreference: true,
    }),
    null,
  );
});

test("the changed-outcome entry asks one explicit impact-detail question", () => {
  const sheetSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraPersonalizationSheet.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    sheetSource,
    /interface AmoraPersonalizationSheetProps \{[\s\S]{0,320}entryPoint\?:[\s\S]{0,280}\| "changed_action"/,
  );
  for (const label of ["핵심 영향만", "필요한 만큼", "전체 영향 자세히"]) {
    assert.match(sheetSource, new RegExp(label));
  }
  assert.match(sheetSource, /바뀐 뒤, 어디까지 다시 볼까요\?/);
  assert.match(sheetSource, /확정된 건 그대로 두고/);
  assert.match(sheetSource, /buildChangedOutcomePersonalizationSaveBody/);
  assert.match(sheetSource, /outcome: "changed"/);
  assert.match(sheetSource, /accessibilityLabel="변경 영향 보기 방식 저장하기"/);
});

test("a completed outcome changes only the explicitly confirmed work mode", () => {
  const current = parseAmoraPersonalizationEnvelope({
    profile: {
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "ask_each_time",
        familyOrder: "couple_first",
        toneStyle: "warm",
      },
      revision: 15,
      confirmedAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  })?.profile;

  assert.deepEqual(
    buildCompletedOutcomePersonalizationSaveBody(current, {
      outcome: "completed",
      workMode: "hybrid",
    }),
    {
      expectedRevision: 15,
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "couple_first",
        toneStyle: "warm",
      },
    },
  );
  assert.equal(
    buildCompletedOutcomePersonalizationSaveBody(current, {
      outcome: "changed",
      workMode: "hybrid",
    }),
    null,
  );
  assert.equal(
    buildCompletedOutcomePersonalizationSaveBody(current, {
      outcome: "completed",
      workMode: "hybrid",
      inferredPartnerRole: true,
    }),
    null,
  );
});

test("the completed-outcome entry asks one explicit collaboration question", () => {
  const sheetSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraPersonalizationSheet.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(sheetSource, /"completed_action"/);
  for (const label of [
    "둘이 함께 확인",
    "한 명이 먼저 정리",
    "중요한 건 함께, 나머지는 나눠서",
    "그때마다 물어보기",
  ]) {
    assert.match(sheetSource, new RegExp(label));
  }
  assert.match(sheetSource, /다음 준비는 어떻게 나눌까요\?/);
  assert.match(sheetSource, /담당자를 자동으로 정하지 않아요/);
  assert.match(sheetSource, /buildCompletedOutcomePersonalizationSaveBody/);
  assert.match(sheetSource, /outcome: "completed"/);
  assert.match(sheetSource, /accessibilityLabel="협업 방식 저장하기"/);
});

test("an upcoming verified family moment changes only the explicitly confirmed family order", () => {
  const current = parseAmoraPersonalizationEnvelope({
    profile: {
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "ask_each_time",
        toneStyle: "warm",
      },
      revision: 16,
      confirmedAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  })?.profile;

  assert.deepEqual(
    buildFamilyMomentPersonalizationSaveBody(current, {
      momentType: "sanggyeonrye",
      attentionWindow: "d1",
      familyOrder: "couple_first",
    }),
    {
      expectedRevision: 16,
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "couple_first",
        toneStyle: "warm",
      },
    },
  );
  assert.equal(
    buildFamilyMomentPersonalizationSaveBody(current, {
      momentType: "sanggyeonrye",
      attentionWindow: "dAfter",
      familyOrder: "couple_first",
    }),
    null,
  );
  assert.equal(
    buildFamilyMomentPersonalizationSaveBody(current, {
      momentType: "venue_tour",
      attentionWindow: "d1",
      familyOrder: "couple_first",
    }),
    null,
  );
  assert.equal(
    buildFamilyMomentPersonalizationSaveBody(current, {
      momentType: "family_greeting",
      attentionWindow: "d3",
      familyOrder: "family_input_first",
      inferredFamilyAuthority: true,
    }),
    null,
  );
});

test("the family-moment entry asks one explicit coordination-order question", () => {
  const sheetSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraPersonalizationSheet.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(sheetSource, /"family_moment"/);
  for (const label of [
    "우리 둘 기준 먼저",
    "관련된 의견부터 확인",
    "상황마다 정하기",
    "그때마다 물어보기",
  ]) {
    assert.match(sheetSource, new RegExp(label));
  }
  assert.match(sheetSource, /이 일정은 누구의 기준부터 맞출까요\?/);
  assert.match(sheetSource, /정답이나 의무를 만들지 않아요/);
  assert.match(sheetSource, /buildFamilyMomentPersonalizationSaveBody/);
  assert.match(sheetSource, /familyMomentContext\s*\?[\s\S]{0,180}momentType: familyMomentContext\.momentType/);
  assert.match(sheetSource, /attentionWindow: familyMomentContext\.attentionWindow/);
  assert.match(sheetSource, /accessibilityLabel="가족 조율 순서 저장하기"/);
  assert.doesNotMatch(
    sheetSource,
    /useEffect\([\s\S]{0,240}(?:buildFamilyMomentPersonalizationSaveBody|void save\(\))/,
  );
});
