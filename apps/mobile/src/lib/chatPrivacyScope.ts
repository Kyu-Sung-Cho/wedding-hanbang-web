export type ChatScope = "shared" | "private";
export type ChatTarget = "ai" | "partner";
export type ChatViewerRole = "bride" | "groom" | null;
export type ChatVisibility = "shared" | "bride_private" | "groom_private";

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
