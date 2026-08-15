import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  buildAmoraPersonalizationResetBody,
  parseAmoraPersonalizationEnvelope,
  parseAmoraPersonalizationResetEnvelope,
} from "../lib/amoraPersonalization.mjs";
import {
  AMORA_PERSONALIZATION_SETTING_SECTIONS,
  buildAmoraPersonalizationSummary,
  getAmoraPersonalizationSettingsView,
} from "../lib/amoraPersonalizationSettings.mjs";

test("resetting saved response preferences pins the exact current revision", () => {
  const profile = parseAmoraPersonalizationEnvelope({
    profile: {
      preferences: {
        decisionStart: "compare_first",
        answerDetail: "brief",
        supportOrder: "listen_first",
        workMode: "hybrid",
        familyOrder: "couple_first",
        toneStyle: "warm",
      },
      revision: 17,
      confirmedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:01.000Z",
    },
  })?.profile;

  assert.deepEqual(buildAmoraPersonalizationResetBody(profile), {
    expectedRevision: 17,
  });
  assert.equal(buildAmoraPersonalizationResetBody(null), null);
  assert.equal(
    buildAmoraPersonalizationResetBody({ ...profile, revision: 16.5 }),
    null,
  );
});

test("a response preference reset accepts only the exact cleared receipt", () => {
  assert.deepEqual(
    parseAmoraPersonalizationResetEnvelope({ deleted: true, profile: null }),
    { deleted: true, profile: null },
  );
  assert.equal(
    parseAmoraPersonalizationResetEnvelope({ deleted: true, profile: null, criterion: null }),
    null,
  );
  assert.equal(
    parseAmoraPersonalizationResetEnvelope({ deleted: false, profile: null }),
    null,
  );
});

test("the settings center explains all six explicit personalization controls", () => {
  const view = getAmoraPersonalizationSettingsView({
    decisionStart: "compare_first",
    answerDetail: "brief",
    supportOrder: "action_first",
    workMode: "hybrid",
    familyOrder: "couple_first",
    toneStyle: "friendly_honest",
  });

  assert.equal(AMORA_PERSONALIZATION_SETTING_SECTIONS.length, 6);
  assert.deepEqual(
    view?.map(({ field, selectedValue }) => [field, selectedValue]),
    [
      ["toneStyle", "friendly_honest"],
      ["decisionStart", "compare_first"],
      ["answerDetail", "brief"],
      ["supportOrder", "action_first"],
      ["workMode", "hybrid"],
      ["familyOrder", "couple_first"],
    ],
  );
  assert.deepEqual(
    view?.map(({ selectedLabel }) => selectedLabel),
    [
      "친근하고 솔직하게",
      "선택지 비교부터",
      "짧고 핵심만",
      "바로 할 일부터",
      "중요한 건 함께, 나머지는 나눠서",
      "우리 둘 기준 먼저",
    ],
  );
  assert.equal(
    getAmoraPersonalizationSettingsView({
      decisionStart: "compare_first",
      answerDetail: "brief",
      supportOrder: "action_first",
      workMode: "hybrid",
      familyOrder: "couple_first",
      toneStyle: "friendly_honest",
      inferredPersona: "decisive",
    }),
    null,
  );
});

test("the chosen controls become one plain-language preview without personality inference", () => {
  const preferences = {
    decisionStart: "compare_first",
    answerDetail: "brief",
    supportOrder: "action_first",
    workMode: "hybrid",
    familyOrder: "couple_first",
    toneStyle: "friendly_honest",
  };

  assert.equal(
    buildAmoraPersonalizationSummary(preferences),
    "친근하고 솔직하게 말하고 선택지 비교부터 시작해요. 막히면 바로 할 일부터 보여주고 핵심만 짧게 설명해요. 중요한 건 함께 보고 나머지는 나누는 흐름으로 제안하고, 가족 조율은 우리 둘 기준부터 맞춰요.",
  );
  assert.equal(
    buildAmoraPersonalizationSummary({
      ...preferences,
      inferredPersona: "decisive",
    }),
    null,
  );
});

