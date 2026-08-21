/** expo-secure-store와 같은 모양. 이 모듈은 저장소를 직접 import하지 않는다. */
export interface PendingInviteStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface PendingInviteOptions {
  storage?: PendingInviteStorage | null;
  now?: number;
}

export const PENDING_INVITE_TTL_MS: number;
export const PENDING_INVITE_STORAGE_KEY: string;

export function serializePendingInvite(code: string, now: number): string;
export function parsePendingInvite(
  raw: unknown,
  now: number,
  ttlMs?: number,
): string | null;

export function rememberPendingCoupleInviteCode(
  value: unknown,
  options?: PendingInviteOptions,
): Promise<string | null>;
export function consumePendingCoupleInviteCode(
  options?: PendingInviteOptions,
): Promise<string | null>;
export function peekPendingCoupleInviteCode(): string | null;
export function clearPendingCoupleInviteCode(
  options?: PendingInviteOptions,
): Promise<void>;
