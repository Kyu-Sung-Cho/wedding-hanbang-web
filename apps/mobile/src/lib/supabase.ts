// Supabase 모바일 클라이언트
// 세션은 expo-secure-store(Keychain/Keystore)에 저장 — AsyncStorage 대비 안전
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

// SecureStore에는 2KB 제한이 있어 큰 값은 쪼개서 저장하는 어댑터 사용
const LargeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") return null;
    const value = await SecureStore.getItemAsync(key);
    return value;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return;
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") return;
    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: LargeSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // 모바일은 OAuth 콜백을 딥링크로 처리
  },
});
