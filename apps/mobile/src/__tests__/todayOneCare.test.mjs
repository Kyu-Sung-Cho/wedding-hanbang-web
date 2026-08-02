import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  buildTodayOneActionBody,
  getTodayOneNativeRoute,
  parseTodayOneEnvelope,
  parseTodayOnePreferenceEnvelope,
} from "../lib/todayOneCare.mjs";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const HERE = dirname(fileURLToPath(import.meta.url));

test("today-one envelopes fail closed around the shared validated result", () => {
  const result = {
    version: 1,
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

test("today-one native navigation only maps the two shared contract routes", () => {
  assert.equal(getTodayOneNativeRoute("/schedule"), "/schedule");
  assert.equal(getTodayOneNativeRoute("/budget"), "/budget");
  assert.equal(getTodayOneNativeRoute("//evil.example"), null);
  assert.equal(getTodayOneNativeRoute("/schedule?next=https://evil.example"), null);
  assert.equal(getTodayOneNativeRoute("/(tabs)/chat"), null);
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
    readFile(resolve(HERE, "../../app/(tabs)/dashboard.tsx"), "utf8"),
    readFile(resolve(HERE, "../components/dashboard/WeddingHomeExperience.tsx"), "utf8"),
    readFile(resolve(HERE, "../../app/settings/index.tsx"), "utf8"),
  ]);

  assert.match(cardSource, /const response = await apiFetchForExpectedUser\(expectedUserId, path/);
  assert.match(cardSource, /readRawResponse\(userId, "\/api\/amora\/today-one"/);
  assert.match(cardSource, /validateTodayOneCareResponse\([^,]+,\s*userId\)/s);
  assert.match(cardSource, /buildTodayOneActionBody/);
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
  assert.match(settingsSource, /<TodayOnePreferenceControl/);
  assert.match(experienceSource, /label: "준비 포커스"/);
  assert.doesNotMatch(experienceSource, /label: "오늘의 한 가지"/);
});
