import { supabase } from "./supabase";
import type { Provider, Session } from "@supabase/supabase-js";

export async function signInWithOAuth(
  provider: Provider
): Promise<{ cancelled: boolean; session: Session | null }> {
  void provider;
  throw new Error(
    "모바일 소셜 로그인은 보안 연결(PKCE·검증된 앱 링크) 적용 전까지 잠시 중단되었습니다."
  );
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
