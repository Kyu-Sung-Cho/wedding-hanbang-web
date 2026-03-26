"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PenSquare } from "lucide-react";
import { useCommunityStore } from "@/stores/communityStore";
import {
  COMMUNITY_CATEGORIES,
  CATEGORY_MAP,
} from "@/constants/communityCategories";
import type { CommunityCategory } from "@/types/community.types";
import CategoryTabs from "@/components/community/CategoryTabs";
import SortSelector from "@/components/community/SortSelector";
import PostCard from "@/components/community/PostCard";
import PostSkeleton from "@/components/community/PostSkeleton";
import EmptyState from "@/components/community/EmptyState";
import GamificationWidget from "@/components/community/GamificationWidget";

interface PopularTag {
  tag: string;
  count: number;
}

// 유효한 카테고리 키 목록
const VALID_KEYS = COMMUNITY_CATEGORIES.map((c) => c.key);

export default function CategoryFeedPage() {
  const params = useParams();
  const router = useRouter();
  const categoryParam = params.category as string;

  const posts = useCommunityStore((s) => s.posts);
  const isLoading = useCommunityStore((s) => s.isLoading);
  const hasMore = useCommunityStore((s) => s.hasMore);
  const currentSort = useCommunityStore((s) => s.currentSort);
  const currentPeriod = useCommunityStore((s) => s.currentPeriod);
  const total = useCommunityStore((s) => s.total);

  const [popularTags, setPopularTags] = useState<PopularTag[]>([]);
  const observerRef = useRef<HTMLDivElement>(null);

  // 카테고리 유효성 검사 + 글 목록 가져오기
  useEffect(() => {
    if (!VALID_KEYS.includes(categoryParam as CommunityCategory)) {
      router.replace("/community");
      return;
    }
    const store = useCommunityStore.getState();
    store.setCategory(categoryParam as CommunityCategory);
    store.fetchPosts(true);
  }, [categoryParam, currentSort, currentPeriod, router]);

  // 인기 태그 가져오기
  useEffect(() => {
    fetch("/api/community/popular-tags")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setPopularTags(data.tags ?? data ?? []))
      .catch(() => {});
  }, []);

  // 무한스크롤 IntersectionObserver
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      const s = useCommunityStore.getState();
      if (entry.isIntersecting && s.hasMore && !s.isLoading) {
        s.fetchMorePosts();
      }
    },
    []
  );

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, {
      rootMargin: "200px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  const categoryInfo = CATEGORY_MAP[categoryParam as CommunityCategory];

  // 유효하지 않은 카테고리면 리다이렉트 전까지 빈 화면
  if (!categoryInfo) return null;

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-8">
        {/* 카테고리 헤더 */}
        <div className="bg-white rounded-2xl border border-[#F0EFED] p-6 mb-4">
          <h1 className="font-serif text-lg font-medium text-[#1A1A1F]">
            {categoryInfo.label}
          </h1>
          <p className="mt-1 text-sm text-[#878680]">
            {categoryInfo.description}
          </p>
        </div>

        {/* 정렬 바 */}
        <div className="bg-white rounded-2xl border border-[#F0EFED] p-4 mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <CategoryTabs />
            </div>
            <div className="w-px h-6 bg-[#F0EFED]" />
            <div className="shrink-0">
              <SortSelector
                sort={currentSort}
                period={currentPeriod}
                onSortChange={(s) => useCommunityStore.getState().setSort(s)}
                onPeriodChange={(p) => useCommunityStore.getState().setPeriod(p)}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* 메인 피드 */}
          <div className="flex-1 min-w-0">
            {isLoading && posts.length === 0 ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <PostSkeleton key={i} />
                ))}
              </div>
            ) : posts.length === 0 ? (
              <EmptyState
                message={`${categoryInfo.label}에 아직 작성된 글이 없습니다`}
                description="첫 번째 글을 작성해 보세요!"
                ctaLabel="글쓰기"
                ctaHref="/community/post/write"
              />
            ) : (
              <div className="space-y-4">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}

                {isLoading && (
                  <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <PostSkeleton key={`more-${i}`} />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div ref={observerRef} className="h-1" />
          </div>

          {/* 데스크탑 사이드바 */}
          <aside className="hidden lg:block w-[300px] xl:w-[320px] shrink-0 space-y-4">
            {/* 게이미피케이션 위젯 */}
            <GamificationWidget />

            {/* 커뮤니티 정보 카드 */}
            <div className="bg-white rounded-2xl border border-[#F0EFED] p-6">
              <h2 className="font-serif text-lg font-medium text-[#1A1A1F] mb-1">
                웨딩한방 커뮤니티
              </h2>
              <p className="text-sm text-[#878680] leading-relaxed mb-4">
                예비 신랑신부를 위한<br />
                웨딩 정보 공유 공간
              </p>

              <div className="border-t border-[#F0EFED] py-3 mb-4">
                <span className="text-sm text-[#878680]">글 {total || 0}개</span>
              </div>

              <Link
                href="/community/post/write"
                className="flex items-center justify-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-[#1A1A1F] hover:bg-[#2d2d30] rounded-xl transition-all duration-200"
              >
                <PenSquare className="w-4 h-4" />
                글쓰기
              </Link>
            </div>

            {/* 인기 태그 */}
            {popularTags.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#F0EFED] p-5">
                <h3 className="text-sm font-medium text-[#1A1A1F] mb-3">
                  인기 태그
                </h3>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  {popularTags.slice(0, 12).map((t) => (
                    <Link
                      key={t.tag}
                      href={`/community?tag=${encodeURIComponent(t.tag)}`}
                      className="inline-flex items-center gap-1 text-sm text-[#B5ADA3] hover:text-[#C4967E] transition-colors duration-200"
                    >
                      #{t.tag}
                      <span className="text-xs text-[#B5ADA3]">{t.count}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 웨딩한방 서비스 링크 */}
            <div className="text-center py-3">
              <Link href="/login" className="text-xs text-[#878680] hover:text-[#C4967E] transition-colors duration-200">
                웨딩한방 서비스 둘러보기 →
              </Link>
            </div>
          </aside>
        </div>

        {/* 모바일 플로팅 글쓰기 버튼 */}
        <Link
          href="/community/post/write"
          className="lg:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 text-white bg-[#1A1A1F] hover:bg-[#2d2d30] rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200"
          aria-label="글쓰기"
        >
          <PenSquare className="w-5 h-5" />
        </Link>
      </div>
    </div>
  );
}
