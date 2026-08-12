export type OwnerBoundInviteSecretCopyInput = Readonly<{
  expectedOwnerId: string;
  secretOwnerId: string | null;
  secret: string | null;
  readScreenOwner: () => string | null;
  readAuthenticatedOwner: () => Promise<string | null>;
  writeText: (value: string) => Promise<void>;
  purgeOwnerBoundSecret: () => void;
}>;

export function copyOwnerBoundInviteSecret(
  input: OwnerBoundInviteSecretCopyInput,
): Promise<boolean>;
