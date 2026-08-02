export const SERVER_SECRET_MIN_LENGTH: 32;
export const SERVER_SECRET_MAX_LENGTH: 512;

export function isValidServerSecret(value: unknown): value is string;

export function resolveAliasedServerSecret(
  canonicalSecret: string | undefined,
  legacySecret: string | undefined,
): string;
