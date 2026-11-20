import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

// 10장 P1 "아모라가 먼저 알려 주기"의 앱 쪽 계약. 웹은
// apps/web/src/components/app/AmoraCarePreferenceControl.test.tsx 가 같은 규칙을 렌더링으로 잰다.

const helperPath = fileURLToPath(new URL("../lib/careSettings.ts", import.meta.url));
const controlSource = readFileSync(
  new URL("../components/settings/AmoraCarePreferenceControl.tsx", import.meta.url),
  "utf8",
);
const promptSource = readFileSync(
  new URL("../components/dashboard/AmoraCareConsentPrompt.tsx", import.meta.url),
  "utf8",
);
const loungeSource = readFileSync(new URL("../../app/(tabs)/lounge.tsx", import.meta.url), "utf8");
const slotSource = readFileSync(
  new URL("../components/dashboard/AmoraTodayOneSlot.tsx", import.meta.url),
  "utf8",
);

function loadHelpers() {
  const source = readFileSync(helperPath, "utf8");
  const compiled = ts.transpileModule(source.replace(/\bexport\s+/g, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    `${compiled.outputText}\nreturn { parseCarePreferencePayload, shouldAskCareConsentInLounge, careConsentPartnerLine, careEmailDescription, describeCoupleCadence };`,
  )();
}

const AT = "2026-11-13T01:00:00.000Z";

function payload(overrides = {}) {
  return {
    available: true,
    emailAvailable: false,
    chat: { enabled: false, consentedAt: null },
    email: { enabled: false, consentedAt: null, verified: true, maskedAddress: "am***@example.com" },
    partner: { connected: true, chatEnabled: false },
    promptAnswered: false,
    cadence: { intensity: "normal", windowStartHour: 9, windowEndHour: 20 },
    couple: { intensity: "normal", windowStartHour: 9, windowEndHour: 20, dailyLimit: 1, windowOpen: true },
    ...overrides,
  };
}

test("the app re-checks the server answer instead of trusting it", () => {
  const { parseCarePreferencePayload } = loadHelpers();
  assert.deepEqual(parseCarePreferencePayload(payload()), payload());
  for (const broken of [
    payload({ chat: { enabled: true, consentedAt: null } }),
    payload({ email: { enabled: true, consentedAt: AT, verified: true, maskedAddress: null } }),
    payload({ partner: { connected: false, chatEnabled: true } }),
    payload({ chat: { enabled: true, consentedAt: "not a date" } }),
    payload({ cadence: { intensity: "often", windowStartHour: 9, windowEndHour: 20 } }),
    payload({ cadence: { intensity: "normal", windowStartHour: 15, windowEndHour: 12 } }),
    payload({ couple: { intensity: "normal", windowStartHour: 9, windowEndHour: 20, dailyLimit: 4, windowOpen: true } }),
    { ...payload(), available: "true" },
    null,
    [],
  ]) {
    assert.equal(parseCarePreferencePayload(broken), null, JSON.stringify(broken));
  }
});

test("the lounge asks once, only after a planned schedule exists", () => {
  const { shouldAskCareConsentInLounge } = loadHelpers();
  assert.equal(shouldAskCareConsentInLounge(payload(), 1), true);
  assert.equal(shouldAskCareConsentInLounge(payload(), 0), false);
  assert.equal(shouldAskCareConsentInLounge(payload({ promptAnswered: true }), 3), false);
  assert.equal(
    shouldAskCareConsentInLounge(payload({ chat: { enabled: true, consentedAt: AT } }), 3),
    false,
  );
  assert.equal(shouldAskCareConsentInLounge(payload({ available: false }), 3), false);
  assert.equal(shouldAskCareConsentInLounge(null, 3), false);
});

test("the partner line and email line say what will actually happen", () => {
  const { careConsentPartnerLine, careEmailDescription } = loadHelpers();
  assert.equal(careConsentPartnerLine(payload()), null);
  assert.equal(
    careConsentPartnerLine(payload({ chat: { enabled: true, consentedAt: AT } })),
    "상대가 켜면 그날부터 와요.",
  );
  assert.equal(
    careConsentPartnerLine(payload({
      chat: { enabled: true, consentedAt: AT },
      partner: { connected: true, chatEnabled: true },
    })),
    "두 분 모두 켜 두셨어요.",
  );
  assert.equal(
    careConsentPartnerLine(payload({ partner: { connected: true, chatEnabled: true } })),
    "상대는 켜 두셨어요.",
  );
  assert.match(
    careConsentPartnerLine(payload({
      chat: { enabled: true, consentedAt: AT },
      partner: { connected: false, chatEnabled: false },
    })),
    /혼자 쓰는 동안은 바로 와요/,
  );
  assert.equal(careEmailDescription(payload()), "함께 대화 알림을 켜면 고를 수 있어요.");
  assert.equal(
    careEmailDescription(payload({
      chat: { enabled: true, consentedAt: AT },
      email: { enabled: false, consentedAt: null, verified: false, maskedAddress: null },
    })),
    "가입 메일 확인을 마치면 켤 수 있어요.",
  );
  assert.equal(
    careEmailDescription(payload({ chat: { enabled: true, consentedAt: AT } })),
    "가입 메일 am***@example.com으로 같은 글을 하루 한 통까지 보내요.",
  );
});

test("the settings control hides itself when no care path can run and binds every call to one account", () => {
  assert.match(controlSource, /const ROUTE = "\/api\/amora\/care-preferences";/);
  assert.match(
    controlSource,
    /if \(!preference\.available\) \{\s*setView\(\{ kind: "hidden" \}\);\s*onAvailabilityChange\?\.\(false\);/,
  );
  assert.match(controlSource, /if \(view\.kind === "hidden"\) return null;/);
  assert.match(controlSource, /apiFetchForExpectedUser\(userId, ROUTE,/);
  assert.match(controlSource, /apiFetchForExpectedUser\(ownerUserId, ROUTE,/);
  // 저장 중에 계정이 바뀌면 쓰지 않는다.
  assert.match(controlSource, /if \(await currentVerifiedUserId\(\) !== ownerUserId\) \{\s*void load\(\);\s*return;/);
  // 메일 스위치는 함께 대화 글과 확인된 메일이 있어야 켤 수 있다.
  assert.match(controlSource, /disabled=\{saving \|\| \(!preference\.email\.enabled && !emailSelectable\)\}/);
  assert.match(
    controlSource,
    /const emailSelectable = preference\.emailAvailable\s*&& preference\.chat\.enabled\s*&& preference\.email\.verified;/,
  );
  assert.doesNotMatch(controlSource, /\/api\/profile/);
});

test("the lounge prompt never calls the server without a planned schedule and records a decline", () => {
  const effectStart = promptSource.indexOf("useEffect(() => {");
  const firstFetch = promptSource.indexOf("apiFetchForExpectedUser(userId, ROUTE");
  const guard = promptSource.indexOf("if (plannedScheduleCount <= 0) return;");
  assert.ok(effectStart >= 0 && guard > effectStart && guard < firstFetch, "count guard must precede the first fetch");
  assert.match(promptSource, /body: JSON\.stringify\(turnOn \? \{ chat: true \} : \{ promptAnswered: true \}\)/);
  assert.match(promptSource, /if \(await currentVerifiedUserId\(\) !== ownerUserId\) \{\s*setView\(\{ kind: "idle" \}\);/);

  // 홈에는 먼저 챙기기 한 칸이 한 줄로 들어가고, 그 칸이 일정 수를 세어 한 번 묻는 카드에 넘긴다.
  assert.match(
    loungeSource,
    /todayOneCare=\{<AmoraTodayOneSlot refreshVersion=\{careRefreshVersion\} progress=\{data\.progress\} \/>\}/,
  );
  assert.match(slotSource, /<AmoraCareConsentPrompt plannedScheduleCount=\{plannedScheduleCount\} \/>/);
  assert.match(slotSource, /useMemo\(\(\) => countPlannedSchedules\(progress\), \[progress\]\)/);
});

test("only planned, not finished, not cancelled schedules from today on count toward asking", async () => {
  const { countPlannedSchedules } = await import("../lib/plannedSchedules.mjs");
  const event = (overrides) => ({ id: "e-1", title: "드레스 투어", date: "2026-11-21", ...overrides });
  assert.equal(countPlannedSchedules(null, "2026-11-20"), 0);
  assert.equal(countPlannedSchedules({}, "2026-11-20"), 0);
  assert.equal(countPlannedSchedules({ __events: "not a list" }, "2026-11-20"), 0);
  assert.equal(countPlannedSchedules({ __events: [event({})] }, "2026-11-20"), 1);
  assert.equal(countPlannedSchedules({ __events: [event({ date: "2026-11-20" })] }, "2026-11-20"), 1);
  assert.equal(countPlannedSchedules({ __events: [event({ date: "2026-11-19" })] }, "2026-11-20"), 0);
  assert.equal(countPlannedSchedules({ __events: [event({ status: "completed" })] }, "2026-11-20"), 0);
  assert.equal(countPlannedSchedules({ __events: [event({ status: "cancelled" })] }, "2026-11-20"), 0);
});

test("care consent copy uses no banned product words and no dash", () => {
  for (const [name, source] of [
    ["AmoraCarePreferenceControl.tsx", controlSource],
    ["AmoraCareConsentPrompt.tsx", promptSource],
    ["careSettings.ts", readFileSync(helperPath, "utf8")],
  ]) {
    const visible = [
      ...[...source.matchAll(/>\s*([^<>{}]*[가-힣][^<>{}]*)\s*</g)].map((match) => match[1]),
      ...[...source.matchAll(/"([^"]*[가-힣][^"]*)"/g)].map((match) => match[1]),
      ...[...source.matchAll(/`([^`]*[가-힣][^`]*)`/g)].map((match) => match[1]),
    ];
    assert.ok(visible.length > 3, name);
    for (const sentence of visible) {
      assert.doesNotMatch(sentence, /플래너|파트너|베타|—|–/, `${name}: ${sentence}`);
    }
  }
});

// 10장 P2: 강도와 받는 시간
test("the couple line says what the two settings add up to", () => {
  const { describeCoupleCadence } = loadHelpers();
  assert.equal(
    describeCoupleCadence({ intensity: "normal", windowStartHour: 9, windowEndHour: 20, dailyLimit: 1, windowOpen: true }),
    "두 분 설정을 합쳐 하루 한 건까지, 오전 9시부터 오후 8시 전까지 와요.",
  );
  assert.equal(
    describeCoupleCadence({ intensity: "light", windowStartHour: 10, windowEndHour: 18, dailyLimit: 1, windowOpen: true }),
    "두 분 설정을 합쳐 전날 확인만 하루 한 건, 오전 10시부터 오후 6시 전까지 와요.",
  );
  assert.equal(
    describeCoupleCadence({ intensity: "more", windowStartHour: 12, windowEndHour: 20, dailyLimit: 3, windowOpen: true }),
    "두 분 설정을 합쳐 하루 세 건까지, 낮 12시부터 오후 8시 전까지 와요.",
  );
  assert.equal(
    describeCoupleCadence({ intensity: "normal", windowStartHour: 15, windowEndHour: 12, dailyLimit: 1, windowOpen: false }),
    "두 분이 고른 시간이 겹치지 않아 지금은 오지 않아요.",
  );
});

test("the settings control shows intensity and hours only after the shared-chat message is on", () => {
  const cadenceStart = controlSource.indexOf('testID="amora-care-cadence"');
  const guard = controlSource.lastIndexOf("{preference.chat.enabled ? (", cadenceStart);
  assert.ok(cadenceStart > 0 && guard > 0 && cadenceStart - guard < 120, "cadence must sit inside the chat-enabled branch");
  assert.ok(controlSource.includes("void save({ intensity: option.value })"));
  assert.ok(controlSource.includes("void save({ windowStartHour: hour })"));
  assert.ok(controlSource.includes("void save({ windowEndHour: hour })"));
  assert.ok(controlSource.includes("max={preference.cadence.windowEndHour - 1}"));
  assert.ok(controlSource.includes("min={preference.cadence.windowStartHour + 1}"));
});
