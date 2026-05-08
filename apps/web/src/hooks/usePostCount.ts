"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  /** 강제 재조회 — 모달 열기 등 시점에 호출 */
  refetch: () => void;
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

  /**
   * @param silent true면 loading state 안 건드림 (background refetch).
   *   탭 포커스 복귀처럼 사용자가 명시적 행동 안 한 경우 spinner 안 띄우려고.
   */
  const fetchCount = useCallback(
    async (silent = false) => {
      if (isDemo) {
        setPostCount(null);
        return;
      }
      if (!profile?.id) {
        setPostCount(null);
        return;
      }

      if (!silent) setLoading(true);
      try {
        // 캐시 무력화 — URL timestamp + header + cache 옵션 3중 차단
        const res = await fetch(
          `/api/community/profile?_t=${Date.now()}`,
          {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
          }
        );
        const data = res.ok ? await res.json() : null;
        // actualPostCount 우선 (community_posts 직접 COUNT) →
        // 캐시 컬럼(post_count)이 어긋나도 historical 글 정확히 반영.
        const actual = data?.actualPostCount;
        const cached = data?.profile?.post_count;
        const count =
          typeof actual === "number"
            ? actual
            : typeof cached === "number"
              ? cached
              : 0;
        setPostCount(count);
      } catch {
        if (!silent) setPostCount(0);
        // silent 모드에선 fetch 실패해도 기존 값 유지
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [profile?.id, isDemo]
  );

  useEffect(() => {
    void fetchCount();
  }, [fetchCount]);

  // 탭 포커스 돌아올 때 silent refetch — 다른 탭/창에서 글 작성 후 복귀 시 반영하되
  // "잠금 상태 확인 중..." 스피너로 화면을 깜빡이게 하지 않음.
  // 추가로 마지막 fetch 후 30초 안엔 skip — 빠른 탭 전환 spam 방지.
  const lastFetchAtRef = useRef<number>(0);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFetchAtRef.current < 30_000) return;
      lastFetchAtRef.current = now;
      void fetchCount(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [fetchCount]);

  const unlocked = isDemo
    ? true
    : postCount !== null && postCount >= REQUIRED_POSTS_FOR_TOOLS;

  return { postCount, unlocked, isDemo, loading, refetch: fetchCount };
}
