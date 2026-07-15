"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ThumbsUp, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import PostCard from "@/components/community/PostCard";
import { createClient } from "@/lib/supabase/client";
import { weddingPath } from "@/lib/weddingPaths";
import type { PostWithAuthor } from "@/types/community.types";

export default function MyUpvotedPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const supabase = createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) {
          router.push(`/login?redirect=${encodeURIComponent(weddingPath("/community/my/upvoted"))}`);
          return;
        }

        const res = await fetch("/api/community/posts/voted?limit=100");
        if (!res.ok) throw new Error("upvoted_posts_load_failed");
        const data: unknown = await res.json();
        const payload = data as { posts?: unknown; total?: unknown };
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data) ||
          !Array.isArray(payload.posts) ||
          typeof payload.total !== "number" ||
          !Number.isSafeInteger(payload.total) ||
          payload.total < 0
        ) {
          throw new Error("upvoted_posts_invalid_response");
        }
        if (!cancelled) {
          setPosts(payload.posts as PostWithAuthor[]);
          setTotal(payload.total);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, router]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={weddingPath()}
          className="w-8 h-8 rounded-full bg-white border border-black/[0.06] flex items-center justify-center hover:bg-ivory-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-noir-800" />
        </Link>
        <div className="flex items-center gap-2">
          <ThumbsUp className="w-5 h-5 text-[#2E7D5A]" />
          <h1 className="font-serif-kr text-[20px] text-noir-800">좋아요한 글</h1>
          {!loading && total > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-[#2E7D5A]/10 text-[#2E7D5A] text-[12px] font-medium">
              {total}
            </span>
          )}
        </div>
      </div>

      {/* 로딩 */}
      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 text-[#B5ADA3] animate-spin" />
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center">
          <p className="text-[14px] font-medium text-red-800">좋아요한 글을 불러오지 못했어요.</p>
          <p className="mt-1 text-[12px] text-red-700">저장된 반응이 없어진 것은 아니에요.</p>
          <button
            type="button"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            className="mt-4 rounded-xl bg-white px-5 py-2.5 text-[13px] font-medium text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100"
          >
            다시 시도
          </button>
        </div>
      ) : posts.length === 0 ? (
        /* 빈 상태 */
        <div className="py-16 text-center">
          <ThumbsUp className="w-10 h-10 text-[#B5ADA3]/40 mx-auto mb-3" />
          <p className="text-[14px] text-[#928980] mb-1">아직 좋아요한 글이 없어요</p>
          <p className="text-[12px] text-[#B5ADA3] mb-4">마음에 드는 글에 좋아요를 눌러보세요</p>
          <Link
            href={weddingPath()}
            className="inline-block px-5 py-2.5 rounded-xl text-[13px] font-medium text-white bg-[#36534E] hover:bg-[#9A6B62] transition-colors"
          >
            커뮤니티 둘러보기
          </Link>
        </div>
      ) : (
        /* 게시글 목록 */
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
