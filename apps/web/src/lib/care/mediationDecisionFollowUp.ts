import { createHash } from "node:crypto";
import {
  MEDIATION_OUTCOME_FOLLOW_UP_CHOICES,
  MEDIATION_OUTCOME_FOLLOW_UP_COPY,
} from "@hanbang/shared";

/**
 * The compiler deliberately emits only identifier-bound provenance and fixed
 * copy. Its candidates are revalidated and atomically claimed by the separate
 * recipient-private mediation follow-up storage boundary.
 */

const FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000;
const FOLLOW_UP_RESPONSE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MD5_RE = /^[0-9a-f]{32}$/u;

export const MEDIATION_DECISION_FOLLOW_UP_OUTCOMES =
  MEDIATION_OUTCOME_FOLLOW_UP_CHOICES;

export type MediationDecisionFollowUpOutcome =
  (typeof MEDIATION_DECISION_FOLLOW_UP_OUTCOMES)[number]["outcome"];

export interface MediationFollowUpSafetyContext {
  violence: boolean;
  coercion: boolean;
  privateSafetyHold: boolean;
}

export interface MediationFollowUpRoster {
  brideUserId: string;
  groomUserId: string;
}

export interface BuildMediationDecisionFollowUpCandidatesInput {
  coupleId: string;
  recipientUserId: string;
  currentRoster: MediationFollowUpRoster;
  safety: MediationFollowUpSafetyContext;
  decisions: readonly unknown[];
  now?: Date;
}

export interface MediationDecisionFollowUpCandidate {
  decisionId: string;
  sourceKey: string;
  sourceStateDigest: string;
  kind: "mediation_outcome_follow_up";
  visibility: "private";
  recipientUserId: string;
  eligibleAt: string;
  title: string;
  question: string;
  confirmed: string[];
  unknown: string[];
  outcomes: Array<(typeof MEDIATION_DECISION_FOLLOW_UP_OUTCOMES)[number]>;
  impact: string;
  safeguards: {
    automaticSharedMutation: false;
    automaticRemediation: false;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hash(algorithm: "md5" | "sha256", value: string): string {
  return createHash(algorithm).update(value, "utf8").digest("hex");
}

function isClearSafetyContext(value: unknown): boolean {
  return isRecord(value)
    && value.violence === false
    && value.coercion === false
    && value.privateSafetyHold === false;
}

function currentRosterFingerprint(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const brideUserId = value.brideUserId;
  const groomUserId = value.groomUserId;
  if (
    typeof brideUserId !== "string"
    || typeof groomUserId !== "string"
    || !UUID_RE.test(brideUserId)
    || !UUID_RE.test(groomUserId)
    || brideUserId.toLowerCase() === groomUserId.toLowerCase()
  ) return null;
  return hash("md5", `${brideUserId.toLowerCase()}:${groomUserId.toLowerCase()}`);
}

/**
 * Builds recipient-private prompts only from the durable mediation decision
 * receipt. Raw chat, requester summaries, titles, reasoning, and inferred
 * partner state are deliberately outside the output contract.
 */
export function buildMediationDecisionFollowUpCandidates({
  coupleId,
  recipientUserId,
  currentRoster,
  safety,
  decisions,
  now = new Date(),
}: BuildMediationDecisionFollowUpCandidatesInput): MediationDecisionFollowUpCandidate[] {
  const rosterFingerprint = currentRosterFingerprint(currentRoster);
  if (
    !UUID_RE.test(coupleId)
    || !UUID_RE.test(recipientUserId)
    || !rosterFingerprint
    || (
      recipientUserId !== currentRoster.brideUserId
      && recipientUserId !== currentRoster.groomUserId
    )
    || !isClearSafetyContext(safety)
    || !Number.isFinite(now.getTime())
    || !Array.isArray(decisions)
  ) return [];

  const candidates: MediationDecisionFollowUpCandidate[] = [];
  for (const decision of decisions) {
    if (!isRecord(decision) || !isRecord(decision.metadata)) continue;
    const decidedAt = safeTimestamp(decision.decided_at);
    const decisionId = String(decision.id).toLowerCase();
    const messageId = String(decision.source_ref_id).toLowerCase();
    const proposalVersion = String(decision.metadata.proposal_version).toLowerCase();
    const proposalRosterFingerprint = String(
      decision.metadata.roster_fingerprint,
    ).toLowerCase();
    if (
      !UUID_RE.test(decisionId)
      || decision.couple_id !== coupleId
      || decision.category !== "conflict_resolution"
      || decision.decision_type !== "decided"
      || decision.source !== "chat"
      || !UUID_RE.test(messageId)
      || decision.visibility !== "shared"
      || decision.superseded_at !== null
      || decidedAt === null
      || decidedAt > now.getTime()
      || now.getTime() - decidedAt < FOLLOW_UP_DELAY_MS
      || now.getTime() - decidedAt
        >= FOLLOW_UP_DELAY_MS + FOLLOW_UP_RESPONSE_WINDOW_MS
      || decision.metadata.confirmed_by_both !== true
      || decision.metadata.acceptance_count !== 2
      || !UUID_RE.test(proposalVersion)
      || !MD5_RE.test(proposalRosterFingerprint)
      || proposalRosterFingerprint !== rosterFingerprint
    ) continue;

    const eligibleAt = new Date(decidedAt + FOLLOW_UP_DELAY_MS).toISOString();
    candidates.push({
      decisionId,
      sourceKey: `mediation-decision:${decisionId}:recipient:${recipientUserId.toLowerCase()}`,
      sourceStateDigest: hash("sha256", [
        "v1",
        decisionId,
        messageId,
        proposalVersion,
        rosterFingerprint,
        recipientUserId.toLowerCase(),
        eligibleAt,
      ].join("|")),
      kind: "mediation_outcome_follow_up",
      visibility: "private",
      recipientUserId,
      eligibleAt,
      title: MEDIATION_OUTCOME_FOLLOW_UP_COPY.title,
      question: MEDIATION_OUTCOME_FOLLOW_UP_COPY.question,
      confirmed: [...MEDIATION_OUTCOME_FOLLOW_UP_COPY.confirmed],
      unknown: [...MEDIATION_OUTCOME_FOLLOW_UP_COPY.unknown],
      outcomes: MEDIATION_DECISION_FOLLOW_UP_OUTCOMES.map((outcome) => ({ ...outcome })),
      impact: MEDIATION_OUTCOME_FOLLOW_UP_COPY.impact,
      safeguards: {
        automaticSharedMutation: false,
        automaticRemediation: false,
      },
    });
  }
  return candidates;
}
