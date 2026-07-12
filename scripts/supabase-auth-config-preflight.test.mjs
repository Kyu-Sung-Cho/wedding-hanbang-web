import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AUTH_CONFIG_CONTRACT,
  GENERAL_PASSWORD_MIN_LENGTH,
  GENERAL_PASSWORD_REQUIRED_CHARACTERS,
  OAUTH_PROVIDER_CONTRACT,
  REDIRECT_TOKEN_POLICY_CONTRACT,
  evaluateHostedAuthBoundaries,
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
    site_url: "https://hanbang.ai",
    uri_allow_list: "",
    jwt_exp: 3600,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    mailer_otp_length: 6,
    mailer_otp_exp: 3600,
    rate_limit_email_sent: 2,
    rate_limit_token_refresh: 150,
    rate_limit_otp: 30,
    rate_limit_verify: 30,
    external_apple_enabled: false,
    external_google_enabled: false,
    external_kakao_enabled: false,
    ...overrides,
  };
}

function exactReleaseTargets(overrides = {}) {
  return {
    productionSupabaseProjectRefs: [PROJECT_REF],
    productionSupabaseRedirectTokenPolicy: {
      status: "not_attested",
      contract: REDIRECT_TOKEN_POLICY_CONTRACT,
      canonicalSiteUrl: "https://hanbang.ai",
      exactAdditionalRedirectUrls: [],
      jwtExpirySeconds: 3600,
      refreshTokenRotation: true,
      refreshTokenReuseSeconds: 10,
      emailOtpLength: 6,
      emailOtpExpirySeconds: 3600,
      rateLimits: {
        emailSentPerHour: 2,
        tokenRefreshPerFiveMinutesPerIp: 150,
        signInSignUpsPerFiveMinutesPerIp: 30,
        tokenVerificationsPerFiveMinutesPerIp: 30,
      },
    },
    productionOAuthProviderContract: {
      status: "not_attested",
      contract: OAUTH_PROVIDER_CONTRACT,
      visibleProviders: [],
    },
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

test("attests the exact hosted redirect, token, rate-limit, and OAuth boundary", () => {
  const targets = exactReleaseTargets();
  const result = evaluateHostedAuthBoundaries(exactConfig(), {
    redirectTokenPolicy: targets.productionSupabaseRedirectTokenPolicy,
    oauthProviderContract: targets.productionOAuthProviderContract,
  });

  assert.deepEqual(result.contracts, [
    REDIRECT_TOKEN_POLICY_CONTRACT,
    OAUTH_PROVIDER_CONTRACT,
  ]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.checks.canonical_site_url_exact, true);
  assert.equal(result.checks.oauth_providers_exact, true);
});

test("fails closed on redirect wildcards, weaker token settings, or changed rate limits", () => {
  const targets = exactReleaseTargets();
  const result = evaluateHostedAuthBoundaries(
    exactConfig({
      site_url: "https://www.hanbang.ai",
      uri_allow_list: "https://*.hanbang.ai/**",
      jwt_exp: 7200,
      refresh_token_rotation_enabled: false,
      security_refresh_token_reuse_interval: 60,
      mailer_otp_length: 8,
      mailer_otp_exp: 7200,
      rate_limit_email_sent: 20,
      rate_limit_token_refresh: 500,
      rate_limit_otp: 100,
      rate_limit_verify: 100,
    }),
    {
      redirectTokenPolicy: targets.productionSupabaseRedirectTokenPolicy,
      oauthProviderContract: targets.productionOAuthProviderContract,
    }
  );

  assert.deepEqual(result.failures, [
    "canonical_site_url_exact",
    "additional_redirect_urls_exact",
    "jwt_expiry_exact",
    "refresh_token_rotation_enabled_exact",
    "refresh_token_reuse_interval_exact",
    "email_otp_length_exact",
    "email_otp_expiry_exact",
    "email_rate_limit_exact",
    "token_refresh_rate_limit_exact",
    "sign_in_sign_up_rate_limit_exact",
    "token_verification_rate_limit_exact",
  ]);
});

test("detects any hosted OAuth provider that is not in the checked-in visible set", () => {
  const targets = exactReleaseTargets();
  const result = evaluateHostedAuthBoundaries(
    exactConfig({
      external_kakao_enabled: true,
      external_google_enabled: true,
      external_email_enabled: true,
    }),
    {
      redirectTokenPolicy: targets.productionSupabaseRedirectTokenPolicy,
      oauthProviderContract: targets.productionOAuthProviderContract,
    }
  );
  assert.deepEqual(result.failures, ["oauth_providers_exact"]);

  const expectedEnabled = exactReleaseTargets({
    productionOAuthProviderContract: {
      status: "not_attested",
      contract: OAUTH_PROVIDER_CONTRACT,
      visibleProviders: ["google", "kakao"],
    },
  });
  assert.deepEqual(
    evaluateHostedAuthBoundaries(
      exactConfig({ external_google_enabled: true, external_kakao_enabled: true }),
      {
        redirectTokenPolicy:
          expectedEnabled.productionSupabaseRedirectTokenPolicy,
        oauthProviderContract:
          expectedEnabled.productionOAuthProviderContract,
      }
    ).failures,
    []
  );
});

test("rejects malformed provider flags and unsafe checked-in redirect URLs", () => {
  const targets = exactReleaseTargets();
  const malformed = evaluateHostedAuthBoundaries(
    exactConfig({ external_kakao_enabled: "true" }),
    {
      redirectTokenPolicy: targets.productionSupabaseRedirectTokenPolicy,
      oauthProviderContract: targets.productionOAuthProviderContract,
    }
  );
  assert.deepEqual(malformed.failures, [
    "oauth_provider_flags_boolean",
    "oauth_providers_exact",
  ]);

  assert.throws(
    () => evaluateHostedAuthBoundaries(exactConfig(), {
      redirectTokenPolicy: {
        ...targets.productionSupabaseRedirectTokenPolicy,
        exactAdditionalRedirectUrls: ["https://*.hanbang.ai/**"],
      },
      oauthProviderContract: targets.productionOAuthProviderContract,
    }),
    /unsafe URL/
  );
});

test("rejects incomplete checked-in boundary policy instead of inventing defaults", () => {
  const targets = exactReleaseTargets();
  assert.throws(
    () => evaluateHostedAuthBoundaries(exactConfig(), {
      redirectTokenPolicy: {
        ...targets.productionSupabaseRedirectTokenPolicy,
        rateLimits: {},
      },
      oauthProviderContract: targets.productionOAuthProviderContract,
    }),
    /rate limit is invalid/
  );
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
    releaseTargets: exactReleaseTargets(),
  });

  assert.equal(logs.length, 1);
  const evidence = JSON.parse(logs[0]);
  assert.equal(evidence.projectRef, PROJECT_REF);
  assert.deepEqual(evidence.contracts, [
    AUTH_CONFIG_CONTRACT,
    REDIRECT_TOKEN_POLICY_CONTRACT,
    OAUTH_PROVIDER_CONTRACT,
  ]);
  assert.equal(evidence.checks.direct_signup_disabled, true);
  assert.equal(evidence.checks.canonical_site_url_exact, true);
  assert.equal(evidence.checks.oauth_providers_exact, true);
  assert.doesNotMatch(logs[0], /sbp_/);
  assert.doesNotMatch(logs[0], /password_required_characters/);
  assert.doesNotMatch(logs[0], /external_kakao_secret/);
  assert.doesNotMatch(logs[0], /uri_allow_list/);
});

test("refuses to attest a project outside the checked-in production list", async () => {
  await assert.rejects(
    runAuthConfigPreflight({
      argv: ["--expected-project-ref", PROJECT_REF],
      env: { SUPABASE_ACCESS_TOKEN: ACCESS_TOKEN },
      releaseTargets: exactReleaseTargets({
        productionSupabaseProjectRefs: ["zyxwvutsrqponmlkjihg"],
      }),
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
    }),
    /protected production list/
  );
});
