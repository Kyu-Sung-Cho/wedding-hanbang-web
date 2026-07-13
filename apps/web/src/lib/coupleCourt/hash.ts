import { createHash } from "node:crypto";
import {
  COURT_VERDICT_MODEL_ROLE,
  COURT_VERDICT_PROMPT_VERSION,
  COURT_VERDICT_SCHEMA_VERSION,
} from "@/lib/coupleCourt/config";
import { COURT_SAFETY_POLICY_VERSION } from "@/lib/coupleCourt/safety";
import type {
  CourtCategory,
  CourtMode,
  CourtStatementInput,
  CourtTone,
} from "@/lib/coupleCourt/types";

const INPUT_HASH_NAMESPACE = "couple-court-verdict-input-v2";

export interface CourtVerdictHashInput {
  mode: CourtMode;
  category: CourtCategory;
  tone: CourtTone;
  preflightSafetyLevel: "normal" | "sensitive";
  statements: readonly CourtStatementInput[];
  /** Resolved, code-validated provider model (for example gpt-5.6-terra). */
  model: string;
}

export interface NormalizedCourtStatement {
  role: CourtStatementInput["role"];
  facts: string;
  feelings: string;
  expectations: string;
  priorAgreement: string;
  attempts: string;
  desiredOutcome: string;
  changeCommitment: string;
  evidenceSummaries: string[];
}

export function normalizeCourtInputText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeCourtStatements(
  statements: readonly CourtStatementInput[],
): NormalizedCourtStatement[] {
  return statements
    .map((statement) => ({
      role: statement.role,
      facts: normalizeCourtInputText(statement.facts),
      feelings: normalizeCourtInputText(statement.feelings),
      expectations: normalizeCourtInputText(statement.expectations),
      priorAgreement: normalizeCourtInputText(statement.priorAgreement),
      attempts: normalizeCourtInputText(statement.attempts),
      desiredOutcome: normalizeCourtInputText(statement.desiredOutcome),
      changeCommitment: normalizeCourtInputText(statement.changeCommitment),
      evidenceSummaries: (statement.evidenceSummaries ?? [])
        .map((item) => normalizeCourtInputText(item))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ko")),
    }))
    .sort((a, b) => {
      if (a.role === b.role) return 0;
      return a.role === "applicant" ? -1 : 1;
    });
}

/**
 * Content identity only: user and case identifiers are intentionally excluded;
 * the database claim scopes this digest to its case separately.
 */
export function computeCourtInputHash<T extends CourtVerdictHashInput>(input: T): string {
  const canonical = JSON.stringify({
    mode: input.mode,
    category: input.category,
    tone: input.tone,
    preflightSafetyLevel: input.preflightSafetyLevel,
    statements: normalizeCourtStatements(input.statements),
    promptVersion: COURT_VERDICT_PROMPT_VERSION,
    schemaVersion: COURT_VERDICT_SCHEMA_VERSION,
    safetyPolicyVersion: COURT_SAFETY_POLICY_VERSION,
    provider: "openai",
    modelRole: COURT_VERDICT_MODEL_ROLE,
    model: input.model,
  });
  return createHash("sha256")
    .update(`${INPUT_HASH_NAMESPACE}\u0000${canonical}`, "utf8")
    .digest("hex");
}
