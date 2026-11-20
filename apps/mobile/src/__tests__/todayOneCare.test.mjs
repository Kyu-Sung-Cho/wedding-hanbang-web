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

test("today-one native navigation only maps the shared contract routes", () => {
  assert.equal(getTodayOneNativeRoute("/schedule"), "/schedule");
  assert.equal(getTodayOneNativeRoute("/budget"), "/budget");
  // 25장 2절의 새 종류: 할 일은 홈, 편지는 편지 화면, 상담 상태는 앱의 일정 탭.
  assert.equal(getTodayOneNativeRoute("/lounge"), "/(tabs)/lounge");
  assert.equal(getTodayOneNativeRoute("/halls/letter"), "/halls/letter");
  assert.equal(getTodayOneNativeRoute("/halls/consultation"), "/(tabs)/schedule");
  assert.equal(getTodayOneNativeRoute("//evil.example"), null);
  assert.equal(getTodayOneNativeRoute("/schedule?next=https://evil.example"), null);
  assert.equal(getTodayOneNativeRoute("/(tabs)/chat"), null);
  assert.equal(getTodayOneNativeRoute("toString"), null);
  assert.equal(getTodayOneNativeRoute(undefined), null);
});

test("every shared next-action address has an app address", async () => {
  // 공용 계약(TS 원문)의 `hrefs: [...]` 를 모두 읽어 앱 주소가 있는지 본다. 계약에 주소를 더하면 여기서 빨개진다.
  const contract = await readFile(
    resolve(HERE, "../../../../packages/shared/src/contracts/todayOneCare.ts"),
    "utf8",
  );
  const block = contract.slice(contract.indexOf("TODAY_ONE_CARE_NEXT_ACTIONS"));
  const hrefs = [...block.matchAll(/hrefs: \[([^\]]*)\]/g)]
    .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((inner) => inner[1]));
  assert.ok(hrefs.length >= 5, "contract hrefs were not found");
  for (const href of hrefs) assert.notEqual(getTodayOneNativeRoute(href), null, href);
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
  assert.match(preferenceSource, /문자나 메일로는 보내지 않아요\. 앱 알림은 따로 켠 분에게만 가요\./);
  assert.match(preferenceSource, /saveInFlight\.current/);
  assert.match(preferenceSource, /ownerUserId/);
  assert.match(cardSource, /supabase\.auth\.onAuthStateChange/);
  assert.match(preferenceSource, /supabase\.auth\.onAuthStateChange/);
  // 홈은 먼저 챙기기 한 칸(`AmoraTodayOneSlot`)을 그리고, 그 칸이 오늘의 한 가지 카드를 그린다.
  assert.match(dashboardSource, /<AmoraTodayOneSlot /);
  assert.match(
    await readFile(resolve(HERE, "../components/dashboard/AmoraTodayOneSlot.tsx"), "utf8"),
    /<TodayOneCareCard refreshVersion=\{refreshVersion\} \/>/,
  );
  assert.match(settingsSource, /<TodayOnePreferenceControl/);
  assert.match(experienceSource, /label: "준비 포커스"/);
  assert.doesNotMatch(experienceSource, /label: "오늘의 한 가지"/);
});
