interface SecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

type Manifest = { slot: 0 | 1; count: number } | { slot: null; count: 0 };
const CHUNK_BYTES = 1800;
const MAX_CHUNKS = 1024;

function storageKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_") || "supabase_auth_token";
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_CHUNKS;
}

function parseManifest(value: string | null): Manifest | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed === "object" && parsed !== null && "slot" in parsed && "count" in parsed) {
    if (parsed.slot === null && parsed.count === 0) return { slot: null, count: 0 };
    if ((parsed.slot === 0 || parsed.slot === 1) && typeof parsed.count === "number" && validCount(parsed.count)) {
      return { slot: parsed.slot, count: parsed.count };
    }
  }
  throw new Error("Invalid secure session manifest");
}

function splitChunks(value: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > CHUNK_BYTES) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  chunks.push(chunk);
  if (!validCount(chunks.length)) throw new Error("Secure session is too large");
  return chunks;
}

/** 새 조각을 완성한 뒤 단일 포인터만 교체한다. 이전 버전의 저장 형식도 읽는다. */
export function createSecureSessionStorage(store: SecureStoreAdapter) {
  const cache = new Map<string, string>();
  const pending = new Map<string, Promise<unknown>>();

  // 읽기·교체·로그아웃을 같은 키에서 직렬화해 서로의 조각을 지우지 않게 한다.
  function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = (pending.get(key) ?? Promise.resolve()).then(operation, operation);
    pending.set(key, result);
    const settle = () => { if (pending.get(key) === result) pending.delete(key); };
    void result.then(settle, settle);
    return result;
  }

  function slotPrefix(key: string, slot: 0 | 1) { return `${key}.v2.slot.${slot}`; }

  async function readChunks(prefix: string, count: number): Promise<string> {
    const chunks = await Promise.all(Array.from({ length: count }, (_, index) =>
      store.getItemAsync(`${prefix}.${index}`)));
    if (!chunks.every((chunk): chunk is string => chunk !== null)) {
      throw new Error("Incomplete secure session");
    }
    return chunks.join("");
  }

  async function cleanupSlot(key: string, slot: 0 | 1): Promise<void> {
    const prefix = slotPrefix(key, slot);
    const count = Number(await store.getItemAsync(`${prefix}.count`));
    if (validCount(count)) {
      await Promise.all(Array.from({ length: count }, (_, index) => store.deleteItemAsync(`${prefix}.${index}`)));
    }
    await store.deleteItemAsync(`${prefix}.count`);
  }

  async function cleanupLegacy(key: string): Promise<void> {
    const count = Number(await store.getItemAsync(`${key}.chunks`));
    await store.deleteItemAsync(key);
    if (validCount(count)) {
      await Promise.all(Array.from({ length: count }, (_, index) => store.deleteItemAsync(`${key}.chunk.${index}`)));
    }
    await store.deleteItemAsync(`${key}.chunks`);
  }

  return {
    getItem(inputKey: string): Promise<string | null> {
      const key = storageKey(inputKey);
      return serialize(key, async () => {
        try {
          const manifest = parseManifest(await store.getItemAsync(`${key}.v2`));
          let value: string | null;
          if (manifest?.slot === null) {
            value = null;
          } else if (manifest) {
            value = await readChunks(slotPrefix(key, manifest.slot), manifest.count);
          } else {
            const legacyCount = await store.getItemAsync(`${key}.chunks`);
            if (legacyCount !== null) {
              const count = Number(legacyCount);
              if (!validCount(count)) throw new Error("Invalid legacy secure session count");
              value = await readChunks(`${key}.chunk`, count);
            } else {
              value = await store.getItemAsync(key);
            }
          }
          if (value === null) cache.delete(key);
          else cache.set(key, value);
          return value;
        } catch (error) {
          if (error instanceof Error && /User interaction is not allowed|getValueWithKeyAsync/i.test(error.message)) {
            return cache.get(key) ?? null;
          }
          throw error;
        }
      });
    },
    setItem(inputKey: string, value: string): Promise<void> {
      const key = storageKey(inputKey);
      return serialize(key, async () => {
        const chunks = splitChunks(value);
        const previous = parseManifest(await store.getItemAsync(`${key}.v2`));
        const slot = previous?.slot === 0 ? 1 : 0;
        const prefix = slotPrefix(key, slot);
        const oldCount = Number(await store.getItemAsync(`${prefix}.count`));
        // 중간 실패 뒤에도 쓰였을 수 있는 조각을 다음 교체/삭제에서 찾을 수 있게 한다.
        await store.setItemAsync(`${prefix}.count`, String(Math.max(validCount(oldCount) ? oldCount : 0, chunks.length)));
        for (const [index, chunk] of chunks.entries()) {
          await store.setItemAsync(`${prefix}.${index}`, chunk);
        }
        try {
          await store.setItemAsync(`${key}.v2`, JSON.stringify({ slot, count: chunks.length }));
        } catch (error) {
          // 네이티브 호출이 커밋 후 실패를 보고했을 수도 있다. 조각은 지우지 않는다.
          cache.delete(key);
          throw error;
        }
        cache.set(key, value);
        await Promise.allSettled([
          cleanupSlot(key, slot === 0 ? 1 : 0),
          cleanupLegacy(key),
        ]);
      });
    },
    removeItem(inputKey: string): Promise<void> {
      const key = storageKey(inputKey);
      return serialize(key, async () => {
        try {
          // 먼저 삭제 표식을 커밋해 청소 실패/앱 종료 때 옛 세션이 부활하지 않게 한다.
          await store.setItemAsync(`${key}.v2`, JSON.stringify({ slot: null, count: 0 }));
        } finally {
          cache.delete(key);
        }
        await Promise.allSettled([cleanupSlot(key, 0), cleanupSlot(key, 1), cleanupLegacy(key)]);
      });
    },
  };
}
