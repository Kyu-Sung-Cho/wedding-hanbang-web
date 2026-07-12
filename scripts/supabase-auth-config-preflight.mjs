import { pathToFileURL } from "node:url";

export const AUTH_CONFIG_CONTRACT =
  "direct-signup-disabled-general-password-v1";
export const GENERAL_PASSWORD_MIN_LENGTH = 8;
export const GENERAL_PASSWORD_REQUIRED_CHARACTERS =
  "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~";

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
} = {}) {
  const { expectedProjectRef } = parseArgs(argv);
  const config = await readProductionAuthConfig({
    expectedProjectRef,
    accessToken: env.SUPABASE_ACCESS_TOKEN,
    fetchImpl,
  });
  const result = evaluateProductionAuthConfig(config);

  if (result.failures.length > 0) {
    throw new Error(
      `Supabase Auth config contract failed: ${result.failures.join(", ")}.`
    );
  }

  logger.log(
    JSON.stringify({
      projectRef: expectedProjectRef,
      contract: result.contract,
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
