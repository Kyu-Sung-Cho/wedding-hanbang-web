export function canFinishOwnerBoundDeletion({
  expectedOwnerId,
  sessionOwnerId,
  authenticatedOwnerId,
  screenOwnerId,
}) {
  if (typeof expectedOwnerId !== "string" || expectedOwnerId.length === 0) {
    return false;
  }
  return (
    (sessionOwnerId === null || sessionOwnerId === expectedOwnerId)
    && (authenticatedOwnerId === null || authenticatedOwnerId === expectedOwnerId)
    && (screenOwnerId === null || screenOwnerId === expectedOwnerId)
  );
}
