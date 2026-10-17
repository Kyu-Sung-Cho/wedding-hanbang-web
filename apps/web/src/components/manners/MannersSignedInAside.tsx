"use client";

import { useEffect, type ReactNode } from "react";
import Sidebar from "@/components/app/Sidebar";
import { useAuthSessionSync } from "@/hooks/useAuthSessionSync";
import { useAuthStore } from "@/stores/authStore";

/**
 * 로그인 세션 힌트가 있을 때 사이드바 자리를 맡는다(`MannersChrome`).
 *
 * auth 스토어를 여기서 부팅하고, 로그인한 사용자가 확인되면 앱과 같은 사이드바를 그린다.
 * 확인 전이거나 로그인이 아니면 서버가 그린 공개 사이드바를 그대로 둔다.
 *
 * 체험(데모) 세션이 이미 스토어에 있으면 세션 동기화를 켜지 않는다. 동기화는 실제 로그인 세션만
 * 보는데, 앱에서 넘어온 체험 사용자를 "로그인이 끊겼다"로 읽어 스토어를 비우고 다시 채우기
 * 때문이다(`AppClientLayout` 도 체험 중에는 끈다). 그 사이 사이드바가 공개 모양으로 깜빡였다.
 */
export default function MannersSignedInAside({
  publicAside,
  isOpen,
  onClose,
}: {
  publicAside: ReactNode;
  isOpen: boolean;
  onClose: () => void;
}) {
  const signedIn = useAuthStore((state) => state.isInitialized && state.user !== null);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const isDemo = useAuthStore((state) => state.isDemo);
  const initialize = useAuthStore((state) => state.initialize);

  useAuthSessionSync(!isDemo && !hasDemoCookie());
  useEffect(() => {
    if (!isInitialized) void initialize();
  }, [initialize, isInitialized]);

  return signedIn ? <Sidebar isOpen={isOpen} onClose={onClose} /> : publicAside;
}

function hasDemoCookie() {
  return typeof document !== "undefined" && document.cookie.includes("demo_mode=true");
}
