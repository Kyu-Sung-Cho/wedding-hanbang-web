"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { ThumbsUp, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import PostCard from "@/components/community/PostCard";
import { weddingPath } from "@/lib/weddingPaths";
import type { PostWithAuthor } from "@/types/community.types";

export default function MyUpvotedPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/login?redirect=${encodeURIComponent(weddingPath("/community/my/upvoted"))}`);
        return;
      }

      try {
        const res = await fetch("/api/community/posts/voted?limit=100");
        if (res.ok) {
          const data = await res.json();
          setPosts(data.posts ?? []);
          setTotal(data.total ?? 0);
        }
      } catch {
        // 에러 무시
      }
      setLoading(false);
    })();
  }, [router, supabase.auth]);

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
