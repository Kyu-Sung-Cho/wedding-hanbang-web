export type FirstChatSkipStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export const FIRST_CHAT_SKIP_KEY_PREFIX: string;
export function firstChatSkipKey(ownerId: unknown): string | null;
export function hasSkippedFirstChat(storage: FirstChatSkipStorage, ownerId: string): Promise<boolean>;
export function rememberFirstChatSkip(storage: FirstChatSkipStorage, ownerId: string, nowMs?: number): Promise<boolean>;
