import type { PersonalAction, PersonalActionDraft } from '@hanbang/shared/amora-personal-actions';
export type PersonalActionsState = {
  ownerId: string | null; actions: PersonalAction[]; count: number; nextCursor: string | null;
  loading: boolean; busyIds: string[]; error: string | null; writeError: string | null;
};
export type PersonalActionsSession = {
  getState(): PersonalActionsState;
  subscribe(listener: () => void): () => void;
  setOwner(owner: string | null): void;
  dispose(): void;
  load(cursor?: string): Promise<boolean>;
  save(sourceMessageId: string, expectedCoupleId: string, draft: PersonalActionDraft, requestId: string): Promise<PersonalAction | true | null>;
  update(action: PersonalAction): Promise<PersonalAction | true | null>;
  remove(action: PersonalAction): Promise<PersonalAction | true | null>;
};
export function createPersonalActionsSession(request: (owner: string, path: string, options: RequestInit) => Promise<Response>, initialOwnerId?: string | null): PersonalActionsSession;
