"use client";

const HANDOFF_TTL_MS = 2 * 60 * 1000;
const MAX_CHAT_INPUT_CHARS = 8_000;
const MAX_POST_TITLE_CHARS = 200;
const MAX_POST_BODY_CHARS = 20_000;

type PendingHandoff<T> = {
  expectedUserId: string | null;
  expiresAt: number;
  value: T;
};

export type QuotePostHandoff = {
  category: "is_normal";
  title: string;
  body: string;
};

let pendingChat: PendingHandoff<{ input: string }> | null = null;
let pendingQuotePost: PendingHandoff<QuotePostHandoff> | null = null;

function actorMatches(expectedUserId: string | null, currentUserId: string | null): boolean {
  return expectedUserId === currentUserId;
}

export function stageChatHandoff(input: string, expectedUserId: string | null): void {
  const boundedInput = input.slice(0, MAX_CHAT_INPUT_CHARS);
  pendingChat = boundedInput
    ? { expectedUserId, expiresAt: Date.now() + HANDOFF_TTL_MS, value: { input: boundedInput } }
    : null;
}

export function consumeChatHandoff(currentUserId: string | null): { input: string } | null {
  const pending = pendingChat;
  pendingChat = null;
  if (!pending || pending.expiresAt < Date.now()) return null;
  if (!actorMatches(pending.expectedUserId, currentUserId)) return null;
  return { input: pending.value.input };
}

export function stageQuotePostHandoff(
  value: QuotePostHandoff,
  expectedUserId: string | null,
): void {
  const title = value.title.slice(0, MAX_POST_TITLE_CHARS);
  const body = value.body.slice(0, MAX_POST_BODY_CHARS);
  pendingQuotePost = title || body
    ? {
        expectedUserId,
        expiresAt: Date.now() + HANDOFF_TTL_MS,
        value: { category: "is_normal", title, body },
      }
    : null;
}

export function consumeQuotePostHandoff(currentUserId: string | null): QuotePostHandoff | null {
  const pending = pendingQuotePost;
  pendingQuotePost = null;
  if (!pending || pending.expiresAt < Date.now()) return null;
  if (!actorMatches(pending.expectedUserId, currentUserId)) return null;
  return { ...pending.value };
}

export function clearOneTimeHandoffs(): void {
  pendingChat = null;
  pendingQuotePost = null;
}
