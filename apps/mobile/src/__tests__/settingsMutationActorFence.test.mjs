import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

const settingsSource = readFileSync(fileURLToPath(new URL(
  "../../app/settings/index.tsx",
  import.meta.url,
)), "utf8");

test("mobile settings binds every account mutation to the loaded owner", () => {
  for (const path of [
    "/api/settings/wedding-profile",
    "/api/profile",
    "/api/couple/reset",
    "/api/auth/delete",
    "/api/auth/password",
  ]) {
    assert.match(
      settingsSource,
      new RegExp(`apiFetchForExpectedUser\\([\\s\\S]{0,120}"${path}"`, "u"),
      `${path} must use the expected-user transport`,
    );
  }
  assert.match(
    settingsSource,
    /\[HANBANG_EXPECTED_ACTOR_USER_ID_HEADER\]: expectedActorUserId/u,
  );
  assert.doesNotMatch(settingsSource, /supabase\.auth\.updateUser\(/u);
});

test("mobile settings invalidates drafts and password UI when the auth owner changes", () => {
  assert.match(settingsSource, /const \[settingsOwnerId, setSettingsOwnerId\]/u);
  assert.match(settingsSource, /supabase\.auth\.onAuthStateChange/u);
  assert.match(settingsSource, /setPasswordModalVisible\(false\)/u);
  assert.match(settingsSource, /setNewPassword\(""\)/u);
  assert.match(settingsSource, /setConfirmPassword\(""\)/u);
  assert.match(settingsSource, /setSettingsSnapshot\(null\)/u);
  assert.match(settingsSource, /setData\(null\)/u);
  assert.match(settingsSource, /setLoadAttempt\(\(attempt\) => attempt \+ 1\)/u);
});

test("native destructive alert callbacks retain A's owner even if the session becomes B", () => {
  assert.match(
    settingsSource,
    /function handleStartNewCouple\(\)[\s\S]{0,260}const expectedActorUserId = settingsOwnerId/u,
  );
  assert.match(
    settingsSource,
    /function handleDeleteAccount\(\)[\s\S]{0,260}const expectedActorUserId = settingsOwnerId/u,
  );
  assert.match(
    settingsSource,
    /responseOwner\?\.id !== expectedActorUserId/u,
  );
});

test("completed deletion purges the deleted local owner when server auth is already absent", () => {
  assert.match(
    settingsSource,
    /const responseSessionOwnerId\s*=\s*responseSession\?\.user\.id \?\? null/u,
  );
  assert.match(
    settingsSource,
    /canFinishOwnerBoundDeletion\(\{[\s\S]{0,240}authenticatedOwnerId: responseOwner\?\.id \?\? null/u,
  );
  assert.match(
    settingsSource,
    /screenOwnerId: settingsOwnerRef\.current,[\s\S]{0,80}\}\)\) return/u,
  );
  assert.match(
    settingsSource,
    /const finishSignOut = async \(\) => \{[\s\S]{0,900}supabase\.auth\.getSession\(\)[\s\S]{0,900}canFinishOwnerBoundDeletion\(\{[\s\S]{0,320}screenOwnerId: settingsOwnerRef\.current[\s\S]{0,500}expectedOwnerId: deletionOwnerId[\s\S]{0,120}allowMissingSession: true/u,
  );
  assert.match(
    settingsSource,
    /continueOnDecisionPurgeFailure: true[\s\S]{0,160}expectedOwnerId: deletionOwnerId/u,
  );
});

test("invite secrets are owner-tagged and reverify auth immediately before clipboard access", () => {
  assert.match(
    settingsSource,
    /const \[coupleConnectionOwnerId, setCoupleConnectionOwnerId\]/u,
  );
  assert.match(
    settingsSource,
    /coupleConnectionOwnerId === settingsOwnerId[\s\S]{0,100}\? coupleConnection/u,
  );
  assert.match(
    settingsSource,
    /async function copyInviteCode\(\)[\s\S]{0,900}copyOwnerBoundInviteSecret\(\{[\s\S]{0,700}supabase\.auth\.getUser\(\)[\s\S]{0,400}Clipboard\.setStringAsync\(value\)/u,
  );
  assert.match(
    settingsSource,
    /readScreenOwner: \(\) => settingsOwnerRef\.current/u,
  );
  assert.match(
    settingsSource,
    /purgeOwnerBoundSecret: \(\) => \{[\s\S]{0,240}setCoupleConnectionOwnerId\(null\)[\s\S]{0,100}setCodeCopied\(false\)/u,
  );
});
