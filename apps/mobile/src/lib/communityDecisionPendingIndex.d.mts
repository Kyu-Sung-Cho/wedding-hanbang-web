export type CommunityDecisionMutationIndex = {
  version: 1;
  ownerId: string;
  questionIds: string[];
};

export const COMMUNITY_DECISION_PENDING_KEY_PREFIX: string;
export const COMMUNITY_DECISION_DRAFT_KEY_PREFIX: string;
export const COMMUNITY_DECISION_MUTATION_KEY_PREFIX: string;
export const COMMUNITY_DECISION_MUTATION_INDEX_KEY_PREFIX: string;
export const COMMUNITY_DECISION_MUTATION_INDEX_BACKUP_KEY_PREFIX: string;

export function resolveCommunityDecisionMutationIndexCopies(
  primaryRaw: string | null,
  backupRaw: string | null,
  ownerId: string,
):
  | {
      ok: true;
      index: CommunityDecisionMutationIndex;
      needsRepair: boolean;
    }
  | { ok: false; reason: "owner_invalid" | "corrupt" };

export function communityDecisionPendingKey(ownerId: string): string;
export function communityDecisionDraftKey(ownerId: string): string;
export function communityDecisionMutationKey(
  ownerId: string,
  questionId: string,
): string;
export function communityDecisionMutationIndexKey(ownerId: string): string;
export function communityDecisionMutationIndexBackupKey(ownerId: string): string;
export function buildCommunityDecisionOwnerPurgeKeys(
  ownerId: string,
  index: CommunityDecisionMutationIndex,
): string[];
export function appendCommunityDecisionMutationIndex(
  index: CommunityDecisionMutationIndex,
  questionId: string,
): CommunityDecisionMutationIndex;
export function purgeCommunityDecisionOwnerKeys(
  ownerId: string,
  index: CommunityDecisionMutationIndex,
  deleteKey: (key: string) => Promise<unknown>,
): Promise<void>;
