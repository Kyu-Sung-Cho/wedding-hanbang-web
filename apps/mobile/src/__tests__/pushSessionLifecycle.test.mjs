import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { releasePushDeliveryOwnership } from "../lib/pushSessionLifecycle.mjs";

test("push logout attempts both release boundaries and accepts either confirmation", async () => {
  const calls = [];
  const serverConfirmed = await releasePushDeliveryOwnership({
    releaseServerToken: async () => {
      calls.push("server");
    },
    unregisterDeviceToken: async () => {
      calls.push("device");
      throw new Error("native service unavailable");
    },
    clearCachedNotifications: async () => {
      calls.push("cache");
    },
  });
  assert.deepEqual(serverConfirmed, {
    serverReleased: true,
    deviceUnregistered: false,
    cacheCleared: true,
  });
  assert.deepEqual(calls.sort(), ["cache", "device", "server"]);

  const deviceConfirmed = await releasePushDeliveryOwnership({
    releaseServerToken: async () => {
      throw new Error("offline");
    },
    unregisterDeviceToken: async () => undefined,
    clearCachedNotifications: async () => undefined,
  });
  assert.deepEqual(deviceConfirmed, {
    serverReleased: false,
    deviceUnregistered: true,
    cacheCleared: true,
  });
});

test("push logout fails closed when neither boundary can be confirmed", async () => {
  await assert.rejects(
    releasePushDeliveryOwnership({
      releaseServerToken: async () => {
        throw new Error("offline");
      },
      unregisterDeviceToken: async () => {
        throw new Error("native service unavailable");
      },
      clearCachedNotifications: async () => undefined,
    }),
    /PUSH_DELIVERY_OWNERSHIP_RELEASE_UNCONFIRMED/,
  );

  await assert.rejects(
    releasePushDeliveryOwnership({
      releaseServerToken: async () => undefined,
      unregisterDeviceToken: async () => undefined,
      clearCachedNotifications: async () => {
        throw new Error("notification center unavailable");
      },
    }),
    /PUSH_DELIVERY_OWNERSHIP_RELEASE_UNCONFIRMED/,
  );
});

test("mobile logout releases push ownership before Auth and cleans external sign-outs", async () => {
  const [authSource, listenerSource] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/authListener.ts", import.meta.url), "utf8"),
  ]);
  assert.match(
    authSource,
    /Platform\.OS !== "web"[\s\S]*releasePushNotificationsForCurrentSession\(\)[\s\S]*supabase\.auth\.signOut\(\{\s*scope:\s*"local"\s*\}\)/,
  );
  assert.match(
    listenerSource,
    /event === "SIGNED_OUT"[\s\S]*unregisterPushNotificationsForSignedOutDevice[\s\S]*router\.replace/,
  );
  assert.match(
    listenerSource,
    /event === "INITIAL_SESSION" && !session/,
  );
});

test("push registration and release use one durable installation id", async () => {
  const [notificationSource, listenerSource] = await Promise.all([
    readFile(new URL("../lib/notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/authListener.ts", import.meta.url), "utf8"),
  ]);

  assert.match(notificationSource, /SecureStore\.getItemAsync\(PUSH_INSTALLATION_ID_KEY\)/);
  assert.match(notificationSource, /SecureStore\.setItemAsync\(PUSH_INSTALLATION_ID_KEY, created\)/);
  assert.match(
    notificationSource,
    /rpc\("bind_mobile_push_token",\s*\{[\s\S]*p_installation_id: installationId,[\s\S]*p_push_token: token,[\s\S]*p_platform: platform/u,
  );
  assert.match(
    notificationSource,
    /rpc\("release_mobile_push_token",\s*\{[\s\S]*p_installation_id: installationId,[\s\S]*p_push_token: currentToken/u,
  );
  assert.match(listenerSource, /event === "TOKEN_REFRESHED"/u);
});

test("automatic lifecycle refresh is silent and token rotation rebinds without a permission prompt", async () => {
  const [notificationSource, listenerSource] = await Promise.all([
    readFile(new URL("../lib/notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/authListener.ts", import.meta.url), "utf8"),
  ]);
  const silentStart = notificationSource.indexOf(
    "export async function refreshExistingPushRegistration",
  );
  const explicitStart = notificationSource.indexOf(
    "export async function registerForPushNotifications",
  );
  assert.ok(silentStart >= 0, "missing silent refresh boundary");
  assert.ok(explicitStart > silentStart, "explicit opt-in must follow silent refresh");
  const silentSource = notificationSource.slice(silentStart, explicitStart);
  assert.match(silentSource, /getPermissionsAsync\(\)/u);
  assert.match(silentSource, /status !== "granted"[\s\S]*return null/u);
  assert.doesNotMatch(silentSource, /requestPermissionsAsync/u);

  const explicitSource = notificationSource.slice(explicitStart);
  assert.match(explicitSource, /requestPermissionsAsync\(\)/u);
  assert.match(listenerSource, /refreshExistingPushRegistration/u);
  assert.doesNotMatch(
    listenerSource,
    /then\(\(\{ registerForPushNotifications \}\)/u,
  );
  assert.match(notificationSource, /addPushTokenListener/u);
  assert.match(
    notificationSource,
    /getExpoPushTokenAsync\(\{[\s\S]*devicePushToken/u,
  );
});

test("logout uses a cached bound token, local Auth scope, and no direct bypass paths", async () => {
  const [notificationSource, authSource, apiSource, settingsSource] = await Promise.all([
    readFile(new URL("../lib/notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/settings/index.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(notificationSource, /PUSH_BOUND_TOKEN_KEY/u);
  assert.match(
    notificationSource,
    /SecureStore\.setItemAsync\(PUSH_BOUND_TOKEN_KEY, token\)/u,
  );
  assert.match(
    notificationSource,
    /SecureStore\.getItemAsync\(PUSH_BOUND_TOKEN_KEY\)/u,
  );
  assert.match(
    authSource,
    /supabase\.auth\.signOut\(\{\s*scope:\s*"local"\s*\}\)/u,
  );
  assert.match(apiSource, /import \{ signOut \} from "\.\/auth"/u);
  assert.doesNotMatch(apiSource, /supabase\.auth\.signOut\(/u);
  assert.match(
    apiSource,
    /res\.status === 401[\s\S]{0,900}supabase\.auth\.getSession\(\)[\s\S]{0,500}currentSession\?\.user\.id !== initialSession\.userId[\s\S]{0,500}signOut\(\{ expectedOwnerId: initialSession\.userId \}\)/u,
  );
  assert.match(
    settingsSource,
    /await signOut\(\{ expectedOwnerId: expectedActorUserId \}\)/u,
  );
  assert.doesNotMatch(settingsSource, /supabase\.auth\.signOut\(/u);
});
