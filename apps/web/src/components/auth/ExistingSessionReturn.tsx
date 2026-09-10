"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { LoginMode } from "@/lib/auth/loginMode";
import { getAuthRedirectPath } from "@/lib/auth/safeRedirect";
import { createClient } from "@/lib/supabase/client";

export default function ExistingSessionReturn({ mode }: { mode: LoginMode }) {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // 복구·콜백 실패는 기존 안내를 읽고 직접 다시 시도할 수 있어야 한다.
    if (mode === "forgot" || params.has("error") || params.has("code")
      || params.get("type") === "recovery" || window.location.hash) return;
    let cancelled = false;
    async function continuePreparation() {
      try {
        const { data, error } = await createClient().auth.getUser();
        if (cancelled || error || !data.user) return;
        // 목적지의 기존 서버 인증·가입 동의·온보딩 관문이 최종 판정한다.
        router.replace(getAuthRedirectPath(window.location.search, window.location.origin));
      } catch {
        // 확인이 안 되면 세션이 있다고 가정하지 않고 로그인 화면을 유지한다.
      }
    }
    void continuePreparation();
    return () => { cancelled = true; };
  }, [mode, router]);
  return null;
}
