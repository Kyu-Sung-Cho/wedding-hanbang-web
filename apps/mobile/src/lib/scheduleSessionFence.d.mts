export interface ScheduleSessionToken {
  generation: number;
  ownerId: string;
  coupleId: string;
}

export interface ScheduleSessionFence {
  setOwner(ownerId: string | null): boolean;
  clearCouple(ownerId: string): boolean;
  setIdentity(ownerId: string, coupleId: string): boolean;
  capture(): ScheduleSessionToken | null;
  isCurrent(token: ScheduleSessionToken | null): boolean;
}

export function createScheduleSessionFence(): ScheduleSessionFence;
