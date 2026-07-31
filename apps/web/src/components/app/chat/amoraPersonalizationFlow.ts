import type { ChatMessage } from "@/types/database.types";
import {
  AMORA_QUICK_START_OPTIONS,
  type AmoraQuickStartOption,
} from "@/lib/amora/personalization";

const AMORA_PERSONALIZATION_PENDING_STORAGE_PREFIX =
  "amora-personalization-pending:v1";

export type PendingAmoraPersonalizationChoice = {
  option: AmoraQuickStartOption;
  existingUserMessageIds: readonly string[];
  ownerUserId: string;
  coupleId: string;
};

export type AmoraPersonalizationReplyResolution = {
  state: "waiting" | "ready" | "stale";
  replyMessageId: string | null;
};

function findQuickStartOption(
  mode: unknown,
): AmoraQuickStartOption | null {
  if (typeof mode !== "string") return null;
  return (
    AMORA_QUICK_START_OPTIONS.find((option) => option.mode === mode) ?? null
  );
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function amoraPersonalizationPendingStorageKey(
  currentUserId: string,
  coupleId: string,
): string {
  return `${AMORA_PERSONALIZATION_PENDING_STORAGE_PREFIX}:${encodeURIComponent(
    currentUserId,
  )}:${encodeURIComponent(coupleId)}`;
}

export function rememberPendingAmoraPersonalizationChoice(input: {
  currentUserId: string;
  coupleId: string;
  option: AmoraQuickStartOption;
  existingUserMessageIds: readonly string[];
}): PendingAmoraPersonalizationChoice | null {
  const canonicalOption = findQuickStartOption(input.option.mode);
  if (!input.currentUserId || !input.coupleId || !canonicalOption) return null;

  const pending: PendingAmoraPersonalizationChoice = {
    option: canonicalOption,
    existingUserMessageIds: [...input.existingUserMessageIds],
    ownerUserId: input.currentUserId,
    coupleId: input.coupleId,
  };
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.setItem(
        amoraPersonalizationPendingStorageKey(
          input.currentUserId,
          input.coupleId,
        ),
        canonicalOption.mode,
      );
    } catch {
      // The current screen can continue safely even when session storage is blocked.
    }
  }
  return pending;
}

export function readPendingAmoraPersonalizationChoice(
  currentUserId: string,
  coupleId: string,
): PendingAmoraPersonalizationChoice | null {
  if (!currentUserId || !coupleId) return null;
  const storage = getSessionStorage();
  if (!storage) return null;
  const key = amoraPersonalizationPendingStorageKey(currentUserId, coupleId);

  try {
    const rawMode = storage.getItem(key);
    if (rawMode === null) return null;
    const option = findQuickStartOption(rawMode);
    if (!option) {
      storage.removeItem(key);
      return null;
    }
    return {
      option,
      existingUserMessageIds: [],
      ownerUserId: currentUserId,
      coupleId,
    };
  } catch {
    return null;
  }
}

export function clearPendingAmoraPersonalizationChoice(
  currentUserId: string,
  coupleId: string,
): void {
  if (!currentUserId || !coupleId) return;
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(
      amoraPersonalizationPendingStorageKey(currentUserId, coupleId),
    );
  } catch {
    // Failing closed means no recovered confirmation is shown from unreadable storage.
  }
}

export function shouldOfferAmoraQuickStart(input: {
  enabled: boolean;
  status: "idle" | "loading" | "ready" | "error";
  hasSavedProfile: boolean;
  hasPendingChoice: boolean;
  busy: boolean;
  activeTab: "shared" | "private";
  currentUserId: string | null;
  messages: readonly ChatMessage[];
}): boolean {
  if (
    !input.enabled ||
    input.status !== "ready" ||
    input.hasSavedProfile ||
    input.hasPendingChoice ||
    input.busy ||
    input.activeTab !== "shared" ||
    !input.currentUserId
  ) {
    return false;
  }

  const hasSharedGreeting = input.messages.some(
    (message) =>
      message.visibility === "shared" && message.sender_role === "ai",
  );
  if (!hasSharedGreeting) return false;

  return !input.messages.some(
    (message) =>
      message.sender_id === input.currentUserId &&
      message.sender_role !== "ai" &&
      message.metadata?.target !== "partner",
  );
}

export function findAmoraPersonalizationReplyId(
  messages: readonly ChatMessage[],
  currentUserId: string | null,
  coupleId: string | null,
  pending: PendingAmoraPersonalizationChoice | null,
): string | null {
  return resolveAmoraPersonalizationReply(
    messages,
    currentUserId,
    coupleId,
    pending,
  ).replyMessageId;
}

export function resolveAmoraPersonalizationReply(
  messages: readonly ChatMessage[],
  currentUserId: string | null,
  coupleId: string | null,
  pending: PendingAmoraPersonalizationChoice | null,
): AmoraPersonalizationReplyResolution {
  if (!currentUserId || !coupleId || !pending) {
    return { state: "waiting", replyMessageId: null };
  }
  if (
    pending.ownerUserId !== currentUserId ||
    pending.coupleId !== coupleId
  ) {
    return { state: "stale", replyMessageId: null };
  }

  const canonicalOption = findQuickStartOption(pending.option.mode);
  if (!canonicalOption) {
    return { state: "stale", replyMessageId: null };
  }
  const priorIds = new Set(pending.existingUserMessageIds);
  let userMessageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.couple_id === coupleId &&
      message.visibility === "shared" &&
      message.sender_id === currentUserId &&
      message.sender_role !== "ai" &&
      message.metadata?.target === "ai" &&
      message.content === canonicalOption.message &&
      !priorIds.has(message.id)
    ) {
      userMessageIndex = index;
      break;
    }
  }

  if (userMessageIndex < 0) {
    const hasUnexpectedOwnAmoraTurn = messages.some(
      (message) =>
        message.couple_id === coupleId &&
        message.visibility === "shared" &&
        message.sender_id === currentUserId &&
        message.sender_role !== "ai" &&
        message.metadata?.target === "ai" &&
        !priorIds.has(message.id),
    );
    return {
      state: hasUnexpectedOwnAmoraTurn ? "stale" : "waiting",
      replyMessageId: null,
    };
  }

  const userMessage = messages[userMessageIndex];
  const laterMessages = messages.slice(userMessageIndex + 1);
  const hasNewerAmoraTurn = laterMessages.some(
    (message) =>
      message.couple_id === coupleId &&
      message.visibility === "shared" &&
      message.sender_role !== "ai" &&
      message.metadata?.target === "ai",
  );
  if (hasNewerAmoraTurn) {
    return { state: "stale", replyMessageId: null };
  }

  const reply = laterMessages.find(
    (message) =>
      message.couple_id === coupleId &&
      message.visibility === "shared" &&
      message.sender_role === "ai" &&
      message.metadata?.in_reply_to_user_message_id === userMessage.id,
  );
  return reply
    ? { state: "ready", replyMessageId: reply.id }
    : { state: "waiting", replyMessageId: null };
}
