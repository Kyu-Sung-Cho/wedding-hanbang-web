import type { ExpectedUserApiFetch } from "./communityPostMutations.mjs";

export interface CohortRoomSummary {
  id: string;
  name: string;
  memberCount: number;
}

export type CurrentCohortAccess =
  | { status: "unassigned" }
  | { status: "member" | "different_room"; room: CohortRoomSummary };

export interface CohortIdentityToken {
  generation: number;
  ownerId: string;
}

export interface CohortAssignmentToken extends CohortIdentityToken {
  assignmentId: number;
}

export interface CohortMessageToken extends CohortIdentityToken {
  messageId: number;
}

export interface CommunityCohortGate {
  setOwner(ownerId: string | null): boolean;
  capture(): CohortIdentityToken | null;
  invalidateOperations(): boolean;
  beginAssignment(): CohortAssignmentToken | null;
  isCurrent(token: CohortIdentityToken | CohortAssignmentToken | CohortMessageToken | null): boolean;
  finishAssignment(token: CohortAssignmentToken): boolean;
  beginMessage(): CohortMessageToken | null;
  hasActiveMessage(): boolean;
  finishMessage(token: CohortMessageToken): boolean;
}

export class CommunityCohortAccessError extends Error {
  code: string;
  status: number;
  displayMessage: string;
}

export function createCommunityCohortGate(): CommunityCohortGate;

export function mergeCohortMessageSnapshot<
  T extends { id: string; created_at: string },
>(snapshot: readonly T[], liveMessages: readonly T[]): T[];

export interface CohortMessageIdempotencyStore {
  keyFor(
    ownerId: string,
    roomId: string,
    content: string,
    threadTopic?: "price" | "review" | "concern" | "chat",
  ): string;
  clearIf(key: string): boolean;
  clear(): void;
}

export function createCohortMessageIdempotencyStore(
  createId: () => string,
): CohortMessageIdempotencyStore;

export function parseCurrentCohortAccess(
  value: unknown,
  expectedRoomId: string,
): CurrentCohortAccess;

export function fetchCurrentCohortAccess(input: {
  apiFetchForExpectedUser: ExpectedUserApiFetch;
  ownerId: string;
  roomId: string;
}): Promise<CurrentCohortAccess>;

export function assignCurrentUserToCohort(input: {
  apiFetchForExpectedUser: ExpectedUserApiFetch;
  ownerId: string;
}): Promise<{ roomId: string }>;

export function sendCohortMessage(input: {
  apiFetchForExpectedUser: ExpectedUserApiFetch;
  ownerId: string;
  roomId: string;
  content: string;
  threadTopic?: "price" | "review" | "concern" | "chat";
  idempotencyKey: string;
}): Promise<{
  id: string;
  roomId: string;
  authorId: string;
  content: string;
  topic: "price" | "review" | "concern" | "chat" | null;
  createdAt: string;
}>;

export function fetchCohortMessages(input: {
  apiFetchForExpectedUser: ExpectedUserApiFetch;
  ownerId: string;
  roomId: string;
}): Promise<Array<{
  id: string;
  roomId: string;
  authorId: string | null;
  authorNickname: string | null;
  content: string;
  topic: "price" | "review" | "concern" | "chat" | null;
  createdAt: string;
}>>;
