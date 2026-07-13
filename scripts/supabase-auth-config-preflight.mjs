import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const AUTH_CONFIG_CONTRACT =
  "direct-signup-disabled-general-password-v1";
export const GENERAL_PASSWORD_MIN_LENGTH = 8;
export const GENERAL_PASSWORD_REQUIRED_CHARACTERS =
  "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~";
export const REDIRECT_TOKEN_POLICY_CONTRACT =
  "hosted-auth-redirect-token-v1";
export const OAUTH_PROVIDER_CONTRACT =
  "verified-visible-oauth-providers-v1";

const NON_OAUTH_EXTERNAL_ENABLE_FIELDS = new Set([
  "anonymous_users",
  "email",
  "phone",
  "web3_ethereum",
  "web3_solana",
]);
const DEFAULT_RELEASE_TARGETS_PATH = fileURLToPath(
  new URL("./release-targets.json", import.meta.url)
);

export function parseArgs(argv) {
  // pnpm 11 on Windows forwards the conventional script separator as a
  // literal first argument. Accept exactly one leading separator, but keep
  // embedded or repeated separators fail-closed.
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const refIndex = normalizedArgv.indexOf("--expected-project-ref");
  const expectedProjectRef = refIndex >= 0 ? normalizedArgv[refIndex + 1] : "";

  if (!/^[a-z0-9]{20}$/.test(expectedProjectRef ?? "")) {
    throw new Error(
      "--expected-project-ref is required and must be a 20-character Supabase ref."
    );
  }

  const allowed = new Set(["--expected-project-ref", expectedProjectRef]);
  const unknown = normalizedArgv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0 || normalizedArgv.length !== 2) {
    throw new Error(`Unsupported argument: ${unknown[0] ?? "unexpected argument count"}.`);
  }

  return { expectedProjectRef };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  const normalized = value.map((item) => item.trim());
  if (normalized.some((item) => item.length === 0) ||
    new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} cannot contain blank or duplicate values.`);
  }
  return normalized.sort();
}

function parseHostedRedirectAllowList(value) {
  if (typeof value !== "string") return null;
  if (value.trim().length === 0) return [];
  return value.split(",").map((item) => item.trim()).sort();
}

function arraysEqual(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function validateBoundaryExpectations({ redirectTokenPolicy, oauthProviderContract }) {
  if (!isRecord(redirectTokenPolicy) ||
    redirectTokenPolicy.contract !== REDIRECT_TOKEN_POLICY_CONTRACT ||
    typeof redirectTokenPolicy.canonicalSiteUrl !== "string" ||
    redirectTokenPolicy.canonicalSiteUrl.length === 0 ||
    !Number.isInteger(redirectTokenPolicy.jwtExpirySeconds) ||
    redirectTokenPolicy.refreshTokenRotation !== true ||
    !Number.isInteger(redirectTokenPolicy.refreshTokenReuseSeconds) ||
    !Number.isInteger(redirectTokenPolicy.emailOtpLength) ||
    !Number.isInteger(redirectTokenPolicy.emailOtpExpirySeconds) ||
    !isRecord(redirectTokenPolicy.rateLimits)) {
    throw new Error("Checked-in redirect/token policy is incomplete.");
  }

  const additionalRedirectUrls = exactStringArray(
    redirectTokenPolicy.exactAdditionalRedirectUrls,
    "exactAdditionalRedirectUrls"
  );
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(
    redirectTokenPolicy.canonicalSiteUrl
  ) || additionalRedirectUrls.some((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol !== "https:" ||
        parsed.username.length > 0 || parsed.password.length > 0 ||
        parsed.hash.length > 0 || url.includes("*");
    } catch {
      return true;
    }
  })) {
    throw new Error("Checked-in Auth redirect policy contains an unsafe URL.");
  }
  const rateLimits = redirectTokenPolicy.rateLimits;
  for (const name of [
    "emailSentPerHour",
    "tokenRefreshPerFiveMinutesPerIp",
    "signInSignUpsPerFiveMinutesPerIp",
    "tokenVerificationsPerFiveMinutesPerIp",
  ]) {
    if (!Number.isInteger(rateLimits[name]) || rateLimits[name] < 1) {
      throw new Error(`Checked-in Auth rate limit is invalid: ${name}.`);
    }
  }

  if (!isRecord(oauthProviderContract) ||
    oauthProviderContract.contract !== OAUTH_PROVIDER_CONTRACT) {
    throw new Error("Checked-in OAuth provider policy is incomplete.");
  }
  const visibleProviders = exactStringArray(
    oauthProviderContract.visibleProviders,
    "visibleProviders"
  );
  if (visibleProviders.some((provider) =>
    !/^[a-z0-9_]+$/.test(provider) ||
    NON_OAUTH_EXTERNAL_ENABLE_FIELDS.has(provider))) {
    throw new Error("Checked-in OAuth provider policy contains an invalid provider.");
  }

  return {
    redirectTokenPolicy,
    additionalRedirectUrls,
    visibleProviders,
  };
}

export function evaluateHostedAuthBoundaries(
  config,
  { redirectTokenPolicy, oauthProviderContract }
) {
  if (!isRecord(config)) {
    throw new Error("Supabase Auth config did not return an object.");
  }
  const expected = validateBoundaryExpectations({
    redirectTokenPolicy,
    oauthProviderContract,
  });
  const actualRedirectUrls = parseHostedRedirectAllowList(config.uri_allow_list);
  const enabledProviders = Object.entries(config)
    .flatMap(([name, value]) => {
      const match = /^external_([a-z0-9_]+)_enabled$/.exec(name);
      if (!match || value !== true || NON_OAUTH_EXTERNAL_ENABLE_FIELDS.has(match[1])) {
        return [];
      }
      return [match[1]];
    })
    .sort();
  const providerFlagsBoolean = Object.entries(config).every(([name, value]) =>
    !/^external_[a-z0-9_]+_enabled$/.test(name) || typeof value === "boolean"
  );

  const checks = Object.freeze({
    canonical_site_url_exact:
      config.site_url === expected.redirectTokenPolicy.canonicalSiteUrl,
    additional_redirect_urls_exact:
      actualRedirectUrls !== null &&
      arraysEqual(actualRedirectUrls, expected.additionalRedirectUrls),
    jwt_expiry_exact:
      config.jwt_exp === expected.redirectTokenPolicy.jwtExpirySeconds,
    refresh_token_rotation_enabled_exact:
      config.refresh_token_rotation_enabled ===
      expected.redirectTokenPolicy.refreshTokenRotation,
    refresh_token_reuse_interval_exact:
      config.security_refresh_token_reuse_interval ===
      expected.redirectTokenPolicy.refreshTokenReuseSeconds,
    email_otp_length_exact:
      config.mailer_otp_length === expected.redirectTokenPolicy.emailOtpLength,
    email_otp_expiry_exact:
      config.mailer_otp_exp === expected.redirectTokenPolicy.emailOtpExpirySeconds,
    email_rate_limit_exact:
      config.rate_limit_email_sent ===
      expected.redirectTokenPolicy.rateLimits.emailSentPerHour,
    token_refresh_rate_limit_exact:
      config.rate_limit_token_refresh ===
      expected.redirectTokenPolicy.rateLimits.tokenRefreshPerFiveMinutesPerIp,
    sign_in_sign_up_rate_limit_exact:
      config.rate_limit_otp ===
      expected.redirectTokenPolicy.rateLimits.signInSignUpsPerFiveMinutesPerIp,
    token_verification_rate_limit_exact:
      config.rate_limit_verify ===
      expected.redirectTokenPolicy.rateLimits.tokenVerificationsPerFiveMinutesPerIp,
    oauth_provider_flags_boolean: providerFlagsBoolean,
    oauth_providers_exact:
      providerFlagsBoolean && arraysEqual(enabledProviders, expected.visibleProviders),
  });

  return {
    contracts: [REDIRECT_TOKEN_POLICY_CONTRACT, OAUTH_PROVIDER_CONTRACT],
    checks,
    failures: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
  };
}

export function loadReleaseTargets(path = DEFAULT_RELEASE_TARGETS_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Unable to read the checked-in release target policy.");
  }
  if (!isRecord(parsed)) {
    throw new Error("Checked-in release target policy has an unexpected shape.");
  }
  return parsed;
}

export function evaluateProductionAuthConfig(config) {
  if (!isRecord(config)) {
    throw new Error("Supabase Auth config did not return an object.");
  }

  const checks = Object.freeze({
    direct_signup_disabled: config.disable_signup === true,
    anonymous_sign_in_disabled:
      config.external_anonymous_users_enabled === false,
    email_provider_enabled: config.external_email_enabled === true,
    phone_provider_disabled: config.external_phone_enabled === false,
    email_confirmation_required: config.mailer_autoconfirm === false,
    general_password_min_length_exact:
      config.password_min_length === GENERAL_PASSWORD_MIN_LENGTH,
    general_password_character_classes_exact:
      config.password_required_characters ===
      GENERAL_PASSWORD_REQUIRED_CHARACTERS,
    password_change_reauthentication_enabled:
      config.security_update_password_require_reauthentication === true,
    manual_identity_linking_disabled:
      config.security_manual_linking_enabled === false,
  });

  return {
    contract: AUTH_CONFIG_CONTRACT,
    checks,
    failures: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
  };
}

export async function readProductionAuthConfig({
  expectedProjectRef,
  accessToken,
  fetchImpl = fetch,
}) {
  if (
    typeof accessToken !== "string" ||
    accessToken.trim().length < 20 ||
    /^(?:your[_-]|replace[_-]|example|changeme)/i.test(accessToken.trim())
  ) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is required for the read-only Auth config attestation."
    );
  }

  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${expectedProjectRef}/config/auth`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (response.status !== 200) {
    throw new Error(
      `Supabase Auth config attestation failed at the Management API boundary (HTTP ${response.status}).`
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Supabase Auth config response was not valid JSON.");
  }
  if (!isRecord(body)) {
    throw new Error("Supabase Auth config response had an unexpected shape.");
  }

  return body;
}

