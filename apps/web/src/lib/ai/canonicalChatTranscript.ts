export type CanonicalChatVisibility = "shared" | "bride_private" | "groom_private";
export type CanonicalCoupleRole = "bride" | "groom";

export interface CanonicalChatRow {
  id?: unknown;
  couple_id?: unknown;
  sender_id?: unknown;
  sender_type?: unknown;
  sender_role?: unknown;
  role?: unknown;
  content?: unknown;
  metadata?: unknown;
  visibility?: unknown;
  created_at?: unknown;
}

export interface CanonicalTranscriptMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
}

export type CanonicalChatTranscriptErrorCode =
  | "current_message_not_found"
  | "current_message_not_owned"
  | "current_message_visibility_mismatch"
  | "current_message_is_partner_only"
  | "current_message_before_clear"
  | "current_message_invalid"
  | "current_message_too_large";

export class CanonicalChatTranscriptError extends Error {
  constructor(readonly code: CanonicalChatTranscriptErrorCode) {
    super(code);
    this.name = "CanonicalChatTranscriptError";
  }
}

interface BuildCanonicalChatTranscriptInput {
  rows: readonly CanonicalChatRow[];
  coupleId: string;
  currentUserId: string;
  currentUserRole: CanonicalCoupleRole;
  brideId: string | null;
  groomId: string | null;
  visibility: CanonicalChatVisibility;
  currentUserMessageId: string;
  sharedClearedAt: string | null;
  privateClearedAt: string | null;
  maxMessages: number;
  maxSingleMessageChars: number;
  maxTotalMessageChars: number;
}

