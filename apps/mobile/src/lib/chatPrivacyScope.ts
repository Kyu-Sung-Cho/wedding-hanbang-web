import { compareChatTimestamps } from "@hanbang/shared";

export type ChatScope = "shared" | "private";
export type ChatTarget = "ai" | "partner";
export type ChatViewerRole = "bride" | "groom" | null;
export type ChatVisibility = "shared" | "bride_private" | "groom_private";

export interface ChatViewCursors {
  shared: string | null;
  private: string | null;
}

function readChatCursor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("대화 정리 시점을 확인하지 못했어요.");
  }
  return value;
}

export function readChatViewCursors(profile: unknown): ChatViewCursors {
  if (!profile || typeof profile !== "object") throw new Error("대화 범위를 확인하지 못했어요.");
  return {
    shared: readChatCursor("shared_chat_cleared_at" in profile ? profile.shared_chat_cleared_at : undefined),
    private: readChatCursor("private_chat_cleared_at" in profile ? profile.private_chat_cleared_at : undefined),
  };
}

export function hasChatViewCursorAdvanced(current: ChatViewCursors, next: ChatViewCursors): boolean {
  return (["shared", "private"] as const).some(scope => next[scope] !== null &&
    (current[scope] === null || compareChatTimestamps(next[scope], current[scope]) === 1));
}

export function isMessageAfterChatViewCursor(
  message: { visibility: ChatVisibility; created_at?: string | null },
  cursors: ChatViewCursors,
): boolean {
  const cursor = message.visibility === "shared" ? cursors.shared : cursors.private;
  return cursor === null || (typeof message.created_at === "string" && compareChatTimestamps(message.created_at, cursor) === 1);
}

/** 제한 개수보다 먼저 범위별 정리 경계를 적용한다. 상대의 개인 대화는 조회하지 않는다. */
export function buildChatViewCursorFilter(cursors: ChatViewCursors, viewerRole: ChatViewerRole): string {
  const lane = (visibility: ChatVisibility, cursor: string | null) => cursor
    ? `and(visibility.eq.${visibility},created_at.gt.${cursor})`
    : `visibility.eq.${visibility}`;
  const clauses = [lane("shared", cursors.shared)];
  if (viewerRole) clauses.push(lane(`${viewerRole}_private`, cursors.private));
  return clauses.join(",");
}

export function withChatViewCursor<T extends { gt(column: string, value: string): T }>(query: T, cursor: string | null): T {
  return cursor === null ? query : query.gt("created_at", cursor);
}

export interface ChatScopeSelection {
  scope: ChatScope;
  target: ChatTarget;
}

export type ChatScopeDrafts = Record<ChatScope, string>;

export function updateChatScopeDraft(
  drafts: ChatScopeDrafts,
  scope: ChatScope,
  draft: string,
): ChatScopeDrafts {
  return { ...drafts, [scope]: draft };
}

export function chatVisibilityForScope(
  scope: ChatScope,
  viewerRole: ChatViewerRole,
): ChatVisibility | null {
  if (scope === "shared") return "shared";
  return viewerRole === null ? null : `${viewerRole}_private`;
}

export function isMessageInChatScope(
  visibility: ChatVisibility,
  scope: ChatScope,
  viewerRole: ChatViewerRole,
): boolean {
  const selectedVisibility = chatVisibilityForScope(scope, viewerRole);
  return selectedVisibility !== null && visibility === selectedVisibility;
}

export function isMessageInAiContext(
  visibility: ChatVisibility,
  selectedVisibility: ChatVisibility,
): boolean {
  return selectedVisibility === "shared"
    ? visibility === "shared"
    : visibility === "shared" || visibility === selectedVisibility;
}

export function selectChatScope(
  current: ChatScopeSelection,
  nextScope: ChatScope,
  viewerRole: ChatViewerRole,
): ChatScopeSelection {
  if (nextScope === "private" && viewerRole === null) return current;
  return { scope: nextScope, target: "ai" };
}
