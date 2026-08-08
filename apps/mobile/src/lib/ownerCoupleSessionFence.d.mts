export interface OwnerCoupleSessionToken {
  generation: number;
  ownerId: string;
  coupleId: string;
}

export interface OwnerCoupleSessionFence {
  setOwner(ownerId: string | null): boolean;
  clearCouple(ownerId: string): boolean;
  setIdentity(ownerId: string, coupleId: string): boolean;
  capture(): OwnerCoupleSessionToken | null;
  isCurrent(token: OwnerCoupleSessionToken | null): boolean;
}

export function createOwnerCoupleSessionFence(): OwnerCoupleSessionFence;
