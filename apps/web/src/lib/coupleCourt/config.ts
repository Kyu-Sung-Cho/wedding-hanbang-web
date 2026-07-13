import { COUPLE_COURT_JUDGE_PROMPT_VERSION } from "@/lib/coupleCourt/prompts/coupleCourtJudge.ko";

export const COURT_VERDICT_SCHEMA_VERSION = "1.0" as const;
export const COURT_VERDICT_PROMPT_VERSION = COUPLE_COURT_JUDGE_PROMPT_VERSION;
export const COURT_VERDICT_MODEL_ROLE = "primary" as const;
export const COURT_VERDICT_MAX_OUTPUT_TOKENS = 800;

/**
 * Immutable schema-version history used when an audit is recovered after a
 * deployment. Keep old entries when introducing a new verdict schema: a paid
 * response staged by the previous release must retain its original audit
 * identity instead of being rewritten with the current release constants.
 */
const COURT_VERDICT_STRUCTURED_OUTPUT_NAMES: Readonly<Record<string, string>> = {
  "1.0": "couple_court_verdict_v1",
};

export function getCourtVerdictStructuredOutputName(
  schemaVersion: string,
): string | null {
  return COURT_VERDICT_STRUCTURED_OUTPUT_NAMES[schemaVersion] ?? null;
}

export const COURT_VERDICT_STRUCTURED_OUTPUT_NAME =
  getCourtVerdictStructuredOutputName(COURT_VERDICT_SCHEMA_VERSION)
  ?? (() => {
    throw new Error("Current Couple Court verdict schema is not registered");
  })();
