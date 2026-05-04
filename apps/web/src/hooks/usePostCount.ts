"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";

export const REQUIRED_POSTS_FOR_TOOLS = 5;

interface UsePostCountResult {
  /** 본인이 작성한 커뮤니티 글 수. 미인증·미로딩 시 null */
  postCount: number | null;
  /** 잠금 해제됐는지 (5개 이상) */
  unlocked: boolean;
  /** 데모 모드 여부 — 잠금 우회 */
  isDemo: boolean;
  /** 로딩 중 여부 */
  loading: boolean;
}

/**
 * 사용자의 커뮤니티 글 작성 수를 가져와서 도구 잠금 게이트 판정.
 * community_profiles.post_count 기준.
 *
 * - 데모 모드 → unlocked: true (잠금 우회)
 * - 비로그인 → unlocked: false, postCount: null
 * - 인증 후 fetch 진행 중 → loading: true
 */
export function usePostCount(): UsePostCountResult {
  const { profile, isDemo } = useAuthStore();
  const [postCount, setPostCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDemo) {
      // 데모는 fetch 안 함, 잠금 우회
      setPostCount(null);
      return;
    }

    if (!profile?.id) {
      setPostCount(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch("/api/community/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const count = data?.profile?.post_count;
        setPostCount(typeof count === "number" ? count : 0);
      })
      .catch(() => {
        if (!cancelled) setPostCount(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.id, isDemo]);

  const unlocked = isDemo
    ? true
    : postCount !== null && postCount >= REQUIRED_POSTS_FOR_TOOLS;

  return { postCount, unlocked, isDemo, loading };
}