interface TrustedRow {
  id: string;
  role: "user" | "assistant";
  senderRole: CanonicalCoupleRole | "ai";
  content: string;
  visibility: CanonicalChatVisibility;
  createdAt: string;
  createdAtMs: number;
  partnerOnly: boolean;
  senderId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactVisibility(value: unknown): CanonicalChatVisibility | null {
  return value === "shared" || value === "bride_private" || value === "groom_private"
    ? value
    : null;
}

function senderRole(row: CanonicalChatRow): CanonicalCoupleRole | "ai" | null {
  const senderType = row.sender_type;
  const legacySenderRole = row.sender_role;
  const validType = senderType === "bride" || senderType === "groom" || senderType === "ai"
    ? senderType
    : null;
  const validLegacy = legacySenderRole === "bride" || legacySenderRole === "groom" || legacySenderRole === "ai"
    ? legacySenderRole
    : null;
  if (validType && validLegacy && validType !== validLegacy) return null;
  return validType ?? validLegacy;
}

function parseTrustedRow(
  row: CanonicalChatRow,
  input: BuildCanonicalChatTranscriptInput
): TrustedRow | null {
  if (
    typeof row.id !== "string"
    || row.couple_id !== input.coupleId
    || typeof row.content !== "string"
    || row.content.length === 0
    || typeof row.created_at !== "string"
  ) return null;

  const visibility = exactVisibility(row.visibility);
  const normalizedSenderRole = senderRole(row);
  const createdAtMs = Date.parse(row.created_at);
  if (!visibility || !normalizedSenderRole || !Number.isFinite(createdAtMs)) return null;

  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const partnerOnly = metadata.target === "partner";
  const rawSenderId = typeof row.sender_id === "string" ? row.sender_id : null;

  if (row.role === "assistant" && normalizedSenderRole === "ai" && rawSenderId === null) {
    return {
      id: row.id,
      role: "assistant",
      senderRole: "ai",
      content: row.content,
      visibility,
      createdAt: row.created_at,
      createdAtMs,
      partnerOnly,
      senderId: null,
    };
  }

  if (row.role !== "user" || normalizedSenderRole === "ai" || !rawSenderId) return null;
  const expectedSenderId = normalizedSenderRole === "bride" ? input.brideId : input.groomId;
  if (!expectedSenderId || rawSenderId !== expectedSenderId) return null;

  return {
    id: row.id,
    role: "user",
    senderRole: normalizedSenderRole,
    content: row.content,
    visibility,
    createdAt: row.created_at,
    createdAtMs,
    partnerOnly,
    senderId: rawSenderId,
  };
}

function isAfterFence(row: TrustedRow, input: BuildCanonicalChatTranscriptInput): boolean {
  const rawFence = row.visibility === "shared"
    ? input.sharedClearedAt
    : input.privateClearedAt;
  if (!rawFence) return true;
  const fence = Date.parse(rawFence);
  return Number.isFinite(fence) && row.createdAtMs > fence;
}

function isVisibleInContext(row: TrustedRow, visibility: CanonicalChatVisibility): boolean {
  if (row.partnerOnly) return false;
  return visibility === "shared"
    ? row.visibility === "shared"
    : row.visibility === "shared" || row.visibility === visibility;
}

function formatMessage(row: TrustedRow): CanonicalTranscriptMessage {
  if (row.role === "assistant") {
    return { role: "assistant", content: row.content, id: row.id };
  }
  const label = row.senderRole === "bride" ? "신부" : "신랑";
  return { role: "user", content: `[${label}] ${row.content}`, id: row.id };
}

/**
 * Builds model context exclusively from server-loaded rows. The client request
 * transcript is intentionally absent from this interface, so stale or forged
 * browser state cannot influence model context, tool selection, or memory work.
 */
export function buildCanonicalChatTranscript(
  input: BuildCanonicalChatTranscriptInput
): { messages: CanonicalTranscriptMessage[]; currentUserText: string } {
  const rawCurrent = input.rows.find((row) => row.id === input.currentUserMessageId);
  if (!rawCurrent) throw new CanonicalChatTranscriptError("current_message_not_found");

  const current = parseTrustedRow(rawCurrent, input);
  if (!current || current.role !== "user" || current.senderId !== input.currentUserId
    || current.senderRole !== input.currentUserRole) {
    throw new CanonicalChatTranscriptError("current_message_not_owned");
  }
  if (current.visibility !== input.visibility) {
    throw new CanonicalChatTranscriptError("current_message_visibility_mismatch");
  }
  if (current.partnerOnly) {
    throw new CanonicalChatTranscriptError("current_message_is_partner_only");
  }
  if (!isAfterFence(current, input)) {
    throw new CanonicalChatTranscriptError("current_message_before_clear");
  }
  if (current.content.length > input.maxSingleMessageChars) {
    throw new CanonicalChatTranscriptError("current_message_too_large");
  }

  const byId = new Map<string, TrustedRow>();
  for (const rawRow of input.rows) {
    const trusted = parseTrustedRow(rawRow, input);
    if (!trusted || trusted.createdAtMs > current.createdAtMs) continue;
    if (trusted.createdAtMs === current.createdAtMs && trusted.id !== current.id) continue;
    if (!isVisibleInContext(trusted, input.visibility) || !isAfterFence(trusted, input)) continue;
    if (trusted.content.length > input.maxSingleMessageChars) continue;
    byId.set(trusted.id, trusted);
  }

  const ordered = [...byId.values()].sort((a, b) => {
    const timeOrder = a.createdAtMs - b.createdAtMs;
    return timeOrder || a.id.localeCompare(b.id);
  });
  if (ordered.at(-1)?.id !== current.id) {
    throw new CanonicalChatTranscriptError("current_message_invalid");
  }

  const bounded: TrustedRow[] = [];
  let totalChars = 0;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const candidate = ordered[index];
    if (bounded.length >= input.maxMessages) break;
    if (totalChars + candidate.content.length > input.maxTotalMessageChars) continue;
    bounded.unshift(candidate);
    totalChars += candidate.content.length;
  }
  if (bounded.at(-1)?.id !== current.id) {
    throw new CanonicalChatTranscriptError("current_message_invalid");
  }

  return {
    messages: bounded.map(formatMessage),
    currentUserText: current.content,
  };
}