test("the native settings center shows current choices and saves only after confirmation", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/settings/amora-style.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(source, /AppHeader title="나만의 아모라"/);
  assert.match(source, /AMORA_PERSONALIZATION_SETTING_SECTIONS/);
  assert.match(source, /getAmoraPersonalizationSettingsView/);
  assert.match(source, /buildAmoraPersonalizationSummary/);
  assert.match(source, /지금 내 아모라는/);
  assert.match(source, /buildSinglePersonalizationPreferenceSaveBody/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /accessibilityRole="radio"/);
  assert.match(source, /accessibilityState=\{\{ checked: selected \}\}/);
  assert.match(source, /이 선택은 내 계정에만 저장돼요/);
  assert.match(source, /예산·일정·체크리스트·담당자를 자동으로 바꾸지 않아요/);
  assert.doesNotMatch(source, /useEffect\([\s\S]{0,260}(?:savePreference|void save\()/);
});

test("mobile settings offers one clear entry to the personalization center", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/settings/index.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(source, /title="나만의 아모라"/);
  assert.match(source, /description="말투·설명·결정·협업 방식을 내게 맞춰요"/);
  assert.match(source, /router\.push\("\/settings\/amora-style"/);
  assert.match(source, /title="아모라가 기억하는 것"/);
});

test("the settings center purges old-owner data and adopts canonical conflict state", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/settings/amora-style.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(source, /const verifiedOwnerUserIdRef = useRef<string \| null>\(null\)/);
  assert.match(source, /verifiedOwnerUserIdRef\.current = null/);
  assert.match(source, /nextOwnerUserId === verifiedOwnerUserIdRef\.current/);
  assert.match(source, /nextSessionSignedInAt === verifiedSessionSignedInAtRef\.current/);
  assert.match(source, /await currentVerifiedUserId\(\) !== ownerUserId/);
  assert.match(source, /response\.status === 409/);
  assert.match(source, /setProfile\(conflict\.current\)/);
  assert.match(source, /다른 화면에서 설정이 바뀌었어요/);
});

test("returning to the settings center reloads the current canonical preferences", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/settings/amora-style.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(source, /import \{ router, useFocusEffect \} from "expo-router"/);
  assert.match(source, /useFocusEffect\(\s*useCallback\(\(\) => \{/);
  assert.match(source, /void load\(\)/);
  assert.match(source, /requestController\.current\?\.abort\(\)/);
});

test("the settings center lets one explicit private criterion be reviewed, saved, changed, or deleted", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/settings/amora-style.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(source, /꼭 지키고 싶은 기준/);
  assert.match(source, /이 기준은 먼저 나만 보고/);
  assert.match(source, /\/api\/amora\/criterion/);
  assert.match(source, /buildAmoraCoreCriterionSaveRequest/);
  assert.match(source, /buildAmoraCoreCriterionDeleteRequest/);
  assert.match(source, /parseAmoraCoreCriterionResponse/);
  assert.match(source, /AMORA_CORE_CRITERION_MAX_LENGTH/);
  assert.match(source, /Crypto\.randomUUID\(\)/);
  assert.match(source, /method: criterionDeleteMode \? "DELETE" : "PUT"/);
  assert.match(source, /await currentVerifiedUserId\(\) !== ownerUserId/);
  assert.doesNotMatch(source, /criterion[\s\S]{0,160}(?:shared_ai|partnerRecipient|autoSend)/);
});

test("the native settings center resets only saved response preferences behind a current-session confirmation", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/settings/amora-style.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(source, /buildAmoraPersonalizationResetBody/);
  assert.match(source, /parseAmoraPersonalizationResetEnvelope/);
  assert.match(source, /const authSessionGenerationRef = useRef\(0\)/);
  assert.match(source, /sessionGeneration: authSessionGenerationRef\.current/);
  assert.match(source, /sessionSignedInAt: verifiedSessionSignedInAtRef\.current/);
  assert.match(source, /ticket\.sessionGeneration !== authSessionGenerationRef\.current/);
  assert.match(source, /sessionBefore\?\.signedInAt !== ticket\.sessionSignedInAt/);
  assert.match(source, /sessionAfter\?\.signedInAt !== ticket\.sessionSignedInAt/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /body: JSON\.stringify\(ticket\.body\)/);
  assert.match(source, /response\.status === 409[\s\S]{0,220}setProfile\(conflict\.current\)/);
  assert.match(source, /setProfile\(reset\.profile\)/);
  assert.match(source, /저장한 답변 방식만 기본값으로 초기화할까요\?/);
  assert.match(source, /내 기준, 두 사람이 확인한 우리 기준, 아모라 기억은 지워지지 않아요/);
  assert.match(source, /기존 답변 방식은 그대로 유지돼요/);
  assert.match(source, /style: "destructive"/);
});

test("a response preference reset cannot be superseded by another settings write", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/settings/amora-style.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(source, /function openCriterionEditor\(\) \{[\s\S]{0,120}\|\| resetting/);
  assert.match(source, /async function mutateCriterion[\s\S]{0,180}\|\| resetting/);
  assert.match(source, /function openCoupleCriterionEditor\(\) \{[\s\S]{0,180}\|\| resetting/);
  assert.match(source, /async function mutateCoupleCriterion[\s\S]{0,180}\|\| resetting/);
});
