"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Bookmark, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import PostCard from "@/components/community/PostCard";
import { weddingPath } from "@/lib/weddingPaths";
import type { PostWithAuthor } from "@/types/community.types";

export default function MyBookmarksPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push(`/login?redirect=${encodeURIComponent(weddingPath("/community/my/bookmarks"))}`); return; }

      try {
        // 북마크한 글 목록 가져오기
        const res = await fetch("/api/community/posts?bookmarked=true&limit=100");
        if (res.ok) {
          const data = await res.json();
          setPosts(data.posts ?? []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [router, supabase.auth]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href={weddingPath()} className="w-8 h-8 rounded-full bg-white border border-black/[0.06] flex items-center justify-center hover:bg-ivory-100 transition-colors">
          <ArrowLeft className="w-4 h-4 text-noir-800" />
        </Link>
        <h1 className="font-serif-kr text-[20px] text-noir-800">북마크</h1>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 text-[#B5ADA3] animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <div className="py-16 text-center">
          <Bookmark className="w-10 h-10 text-[#B5ADA3]/40 mx-auto mb-3" />
          <p className="text-[14px] text-[#928980]">북마크한 글이 없습니다</p>
          <Link href={weddingPath()} className="inline-block mt-4 px-5 py-2.5 rounded-xl text-[13px] font-medium text-white bg-[#36534E] hover:bg-[#9A6B62] transition-colors">
            커뮤니티 둘러보기
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
