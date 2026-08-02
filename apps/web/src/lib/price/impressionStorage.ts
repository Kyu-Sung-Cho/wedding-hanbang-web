type ImpressionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
  & Partial<Pick<Storage, "key" | "length">>;

const LEGACY_PRICE_IMPRESSION_PREFIX = "hb-price-impression:";
const PRICE_IMPRESSION_PREFIX = `${LEGACY_PRICE_IMPRESSION_PREFIX}v2:`;

function browserSessionStorage(): ImpressionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function priceImpressionStorageKey(actorKey: string, vendorId: string): string {
  if (!actorKey || !vendorId) throw new Error("PRICE_IMPRESSION_SCOPE_REQUIRED");
  return `${PRICE_IMPRESSION_PREFIX}${encodeURIComponent(actorKey)}:${encodeURIComponent(vendorId)}`;
}

export function hasPriceImpression(
  actorKey: string,
  vendorId: string,
  storage: ImpressionStorage | null = browserSessionStorage(),
): boolean {
  try {
    // Account-unbound keys from earlier releases are never trusted.
    storage?.removeItem(`${LEGACY_PRICE_IMPRESSION_PREFIX}${vendorId}`);
    return storage?.getItem(priceImpressionStorageKey(actorKey, vendorId)) === "1";
  } catch {
    return false;
  }
}

export function markPriceImpression(
  actorKey: string,
  vendorId: string,
  storage: ImpressionStorage | null = browserSessionStorage(),
): void {
  try {
    storage?.setItem(priceImpressionStorageKey(actorKey, vendorId), "1");
  } catch {
    // Impression deduplication is best effort only.
  }
}

export function clearPriceImpressionClientState(
  actorKey?: string,
  storage: ImpressionStorage | null = browserSessionStorage(),
): void {
  if (!storage || typeof storage.key !== "function" || typeof storage.length !== "number") return;
  const scopedPrefix = actorKey
    ? `${PRICE_IMPRESSION_PREFIX}${encodeURIComponent(actorKey)}:`
    : PRICE_IMPRESSION_PREFIX;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const isLegacy = key.startsWith(LEGACY_PRICE_IMPRESSION_PREFIX)
      && !key.startsWith(PRICE_IMPRESSION_PREFIX);
    if (isLegacy || key.startsWith(scopedPrefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
