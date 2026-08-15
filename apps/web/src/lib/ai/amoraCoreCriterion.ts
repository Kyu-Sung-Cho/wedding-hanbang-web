import { normalizeAmoraCoreCriterionText } from "@hanbang/shared/amora-core-criterion";

type PrivateVisibility = "bride_private" | "groom_private";

type SelectCurrentAmoraCoreCriterionInput = {
  expectedOwnerUserId: string;
  expectedVisibility: PrivateVisibility;
  newestFirstRows: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function withoutAmoraCoreCriterionReceipts<T>(rows: T[]): T[] {
  return rows.filter((candidate) => !(
    isRecord(candidate)
    && isRecord(candidate.metadata)
    && (
      candidate.metadata.criterion_contract === "amora_core_criterion_v1"
      || candidate.metadata.criterion_contract === "amora_couple_core_criterion_v1"
    )
  ));
}

type SelectCurrentAmoraCoupleCriterionInput = {
  expectedCoupleId: string;
  expectedBrideUserId: string;
  expectedGroomUserId: string;
  newestFirstRows: unknown[];
};

export type CurrentAmoraCoupleCriterionSnapshot = Readonly<{
  decisionId: string;
  value: string;
  confirmedAt: string;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/**
 * Projects only a shared criterion explicitly confirmed by both exact current
 * roster members. Pending proposals never enter decision_nodes and therefore
 * can never become model context through this boundary.
 */
export function selectCurrentAmoraCoupleCriterion(
  input: SelectCurrentAmoraCoupleCriterionInput,
): string | null {
  return selectCurrentAmoraCoupleCriterionSnapshot(input)?.value ?? null;
}

export function selectCurrentAmoraCoupleCriterionSnapshot(
  input: SelectCurrentAmoraCoupleCriterionInput,
): CurrentAmoraCoupleCriterionSnapshot | null {
  for (const candidate of input.newestFirstRows) {
    if (!isRecord(candidate) || !isRecord(candidate.metadata)) continue;
    const metadata = candidate.metadata;
    if (
      candidate.couple_id !== input.expectedCoupleId
      || candidate.category !== "preference"
      || candidate.decision_type !== "decided"
      || candidate.source !== "manual"
      || candidate.visibility !== "shared"
      || candidate.source_actor_role !== null
      || metadata.criterion_contract !== "amora_couple_core_criterion_v1"
      || metadata.criterion_version !== 1
      || metadata.bride_user_id !== input.expectedBrideUserId
      || metadata.groom_user_id !== input.expectedGroomUserId
      || metadata.acceptance_count !== 2
      || metadata.explicit !== true
    ) continue;

    if (!isRecord(candidate.chosen_value)) return null;
    const decisionId = normalizeUuid(candidate.id);
    const value = normalizeAmoraCoreCriterionText(candidate.chosen_value.value);
    const confirmedAt = normalizeIsoTimestamp(candidate.created_at);
    if (!decisionId || !value || !confirmedAt) return null;
    return Object.freeze({ decisionId, value, confirmedAt });
  }
  return null;
}

/**
 * Projects the latest explicit owner-private criterion receipt. The input must
 * already be ordered newest-first. A matching tombstone or corrupt latest
 * receipt is terminal so an older preference can never be resurrected.
 */
export function selectCurrentAmoraCoreCriterion(
  input: SelectCurrentAmoraCoreCriterionInput,
): string | null {
  for (const candidate of input.newestFirstRows) {
    if (!isRecord(candidate) || !isRecord(candidate.metadata)) continue;
    const metadata = candidate.metadata;
    if (
      candidate.category !== "preference"
      || candidate.decision_type !== "considering"
      || candidate.source !== "manual"
      || candidate.visibility !== input.expectedVisibility
      || metadata.criterion_contract !== "amora_core_criterion_v1"
      || metadata.criterion_version !== 1
      || metadata.owner_user_id !== input.expectedOwnerUserId
      || metadata.explicit !== true
    ) continue;

    if (metadata.criterion_deleted === true) return null;
    if (metadata.criterion_deleted !== false || !isRecord(candidate.chosen_value)) {
      return null;
    }
    return normalizeAmoraCoreCriterionText(candidate.chosen_value.value);
  }
  return null;
}
