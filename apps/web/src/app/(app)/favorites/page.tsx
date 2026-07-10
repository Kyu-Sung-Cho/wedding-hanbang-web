"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  Sparkles,
  Loader2,
  Heart,
  Trash2,
  ArrowRight,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { weddingPath } from "@/lib/weddingPaths";
import type { Vendor } from "@/types/vendor.types";

// 카테고리별 그룹핑 (vendors.category 기반)
const CATEGORY_LABELS: Record<string, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  venue: "예식장",
  hanbok: "한복",
  jewelry: "예물",
  honeymoon: "신혼여행",
  other: "기타",
};

function categoryLabel(key: string | null | undefined): string {
  if (!key) return "기타";
  return CATEGORY_LABELS[key] ?? key;
}

export default function MyFavoritesPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setIsAuthed(!!user);
      setAuthChecked(true);

      if (!user) {
        setLoading(false);
        return;
      }

      try {
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

        const vendorsRes = await fetch(
          `/api/vendors?ids=${encodeURIComponent(vendorIds.join(","))}&limit=100`
        );
        const vendorsData = await vendorsRes.json().catch(() => ({}));
        setVendors((Array.isArray(vendorsData.vendors) ? vendorsData.vendors : []) as Vendor[]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 찜 해제
  const removeFavorite = async (vendorId: string) => {
    if (removingId) return;
    setRemovingId(vendorId);
    try {
      await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });
      setVendors((prev) => prev.filter((v) => v.id !== vendorId));
    } finally {
      setRemovingId(null);
    }
  };

  // 카테고리별 그룹핑
  const grouped: Record<string, Vendor[]> = {};
  for (const v of vendors) {
    const key = (v as Vendor & { category?: string | null }).category ?? "other";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(v);
  }
  const categories = Object.keys(grouped).sort((a, b) => {
    const aOrder = Object.keys(CATEGORY_LABELS).indexOf(a);
    const bOrder = Object.keys(CATEGORY_LABELS).indexOf(b);
    return (aOrder === -1 ? 99 : aOrder) - (bOrder === -1 ? 99 : bOrder);
  });

  // ────────── 로딩 ──────────
  if (loading || !authChecked) {
    return (
      <div className="max-w-[800px] mx-auto py-20 flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-[#795252] animate-spin" />
      </div>
    );
  }

  // ────────── 비로그인 ──────────
  if (!isAuthed) {
    return (
      <div className="max-w-[640px] mx-auto pt-12">
        <EmptyShell
          title="로그인하면 즐겨찾기를 볼 수 있어요"
          description="마음에 드는 업체를 카테고리별로 모아두는 나만의 공간이에요."
          ctaLabel="로그인"
          ctaHref="/login?redirect=/wedding/favorites"
        />
      </div>
    );
  }

  // ────────── 빈 상태 (가장 흔한 시나리오 — 업체 DB 아직 없음) ──────────
  if (vendors.length === 0) {
    return (
      <div className="max-w-[800px] mx-auto">
        <Header />

        <div className="rounded-[18px] border border-[#eadfc9] bg-white/90 p-8 text-center shadow-[0_8px_24px_rgba(8,22,38,0.035)]">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#795252]/8 text-[#795252] mb-5">
            <Bookmark className="w-8 h-8" />
          </div>

          <h2 className="mb-3 font-serif-kr text-[22px] font-medium leading-tight text-[#071629]">
            아직 즐겨찾기한 업체가 없어요
          </h2>
          <p className="mx-auto mb-1 max-w-md text-[13px] font-medium leading-[1.65] text-[#5d6879]">
            맘에 드는 업체를 발견하면 ♡ 를 눌러 카테고리별로 모아둘 수 있어요.
          </p>
          <p className="text-sm text-[#928980] mb-7">
            지금은 커뮤니티에서 다른 분들의 후기와 추천을 먼저 살펴보세요.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 max-w-md mx-auto">
            <Link
              href={weddingPath()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 py-3 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(54,83,78,0.14)] transition-colors hover:bg-[#2d4642] sm:w-auto"
            >
              커뮤니티 둘러보기
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* 곧 출시 안내 */}
          <div className="mt-8 pt-6 border-t border-[#f0eeec] text-left max-w-md mx-auto">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-[#C9A96E]/12 text-[#C9A96E] flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="text-sm text-[#504444] leading-relaxed">
                <p className="font-medium text-[#1A1A1F] mb-1">곧 만나요</p>
                <p className="text-[#928980]">
                  웨딩한방이 직접 검증한 스튜디오 · 드레스 · 메이크업 · 예식장
                  업체 카탈로그가 준비 중이에요. 오픈하면 즐겨찾기로 바로
                  쌓을 수 있어요.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ────────── 즐겨찾기 목록 (카테고리별 그룹) ──────────
  return (
    <div className="max-w-[800px] mx-auto">
      <Header count={vendors.length} />

      <div className="space-y-8">
        {categories.map((cat) => (
          <section key={cat}>
            <h2 className="text-sm font-medium text-[#B5ADA3] uppercase tracking-[0.12em] mb-3">
              {categoryLabel(cat)}
              <span className="ml-2 text-[#928980] normal-case tracking-normal text-xs">
                {grouped[cat].length}
              </span>
            </h2>

            <div className="space-y-3">
              {grouped[cat].map((v) => (
                <FavoriteCard
                  key={v.id}
                  vendor={v}
                  removing={removingId === v.id}
                  onRemove={() => removeFavorite(v.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ────────── 헤더 ──────────
function Header({ count }: { count?: number }) {
  return (
    <div className="mb-6 animate-fade-in">
      <div className="flex items-end justify-between gap-3 mb-1">
        <h1 className="font-serif-kr text-[26px] font-medium leading-tight text-[#071629] sm:text-[30px]">
          내 즐겨찾기
        </h1>
        {typeof count === "number" && count > 0 && (
          <span className="text-sm text-[#928980] pb-2">
            {count}개 저장됨
          </span>
        )}
      </div>
      <p className="text-[13px] font-medium leading-[1.65] text-[#5d6879]">
        마음에 드는 업체를 카테고리별로 모아둔 나만의 공간이에요.
      </p>
    </div>
  );
}

// ────────── 카드 ──────────
function FavoriteCard({
  vendor,
  removing,
  onRemove,
}: {
  vendor: Vendor;
  removing: boolean;
  onRemove: () => void;
}) {
  const v = vendor as Vendor & {
    rating?: number | null;
    review_count?: number | null;
    region?: string | null;
    image_url?: string | null;
  };
  return (
    <div className="group flex items-stretch gap-3 bg-white rounded-2xl border border-[#f0eeec] shadow-[0_4px_14px_rgb(0,0,0,0.02)] hover:shadow-[0_8px_28px_rgb(0,0,0,0.05)] hover:border-[#795252]/30 transition-all overflow-hidden">
      <Link
        href={weddingPath(`/vendors/${vendor.id}`)}
        className="flex-1 flex items-center gap-3 p-4 min-w-0"
      >
        <div className="shrink-0 w-14 h-14 rounded-xl bg-[#f6f3f2] flex items-center justify-center text-[#795252]">
          <Heart className="w-5 h-5" fill="currentColor" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-serif-kr text-[18px] font-medium leading-snug text-[#071629] truncate">
            {vendor.name}
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[#928980] truncate">
            {v.region && <span>{v.region}</span>}
            {v.rating != null && (
              <>
                {v.region && <span className="text-[#e4e2e1]">·</span>}
                <span>★ {Number(v.rating).toFixed(1)}</span>
              </>
            )}
          </div>
        </div>
      </Link>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        className="shrink-0 px-3 flex items-center justify-center text-[#B5ADA3] hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
        aria-label="즐겨찾기 해제"
        title="즐겨찾기 해제"
      >
        {removing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Trash2 className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

// ────────── 비로그인 빈 화면 ──────────
function EmptyShell({
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#f0eeec] p-10 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-[#795252]/8 text-[#795252] mb-4">
        <Bookmark className="w-7 h-7" />
      </div>
      <h2 className="font-serif-kr text-xl font-light text-[#1A1A1F] mb-2">
        {title}
      </h2>
      <p className="text-sm text-[#504444] leading-relaxed mb-6">
        {description}
      </p>
      <Link
        href={ctaHref}
        className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] transition-all"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}
