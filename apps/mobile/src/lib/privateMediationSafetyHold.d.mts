export type PrivateMediationSafetyHoldOwner = {
  ownerUserId: string;
  coupleId: string;
  nowMs?: number;
};

export function privateMediationSafetyHoldProcessKey(
  ownerUserId: string,
  coupleId: string,
): string | null;
export function privateMediationSafetyHoldDigestInput(
  ownerUserId: string,
  coupleId: string,
): string | null;
export function privateMediationSafetyHoldPersistentKey(digest: string): string | null;
export function createPrivateMediationSafetyHoldRecord(
  input: PrivateMediationSafetyHoldOwner,
): string;
export function classifyPrivateMediationSafetyHoldRecord(
  raw: unknown,
  expected: PrivateMediationSafetyHoldOwner,
): "missing" | "active" | "invalid";
export function parsePrivateMediationSafetyHoldRecord(
  raw: unknown,
  expected: PrivateMediationSafetyHoldOwner,
): boolean;
export function shouldSuppressForPrivateMediationSafetyHold(
  raw: unknown,
  expected: PrivateMediationSafetyHoldOwner,
): boolean;
export function persistPrivateMediationSafetyHoldRecord(
  record: string,
  writers: Array<(record: string) => Promise<unknown>>,
  options?: { timeoutMs?: number },
): Promise<boolean>;
export function readPrivateMediationSafetyHoldStores(
  expected: PrivateMediationSafetyHoldOwner,
  readers: Array<() => Promise<unknown>>,
  options?: { timeoutMs?: number },
): Promise<boolean>;

export type PrivateMediationSafetyHoldRuntimeAdapters = {
  digestSha256: (input: string) => Promise<string>;
  writeSecure: (key: string, value: string) => Promise<unknown>;
  writeJournal: (key: string, value: string) => Promise<unknown>;
  readSecure: (key: string) => Promise<unknown>;
  readJournal: (key: string) => Promise<unknown>;
};

export type PrivateMediationSafetyHoldRuntime = {
  seal: (owner: PrivateMediationSafetyHoldOwner) => Promise<void>;
  has: (owner: PrivateMediationSafetyHoldOwner) => Promise<boolean>;
};

export function createPrivateMediationSafetyHoldRuntime(
  adapters: PrivateMediationSafetyHoldRuntimeAdapters,
  options?: { timeoutMs?: number },
): PrivateMediationSafetyHoldRuntime;
