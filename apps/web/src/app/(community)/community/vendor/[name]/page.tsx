"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Star, MessageSquare, TrendingUp } from "lucide-react";
import { timeAgo } from "@/utils/timeAgo";
import type { VendorTagInfo, PostWithAuthor } from "@/types/community.types";

interface ApiResponse {
  tag: VendorTagInfo | null;
  posts: PostWithAuthor[];
}

export default function VendorDetailPage() {
  const params = useParams<{ name: string }>();
  const decodedName = decodeURIComponent(params.name);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/community/vendor-tags/${encodeURIComponent(decodedName)}`);
        if (!res.ok) return;
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) setData(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [decodedName]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-center text-[#B5ADA3]">
        불러오는 중...
      </div>
    );
  }

  const tag = data?.tag;
  const posts = data?.posts ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <h1
        className="font-serif text-3xl font-medium text-[#1A1A1F] mb-2"
        style={{ fontFamily: "'Noto Serif KR', serif" }}
      >
        {decodedName}
      </h1>
      <p className="text-sm text-[#878680] mb-8">
        {tag?.category ?? "업체"} {tag?.region ? `· ${tag.region}` : ""}
      </p>

      {/* 집계 카드 */}
      <div className="bg-white border border-[#F0EFED] rounded-2xl p-6 sm:p-8 mb-8 grid grid-cols-2 sm:grid-cols-4 gap-5">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-[#B5ADA3] mb-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            언급수
          </div>
          <p className="text-2xl font-medium text-[#1A1A1F]">
            {tag?.mention_count ?? 0}
          </p>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-xs text-[#B5ADA3] mb-1.5">
            <Star className="w-3.5 h-3.5" />
            평균 별점
          </div>
          <p className="text-2xl font-medium text-[#C9A96E] flex items-center gap-1">
            {tag?.avg_rating != null ? tag.avg_rating.toFixed(1) : "-"}
            {tag?.avg_rating != null && (
              <Star className="w-4 h-4" fill="#C9A96E" />
            )}
          </p>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-xs text-[#B5ADA3] mb-1.5">평균 기본금</div>
          <p className="text-2xl font-medium text-[#1A1A1F]">
            {tag?.avg_base_price != null ? `${tag.avg_base_price}만` : "-"}
          </p>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-xs text-[#B5ADA3] mb-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            추가금 발생률
          </div>
          <p className="text-2xl font-medium text-[#1A1A1F]">
            {tag?.extra_rate != null ? `${Math.round(tag.extra_rate * 100)}%` : "-"}
          </p>
          {tag?.avg_extra_price != null && (
            <p className="text-xs text-[#B5ADA3] mt-1">
              평균 {tag.avg_extra_price}만
            </p>
          )}
        </div>
      </div>

      {/* 게시글 목록 */}
      <h2 className="font-serif text-xl font-medium text-[#1A1A1F] mb-4">
        관련 게시글 {posts.length > 0 && <span className="text-[#C4967E]">{posts.length}</span>}
      </h2>

      {posts.length === 0 ? (
        <div className="bg-white border border-[#F0EFED] rounded-2xl p-10 text-center text-[#B5ADA3]">
          아직 관련 게시글이 없어요.
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
            const preview = post.content
              .replace(/<[^>]*>/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 140);
            return (
              <Link
                key={post.id}
                href={`/community/post/${post.id}`}
                className="block bg-white border border-[#F0EFED] rounded-2xl p-6 hover:border-[#C4967E] transition"
              >
                <div className="flex items-center gap-2 text-sm text-[#B5ADA3] mb-2">
                  <span className="text-[#C4967E] font-medium">
                    {post.author?.nickname ?? "익명"}
                  </span>
                  <span>&middot;</span>
                  <span>{timeAgo(post.created_at)}</span>
                  {post.rating != null && (
                    <>
                      <span>&middot;</span>
                      <span className="inline-flex items-center gap-1 text-[#C9A96E]">
                        <Star className="w-3.5 h-3.5" fill="#C9A96E" />
                        {post.rating}
                      </span>
                    </>
                  )}
                </div>
                <h3 className="text-lg font-medium text-[#1A1A1F] mb-1">
                  {post.title}
                </h3>
                {preview && (
                  <p className="text-sm text-[#878680] line-clamp-2">{preview}</p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
