"use client";

import { useEffect } from "react";
import { useAuthSessionSync } from "@/hooks/useAuthSessionSync";
import { useAuthStore } from "@/stores/authStore";

/**
 * 비-(app) 레이아웃에서 auth 스토어를 부팅시키는 무화면 컴포넌트.
 * (app) 레이아웃은 자체 useEffect로 처리하지만, (community) 같은
 * 레이아웃은 SSR 우선이라 클라이언트에서 한 번 트리거가 필요함.
 *
 * couple/journey 정보가 있어야 동작하는 페이지(/community/chat 등)에서
 * 이 데이터가 비어있으면 잘못된 빈 상태가 노출되는 문제를 방지.
 */
export default function AuthInitializer() {
  const { initialize, isInitialized } = useAuthStore();
  useAuthSessionSync();
  useEffect(() => {
    if (!isInitialized) void initialize();
  }, [initialize, isInitialized]);
  return null;
}
