export interface ScheduleSessionToken {
  generation: number;
  ownerId: string;
  coupleId: string;
}

export interface ScheduleIdentitySnapshot {
  ownerId: string;
  coupleId: string;
  memberIds: readonly string[];
}

export const SCHEDULE_IDENTITY_RECONCILIATION_INTERVAL_MS: number;

export function buildScheduleIdentitySnapshot(input: {
  ownerId: unknown;
  coupleId: unknown;
  roster: {
    id?: unknown;
    bride_id?: unknown;
    groom_id?: unknown;
  } | null;
}): ScheduleIdentitySnapshot | null;

export function isSameScheduleIdentitySnapshot(
  current: ScheduleIdentitySnapshot | null,
  next: ScheduleIdentitySnapshot,
): boolean;

export interface ScheduleSessionFence {
  setOwner(ownerId: string | null): boolean;
  clearCouple(ownerId: string): boolean;
  setIdentity(ownerId: string, coupleId: string): boolean;
  capture(): ScheduleSessionToken | null;
  isCurrent(token: ScheduleSessionToken | null): boolean;
}

export function createScheduleSessionFence(): ScheduleSessionFence;
