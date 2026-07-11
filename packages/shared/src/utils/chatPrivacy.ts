export type CoupleRole = "bride" | "groom";
export type ChatVisibility = "shared" | "bride_private" | "groom_private";
export type MobileChatTarget = "ai_shared" | "ai_private" | "partner";

export interface VisibilityScopedMessage {
  visibility?: ChatVisibility | string | null;
  metadata?: { target?: string } | null;
}

export function normalizeChatVisibility(value: unknown): ChatVisibility {
  return value === "bride_private" || value === "groom_private" ? value : "shared";
}

export function privateChatVisibilityForRole(role: CoupleRole): ChatVisibility {
  return role === "groom" ? "groom_private" : "bride_private";
}

export function chatVisibilityForMobileTarget(
  target: MobileChatTarget,
  role: CoupleRole
): ChatVisibility {
  return target === "ai_private" ? privateChatVisibilityForRole(role) : "shared";
}

export function isMessageVisibleForMobileTarget(
  message: VisibilityScopedMessage,
  target: MobileChatTarget,
  role: CoupleRole
): boolean {
  const visibility = normalizeChatVisibility(message.visibility);
  const isPartnerMessage = message.metadata?.target === "partner";

  if (target === "partner") return visibility === "shared" && isPartnerMessage;
  if (target === "ai_private") return visibility === privateChatVisibilityForRole(role);
  return visibility === "shared" && !isPartnerMessage;
}

export function isMessageAllowedInAiContext(
  message: VisibilityScopedMessage,
  visibility: ChatVisibility
): boolean {
  const messageVisibility = normalizeChatVisibility(message.visibility);
  return visibility === "shared"
    ? messageVisibility === "shared"
    : messageVisibility === "shared" || messageVisibility === visibility;
}
