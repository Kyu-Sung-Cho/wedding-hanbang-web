import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { hasAmoraMemoryTurnOptOut } from "@/lib/ai/amoraMemoryTurnOptOut";
import {
  AMORA_MEMORY_MAX_BATCH,
  extractTrustedMomentMemoryKeys,
  prepareAmoraMemoryBatch,
  type MemoryCompilerMessage,
  type PreparedAmoraMemoryBatch,
} from "@/lib/ai/amoraMemoryCompiler";

// One extra row lets a user message in slot 40 prove its provenance through
// the immediately-following canonical assistant reply without advancing the
// durable cursor past the 40-message compiler boundary.
export const AMORA_MEMORY_SOURCE_READ_LIMIT = AMORA_MEMORY_MAX_BATCH + 1;

export type AmoraMemorySourceScopeVisibility =
  | "shared"
  | "bride_private"
  | "groom_private";

export type AmoraMemorySourceScopeRow = {
  id: string;
  sender_id: string | null;
  sender_type: "bride" | "groom" | "ai";
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  visibility: AmoraMemorySourceScopeVisibility;
  created_at: string;
  segment_id?: string | null;
};

export type PreparedTrustedAmoraMemoryBatch = PreparedAmoraMemoryBatch & {
  blockedByUnresolvedSource: boolean;
};

function isMemoryEligibleScope(value: unknown): boolean {
  return value === "W0_wedding_core" || value === "W1_wedding_adjacent";
}

export function hasTrustedAmoraMemoryEligibilityMetadata(
  metadata: Record<string, unknown> | null,
): boolean {
  return metadata?.memory_eligible === true
    && isMemoryEligibleScope(metadata.question_scope);
}

function canonicalAmoraReplySource(
  assistant: AmoraMemorySourceScopeRow,
  rowById: ReadonlyMap<string, AmoraMemorySourceScopeRow>,
): AmoraMemorySourceScopeRow | null {
  if (
    assistant.sender_type !== "ai"
    || assistant.role !== "assistant"
    || assistant.sender_id !== null
    || assistant.metadata?.target === "partner"
  ) {
    return null;
  }
  const sourceId = assistant.metadata?.in_reply_to_user_message_id;
  if (typeof sourceId !== "string") return null;
  const source = rowById.get(sourceId);
  if (
    !source
    || source.role !== "user"
    || source.sender_type === "ai"
    || source.sender_id === null
    || source.metadata?.target === "partner"
    || source.visibility !== assistant.visibility
    || !(
      source.created_at < assistant.created_at
      || (
        source.created_at === assistant.created_at
        && source.id < assistant.id
      )
    )
  ) {
    return null;
  }
  return source;
}

function selectCanonicalAmoraReplySourceIds(
  rows: readonly AmoraMemorySourceScopeRow[],
): ReadonlySet<string> {
  const rowById = new Map(rows.map((row) => [row.id, row] as const));
  const resolved = new Set<string>();
  for (const assistant of rows) {
    const source = canonicalAmoraReplySource(assistant, rowById);
    if (source) resolved.add(source.id);
  }
  return resolved;
}

/**
 * Returns user rows that have both current-classifier and server-authored
 * W0/W1 provenance. The caller may still apply its couple actor boundary.
 */
export function selectTrustedAmoraMemoryUserIds(
  rows: readonly AmoraMemorySourceScopeRow[],
  excludedSourceIds: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
  const rowById = new Map(rows.map((row) => [row.id, row] as const));
  const trusted = new Set<string>();

  for (const assistant of rows) {
    if (!hasTrustedAmoraMemoryEligibilityMetadata(assistant.metadata)) continue;
    const source = canonicalAmoraReplySource(assistant, rowById);
    if (!source || excludedSourceIds.has(source.id) || hasAmoraMemoryTurnOptOut(source.content)) continue;
    const currentScope = classifyAmoraQuestionScope({
      userText: source.content,
    }).scope;
    if (!isMemoryEligibleScope(currentScope)) continue;
    trusted.add(source.id);
  }

  return trusted;
}

function buildTrustedAmoraMemoryCompilerMessagesFromIds(
  rows: readonly AmoraMemorySourceScopeRow[],
  couple: { brideId: string | null; groomId: string | null },
  trustedUserIds: ReadonlySet<string>,
): MemoryCompilerMessage[] {
  return rows.map((row) => {
    const isAssistant = row.sender_type === "ai" || row.role === "assistant";
    const sourceActorRole = isAssistant || !trustedUserIds.has(row.id)
      ? null
      : row.sender_type === "bride" && row.sender_id === couple.brideId
        ? "bride" as const
        : row.sender_type === "groom" && row.sender_id === couple.groomId
          ? "groom" as const
          : null;

    return {
      id: row.id,
      role: isAssistant ? "assistant" : "user",
      content: row.content,
      sourceActorRole,
      trustedMomentMemoryKeys:
        row.sender_type === "ai"
          && row.role === "assistant"
          && row.sender_id === null
          ? extractTrustedMomentMemoryKeys(row.metadata)
          : [],
    };
  });
}

export function buildTrustedAmoraMemoryCompilerMessages(
  rows: readonly AmoraMemorySourceScopeRow[],
  couple: { brideId: string | null; groomId: string | null },
): MemoryCompilerMessage[] {
  return buildTrustedAmoraMemoryCompilerMessagesFromIds(
    rows,
    couple,
    selectTrustedAmoraMemoryUserIds(rows),
  );
}

/**
 * Applies source provenance before the compiler's cursor/input boundary.
 * Every row can advance the cursor, while only verified W0/W1 user rows are
 * exposed as provider evidence.
 */
export function prepareTrustedAmoraMemoryBatch(
  rows: readonly AmoraMemorySourceScopeRow[],
  couple: { brideId: string | null; groomId: string | null },
  excludedSourceIds: ReadonlySet<string> = new Set(),
): PreparedTrustedAmoraMemoryBatch {
  const trustedUserIds = selectTrustedAmoraMemoryUserIds(rows, excludedSourceIds);
  const resolvedUserIds = selectCanonicalAmoraReplySourceIds(rows);
  const unresolvedSourceIndex = rows.findIndex((row) => {
    if (
      row.role !== "user"
      || excludedSourceIds.has(row.id)
      || row.sender_id === null
      || hasAmoraMemoryTurnOptOut(row.content)
      || resolvedUserIds.has(row.id)
      || !(
        (row.sender_type === "bride" && row.sender_id === couple.brideId)
        || (row.sender_type === "groom" && row.sender_id === couple.groomId)
      )
    ) {
      return false;
    }
    return isMemoryEligibleScope(
      classifyAmoraQuestionScope({ userText: row.content }).scope,
    );
  });
  const cursorSafeRows = unresolvedSourceIndex < 0
    ? rows
    : rows.slice(0, unresolvedSourceIndex);
  const batch = prepareAmoraMemoryBatch(
    // A canonical assistant after the unresolved barrier can still prove the
    // provenance of an earlier source inside the contiguous prefix. Reusing
    // the full read-window trust set prevents that earlier source from being
    // cursor-consumed without ever reaching the compiler.
    buildTrustedAmoraMemoryCompilerMessagesFromIds(
      cursorSafeRows,
      couple,
      trustedUserIds,
    ),
  );
  return {
    ...batch,
    blockedByUnresolvedSource: unresolvedSourceIndex >= 0,
  };
}
