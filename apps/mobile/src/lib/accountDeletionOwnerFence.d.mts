export function canFinishOwnerBoundDeletion(input: {
  expectedOwnerId: string;
  sessionOwnerId: string | null;
  authenticatedOwnerId: string | null;
  screenOwnerId: string | null;
}): boolean;
