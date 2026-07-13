import Ajv, { type ErrorObject } from "ajv";
import { COURT_VERDICT_SCHEMA_VERSION } from "@/lib/coupleCourt/config";
import { detectCourtPii } from "@/lib/coupleCourt/privacy";
import {
  COURT_CATEGORIES,
  COURT_SAFETY_RISK_TYPES,
  type CourtCategory,
  type CourtMode,
  type CourtTone,
  type CourtVerdict,
} from "@/lib/coupleCourt/types";

const nullableString = (maxLength: number) => ({
  anyOf: [
    { type: "string", minLength: 1, maxLength },
    { type: "null" },
  ],
});

const nullablePercentage = {
  anyOf: [
    { type: "integer", minimum: 0, maximum: 100 },
    { type: "null" },
  ],
};

export const COURT_VERDICT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "safety",
    "caseMeta",
    "caseSummary",
    "sharedFacts",
    "differentViews",
    "applicantNeeds",
    "partnerNeeds",
    "coreConflict",
    "responsibility",
    "verdict",
    "conversationScript",
    "missions",
    "checkIn",
    "confidence",
    "limitations",
    "publicCard",
  ],
  properties: {
    schemaVersion: { type: "string", enum: [COURT_VERDICT_SCHEMA_VERSION] },
    safety: {
      type: "object",
      additionalProperties: false,
      required: [
        "level",
        "riskTypes",
        "disablePlayfulVerdict",
        "publicEligible",
        "supportMessage",
      ],
      properties: {
        level: { type: "string", enum: ["normal", "sensitive", "high_risk"] },
        riskTypes: {
          type: "array",
          maxItems: COURT_SAFETY_RISK_TYPES.length,
          items: { type: "string", enum: [...COURT_SAFETY_RISK_TYPES] },
        },
        disablePlayfulVerdict: { type: "boolean" },
        publicEligible: { type: "boolean" },
        supportMessage: nullableString(300),
      },
    },
    caseMeta: {
      type: "object",
      additionalProperties: false,
      required: ["generatedTitle", "category", "provisional"],
      properties: {
        generatedTitle: { type: "string", minLength: 2, maxLength: 60 },
        category: { type: "string", enum: [...COURT_CATEGORIES] },
        provisional: { type: "boolean" },
      },
    },
    caseSummary: { type: "string", minLength: 10, maxLength: 360 },
    sharedFacts: {
      type: "array",
      maxItems: 4,
      items: { type: "string", minLength: 2, maxLength: 160 },
    },
    differentViews: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["applicant", "respondent"],
        properties: {
          applicant: { type: "string", minLength: 2, maxLength: 160 },
          respondent: nullableString(160),
        },
      },
    },
    applicantNeeds: { type: "string", minLength: 2, maxLength: 180 },
    partnerNeeds: nullableString(180),
    coreConflict: { type: "string", minLength: 2, maxLength: 180 },
    responsibility: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "displayMode",
            "applicant",
            "respondent",
            "shared",
            "explanation",
          ],
          properties: {
            displayMode: { type: "string", enum: ["percentage", "qualitative"] },
            applicant: nullablePercentage,
            respondent: nullablePercentage,
            shared: nullablePercentage,
            explanation: { type: "string", minLength: 5, maxLength: 260 },
          },
        },
      ],
    },
    verdict: {
      type: "object",
      additionalProperties: false,
      required: ["status", "headline", "reasons", "judgeOneLiner"],
      properties: {
        status: {
          type: "string",
          enum: [
            "applicant_partially_upheld",
            "respondent_partially_upheld",
            "shared_responsibility",
            "settlement_recommended",
            "insufficient_information",
            "safety_redirect",
          ],
        },
        headline: { type: "string", minLength: 2, maxLength: 100 },
        reasons: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: { type: "string", minLength: 2, maxLength: 180 },
        },
        judgeOneLiner: nullableString(100),
      },
    },
    conversationScript: {
      type: "object",
      additionalProperties: false,
      required: ["opening", "applicantLine", "respondentLine"],
      properties: {
        opening: { type: "string", minLength: 2, maxLength: 180 },
        applicantLine: { type: "string", minLength: 2, maxLength: 180 },
        respondentLine: nullableString(180),
      },
    },
    missions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "description",
          "owner",
          "dueInMinutes",
          "completionCheck",
          "funTag",
          "relatedFeature",
        ],
        properties: {
          title: { type: "string", minLength: 2, maxLength: 80 },
          description: { type: "string", minLength: 5, maxLength: 220 },
          owner: { type: "string", enum: ["applicant", "partner", "both"] },
          dueInMinutes: { type: "integer", minimum: 10, maximum: 4320 },
          completionCheck: { type: "string", minLength: 2, maxLength: 160 },
          funTag: nullableString(30),
          relatedFeature: { type: "string", enum: ["task"] },
        },
      },
    },
    checkIn: {
      type: "object",
      additionalProperties: false,
      required: ["dueInDays", "question"],
      properties: {
        dueInDays: { type: "integer", minimum: 1, maximum: 14 },
        question: { type: "string", minLength: 5, maxLength: 180 },
      },
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    limitations: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", minLength: 2, maxLength: 180 },
    },
    publicCard: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["safeTitle", "oneLine", "resultLabel", "hashtags"],
          properties: {
            safeTitle: { type: "string", minLength: 2, maxLength: 80 },
            oneLine: { type: "string", minLength: 2, maxLength: 180 },
            resultLabel: { type: "string", minLength: 2, maxLength: 60 },
            hashtags: {
              type: "array",
              maxItems: 4,
              items: { type: "string", minLength: 2, maxLength: 20 },
            },
          },
        },
      ],
    },
  },
};

