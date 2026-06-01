"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Heart, Star, MapPin, Sparkles, Clock, Loader2, ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import type { Vendor } from "@/types/vendor.types";

export default function VendorFavoritesPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login?redirect=/vendors/favorites");
        return;
      }

      try {
        // 찜한 업체 ID 목록 가져오기
        const favRes = await fetch("/api/favorites");
        if (!favRes.ok) {
          setLoading(false);
          return;
        }
        const favData = await favRes.json();
        const vendorIds: string[] = favData.vendorIds ?? [];

        if (vendorIds.length === 0) {
          setVendors([]);
          setLoading(false);
          return;
        }

        // 업체 상세 정보 가져오기 (ids 파라미터로 한번에)
        const idsParam = vendorIds.join(",");
        const vendorRes = await fetch(`/api/vendors?ids=${encodeURIComponent(idsParam)}&limit=100`);
        if (vendorRes.ok) {
          const vendorData = await vendorRes.json();
          const fetchedVendors: Vendor[] = vendorData.vendors ?? [];

          // 찜한 순서대로 정렬 (최근 찜한 것이 위)
          const idOrder = new Map(vendorIds.map((id, i) => [id, i]));
          fetchedVendors.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));

          setVendors(fetchedVendors);
        }
      } catch {
        // 에러 무시
      }
      setLoading(false);
    })();
  }, [router, supabase.auth]);

  // 찜 해제
  const handleRemoveFavorite = async (e: React.MouseEvent, vendorId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setRemovingId(vendorId);

    try {
      await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });
      setVendors((prev) => prev.filter((v) => v.id !== vendorId));
    } catch {
      // 실패 시 무시
    }
    setRemovingId(null);
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6 animate-fade-in">
        <Link
          href="/vendors"
          className="w-8 h-8 rounded-full bg-white border border-black/[0.06] flex items-center justify-center hover:bg-ivory-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-noir-800" />
        </Link>
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 fill-[#36534E] text-[#36534E]" />
          <h1 className="font-serif-kr text-[26px] font-medium leading-tight text-[#071629] sm:text-[30px]">찜한 업체</h1>
          {!loading && vendors.length > 0 && (
            <span className="ml-1 rounded-full bg-[#eef4ef] px-2 py-0.5 text-[12px] font-semibold text-[#36534E]">
              {vendors.length}
            </span>
          )}
        </div>
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && vendors.length === 0 && (
        <div className="py-16 text-center animate-fade-in">
          <Heart className="w-10 h-10 text-[#B5ADA3]/40 mx-auto mb-3" />
          <p className="text-base text-[#928980] mb-1">아직 찜한 업체가 없어요</p>
          <p className="text-sm text-[#B5ADA3] mb-4">마음에 드는 업체를 찜해보세요</p>
          <Link
            href="/vendors"
            className="inline-block rounded-full bg-[#36534E] px-5 py-3 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(54,83,78,0.14)] transition-colors hover:bg-[#2d4642]"
          >
            업체 탐색하기
          </Link>
        </div>
      )}

      {/* 업체 그리드 */}
      {!loading && vendors.length > 0 && (
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          {vendors.map((vendor) => {
            const hasSlots = vendor.timeSlots.some((s) => s.available);
            return (
              <div key={vendor.id} className="animate-fade-in">
                <Link
                  href={`/vendors/${vendor.id}`}
                  className="group block overflow-hidden rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_8px_24px_rgba(8,22,38,0.035)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(8,22,38,0.07)]"
                >
                  {/* 이미지 플레이스홀더 */}
                  <div className="h-[160px] bg-gradient-to-br from-ivory-deep to-ivory-warm relative">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-base text-taupe-400 font-light">{vendor.category} 사진</span>
                    </div>
                    <div className="absolute top-3 left-3 flex gap-2">
                      {vendor.aiRecommend && (
                        <span className="flex items-center gap-1.5 rounded-full bg-[#36534E] px-3 py-1.5 text-[12px] font-semibold text-white">
                          <Sparkles className="w-4 h-4" />
                          AI 추천
                        </span>
                      )}
                      {hasSlots && (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#2E7D5A] text-white text-sm font-medium">
                          <Clock className="w-4 h-4" />
                          예약 가능
                        </span>
                      )}
                    </div>
                    {/* 찜 해제 버튼 */}
                    <button
                      onClick={(e) => handleRemoveFavorite(e, vendor.id)}
                      disabled={removingId === vendor.id}
                      className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center hover:bg-white transition-colors shadow-sm disabled:opacity-50"
                    >
                      {removingId === vendor.id ? (
                        <Loader2 className="w-4 h-4 text-taupe-400 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4 text-taupe-400 hover:text-rose-500 transition-colors" />
                      )}
                    </button>
                  </div>

                  {/* 콘텐츠 */}
                  <div className="p-5">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <h3 className="font-serif-kr text-[18px] font-medium leading-snug text-[#071629] transition-colors group-hover:text-[#36534E]">
                        {vendor.name}
                      </h3>
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 text-gold fill-gold" />
                        <span className="text-[13px] font-semibold text-[#071629]">{vendor.rating}</span>
                        <span className="text-[12px] text-[#5d6879]">({vendor.reviewCount})</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 mb-3">
                      <MapPin className="w-4 h-4 text-taupe-400" />
                      <span className="text-[13px] font-medium text-[#5d6879]">{vendor.location}</span>
                      <span className="mx-1 text-[13px] text-[#d7cbb8]">·</span>
                      <span className="text-[13px] font-semibold text-[#36534E]">{vendor.priceRange}</span>
                    </div>

                    <div className="flex gap-1.5 flex-wrap">
                      {vendor.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-[#f7f3ec] px-2.5 py-1 text-[12px] font-medium text-[#5d6879]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
