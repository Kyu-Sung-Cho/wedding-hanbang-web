"use client";

import Link from "next/link";
import { weddingPath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

/**
 * 푸터 우측 인증 링크. 비로그인 → "로그인", 로그인 → "설정".
 * 풋터에서 항상 "로그인" 보이는 게 어색해서 인증 상태에 맞게 노출.
 */
export default function FooterAuthLink() {
  const { profile, isInitialized } = useAuthStore();

  // 초기화 전이면 깜빡임 방지를 위해 안 보여줌 (placeholder 폭은 유지)
  if (!isInitialized) {
    return <span className="text-base text-transparent select-none">로그인</span>;
  }

  if (profile) {
    return (
      <Link href={weddingPath("/settings")} className="hover:text-[var(--hb-text-strong)] transition-colors">
        설정
      </Link>
    );
  }

  return (
    <Link href="/login" className="hover:text-[var(--hb-text-strong)] transition-colors">
      로그인
    </Link>
  );
}
