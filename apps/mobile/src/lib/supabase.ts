// Supabase 모바일 클라이언트
// 세션은 expo-secure-store(Keychain/Keystore)에 저장
// 웹과 동일한 Supabase 프로젝트를 공유

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "[Supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing. Check apps/mobile/.env.local"
  );
}

// SecureStore는 값 크기 제한이 있으므로 큰 세션은 여러 조각으로 나눠 저장한다.
// 인증 토큰은 AsyncStorage로 fallback하지 않는다.
const SECURE_CHUNK_SIZE = 1800;
const MAX_SECURE_SESSION_BYTES = 64 * 1024;
const MAX_SECURE_CHUNKS = Math.ceil(MAX_SECURE_SESSION_BYTES / SECURE_CHUNK_SIZE);
const memorySessionCache = new Map<string, string>();
const SECURE_STORE_WRITE_OPTIONS = {
  // Session tokens may be restored from the server after a new login. Keeping
  // them device-bound avoids migrating a still-live token through an iOS
  // Keychain backup to another device.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;
const INSTALLATION_SENTINEL_KEY = "hanbang.secure-session.installation.v1";
const INSTALLATION_SENTINEL_VALUE = "installed";
const legacyAsyncStorageCleanupByKey = new Map<string, Promise<void>>();
const installationBoundaryByKey = new Map<string, Promise<void>>();

function isTransientSecureStoreError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /User interaction is not allowed|getValueWithKeyAsync/i.test(error.message);
}

function secureStoreKey(key: string) {
  const sanitized = key.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "supabase_auth_token";
}

function chunkMetaKey(key: string) {
  return `${secureStoreKey(key)}.chunks`;
}

function chunkKey(key: string, index: number) {
  return `${secureStoreKey(key)}.chunk.${index}`;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f
      ? 1
      : codePoint <= 0x7ff
        ? 2
        : codePoint <= 0xffff
          ? 3
          : 4;
  }
  return bytes;
}

function splitSecureStoreChunks(value: string): string[] {
  const chunks: string[] = [];
  let currentCharacters: string[] = [];
  let currentBytes = 0;

  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (currentBytes + characterBytes > SECURE_CHUNK_SIZE) {
      chunks.push(currentCharacters.join(""));
      currentCharacters = [];
      currentBytes = 0;
    }
    currentCharacters.push(character);
    currentBytes += characterBytes;
  }

  if (currentCharacters.length > 0) {
    chunks.push(currentCharacters.join(""));
  }
  return chunks;
}

function parseChunkCount(value: string | null): number | null {
  if (!value || !/^[1-9]\d{0,2}$/.test(value)) return null;
  const chunkCount = Number(value);
  return Number.isSafeInteger(chunkCount)
    && chunkCount > 0
    && chunkCount <= MAX_SECURE_CHUNKS
    ? chunkCount
    : null;
}

function chunkKeys(key: string, startIndex = 0): string[] {
  return Array.from(
    { length: Math.max(0, MAX_SECURE_CHUNKS - startIndex) },
    (_, offset) => chunkKey(key, startIndex + offset),
  );
}

async function deleteSecureStoreKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const results = await Promise.allSettled(
    keys.map((storageKey) => SecureStore.deleteItemAsync(storageKey)),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) {
    throw failure.reason instanceof Error
      ? failure.reason
      : new Error("Secure session removal failed");
  }
}

async function deleteSessionData(key: string): Promise<void> {
  await deleteSecureStoreKeys([
    secureStoreKey(key),
    ...chunkKeys(key),
  ]);
}

async function ensureLegacyAsyncStorageSessionRemoved(key: string): Promise<void> {
  const boundaryKey = secureStoreKey(key);
  let boundary = legacyAsyncStorageCleanupByKey.get(boundaryKey);
  if (!boundary) {
    // Earlier adapter versions persisted large Supabase
    // sessions under the original key in plaintext AsyncStorage. Purge that
    // exact key before any current session can be read, written, or removed.
    boundary = AsyncStorage.removeItem(key);
    legacyAsyncStorageCleanupByKey.set(boundaryKey, boundary);
  }

  try {
    await boundary;
  } catch (error) {
    // Fail closed, but allow the next auth operation to retry cleanup.
    legacyAsyncStorageCleanupByKey.delete(boundaryKey);
    throw error;
  }
}

