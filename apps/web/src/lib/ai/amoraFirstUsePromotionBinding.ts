import {
  buildAmoraFirstUseSharedDraft,
  extractAmoraFirstUseActionDraft,
} from "@hanbang/shared/amora-first-use-promotion";

import type { AmoraFirstUseActionProposalBinding } from "@/lib/ai/amoraToolPolicy";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AmoraFirstUsePromotionValidation
  extends AmoraFirstUseActionProposalBinding {
  canonicalActionInput: Readonly<{
    action: string;
    reason: string;
    completionCriterion: string;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

export function isAmoraFirstUseSharedDraftText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const draft = extractAmoraFirstUseActionDraft(value);
  return draft !== null && buildAmoraFirstUseSharedDraft(draft) === value;
}

function matchesCanonicalAddActionInput(
  value: unknown,
  expected: AmoraFirstUseActionProposalBinding["canonicalAddActionInput"],
): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      "title",
      "description",
      "category_key",
      "priority",
      "source",
    ])
    && Object.entries(expected).every(
      ([key, expectedValue]) => value[key] === expectedValue,
    );
}

export function matchesAmoraFirstUsePendingAction(
  value: unknown,
  binding: AmoraFirstUsePromotionValidation | null,
): binding is AmoraFirstUsePromotionValidation {
  return binding !== null
    && isRecord(value)
    && value.tool === "add_amora_action"
    && matchesCanonicalAddActionInput(
      value.input,
      binding.canonicalAddActionInput,
    );
}

export function parseAmoraFirstUsePromotionValidation(input: {
  value: unknown;
  expectedPromotionId: string;
  expectedSharedText: string;
}): AmoraFirstUsePromotionValidation | null {
  if (
    !UUID_RE.test(input.expectedPromotionId)
    || typeof input.expectedSharedText !== "string"
    || !isRecord(input.value)
    || !hasExactKeys(input.value, [
      "version",
      "promotionId",
      "canonicalActionInput",
      "canonicalAddActionInput",
    ])
    || input.value.version !== 1
    || input.value.promotionId !== input.expectedPromotionId
    || !isRecord(input.value.canonicalActionInput)
    || !hasExactKeys(input.value.canonicalActionInput, [
      "action",
      "reason",
      "completionCriterion",
    ])
  ) return null;

  const action = input.value.canonicalActionInput.action;
  const reason = input.value.canonicalActionInput.reason;
  const completionCriterion =
    input.value.canonicalActionInput.completionCriterion;
  if (
    typeof action !== "string"
    || typeof reason !== "string"
    || typeof completionCriterion !== "string"
  ) return null;
  const canonicalActionInput = { action, reason, completionCriterion };
  if (
    buildAmoraFirstUseSharedDraft(canonicalActionInput)
      !== input.expectedSharedText
  ) return null;

  const canonicalAddActionInput = {
    title: action,
    description: `이유: ${reason} 완료 기준: ${completionCriterion}`,
    category_key: "general" as const,
    priority: "medium" as const,
    source: "chat" as const,
  };
  if (!matchesCanonicalAddActionInput(
    input.value.canonicalAddActionInput,
    canonicalAddActionInput,
  )) return null;

  return {
    promotionId: input.expectedPromotionId,
    canonicalActionInput,
    canonicalAddActionInput,
  };
}
