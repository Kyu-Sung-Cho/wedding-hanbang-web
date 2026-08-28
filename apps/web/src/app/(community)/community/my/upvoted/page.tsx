"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { ThumbsUp, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import PostCard from "@/components/community/PostCard";
import CommunityConfigurationUnavailable from "@/components/community/CommunityConfigurationUnavailable";
import { weddingPath } from "@/lib/weddingPaths";
import type { PostWithAuthor } from "@/types/community.types";

export default function MyUpvotedPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const configurationUnavailable =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    connectionFailed;

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          router.push(`/login?redirect=${encodeURIComponent(weddingPath("/community/my/upvoted"))}`);
          return;
        }

        const res = await fetch("/api/community/posts/voted?limit=100");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setPosts(data.posts ?? []);
            setTotal(data.total ?? 0);
          }
        }
      } catch {
        if (!cancelled) {
          setConnectionFailed(true);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (configurationUnavailable) {
    return (
      <CommunityConfigurationUnavailable
        retryHref={weddingPath("/community/my/upvoted")}
      />
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={weddingPath()}
          className="w-8 h-8 rounded-full bg-white border border-black/[0.06] flex items-center justify-center hover:bg-[var(--hb-surface-hover)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-[var(--hb-text-strong)]" />
        </Link>
        <div className="flex items-center gap-2">
          <ThumbsUp className="w-5 h-5 text-[#2E7D5A]" />
          <h1 className="font-serif-kr text-[20px] text-[var(--hb-text-strong)]">좋아요한 글</h1>
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
          <Loader2 className="w-6 h-6 text-[var(--hb-text-muted)] animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        /* 빈 상태 */
        <div className="py-16 text-center">
          <ThumbsUp className="w-10 h-10 text-[var(--hb-text-muted)]/40 mx-auto mb-3" />
          <p className="text-[14px] text-[var(--hb-text-muted)] mb-1">아직 좋아요한 글이 없어요</p>
          <p className="text-[12px] text-[var(--hb-text-muted)] mb-4">마음에 드는 글에 좋아요를 눌러보세요</p>
          <Link
            href={weddingPath()}
            className="inline-block px-5 py-2.5 rounded-xl text-[13px] font-medium text-white bg-[var(--hb-primary)] hover:bg-[#9A6B62] transition-colors"
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
