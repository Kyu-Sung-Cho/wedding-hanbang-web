// Supabase 모바일 클라이언트
// 세션은 expo-secure-store(Keychain/Keystore)에 저장
// 웹과 동일한 Supabase 프로젝트를 공유

import "react-native-url-polyfill/auto";
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

const LargeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") return null;

    const chunkCountValue = await SecureStore.getItemAsync(chunkMetaKey(key));
    const chunkCount = Number(chunkCountValue);
    if (Number.isInteger(chunkCount) && chunkCount > 0) {
      const chunks = await Promise.all(
        Array.from({ length: chunkCount }, (_, index) =>
          SecureStore.getItemAsync(chunkKey(key, index))
        )
      );
      if (chunks.every((chunk): chunk is string => typeof chunk === "string")) {
        return chunks.join("");
      }
      await this.removeItem(key);
      return null;
    }

    return SecureStore.getItemAsync(secureStoreKey(key));
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return;

    await this.removeItem(key);

    if (value.length <= SECURE_CHUNK_SIZE) {
      await SecureStore.setItemAsync(secureStoreKey(key), value);
      return;
    }

    const chunks = value.match(new RegExp(`.{1,${SECURE_CHUNK_SIZE}}`, "g")) ?? [];
    await Promise.all(
      chunks.map((chunk, index) =>
        SecureStore.setItemAsync(chunkKey(key, index), chunk)
      )
    );
    await SecureStore.setItemAsync(chunkMetaKey(key), String(chunks.length));
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") return;
    const chunkCountValue = await SecureStore.getItemAsync(chunkMetaKey(key)).catch(() => null);
    const chunkCount = Number(chunkCountValue);
    await SecureStore.deleteItemAsync(secureStoreKey(key)).catch(() => {});
    if (Number.isInteger(chunkCount) && chunkCount > 0) {
      await Promise.all(
        Array.from({ length: chunkCount }, (_, index) =>
          SecureStore.deleteItemAsync(chunkKey(key, index)).catch(() => {})
        )
      );
    }
    await SecureStore.deleteItemAsync(chunkMetaKey(key)).catch(() => {});
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: LargeSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "implicit", // 모바일: PKCE 대신 implicit — 토큰이 URL fragment로 직접 돌아옴
  },
});
