import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";

const notifications = readFileSync(new URL("../lib/notifications.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");
const profile = readFileSync(new URL("../../app/(tabs)/profile.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../app/settings/index.tsx", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../../supabase/migrations/20260802130000_mobile_push_identity_consent.sql", import.meta.url),
  "utf8",
);
const readProjectionMigration = readFileSync(
  new URL("../../../../supabase/migrations/20260802155100_mobile_push_preference_read_projection.sql", import.meta.url),
  "utf8",
);
const actorBoundMutationMigration = readFileSync(
  new URL("../../../../supabase/migrations/20260802155200_bind_mobile_push_mutations_to_expected_actor.sql", import.meta.url),
  "utf8",
);

test("push registration requires actor consent before requesting an OS token", () => {
  const consentCheck = notifications.indexOf("const actor = await readActorPushPreferences()");
  const permissionCheck = notifications.indexOf("Notifications.getPermissionsAsync()");
  assert.ok(consentCheck >= 0);
  assert.ok(permissionCheck > consentCheck);
  assert.match(notifications, /attach_my_mobile_push_token/);
  assert.doesNotMatch(notifications, /\.update\(\{\s*push_token:/);
});

test("logout paths use the common token-detaching auth boundary", () => {
  assert.match(auth, /detachPushTokenForCurrentUser\(\)/);
  assert.ok(auth.indexOf("detachPushTokenForCurrentUser") < auth.lastIndexOf("supabase.auth.signOut"));
  assert.doesNotMatch(auth, /detachPushTokenForCurrentUser\(\)\.catch/);
  assert.match(notifications, /PUSH_TOKEN_DETACH_FAILED/);
  assert.doesNotMatch(api, /signOutSession\(\)\.finally/);
  for (const source of [api, profile, settings]) {
    assert.match(source, /signOutSession/);
    assert.doesNotMatch(source, /supabase\.auth\.signOut\(/);
  }
  assert.match(profile, /안전한 로그아웃을 완료하지 못했어요/);
  assert.match(settings, /안전한 로그아웃을 완료하지 못했어요/);
  assert.match(auth, /signOutAfterAccountDeletionRequest/);
  assert.match(settings, /updateMobilePushPreferences\(\{ pushEnabled: false \}\)/);
  assert.match(settings, /signOutAfterAccountDeletionRequest\(\)/);
  assert.doesNotMatch(settings, /detachPushTokenForCurrentUser\(\)\.catch/);
});

test("notification toggles are account-scoped server preferences", () => {
  assert.match(settings, /getMobilePushPreferences/);
  assert.match(settings, /updateMobilePushPreferences/);
  assert.doesNotMatch(settings, /AsyncStorage\.getItem\(NOTIF_/);
  assert.doesNotMatch(settings, /AsyncStorage\.setItem\(NOTIF_/);
  assert.match(migration, /REVOKE UPDATE[\s\S]*push_token[\s\S]*FROM authenticated/i);
  assert.match(migration, /push_notifications_consented_at/);
});

test("mobile reads only the authenticated push projection, never the raw delivery token", () => {
  assert.match(notifications, /get_my_mobile_push_preferences/);
  assert.match(notifications, /p_expected_user_id:\s*user\.id/);
  assert.doesNotMatch(
    notifications,
    /\.from\(["']profiles["']\)[\s\S]{0,300}\.select\([\s\S]{0,300}push_token/,
  );
  assert.match(readProjectionMigration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(readProjectionMigration, /p_expected_user_id IS DISTINCT FROM v_user_id/);
  assert.match(readProjectionMigration, /'tokenAttached', v_token_attached/);
  assert.doesNotMatch(readProjectionMigration, /'pushToken'|'push_token'/);
  assert.match(readProjectionMigration, /SECURITY DEFINER[\s\S]*SET search_path = ''/i);
  assert.match(
    readProjectionMigration,
    /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated, service_role;[\s\S]*GRANT EXECUTE[\s\S]*TO authenticated;/i,
  );
});

test("current mobile push mutations bind the RPC actor before and after every write", () => {
  for (const rpcName of [
    "set_my_mobile_push_preferences_v2",
    "attach_my_mobile_push_token_v2",
    "detach_my_mobile_push_token_v2",
  ]) {
    assert.match(notifications, new RegExp(rpcName));
    assert.match(actorBoundMutationMigration, new RegExp(`FUNCTION public\\.${rpcName}`));
  }
  assert.doesNotMatch(
    notifications,
    /supabase\.rpc\(["'](?:set_my_mobile_push_preferences|attach_my_mobile_push_token|detach_my_mobile_push_token)["']/,
  );
  assert.match(notifications, /p_expected_user_id:\s*before\.userId/);
  assert.match(notifications, /p_expected_user_id:\s*actor\.userId/);
  assert.match(notifications, /p_expected_user_id:\s*user\.id/);
  assert.equal(
    (actorBoundMutationMigration.match(
      /p_expected_user_id IS DISTINCT FROM v_user_id/g,
    ) ?? []).length,
    3,
  );

  const updateStart = notifications.indexOf("export async function updateMobilePushPreferences");
  const updateBefore = notifications.indexOf("const before = await readActorPushPreferences()", updateStart);
  const updateRpc = notifications.indexOf('"set_my_mobile_push_preferences_v2"', updateBefore);
  const updateAfter = notifications.indexOf("user: afterUser", updateRpc);
  const updateFence = notifications.indexOf("afterUser?.id !== before.userId", updateAfter);
  assert.ok(updateStart >= 0 && updateStart < updateBefore);
  assert.ok(updateBefore < updateRpc && updateRpc < updateAfter && updateAfter < updateFence);

  const detachStart = notifications.indexOf("export async function detachPushTokenForCurrentUser");
  const detachBefore = notifications.indexOf("user }, error: userError", detachStart);
  const detachRpc = notifications.indexOf('"detach_my_mobile_push_token_v2"', detachBefore);
  const detachAfter = notifications.indexOf("user: afterUser", detachRpc);
  const detachFence = notifications.indexOf("afterUser?.id !== user.id", detachAfter);
  assert.ok(detachStart >= 0 && detachStart < detachBefore);
  assert.ok(detachBefore < detachRpc && detachRpc < detachAfter && detachAfter < detachFence);

  const registerStart = notifications.indexOf("export async function registerForPushNotifications");
  const registerBefore = notifications.indexOf("user?.id !== actor.userId", registerStart);
  const registerRpc = notifications.indexOf('"attach_my_mobile_push_token_v2"', registerBefore);
  const registerAfter = notifications.indexOf("user: afterUser", registerRpc);
  const registerFence = notifications.indexOf("afterUser?.id !== actor.userId", registerAfter);
  assert.ok(registerStart >= 0 && registerStart < registerBefore);
  assert.ok(registerBefore < registerRpc && registerRpc < registerAfter && registerAfter < registerFence);

  assert.match(actorBoundMutationMigration, /SECURITY DEFINER[\s\S]*SET search_path = ''/i);
  assert.match(
    actorBoundMutationMigration,
    /FROM PUBLIC, anon, authenticated, service_role;/i,
  );
});
