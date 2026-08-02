import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import {
  isStrongAdminPassword,
  isStrongUserPassword,
} from "../../../../packages/shared/src/security/passwordPolicy.mjs";
import {
  changePasswordAndRevokeSessions,
  isValidPasswordReauthenticationCode,
  requestPasswordChangeReauthentication,
} from "../lib/passwordChange.mjs";

const settingsSource = await readFile(
  new URL("../../app/settings/index.tsx", import.meta.url),
  "utf8",
);
const signupSource = await readFile(
  new URL("../../app/(auth)/signup.tsx", import.meta.url),
  "utf8",
);
const authConfigSource = await readFile(
  new URL("../../../../supabase/config.toml", import.meta.url),
  "utf8",
);
const mobilePackage = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);

test("canonical user password policy rejects the previous six-character downgrade", () => {
  assert.equal(isStrongUserPassword("Aa1!aa"), false);
  assert.equal(isStrongUserPassword("abcdefgh"), false);
  assert.equal(isStrongUserPassword("Abcdef1!"), true);
});

test("canonical admin policy requires twelve characters and all character classes", () => {
  assert.equal(isStrongAdminPassword("Abcdef1!"), false);
  assert.equal(isStrongAdminPassword("Abcdefghij1!"), true);
});

test("mobile signup and password change both use the canonical policy", () => {
  assert.match(signupSource, /isStrongUserPassword\(password\)/);
  assert.match(settingsSource, /isStrongUserPassword\(newPassword\)/);
  assert.doesNotMatch(settingsSource, /newPassword\.length\s*<\s*6/);
  assert.match(
    settingsSource,
    /8자 이상이며 대문자, 소문자, 숫자, 특수문자를 포함해야 해요/,
  );
});

test("Supabase enforces the canonical password and recent-auth boundary", () => {
  assert.match(authConfigSource, /minimum_password_length\s*=\s*8/);
  assert.match(
    authConfigSource,
    /password_requirements\s*=\s*"lower_upper_letters_digits_symbols"/,
  );
  assert.match(authConfigSource, /secure_password_change\s*=\s*true/);
  assert.match(
    authConfigSource,
    /^\[auth\.email\.notification\.password_changed\][\s\S]*?^enabled\s*=\s*true/m,
  );
});

test("mobile requires a supabase-js release that supports current_password", () => {
  assert.equal(mobilePackage.dependencies["@supabase/supabase-js"], "^2.102.0");
});

test("password change requires reauthentication, sends the nonce, then revokes sessions", async () => {
  const calls = [];
  const auth = {
    async reauthenticate() {
      calls.push(["reauthenticate"]);
      return { error: null };
    },
    async updateUser(attributes) {
      calls.push(["updateUser", attributes]);
      return { error: null };
    },
  };

  await requestPasswordChangeReauthentication(auth);
  await changePasswordAndRevokeSessions({
    auth,
    currentPassword: "Old-password1!",
    newPassword: "Abcdef1!",
    reauthenticationCode: "123456",
    signOutAllSessions: async () => {
      calls.push(["signOutAllSessions"]);
    },
  });

  assert.deepEqual(calls, [
    ["reauthenticate"],
    [
      "updateUser",
      {
        current_password: "Old-password1!",
        password: "Abcdef1!",
        nonce: "123456",
      },
    ],
    ["signOutAllSessions"],
  ]);
});

test("password change rejects a missing current password, weak new password, and malformed nonce before Auth", async () => {
  let updateCount = 0;
  const auth = {
    async reauthenticate() {
      return { error: null };
    },
    async updateUser() {
      updateCount += 1;
      return { error: null };
    },
  };
  const signOutAllSessions = async () => {};

  assert.equal(isValidPasswordReauthenticationCode("123456"), true);
  assert.equal(isValidPasswordReauthenticationCode("12 3456"), false);
  assert.equal(isValidPasswordReauthenticationCode("abcdef"), false);
  await assert.rejects(
    changePasswordAndRevokeSessions({
      auth,
      currentPassword: "",
      newPassword: "Abcdef1!",
      reauthenticationCode: "123456",
      signOutAllSessions,
    }),
    /CURRENT_PASSWORD_REQUIRED/,
  );
  await assert.rejects(
    changePasswordAndRevokeSessions({
      auth,
      currentPassword: "Old-password1!",
      newPassword: "weakpass",
      reauthenticationCode: "123456",
      signOutAllSessions,
    }),
    /PASSWORD_POLICY_REJECTED/,
  );
  await assert.rejects(
    changePasswordAndRevokeSessions({
      auth,
      currentPassword: "Old-password1!",
      newPassword: "Abcdef1!",
      reauthenticationCode: "12 3456",
      signOutAllSessions,
    }),
    /PASSWORD_REAUTHENTICATION_CODE_INVALID/,
  );
  assert.equal(updateCount, 0);
});

test("Auth rejection never reports success or revokes sessions out of order", async () => {
  let signOutCount = 0;
  await assert.rejects(
    requestPasswordChangeReauthentication({
      reauthenticate: async () => ({ error: new Error("provider detail") }),
    }),
    /PASSWORD_REAUTHENTICATION_FAILED/,
  );
  await assert.rejects(
    changePasswordAndRevokeSessions({
      auth: {
        updateUser: async () => ({ error: new Error("provider detail") }),
      },
      currentPassword: "Old-password1!",
      newPassword: "Abcdef1!",
      reauthenticationCode: "123456",
      signOutAllSessions: async () => {
        signOutCount += 1;
      },
    }),
    /PASSWORD_CHANGE_REJECTED/,
  );
  assert.equal(signOutCount, 0);
});

test("a post-change session revocation failure is distinguishable from a rejected change", async () => {
  await assert.rejects(
    changePasswordAndRevokeSessions({
      auth: {
        updateUser: async () => ({ error: null }),
      },
      currentPassword: "Old-password1!",
      newPassword: "Abcdef1!",
      reauthenticationCode: "123456",
      signOutAllSessions: async () => {
        throw new Error("network detail");
      },
    }),
    /PASSWORD_CHANGED_SIGN_OUT_FAILED/,
  );
});

test("mobile settings exposes the reauthentication challenge instead of direct password mutation", () => {
  assert.match(settingsSource, /requestPasswordChangeReauthentication\(supabase\.auth\)/);
  assert.match(settingsSource, /changePasswordAndRevokeSessions\(\{/);
  assert.match(settingsSource, /currentPassword/);
  assert.match(settingsSource, /currentPassword:\s*currentPassword/);
  assert.match(settingsSource, /textContentType="password"/);
  assert.match(settingsSource, /reauthenticationCode:\s*passwordReauthenticationCode/);
  assert.match(settingsSource, /signOutAllSessions:\s*signOutSession/);
  assert.match(settingsSource, /textContentType="oneTimeCode"/);
  assert.doesNotMatch(settingsSource, /supabase\.auth\.updateUser\(/);
});