export async function runAuthConfigPreflight({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  logger = console,
  releaseTargets,
} = {}) {
  const { expectedProjectRef } = parseArgs(argv);
  const targets = releaseTargets ?? loadReleaseTargets();
  if (!Array.isArray(targets.productionSupabaseProjectRefs) ||
    !targets.productionSupabaseProjectRefs.includes(expectedProjectRef)) {
    throw new Error(
      "Expected project ref is not in the checked-in protected production list."
    );
  }
  const config = await readProductionAuthConfig({
    expectedProjectRef,
    accessToken: env.SUPABASE_ACCESS_TOKEN,
    fetchImpl,
  });
  const generalResult = evaluateProductionAuthConfig(config);
  const hostedBoundaryResult = evaluateHostedAuthBoundaries(config, {
    redirectTokenPolicy: targets.productionSupabaseRedirectTokenPolicy,
    oauthProviderContract: targets.productionOAuthProviderContract,
  });
  const result = {
    contract: generalResult.contract,
    contracts: [generalResult.contract, ...hostedBoundaryResult.contracts],
    checks: Object.freeze({
      ...generalResult.checks,
      ...hostedBoundaryResult.checks,
    }),
    failures: [...generalResult.failures, ...hostedBoundaryResult.failures],
  };

  if (result.failures.length > 0) {
    throw new Error(
      `Supabase Auth config contract failed: ${result.failures.join(", ")}.`
    );
  }

  logger.log(
    JSON.stringify({
      projectRef: expectedProjectRef,
      contracts: result.contracts,
      checks: result.checks,
    })
  );
  return result;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runAuthConfigPreflight().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Supabase Auth config attestation failed."
    );
    process.exitCode = 1;
  });
}
