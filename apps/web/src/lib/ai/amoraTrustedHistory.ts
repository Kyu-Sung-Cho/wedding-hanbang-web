import { assessAmoraSafetyText } from "@/lib/ai/amoraCrisisClassifier";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

export type AmoraTrustedHistoryVisibility =
  | "shared"
  | "bride_private"
  | "groom_private";

export type AmoraTrustedHistoryRow = {
  id: unknown;
  sender_id: unknown;
  sender_type: unknown;
  role: unknown;
  content: unknown;
  metadata: unknown;
  visibility: unknown;
};

export type SelectAmoraTrustedHistoryInput<T extends AmoraTrustedHistoryRow> = {
  /** Exact database order after the route reverses its newest-first query. */
  oldestFirstRows: readonly T[];
  currentUserMessageId: string;
  visibility: AmoraTrustedHistoryVisibility;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasAllowedVisibility(
  value: unknown,
  requestVisibility: AmoraTrustedHistoryVisibility,
): value is AmoraTrustedHistoryVisibility {
  return value === "shared"
    || (requestVisibility !== "shared" && value === requestVisibility);
}

function isUserRow(row: AmoraTrustedHistoryRow): boolean {
  return typeof row.id === "string"
    && typeof row.sender_id === "string"
    && (row.sender_type === "bride" || row.sender_type === "groom")
    && row.role === "user"
    && typeof row.content === "string"
    && (
      row.metadata === null
      || (isRecord(row.metadata) && row.metadata.target !== "partner")
    );
}

function isServerAuthoredAssistantFor(
  row: AmoraTrustedHistoryRow,
  userMessageId: string,
): boolean {
  if (
    row.sender_id !== null
    || row.sender_type !== "ai"
    || row.role !== "assistant"
    || typeof row.content !== "string"
    || !isRecord(row.metadata)
    || row.metadata.target === "partner"
  ) {
    return false;
  }

  return row.metadata.in_reply_to_user_message_id === userMessageId
    && (
      row.metadata.question_scope === "W0_wedding_core"
      || row.metadata.question_scope === "W1_wedding_adjacent"
    )
    && row.metadata.memory_eligible === true;
}

function isSafeWeddingHistoryUser(row: AmoraTrustedHistoryRow): boolean {
  if (!isUserRow(row) || typeof row.content !== "string") return false;
  const safetyAssessment = assessAmoraSafetyText(row.content);
  const hasActiveAffirmedDisclosure = safetyAssessment.events.some((event) =>
    event.context === "disclosure"
    && event.polarity === "affirmed"
    && (event.temporality === "current" || event.temporality === "impending")
  );
  if (
    (
      safetyAssessment.resolution !== "no_safety_signal"
      && safetyAssessment.resolution !== "inconclusive"
    )
    || hasActiveAffirmedDisclosure
  ) {
    return false;
  }
  const questionScope = classifyAmoraQuestionScope({ userText: row.content });
  return questionScope.scope === "W0_wedding_core"
    || questionScope.scope === "W1_wedding_adjacent";
}

/**
 * Selects only complete, server-proven, low-risk exchanges plus the exact
 * current bound user row. Every historical ambiguity is intentionally dropped.
 */
export function selectAmoraTrustedHistoryRows<T extends AmoraTrustedHistoryRow>({
  oldestFirstRows,
  currentUserMessageId,
  visibility,
}: SelectAmoraTrustedHistoryInput<T>): T[] {
  const idCounts = new Map<string, number>();
  for (const row of oldestFirstRows) {
    if (typeof row.id !== "string") continue;
    idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);
  }
  const currentIndex = oldestFirstRows.findIndex(
    (row) => row.id === currentUserMessageId,
  );
  if (currentIndex < 0 || idCounts.get(currentUserMessageId) !== 1) return [];

  const trustedRows: T[] = [];
  for (let index = 0; index < currentIndex; index += 1) {
    const userRow = oldestFirstRows[index];
    const assistantRow = oldestFirstRows[index + 1];
    if (
      !userRow
      || !assistantRow
      || !isSafeWeddingHistoryUser(userRow)
      || typeof userRow.id !== "string"
      || typeof assistantRow.id !== "string"
      || idCounts.get(userRow.id) !== 1
      || idCounts.get(assistantRow.id) !== 1
      || !hasAllowedVisibility(userRow.visibility, visibility)
      || assistantRow.visibility !== userRow.visibility
      || !isServerAuthoredAssistantFor(assistantRow, userRow.id)
    ) {
      continue;
    }
    trustedRows.push(userRow, assistantRow);
    index += 1;
  }

  const currentRow = oldestFirstRows[currentIndex];
  if (
    currentRow
    && isUserRow(currentRow)
    && hasAllowedVisibility(currentRow.visibility, visibility)
  ) {
    trustedRows.push(currentRow);
  }
  return trustedRows;
}
