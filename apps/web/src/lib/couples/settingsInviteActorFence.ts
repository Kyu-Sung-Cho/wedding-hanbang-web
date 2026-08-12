import {
  resolveCoupleConnectionState,
  type CoupleConnectionState,
} from "@hanbang/shared";

export function selectOwnerBoundCoupleConnection(
  connection: CoupleConnectionState,
  connectionOwnerId: string | null,
  currentSettingsOwnerId: string | null,
): CoupleConnectionState {
  return currentSettingsOwnerId !== null
    && connectionOwnerId === currentSettingsOwnerId
    ? connection
    : resolveCoupleConnectionState(null);
}

export async function copyOwnerBoundInviteCode({
  connectionOwnerId,
  inviteCode,
  readCurrentSettingsOwner,
  readAuthenticatedOwner,
  writeText,
  purgeOwnerBoundSecret,
}: {
  connectionOwnerId: string | null;
  inviteCode: string | null;
  readCurrentSettingsOwner: () => string | null;
  readAuthenticatedOwner: () => Promise<string | null>;
  writeText: (value: string) => Promise<void>;
  purgeOwnerBoundSecret: () => void;
}): Promise<boolean> {
  const expectedOwnerId = readCurrentSettingsOwner();
  if (
    !expectedOwnerId
    || connectionOwnerId !== expectedOwnerId
    || !inviteCode
  ) return false;

  const readCanonicalOwner = async () => {
    if (expectedOwnerId === "demo") return "demo";
    try {
      return await readAuthenticatedOwner();
    } catch {
      return null;
    }
  };
  const ownerStillCurrent = (authenticatedOwnerId: string | null) => (
    authenticatedOwnerId === expectedOwnerId
    && readCurrentSettingsOwner() === expectedOwnerId
  );
  const purgeCopiedSecret = async () => {
    try {
      purgeOwnerBoundSecret();
    } catch {
      // State cleanup is best effort, but must not prevent clipboard cleanup.
    }
    try {
      await writeText("");
    } catch {
      // Clipboard APIs may deny writes; the owner-bound UI is already purged.
    }
  };

  const authenticatedOwnerId = await readCanonicalOwner();
  if (
    !ownerStillCurrent(authenticatedOwnerId)
  ) return false;

  try {
    await writeText(inviteCode);
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
