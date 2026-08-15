import { isUuid } from "@/utils/requestValidation";

type Owner = { ownerUserId: string; coupleId: string };
type OpaqueStorage = Pick<Storage, "getItem" | "setItem">;
type OpaqueJournal = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
};
type PersistenceOptions = {
  storage?: OpaqueStorage;
  journal?: OpaqueJournal;
  digest?: (input: string) => Promise<string>;
  record?: string;
};

const DATABASE_NAME = "hanbang_opaque_state_v1";
const STORE_NAME = "markers";
const KEY_PREFIX = "hb.opaque.v1.";
const PURPOSE = "hanbang:opaque:v1";
const IO_TIMEOUT_MS = 1_000;
const activeProcessHolds = new Set<string>();

function normalizeOwner(owner: Owner): { ownerUserId: string; coupleId: string } | null {
  const ownerUserId = owner.ownerUserId.trim().toLowerCase();
  const coupleId = owner.coupleId.trim().toLowerCase();
  return isUuid(ownerUserId) && isUuid(coupleId) ? { ownerUserId, coupleId } : null;
}

function processKey(owner: Owner): string | null {
  const normalized = normalizeOwner(owner);
  return normalized ? `${normalized.ownerUserId}:${normalized.coupleId}` : null;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function persistentKey(
  owner: Owner,
  digest: (input: string) => Promise<string>,
): Promise<string | null> {
  const normalized = normalizeOwner(owner);
  if (!normalized) return null;
  const value = await digest(
    `${PURPOSE}\u0000${normalized.ownerUserId}\u0000${normalized.coupleId}`,
  );
  return /^[0-9a-f]{64}$/u.test(value) ? `${KEY_PREFIX}${value}` : null;
}

function openJournalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("OPAQUE_JOURNAL_OPEN_FAILED"));
    request.onblocked = () => reject(new Error("OPAQUE_JOURNAL_BLOCKED"));
  });
}

function defaultJournal(): OpaqueJournal | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    get: async (key) => {
      const database = await openJournalDatabase();
      try {
        return await new Promise<string | null>((resolve, reject) => {
          const transaction = database.transaction(STORE_NAME, "readonly");
          const request = transaction.objectStore(STORE_NAME).get(key);
          request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
          request.onerror = () => reject(request.error ?? new Error("OPAQUE_JOURNAL_READ_FAILED"));
          transaction.onabort = () => reject(transaction.error ?? new Error("OPAQUE_JOURNAL_READ_ABORTED"));
        });
      } finally {
        database.close();
      }
    },
    set: async (key, value) => {
      const database = await openJournalDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(STORE_NAME, "readwrite");
          transaction.objectStore(STORE_NAME).put(value, key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error("OPAQUE_JOURNAL_WRITE_FAILED"));
          transaction.onabort = () => reject(transaction.error ?? new Error("OPAQUE_JOURNAL_WRITE_ABORTED"));
        });
      } finally {
        database.close();
      }
    },
  };
}

function withTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OPAQUE_JOURNAL_TIMEOUT")), IO_TIMEOUT_MS);
    operation.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error: unknown) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function resolveStorage(explicit?: OpaqueStorage): OpaqueStorage | null {
  if (explicit) return explicit;
  return typeof window === "undefined" ? null : window.localStorage;
}

export function createBrowserMediationPrivateSafetyHoldRecord(owner?: Owner): string | null {
  if (owner && !normalizeOwner(owner)) return null;
  return JSON.stringify({ version: 1, active: true });
}

function recordSuppresses(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    JSON.parse(raw);
    // The key itself is an exact owner/couple digest. Any value at that key,
    // including an old or schema-invalid marker, remains suppressing.
    return true;
  } catch {
    return true;
  }
}

export function hasActiveBrowserMediationPrivateSafetyHold(owner: Owner): boolean {
  const binding = processKey(owner);
  return binding === null || activeProcessHolds.has(binding);
}

export async function sealBrowserMediationPrivateSafetyHold(
  owner: Owner,
  options: PersistenceOptions = {},
): Promise<boolean> {
  const binding = processKey(owner);
  if (!binding) return false;
  activeProcessHolds.add(binding);
  try {
    const key = await (async () => persistentKey(owner, options.digest ?? sha256Hex))();
    if (!key) return false;
    const record = options.record ?? createBrowserMediationPrivateSafetyHoldRecord();
    if (!record) return false;
    const writes: Array<Promise<unknown>> = [];
    try {
      const storage = resolveStorage(options.storage);
      if (storage) writes.push(Promise.resolve().then(() => storage.setItem(key, record)));
    } catch {
      writes.push(Promise.reject(new Error("OPAQUE_LOCAL_STORAGE_WRITE_FAILED")));
    }
    const journal = options.journal ?? defaultJournal();
    if (journal) writes.push(withTimeout(journal.set(key, record)));
    if (writes.length === 0) return false;
    const results = await Promise.allSettled(writes);
    return results.some((result) => result.status === "fulfilled");
  } catch {
    return false;
  }
}

export async function hasBrowserMediationPrivateSafetyHold(
  owner: Owner,
  options: PersistenceOptions = {},
): Promise<boolean> {
  const binding = processKey(owner);
  if (!binding) return true;
  if (activeProcessHolds.has(binding)) return true;
  try {
    const key = await persistentKey(owner, options.digest ?? sha256Hex);
    if (!key) return true;
    const reads: Array<Promise<string | null>> = [];
    try {
      const storage = resolveStorage(options.storage);
      if (storage) reads.push(Promise.resolve().then(() => storage.getItem(key)));
    } catch {
      reads.push(Promise.reject(new Error("OPAQUE_LOCAL_STORAGE_READ_FAILED")));
    }
    const journal = options.journal ?? defaultJournal();
    if (journal) reads.push(withTimeout(journal.get(key)));
    if (reads.length === 0) return true;
    const results = await Promise.allSettled(reads);
    if (results.some((result) => result.status === "rejected")) return true;
    const suppress = results.some((result) => (
      result.status === "fulfilled" && recordSuppresses(result.value)
    ));
    if (suppress) activeProcessHolds.add(binding);
    return suppress;
  } catch {
    return true;
  }
}
