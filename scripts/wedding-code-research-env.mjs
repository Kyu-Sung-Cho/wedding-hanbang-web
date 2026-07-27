import { SYNTHETIC_SUPABASE_ENVIRONMENT } from "./lib/synthetic-supabase-environment.mjs";

const SAFE_PARENT_ENVIRONMENT_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "CI",
  "FORCE_COLOR",
  "NO_COLOR",
];

/**
 * Build the local research server environment from an explicit allowlist.
 * The preview must never inherit provider, database, telemetry, or deployment
 * credentials from the terminal that launched it.
 */
export function buildWeddingCodeResearchEnvironment(source = process.env) {
  const environment = {};

  for (const key of SAFE_PARENT_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      environment[key] = value;
    }
  }

  return {
    ...environment,
    ...SYNTHETIC_SUPABASE_ENVIRONMENT,
    NODE_ENV: "development",
    NEXT_PUBLIC_POSTHOG_HOST: "",
    NEXT_PUBLIC_POSTHOG_KEY: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
    NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_AUTH_TOKEN: "",
    SENTRY_DSN: "",
    WEDDING_CODE_RESEARCH_PREVIEW: "true",
  };
}