const verdictProperties = COURT_VERDICT_JSON_SCHEMA.properties as Record<string, unknown>;
const providerVerdictProperties = Object.fromEntries(
  Object.entries(verdictProperties).filter(([field]) => field !== "publicCard"),
);

/**
 * The provider never authors share copy. The server injects a deterministic
 * enum-derived card before full validation, reducing token cost and the PII
 * surface while retaining the stricter persisted-result schema above.
 */
export const COURT_VERDICT_PROVIDER_JSON_SCHEMA: Record<string, unknown> = {
  ...COURT_VERDICT_JSON_SCHEMA,
  required: (COURT_VERDICT_JSON_SCHEMA.required as string[])
    .filter((field) => field !== "publicCard"),
  properties: providerVerdictProperties,
};

const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema = ajv.compile<CourtVerdict>(COURT_VERDICT_JSON_SCHEMA);

function schemaIssue(error: ErrorObject): string {
  return `${error.instancePath || "/"}:${error.keyword}`;
}

export class CourtVerdictValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Court verdict validation failed (${issues.join(", ")}).`);
    this.name = "CourtVerdictValidationError";
  }
}

function fail(...issues: string[]): never {
  throw new CourtVerdictValidationError(issues);
}

export function validateCourtVerdict(
  value: unknown,
  context?: {
    mode: CourtMode;
    category: CourtCategory;
    tone?: CourtTone;
    preflightSafetyLevel?: "normal" | "sensitive" | "high_risk";
  },
): CourtVerdict {
  if (!validateSchema(value)) {
    throw new CourtVerdictValidationError(
      (validateSchema.errors ?? []).map(schemaIssue).slice(0, 20),
    );
  }
  const verdict = value;

  if (context) {
    if (verdict.caseMeta.category !== context.category) fail("caseMeta.category:mismatch");
    if (verdict.caseMeta.provisional !== (context.mode === "solo")) {
      fail("caseMeta.provisional:mismatch");
    }
  }

  const highRisk = verdict.safety.level === "high_risk";
  const normal = verdict.safety.level === "normal";
  if (context?.preflightSafetyLevel === "sensitive" && normal) {
    fail("safety.level:preflight_downgrade");
  }
  if (context?.preflightSafetyLevel === "high_risk" && !highRisk) {
    fail("safety.level:preflight_downgrade");
  }
  if (highRisk) {
    if (verdict.safety.riskTypes.length === 0) fail("safety.riskTypes:required");
    if (!verdict.safety.disablePlayfulVerdict) fail("safety.disablePlayfulVerdict:required");
    if (verdict.safety.publicEligible) fail("safety.publicEligible:forbidden");
    if (!verdict.safety.supportMessage) fail("safety.supportMessage:required");
    if (verdict.responsibility !== null) fail("responsibility:forbidden_for_high_risk");
    if (verdict.missions.length !== 0) fail("missions:forbidden_for_high_risk");
    if (verdict.publicCard !== null) fail("publicCard:forbidden_for_high_risk");
    if (verdict.verdict.status !== "safety_redirect") fail("verdict.status:must_redirect");
    if (verdict.verdict.judgeOneLiner !== null) fail("verdict.judgeOneLiner:forbidden_for_high_risk");
  } else {
    if (verdict.safety.riskTypes.length !== 0) fail("safety.riskTypes:unexpected");
    if (verdict.verdict.status === "safety_redirect") fail("verdict.status:unexpected_redirect");
    if (verdict.missions.length < 1) fail("missions:at_least_one_required");
  }

  if (!normal) {
    if (verdict.safety.publicEligible) fail("safety.publicEligible:non_normal");
    if (verdict.publicCard !== null) fail("publicCard:non_normal");
    if (!verdict.safety.disablePlayfulVerdict) fail("safety.disablePlayfulVerdict:non_normal");
    if (verdict.verdict.judgeOneLiner !== null) {
      fail("verdict.judgeOneLiner:non_normal");
    }
  } else {
    if (!verdict.safety.publicEligible) fail("safety.publicEligible:normal_required");
    if (verdict.publicCard === null) fail("publicCard:normal_required");
    if (verdict.safety.supportMessage !== null) fail("safety.supportMessage:normal_forbidden");
  }

  if (verdict.responsibility) {
    const { applicant, respondent, shared, displayMode } = verdict.responsibility;
    if (displayMode === "percentage") {
      if (context?.mode === "solo") fail("responsibility.percentage:solo_forbidden");
      if (applicant === null || respondent === null || shared === null) {
        fail("responsibility.percentage:all_values_required");
      }
      if ([applicant, respondent, shared].some((number) => number % 5 !== 0)) {
        fail("responsibility.percentage:multiple_of_five");
      }
      if (applicant + respondent + shared !== 100) {
        fail("responsibility.percentage:sum_100");
      }
    } else if (applicant !== null || respondent !== null || shared !== null) {
      fail("responsibility.qualitative:percentages_forbidden");
    }
  } else if (!highRisk && verdict.verdict.status !== "insufficient_information") {
    fail("responsibility:required");
  }

  if (context?.mode === "solo" && !highRisk) {
    if (verdict.partnerNeeds !== null) fail("partnerNeeds:solo_forbidden");
    if (verdict.conversationScript.respondentLine !== null) {
      fail("conversationScript.respondentLine:solo_forbidden");
    }
    if (verdict.differentViews.some((view) => view.respondent !== null)) {
      fail("differentViews.respondent:solo_forbidden");
    }
    if (verdict.missions.some((mission) => mission.owner !== "applicant")) {
      fail("missions.owner:solo_applicant_only");
    }
  }

  if (context?.mode === "couple" && !highRisk) {
    if (verdict.partnerNeeds === null) fail("partnerNeeds:couple_required");
    if (verdict.conversationScript.respondentLine === null) {
      fail("conversationScript.respondentLine:couple_required");
    }
  }

  if (verdict.publicCard) {
    const publicText = [
      verdict.publicCard.safeTitle,
      verdict.publicCard.oneLine,
      verdict.publicCard.resultLabel,
      ...verdict.publicCard.hashtags,
    ].join("\n");
    if (detectCourtPii(publicText, { blockCurrencyAmounts: true }).length > 0) {
      fail("publicCard:pii_detected");
    }
  }

  return verdict;
}
