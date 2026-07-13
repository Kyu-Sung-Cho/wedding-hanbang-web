"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Star,
  MessageSquare,
  MapPin,
  Sparkles,
  Calendar,
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
  description: string | null;
}

interface ApiResponse {
  tag: VendorTagInfo | null;
  posts: PostWithAuthor[];
  vendor: VendorMatch | null;
}

type LoadState = "loading" | "ready" | "not_found" | "error";

// DB에 저장된 영어 enum (studio/dress/makeup/venue/hanbok/jewelry/honeymoon/other)을
// 화면에 표시할 한글 라벨로 변환. vendorMapper.categoryToKorean과 동일한 매핑이지만
// 이 페이지는 community vendor-tags API 응답을 직접 쓰므로 별도 변환.
const CATEGORY_KR: Record<string, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  venue: "예식장",
  hanbok: "한복",
  jewelry: "예물",
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

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadState("loading");
      setData(null);
      try {
        const res = await fetch(`/api/community/vendor-tags/${encodeURIComponent(decodedName)}`);
        if (res.status === 404) {
          if (!cancelled) setLoadState("not_found");
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) {
          setData(json);
          setLoadState("ready");
        }
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [decodedName, reloadKey]);

  if (loadState === "loading") {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 text-center text-[#B5ADA3]">
        불러오는 중...
      </div>
    );
  }

  if (loadState === "not_found") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14 text-center">
        <h1 className="font-serif text-2xl font-medium text-[#1A1A1F]">업체 태그를 찾을 수 없어요.</h1>
        <p className="mt-2 text-sm text-[#635b51]">정확히 등록된 업체 태그만 공개 게시글과 연결합니다.</p>
        <Link href="/community" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#36534E] px-4 text-sm font-semibold text-white">
          커뮤니티로 돌아가기
        </Link>
      </div>
    );
  }

  if (loadState === "error" || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14 text-center" role="alert">
        <h1 className="font-serif text-2xl font-medium text-[#1A1A1F]">업체 정보를 불러오지 못했어요.</h1>
        <p className="mt-2 text-sm text-[#635b51]">빈 업체 정보로 표시하지 않았어요. 연결을 확인하고 다시 시도해 주세요.</p>
        <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="mt-5 min-h-11 rounded-xl bg-[#36534E] px-4 text-sm font-semibold text-white">
          다시 불러오기
        </button>
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
            </div>
            {vendor?.description && (
              <p className="mt-2.5 text-sm text-[#635b51] leading-relaxed line-clamp-2">
                {vendor.description}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* ─── 근거가 확인된 공개 범위 ─── */}
      <section className="mb-6 rounded-2xl border border-[#F0EFED] bg-white p-5 sm:p-6">
        <div className="flex items-center gap-2 text-[#36534E]">
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          <h2 className="text-sm font-semibold">커뮤니티 언급 참고</h2>
        </div>
        <p className="mt-3 font-serif text-3xl font-medium text-[#1A1A1F]">
          {tag?.mention_count != null ? `${tag.mention_count}건` : "집계 없음"}
        </p>
        <p className="mt-2 text-xs font-medium leading-relaxed text-[#635b51]">
          과거 집계는 고유 참여자 수·수집 기간·산정 근거가 확인되지 않아 평균 별점,
          평균 가격과 추가금 비율을 공개하지 않습니다. 언급 건수도 참고 정보이며 업체의
          품질·인기·예약 가능성을 뜻하지 않습니다.
        </p>
      </section>

      {/* ─── 업체 연결 상태 ─── */}
      <NoBookingFallback name={decodedName} />

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

function NoBookingFallback({ name }: { name: string }) {
  return (
    <section className="bg-white border border-[#F0EFED] rounded-2xl overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-[#F0EFED] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#1A1A1F]">
          <Calendar className="w-4 h-4 text-[#36534E]" />
          <h2
            className="font-serif text-lg font-medium"
            style={{ fontFamily: "'Paperlogy', sans-serif" }}
          >
            업체 연결 상태
          </h2>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#fbf8f2] border border-[#F0EFED] text-[11px] text-[#928980]">
          연동 준비 중
        </span>
      </div>

      <div className="px-5 sm:px-6 py-5">
        <div className="bg-[#fbf8f2] border border-[#F0EFED] rounded-xl p-4 flex items-start gap-3 mb-4">
          <Sparkles className="w-5 h-5 text-[#36534E] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#1A1A1F] mb-0.5">
              <span className="font-semibold">{name}</span> 업체 연결은 준비 중입니다
            </p>
            <p className="text-xs text-[#635b51] leading-relaxed">
              현재 웨딩한방에서는 상담 요청이나 예약을 업체에 전송하지 않습니다. 최신 가격,
              가능 일정과 계약 조건은 업체의 공식 연락처로 직접 확인해 주세요.
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 sm:px-6 py-4 border-t border-[#F0EFED] bg-[#fbf8f2] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-[#928980] leading-relaxed">
          업체 연결이 준비되는 동안 받은 견적의 확인 항목을 먼저 정리할 수 있습니다.
        </p>
        <Link
          href={weddingPath("/community/quote-check")}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#36534E] text-white text-sm font-medium hover:bg-[#2B423E] transition-colors shrink-0"
        >
          <FileSearch className="w-4 h-4" />
          아모라 견적 체크리스트 보기
        </Link>
      </div>
    </section>
  );
}
