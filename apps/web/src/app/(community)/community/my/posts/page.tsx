"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { FileText, Loader2, Pencil, Trash2, Eye, EyeOff, ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { PostWithAuthor } from "@/types/community.types";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";

export default function MyPostsPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<"published" | "draft">("published");

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login?redirect=/community/my/posts"); return; }
      setUserId(user.id);
    })();
  }, [router, supabase.auth]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetch(`/api/community/posts?author_id=${userId}&limit=100`)
      .then((r) => r.json())
      .then((data) => { setPosts(data.posts ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [userId]);

  const published = posts.filter((p) => p.visibility !== "draft");
  const drafts = posts.filter((p) => p.visibility === "draft");
  const displayed = tab === "published" ? published : drafts;

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/community/posts/${id}`, { method: "DELETE" });
    if (res.ok) setPosts((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/community" className="w-8 h-8 rounded-full bg-white border border-black/[0.06] flex items-center justify-center hover:bg-ivory-100 transition-colors">
          <ArrowLeft className="w-4 h-4 text-noir-800" />
        </Link>
        <h1 className="font-serif-kr text-[20px] text-noir-800">내 글</h1>
      </div>

      {/* 탭 */}
      <div className="flex gap-2 mb-6">
        {[
          { key: "published" as const, label: "발행됨", count: published.length },
          { key: "draft" as const, label: "임시저장", count: drafts.length },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-[13px] font-medium transition-colors ${
              tab === t.key ? "bg-[#9d6f36] text-white" : "bg-white border border-black/[0.06] text-[#928980] hover:bg-ivory-100"
            }`}
          >
            {t.label} {t.count > 0 && <span className="ml-1 opacity-60">{t.count}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 text-[#B5ADA3] animate-spin" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="py-16 text-center">
          <FileText className="w-10 h-10 text-[#B5ADA3]/40 mx-auto mb-3" />
          <p className="text-[14px] text-[#928980]">
            {tab === "published" ? "아직 작성한 글이 없습니다" : "임시저장된 글이 없습니다"}
          </p>
          <Link href="/community/post/write" className="inline-block mt-4 px-5 py-2.5 rounded-xl text-[13px] font-medium text-white bg-[#C4967E] hover:bg-[#9A6B62] transition-colors">
            글쓰기
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((post) => {
            const cat = CATEGORY_MAP[post.category];
            return (
              <div key={post.id} className="bg-white rounded-2xl border border-black/[0.04] px-5 py-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      {cat && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cat.bgColor} ${cat.color}`}>
                          {cat.shortLabel}
                        </span>
                      )}
                      {post.visibility === "members" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium flex items-center gap-0.5">
                          <EyeOff className="w-2.5 h-2.5" /> 회원
                        </span>
                      )}
                    </div>
                    <Link href={`/community/post/${post.id}`} className="text-[14px] font-medium text-noir-800 hover:underline line-clamp-1">
                      {post.title}
                    </Link>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-[#B5ADA3]">
                      <span>{timeAgo(post.created_at)}</span>
                      <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" /> {post.view_count}</span>
                      <span>좋아요 {post.upvote_count}</span>
                      <span>댓글 {post.comment_count}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Link
                      href={`/community/post/write?edit=${post.id}`}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-ivory-100 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Link>
                    <button
                      onClick={() => handleDelete(post.id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-red-50 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