async function ensureCurrentInstallation(key: string): Promise<void> {
  await ensureLegacyAsyncStorageSessionRemoved(key);
  if (Platform.OS !== "ios") return;

  const boundaryKey = secureStoreKey(key);
  let boundary = installationBoundaryByKey.get(boundaryKey);
  if (!boundary) {
    boundary = (async () => {
      const sentinel = await AsyncStorage.getItem(INSTALLATION_SENTINEL_KEY);
      if (sentinel === INSTALLATION_SENTINEL_VALUE) return;

      // iOS Keychain items can survive app uninstall. The unencrypted marker
      // contains no account data and disappears with the app container, so a
      // missing marker means every prior session fragment must be discarded
      // before Supabase is allowed to read or persist a session.
      await deleteSessionData(key);
      await SecureStore.deleteItemAsync(chunkMetaKey(key));
      await AsyncStorage.setItem(
        INSTALLATION_SENTINEL_KEY,
        INSTALLATION_SENTINEL_VALUE,
      );
    })();
    installationBoundaryByKey.set(boundaryKey, boundary);
  }

  try {
    await boundary;
  } catch (error) {
    installationBoundaryByKey.delete(boundaryKey);
    throw error;
  }
}

const LargeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") return null;
    await ensureCurrentInstallation(key);

    try {
      const chunkCountValue = await SecureStore.getItemAsync(chunkMetaKey(key));
      if (chunkCountValue !== null) {
        const chunkCount = parseChunkCount(chunkCountValue);
        if (chunkCount === null) {
          await this.removeItem(key);
          return null;
        }
        const chunks = await Promise.all(
          Array.from({ length: chunkCount }, (_, index) =>
            SecureStore.getItemAsync(chunkKey(key, index))
          )
        );
        if (
          chunks.every((chunk): chunk is string => (
            typeof chunk === "string"
            && chunk.length > 0
            && utf8ByteLength(chunk) <= SECURE_CHUNK_SIZE
          ))
        ) {
          const value = chunks.join("");
          if (utf8ByteLength(value) > MAX_SECURE_SESSION_BYTES) {
            await this.removeItem(key);
            return null;
          }
          // Remove a legacy base value and slots beyond the declared count.
          // Older partial writes could otherwise survive session rotation.
          await deleteSecureStoreKeys([
            secureStoreKey(key),
            ...chunkKeys(key, chunkCount),
          ]);
          memorySessionCache.set(key, value);
          return value;
        }
        await this.removeItem(key);
        return null;
      }

      const value = await SecureStore.getItemAsync(secureStoreKey(key));
      // A missing manifest can mean either a valid single-value session or an
      // interrupted chunk write. Sweep every bounded chunk slot in both cases.
      await deleteSecureStoreKeys(chunkKeys(key));
      if (!value) return null;
      if (utf8ByteLength(value) > SECURE_CHUNK_SIZE) {
        await this.removeItem(key);
        return null;
      }
      memorySessionCache.set(key, value);
      return value;
    } catch (error) {
      if (isTransientSecureStoreError(error)) {
        return memorySessionCache.get(key) ?? null;
      }

      throw error;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return;
    await ensureCurrentInstallation(key);

    const valueBytes = utf8ByteLength(value);
    if (valueBytes === 0 || valueBytes > MAX_SECURE_SESSION_BYTES) {
      await this.removeItem(key);
      throw new Error("Secure session exceeds the storage size limit");
    }

    await this.removeItem(key);

    try {
      if (valueBytes <= SECURE_CHUNK_SIZE) {
        await SecureStore.setItemAsync(
          secureStoreKey(key),
          value,
          SECURE_STORE_WRITE_OPTIONS,
        );
        memorySessionCache.set(key, value);
        return;
      }

      const chunks = splitSecureStoreChunks(value);
      if (chunks.length < 1 || chunks.length > MAX_SECURE_CHUNKS) {
        throw new Error("Secure session exceeds the chunk limit");
      }
      const writeResults = await Promise.allSettled(
        chunks.map((chunk, index) =>
          SecureStore.setItemAsync(
            chunkKey(key, index),
            chunk,
            SECURE_STORE_WRITE_OPTIONS,
          )
        )
      );
      const failedWrite = writeResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failedWrite) {
        throw failedWrite.reason instanceof Error
          ? failedWrite.reason
          : new Error("Secure session chunk write failed");
      }

      // This count is the commit marker. It is written only after every data
      // slot succeeds, and deletion removes it only after all data is gone.
      await SecureStore.setItemAsync(
        chunkMetaKey(key),
        String(chunks.length),
        SECURE_STORE_WRITE_OPTIONS,
      );
      memorySessionCache.set(key, value);
    } catch (error) {
      try {
        await this.removeItem(key);
      } catch {
        throw new Error("Secure session write cleanup failed");
      }
      throw error;
    }
  },
  async removeItem(key: string): Promise<void> {
    memorySessionCache.delete(key);
    if (Platform.OS === "web") return;
    await ensureCurrentInstallation(key);

    // 세션 삭제 실패를 성공으로 위장하면 로그아웃 뒤 이전 계정이 복원될 수 있다.
    // 모든 키를 시도하되 하나라도 실패하면 Supabase에 실패를 전달한다.
    // Sweep the fixed, bounded slot range even when metadata is missing or
    // corrupt. Delete the manifest last so any data failure remains retryable.
    await deleteSessionData(key);
    await SecureStore.deleteItemAsync(chunkMetaKey(key));
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: LargeSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});
