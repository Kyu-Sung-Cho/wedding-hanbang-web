import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AUTH_CONFIG_CONTRACT,
  GENERAL_PASSWORD_MIN_LENGTH,
  GENERAL_PASSWORD_REQUIRED_CHARACTERS,
  evaluateProductionAuthConfig,
  parseArgs,
  readProductionAuthConfig,
  runAuthConfigPreflight,
} from "./supabase-auth-config-preflight.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const ACCESS_TOKEN = `sbp_${"a".repeat(40)}`;

function exactConfig(overrides = {}) {
  return {
    disable_signup: true,
    external_anonymous_users_enabled: false,
    external_email_enabled: true,
    external_phone_enabled: false,
    mailer_autoconfirm: false,
    password_min_length: GENERAL_PASSWORD_MIN_LENGTH,
    password_required_characters: GENERAL_PASSWORD_REQUIRED_CHARACTERS,
    security_update_password_require_reauthentication: true,
    security_manual_linking_enabled: false,
    ...overrides,
  };
}

test("accepts only the exact hosted general-user Auth contract", () => {
  const result = evaluateProductionAuthConfig(exactConfig());
  assert.equal(result.contract, AUTH_CONFIG_CONTRACT);
  assert.deepEqual(result.failures, []);
  assert.equal(GENERAL_PASSWORD_MIN_LENGTH, 8);
  assert.equal(GENERAL_PASSWORD_REQUIRED_CHARACTERS.length, 98);
  assert.equal(
    createHash("sha256")
      .update(GENERAL_PASSWORD_REQUIRED_CHARACTERS)
      .digest("hex"),
    "90a34085ea54d56cc9e221509cf792e170a65398dd8f8fc1261cf1c411afe17d"
  );
});

test("fails closed when public GoTrue signup can bypass the server route", () => {
  const result = evaluateProductionAuthConfig(
    exactConfig({ disable_signup: false })
  );
  assert.deepEqual(result.failures, ["direct_signup_disabled"]);
});

test("rejects the provider's weak six-character fallback independently of admin policy", () => {
  const result = evaluateProductionAuthConfig(
    exactConfig({ password_min_length: 6, password_required_characters: "" })
  );
  assert.deepEqual(result.failures, [
    "general_password_min_length_exact",
    "general_password_character_classes_exact",
  ]);
  assert.equal(result.checks.direct_signup_disabled, true);
});

test("does not pretend the global general-user policy proves the role-aware admin policy", () => {
  const result = evaluateProductionAuthConfig(
    exactConfig({ security_captcha_enabled: false })
  );
  assert.deepEqual(result.failures, []);
  assert.equal("admin_password_min_length" in result.checks, false);
  assert.equal("security_captcha_enabled" in result.checks, false);
});

test("parses one exact project-ref argument and rejects extras", () => {
  assert.deepEqual(
    parseArgs(["--expected-project-ref", PROJECT_REF]),
    { expectedProjectRef: PROJECT_REF }
  );
  assert.deepEqual(
    parseArgs(["--", "--expected-project-ref", PROJECT_REF]),
    { expectedProjectRef: PROJECT_REF }
  );
  assert.throws(
    () => parseArgs(["--expected-project-ref", PROJECT_REF, "--write"]),
    /Unsupported argument/
  );
  assert.throws(
    () => parseArgs(["--", "--", "--expected-project-ref", PROJECT_REF]),
    /Unsupported argument/
  );
  assert.throws(() => parseArgs([]), /required/);
});

test("reads only the expected project's Management Auth endpoint", async () => {
  let observedUrl = "";
  let observedInit;
  const config = exactConfig();
  const result = await readProductionAuthConfig({
    expectedProjectRef: PROJECT_REF,
    accessToken: ACCESS_TOKEN,
    fetchImpl: async (url, init) => {
      observedUrl = url;
      observedInit = init;
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.deepEqual(result, config);
  assert.equal(
    observedUrl,
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`
  );
  assert.equal(observedInit.method, "GET");
  assert.equal(observedInit.redirect, "error");
  assert.equal(observedInit.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
});

test("does not expose provider response bodies on authorization failure", async () => {
  await assert.rejects(
    readProductionAuthConfig({
      expectedProjectRef: PROJECT_REF,
      accessToken: ACCESS_TOKEN,
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: "private provider detail" }), {
          status: 403,
        }),
    }),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /private provider detail/);
      assert.doesNotMatch(error.message, /sbp_/);
      return true;
    }
  );
});

test("prints only project identity and boolean evidence on success", async () => {
  const logs = [];
  await runAuthConfigPreflight({
    argv: ["--expected-project-ref", PROJECT_REF],
    env: { SUPABASE_ACCESS_TOKEN: ACCESS_TOKEN },
    fetchImpl: async () =>
      new Response(JSON.stringify(exactConfig()), { status: 200 }),
    logger: { log: (value) => logs.push(value) },
  });

  assert.equal(logs.length, 1);
  const evidence = JSON.parse(logs[0]);
  assert.equal(evidence.projectRef, PROJECT_REF);
  assert.equal(evidence.contract, AUTH_CONFIG_CONTRACT);
  assert.equal(evidence.checks.direct_signup_disabled, true);
  assert.doesNotMatch(logs[0], /sbp_/);
  assert.doesNotMatch(logs[0], /password_required_characters/);
});
