import { createHash } from "node:crypto";
import { guardAmoraFirstUseActionClaim } from "@hanbang/shared/amora-first-use-action-claim";
import {
  buildAmoraFirstUseSharedDraft,
  extractAmoraFirstUseActionDraft,
} from "@hanbang/shared/amora-first-use-promotion";

import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MD5_RE = /^[0-9a-f]{32}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface AmoraFirstUsePromotionSourceSeal {
  canonicalActionInput: Readonly<{
    action: string;
    reason: string;
    completionCriterion: string;
  }>;
  canonicalAddActionInput: Readonly<{
    title: string;
    description: string;
    category_key: "general";
    priority: "medium";
    source: "chat";
  }>;
  canonicalSharedText: string;
  metadata: Readonly<{
    version: 1;
    sourceContentDigest: string;
    journeyRevision: number;
    privacyEpoch: number;
    rosterFingerprint: string;
    criterionDecisionId: string | null;
    canonicalActionInput: Readonly<{
      action: string;
      reason: string;
      completionCriterion: string;
    }>;
    actionDigest: string;
    sharedContentDigest: string;
  }>;
}

export function buildAmoraFirstUsePromotionSourceSeal(input: {
  content: string;
  grounding: unknown;
  sourceRevision: number;
  criterionDecisionId: string | null;
  privacyEpoch: number;
  rosterFingerprint: string;
}): AmoraFirstUsePromotionSourceSeal | null {
  if (
    typeof input.content !== "string"
    || !Number.isSafeInteger(input.sourceRevision)
    || input.sourceRevision < 0
    || !Number.isSafeInteger(input.privacyEpoch)
    || input.privacyEpoch < 1
    || !MD5_RE.test(input.rosterFingerprint)
    || (input.criterionDecisionId !== null && !UUID_RE.test(input.criterionDecisionId))
    || typeof input.grounding !== "object"
    || input.grounding === null
    || Array.isArray(input.grounding)
    || (input.grounding as { sourceRevision?: unknown }).sourceRevision !== input.sourceRevision
  ) return null;

  const providerDraft = extractAmoraFirstUseActionDraft(input.content);
  if (!providerDraft) return null;
  const guardedDraft = guardAmoraFirstUseActionClaim({
    ...providerDraft,
    grounding: input.grounding,
  });
  if (!guardedDraft) return null;
  const canonicalSharedText = buildAmoraFirstUseSharedDraft(guardedDraft);
  if (!canonicalSharedText) return null;

  const canonicalActionInput = Object.freeze({
    action: guardedDraft.action,
    reason: guardedDraft.reason,
    completionCriterion: guardedDraft.completionCriterion,
  });
  const canonicalAddActionInput = Object.freeze({
    title: guardedDraft.action,
    description: `이유: ${guardedDraft.reason} 완료 기준: ${guardedDraft.completionCriterion}`,
    category_key: "general" as const,
    priority: "medium" as const,
    source: "chat" as const,
  });
  const actionIdentity = getAmoraToolOperationIdentity(
    "add_amora_action",
    canonicalAddActionInput,
  );
  const metadata = Object.freeze({
    version: 1 as const,
    sourceContentDigest: sha256(input.content),
    journeyRevision: input.sourceRevision,
    privacyEpoch: input.privacyEpoch,
    rosterFingerprint: input.rosterFingerprint,
    criterionDecisionId: input.criterionDecisionId,
    canonicalActionInput,
    actionDigest: actionIdentity.inputDigest,
    sharedContentDigest: sha256(canonicalSharedText),
  });
  return Object.freeze({
    canonicalActionInput,
    canonicalAddActionInput,
    canonicalSharedText,
    metadata,
  });
}

export function parseAmoraFirstUsePromotionSourceSeal(input: {
  content: string;
  value: unknown;
}): AmoraFirstUsePromotionSourceSeal | null {
  if (
    typeof input.content !== "string"
    || !isRecord(input.value)
    || !hasExactKeys(input.value, [
      "version",
      "sourceContentDigest",
      "journeyRevision",
      "privacyEpoch",
      "rosterFingerprint",
      "criterionDecisionId",
      "canonicalActionInput",
      "actionDigest",
      "sharedContentDigest",
    ])
    || input.value.version !== 1
    || typeof input.value.sourceContentDigest !== "string"
    || !SHA256_RE.test(input.value.sourceContentDigest)
    || input.value.sourceContentDigest !== sha256(input.content)
    || !Number.isSafeInteger(input.value.journeyRevision)
    || (input.value.journeyRevision as number) < 0
    || !Number.isSafeInteger(input.value.privacyEpoch)
    || (input.value.privacyEpoch as number) < 1
    || typeof input.value.rosterFingerprint !== "string"
    || !MD5_RE.test(input.value.rosterFingerprint)
    || (
      input.value.criterionDecisionId !== null
      && (
        typeof input.value.criterionDecisionId !== "string"
        || !UUID_RE.test(input.value.criterionDecisionId)
      )
    )
    || typeof input.value.actionDigest !== "string"
    || !SHA256_RE.test(input.value.actionDigest)
    || typeof input.value.sharedContentDigest !== "string"
    || !SHA256_RE.test(input.value.sharedContentDigest)
    || !isRecord(input.value.canonicalActionInput)
    || !hasExactKeys(input.value.canonicalActionInput, [
      "action",
      "reason",
      "completionCriterion",
    ])
    || typeof input.value.canonicalActionInput.action !== "string"
    || typeof input.value.canonicalActionInput.reason !== "string"
    || typeof input.value.canonicalActionInput.completionCriterion !== "string"
  ) return null;

  const canonicalSharedText = buildAmoraFirstUseSharedDraft({
    action: input.value.canonicalActionInput.action,
    reason: input.value.canonicalActionInput.reason,
    completionCriterion: input.value.canonicalActionInput.completionCriterion,
  });
  if (!canonicalSharedText || sha256(canonicalSharedText) !== input.value.sharedContentDigest) {
    return null;
  }
  const canonicalActionInput = Object.freeze({
    action: input.value.canonicalActionInput.action,
    reason: input.value.canonicalActionInput.reason,
    completionCriterion: input.value.canonicalActionInput.completionCriterion,
  });
  const canonicalAddActionInput = Object.freeze({
    title: canonicalActionInput.action,
    description: `이유: ${canonicalActionInput.reason} 완료 기준: ${canonicalActionInput.completionCriterion}`,
    category_key: "general" as const,
    priority: "medium" as const,
    source: "chat" as const,
  });
  const identity = getAmoraToolOperationIdentity(
    "add_amora_action",
    canonicalAddActionInput,
  );
  if (identity.inputDigest !== input.value.actionDigest) return null;

  const metadata = Object.freeze({
    version: 1 as const,
    sourceContentDigest: input.value.sourceContentDigest,
    journeyRevision: input.value.journeyRevision as number,
    privacyEpoch: input.value.privacyEpoch as number,
    rosterFingerprint: input.value.rosterFingerprint,
    criterionDecisionId: input.value.criterionDecisionId as string | null,
    canonicalActionInput,
    actionDigest: input.value.actionDigest,
    sharedContentDigest: input.value.sharedContentDigest,
  });
  return Object.freeze({
    canonicalActionInput,
    canonicalAddActionInput,
    canonicalSharedText,
    metadata,
  });
}
