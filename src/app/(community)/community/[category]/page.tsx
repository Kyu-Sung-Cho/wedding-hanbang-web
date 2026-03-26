"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PenSquare, Hash, Shield } from "lucide-react";
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
    <div className="min-h-screen bg-[#F4F6F8]">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-6">
        {/* 카테고리 헤더 */}
        <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-4 mb-3">
          <h1 className="text-lg font-bold text-[#1c1c1e]">
            {categoryInfo.label}
          </h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            {categoryInfo.description}
          </p>
        </div>

        {/* 정렬 바 */}
        <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-3 mb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <CategoryTabs />
            </div>
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
              <div className="space-y-2">
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
              <div className="space-y-2">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}

                {isLoading && (
                  <div className="space-y-2">
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
          <aside className="hidden lg:block w-[280px] xl:w-[312px] shrink-0 space-y-3">
            {/* 게이미피케이션 위젯 */}
            <GamificationWidget />

            {/* 커뮤니티 정보 카드 */}
            <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] overflow-hidden">
              <div className="bg-gradient-to-r from-[#2563EB] to-[#3B82F6] h-12 relative">
                <div className="absolute inset-0 bg-[url('/images/pattern.svg')] opacity-10" />
              </div>
              <div className="p-4">
                <h2 className="text-sm font-bold text-[#1c1c1e] mb-1">
                  웨딩한방 커뮤니티
                </h2>
                <p className="text-sm text-[#6B7280] leading-relaxed mb-3">
                  예비 신랑신부를 위한 웨딩 정보 공유 커뮤니티
                </p>

                {/* 커뮤니티 통계 */}
                <div className="flex items-center gap-4 py-3 mb-3 border-y border-[#F4F6F8]">
                  <div className="text-center flex-1">
                    <div className="text-sm font-bold text-[#1c1c1e]">{total || '—'}</div>
                    <div className="text-xs text-[#6B7280]">게시글</div>
                  </div>
                  <div className="w-px h-8 bg-[#E5E7EB]" />
                  <div className="text-center flex-1">
                    <div className="text-sm font-bold text-[#1c1c1e]">—</div>
                    <div className="text-xs text-[#6B7280]">멤버</div>
                  </div>
                  <div className="w-px h-8 bg-[#E5E7EB]" />
                  <div className="text-center flex-1">
                    <div className="flex items-center justify-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <div className="text-sm font-bold text-[#1c1c1e]">—</div>
                    </div>
                    <div className="text-xs text-[#6B7280]">온라인</div>
                  </div>
                </div>

                <Link
                  href="/community/post/write"
                  className="flex items-center justify-center gap-2 w-full px-4 py-3 text-base font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-all duration-200"
                >
                  <PenSquare className="w-4 h-4" />
                  글쓰기
                </Link>
              </div>
            </div>

            {/* 커뮤니티 규칙 */}
            <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[#1c1c1e] mb-3">
                <Shield className="w-4 h-4 text-[#6B7280]" />
                커뮤니티 규칙
              </h3>
              <ol className="space-y-2 text-sm text-[#6B7280]">
                <li className="flex gap-2"><span className="font-semibold text-[#1c1c1e] shrink-0">1.</span>서로 존중하는 대화를 해주세요</li>
                <li className="flex gap-2"><span className="font-semibold text-[#1c1c1e] shrink-0">2.</span>광고/스팸 글은 삭제됩니다</li>
                <li className="flex gap-2"><span className="font-semibold text-[#1c1c1e] shrink-0">3.</span>개인정보를 공유하지 마세요</li>
                <li className="flex gap-2"><span className="font-semibold text-[#1c1c1e] shrink-0">4.</span>후기는 솔직하게 작성해주세요</li>
                <li className="flex gap-2"><span className="font-semibold text-[#1c1c1e] shrink-0">5.</span>비용 정보는 정확하게 공유해주세요</li>
              </ol>
            </div>

            {/* 인기 태그 */}
            {popularTags.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-4">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#1c1c1e] uppercase mb-3">
                  <Hash className="w-4 h-4 text-[#6B7280]" />
                  인기 태그
                </h3>
                <div className="flex flex-wrap gap-2">
                  {popularTags.slice(0, 12).map((t) => (
                    <Link
                      key={t.tag}
                      href={`/community?tag=${encodeURIComponent(t.tag)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-sm text-[#2563EB] bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg hover:bg-[#DBEAFE] transition-all duration-200"
                    >
                      #{t.tag}
                      <span className="text-xs text-[#2563EB]/60 bg-white px-2 py-0.5 rounded-full">{t.count}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 웨딩한방 서비스 링크 */}
            <div className="text-center py-3">
              <Link href="/login" className="text-xs text-[#6B7280] hover:text-[#2563EB] transition-all duration-200">
                웨딩한방 서비스 둘러보기 →
              </Link>
            </div>
          </aside>
        </div>

        {/* 모바일 플로팅 글쓰기 버튼 */}
        <Link
          href="/community/post/write"
          className="lg:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200"
          aria-label="글쓰기"
        >
          <PenSquare className="w-5 h-5" />
        </Link>
      </div>
    </div>
  );
}
