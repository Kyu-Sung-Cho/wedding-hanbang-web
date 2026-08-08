"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Star,
  MessageSquare,
  TrendingUp,
  MapPin,
  ArrowRight,
  Tag,
  FileSearch,
} from "lucide-react";
import { timeAgo } from "@/utils/timeAgo";
import { communityPostPath } from "@/lib/community/routes";
import { weddingPath } from "@/lib/weddingPaths";
import type { VendorTagInfo, PostWithAuthor } from "@/types/community.types";

interface VendorMatch {
  id: string;
  name: string;
  category: string;
  region: string | null;
  address: string | null;
  thumbnail_url: string | null;
  rating: number | null;
  review_count: number | null;
  price_min: number;
  price_max: number;
  price_range: string | null;
  description: string | null;
}

interface ApiResponse {
  tag: VendorTagInfo | null;
  posts: PostWithAuthor[];
  vendor: VendorMatch | null;
}

// DB에 저장된 영어 enum (studio/dress/makeup/venue/hanbok/jewelry/honeymoon/other)을
// 화면에 표시할 한글 라벨로 변환. vendorMapper.categoryToKorean과 동일한 매핑이지만
// 이 페이지는 community vendor-tags API 응답을 직접 쓰므로 별도 변환.
const CATEGORY_KR: Record<string, string> = {
  studio: "웨딩 사진 촬영",
  dress: "드레스",
  makeup: "헤어·메이크업",
  venue: "결혼식장",
  hanbok: "한복",
  jewelry: "결혼반지·기념 선물",
  honeymoon: "신혼여행",
  other: "기타",
};
function categoryLabel(raw: string | null | undefined): string {
  if (!raw) return "업체";
  return CATEGORY_KR[raw] ?? raw;
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
        if (!cancelled) {
          setData(json);
        }
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 text-center text-[#B5ADA3]">
        불러오는 중...
      </div>
    );
  }

  const tag = data?.tag;
  const posts = data?.posts ?? [];
  const vendor = data?.vendor;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      {/* ─── 히어로 ─── */}
      <header className="mb-8">
        <div className="flex items-start gap-4 sm:gap-6">
          {vendor?.thumbnail_url ? (
            <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-[#F0EFED] shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={vendor.thumbnail_url}
                alt={vendor.name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-2xl bg-gradient-to-br from-[#fbf8f2] to-[#f0efed] flex items-center justify-center shrink-0">
              <Tag className="w-8 h-8 text-[#B5ADA3]" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1
              className="font-serif text-2xl sm:text-3xl font-medium text-[#1A1A1F] mb-2 leading-tight"
              style={{ fontFamily: "'Paperlogy', sans-serif" }}
            >
              {decodedName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-[#878680]">
              <span>{categoryLabel(vendor?.category ?? tag?.category)}</span>
              {(vendor?.region || tag?.region) && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {vendor?.region ?? tag?.region}
                  </span>
                </>
              )}
              {vendor?.rating != null && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-[#B89785]">
                    <Star className="w-3.5 h-3.5 fill-[#B89785]" />
                    {vendor.rating.toFixed(1)}
                    {vendor.review_count != null && (
                      <span className="text-[#B5ADA3]">({vendor.review_count})</span>
                    )}
                  </span>
                </>
              )}
            </div>
            {vendor?.description && (
              <p className="mt-2.5 text-sm text-[#635b51] leading-relaxed line-clamp-2">
                {vendor.description}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* ─── 커뮤니티 통계 ─── */}
      <section className="bg-white border border-[#F0EFED] rounded-2xl p-5 sm:p-6 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          label="언급수"
          value={tag?.mention_count != null ? String(tag.mention_count) : "-"}
        />
        <Stat
          icon={<Star className="w-3.5 h-3.5" />}
          label="평균 별점"
          value={tag?.avg_rating != null ? tag.avg_rating.toFixed(1) : "-"}
          accent={tag?.avg_rating != null ? "#B89785" : undefined}
        />
        <Stat
          label="평균 기본금"
          value={tag?.avg_base_price != null ? `${tag.avg_base_price}만` : "-"}
        />
        <Stat
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="추가금 발생률"
          value={tag?.extra_rate != null ? `${Math.round(tag.extra_rate * 100)}%` : "-"}
          sub={
            tag?.avg_extra_price != null ? `평균 ${tag.avg_extra_price}만` : undefined
          }
        />
      </section>

      <section className="mb-6 border-y border-[#F0EFED] bg-[#fbf8f2] px-5 py-5 sm:px-6">
        <h2 className="text-base font-semibold text-[#1A1A1F]">
          이 업체 정보를 확인할 때
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#635b51]">
          웨딩한방에서는 이 업체의 예약 가능 시간이나 예약 완료 여부를 제공하지
          않습니다. 공개된 가격·조건은 원문에서 다시 확인하고, 직접 받은 견적은
          항목별로 정리해 보세요.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/price"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#36534E]/20 bg-white px-4 text-sm font-semibold text-[#36534E]"
          >
            공개 가격 보기
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href={weddingPath("/community/quote-check")}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#36534E] px-4 text-sm font-semibold text-white"
          >
            <FileSearch className="h-4 w-4" />
            받은 견적 확인하기
          </Link>
        </div>
      </section>

      {/* ─── 관련 게시글 ─── */}
      <section className="mt-10">
        <h2 className="font-serif text-xl font-medium text-[#1A1A1F] mb-4">
          관련 게시글{" "}
          {posts.length > 0 && <span className="text-[#36534E]">{posts.length}</span>}
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
                  href={communityPostPath(post.id)}
                  className="block bg-white border border-[#F0EFED] rounded-2xl p-5 sm:p-6 hover:border-[#36534E] transition"
                >
                  <div className="flex items-center gap-2 text-sm text-[#B5ADA3] mb-2">
                    <span className="text-[#36534E] font-medium">
                      {post.author?.nickname ?? "익명"}
                    </span>
                    <span>·</span>
                    <span>{timeAgo(post.created_at)}</span>
                    {post.rating != null && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-[#B89785]">
                          <Star className="w-3.5 h-3.5 fill-[#B89785]" />
                          {post.rating}
                        </span>
                      </>
                    )}
                  </div>
                  <h3 className="text-lg font-medium text-[#1A1A1F] mb-1">{post.title}</h3>
                  {preview && (
                    <p className="text-sm text-[#878680] line-clamp-2">{preview}</p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-[#B5ADA3] mb-1.5">
        {icon}
        {label}
      </div>
      <p
        className="text-2xl font-medium leading-none"
        style={{ color: accent ?? "#1A1A1F" }}
      >
        {value}
        {accent && value !== "-" && (
          <Star className="w-4 h-4 inline-block ml-1 -mt-1" fill={accent} stroke={accent} />
        )}
      </p>
      {sub && <p className="text-xs text-[#B5ADA3] mt-1">{sub}</p>}
    </div>
  );
}
