type OperationKeyFactory = () => string;

export function getOrCreateModerationOperationKey(
  keys: Map<string, string>,
  commandFingerprint: string,
  createKey: OperationKeyFactory = () => crypto.randomUUID(),
) {
  const existing = keys.get(commandFingerprint);
  if (existing) return existing;

  const operationKey = createKey();
  keys.set(commandFingerprint, operationKey);
  return operationKey;
}

export function settleModerationOperationKey(
  keys: Map<string, string>,
  commandFingerprint: string,
  responseStatus: number,
) {
  // A 5xx/503 can be returned after the database committed but before the
  // browser received a verifiable receipt. Preserve identity for an exact retry.
  if (responseStatus >= 500) return;
  keys.delete(commandFingerprint);
}
