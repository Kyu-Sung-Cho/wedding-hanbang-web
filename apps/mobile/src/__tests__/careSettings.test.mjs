import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../lib/careSettings.ts", import.meta.url));
const settingsPath = fileURLToPath(new URL("../../app/settings/index.tsx", import.meta.url));
const settingsSource = readFileSync(settingsPath, "utf8");

function loadCareSettingsHelpers() {
  const source = readFileSync(helperPath, "utf8");
  const compiled = ts.transpileModule(source.replace(/\bexport\s+/g, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    `${compiled.outputText}\nreturn { hasActiveCareConsent, maskSignupEmail, parseCareAvailability, canChangeCareConsent };`,
  )();
}

test("proactive care is active only with both the enabled flag and server consent time", () => {
  const { hasActiveCareConsent } = loadCareSettingsHelpers();

  assert.equal(hasActiveCareConsent({
    care_notifications_enabled: true,
    care_notifications_consented_at: "2026-07-16T01:00:00.000Z",
  }), true);
  assert.equal(hasActiveCareConsent({
    care_notifications_enabled: true,
    care_notifications_consented_at: null,
  }), false);
  assert.equal(hasActiveCareConsent({
    care_notifications_enabled: false,
    care_notifications_consented_at: "2026-07-16T01:00:00.000Z",
  }), false);
});

test("verified signup email disclosure masks the local part and rejects malformed input", () => {
  const { maskSignupEmail } = loadCareSettingsHelpers();

  assert.equal(maskSignupEmail("amora@example.com"), "am***@example.com");
  assert.equal(maskSignupEmail("a@example.com"), "a***@example.com");
  assert.equal(maskSignupEmail("not-an-email"), null);
  assert.equal(maskSignupEmail(null), null);
});

test("a paused outbound channel blocks opt-in while preserving opt-out", () => {
  const { parseCareAvailability, canChangeCareConsent } = loadCareSettingsHelpers();
  const paused = parseCareAvailability({
    outboundEnabled: false,
    emailVerified: true,
  });

  assert.deepEqual(paused, { outboundEnabled: false, emailVerified: true });
  assert.equal(canChangeCareConsent(false, paused), false);
  assert.equal(canChangeCareConsent(true, paused), true);
  assert.equal(canChangeCareConsent(false, null), false);
  assert.equal(canChangeCareConsent(false, {
    outboundEnabled: true,
    emailVerified: false,
  }), true);
  assert.equal(parseCareAvailability({
    outboundEnabled: "true",
    emailVerified: true,
  }), null);
});

test("mobile settings reads its private profile through the authenticated server contract", () => {
  assert.match(settingsSource, /apiFetch\("\/api\/settings\/wedding-profile"\)/);
  assert.doesNotMatch(settingsSource, /\.from\("profiles"\)/);
  assert.match(settingsSource, /profile\.id !== user\.id/);
});

test("mobile settings fails closed instead of presenting blank editable fields after a load error", () => {
  assert.match(settingsSource, /const \[loadError, setLoadError\] = useState<string \| null>\(null\)/);
  assert.match(settingsSource, /if \(loadError \|\| !data \|\| !initialData\)/);
  assert.match(settingsSource, /설정을 열지 못했어요/);
  assert.match(settingsSource, /setLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.doesNotMatch(settingsSource, /if \(!user\) return/);
  assert.doesNotMatch(settingsSource, /\.from\("wedding_journeys"\)/);
  assert.doesNotMatch(settingsSource, /apiFetch\("\/api\/community\/profile"\)/);
  assert.match(settingsSource, /parseWeddingSettingsResponse\(settingsPayload\)/);
  assert.doesNotMatch(settingsSource, /communityNickname = profile\?\.name \?\? ""/);
});

test("settings load commits legacy consent, partner, form, and snapshot only for the latest attempt", () => {
  const loadStart = settingsSource.indexOf("// 현재 데이터 로드");
  const loadEnd = settingsSource.indexOf("function updateField", loadStart);
  const loadSource = settingsSource.slice(loadStart, loadEnd);

  assert.match(loadSource, /const loadToken = settingsLoadGate\.begin\(\)/);
  assert.match(
    loadSource,
    /if \(loadToken\.isCurrent\(\)\) \{[\s\S]*setPartnerName[\s\S]*setCoupleConnection[\s\S]*setLegacyCareConsentActive[\s\S]*setData[\s\S]*setInitialData[\s\S]*setSettingsSnapshot/,
  );
  assert.doesNotMatch(loadSource, /setCareAvailability|setCareDeliveryEmail|setCareNotificationsEnabled/);
  assert.match(loadSource, /return \(\) => loadToken\.cancel\(\)/);
  assert.doesNotMatch(loadSource, /if \(!cancelled\)/);
});

test("unshipped care availability cannot block the general settings screen", () => {
  assert.doesNotMatch(settingsSource, /parsedSettings\.careAvailability/);
  assert.doesNotMatch(settingsSource, /parseCareAvailability/);
  assert.doesNotMatch(settingsSource, /아모라 케어 발송 상태를 확인하지 못했어요/);
});

test("mobile hides care opt-in but preserves a conditional legacy-consent opt-out", () => {
  assert.doesNotMatch(settingsSource, /아모라 먼저 챙기기/);
  assert.doesNotMatch(settingsSource, /발송이 일시중지됐어요/);
  assert.doesNotMatch(settingsSource, /canChangeCareConsent/);
  assert.match(settingsSource, /hasActiveCareConsent\(profile\)/);
  assert.match(settingsSource, /legacyCareConsentActive \?/);
  assert.match(settingsSource, /care_notifications_enabled: false/);
  assert.match(settingsSource, /이전 이메일 수신 동의 해제/);
  assert.match(settingsSource, /Linking\.openSettings\(\)/);
});
