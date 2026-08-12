/**
 * Copies an owner-tagged invite only while the screen and canonical session
 * remain bound to the same account. A late account switch cannot leave the
 * previous account's secret acknowledged or retained in app state.
 */
export async function copyOwnerBoundInviteSecret({
  expectedOwnerId,
  secretOwnerId,
  secret,
  readScreenOwner,
  readAuthenticatedOwner,
  writeText,
  purgeOwnerBoundSecret,
}) {
  if (
    typeof expectedOwnerId !== "string"
    || expectedOwnerId.length === 0
    || secretOwnerId !== expectedOwnerId
    || typeof secret !== "string"
    || secret.length === 0
    || readScreenOwner() !== expectedOwnerId
  ) return false;

  const readCanonicalOwner = async () => {
    try {
      return await readAuthenticatedOwner();
    } catch {
      return null;
    }
  };
  const ownerStillCurrent = (authenticatedOwnerId) => (
    authenticatedOwnerId === expectedOwnerId
    && readScreenOwner() === expectedOwnerId
  );
  const purgeCopiedSecret = async () => {
    try {
      purgeOwnerBoundSecret();
    } catch {
      // Clipboard cleanup must still run if local state cleanup fails.
    }
    try {
      await writeText("");
    } catch {
      // Native clipboard access is best effort; app state is already purged.
    }
  };

  if (!ownerStillCurrent(await readCanonicalOwner())) return false;

  try {
    await writeText(secret);
  } catch (error) {
    if (!ownerStillCurrent(await readCanonicalOwner())) {
      await purgeCopiedSecret();
      return false;
    }
    throw error;
  }

  if (!ownerStillCurrent(await readCanonicalOwner())) {
    await purgeCopiedSecret();
    return false;
  }
  return true;
}
