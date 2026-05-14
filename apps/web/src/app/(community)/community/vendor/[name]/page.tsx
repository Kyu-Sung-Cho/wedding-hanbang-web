"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Star,
  MessageSquare,
  TrendingUp,
  MapPin,
  Sparkles,
  Calendar,
  Clock,
  ArrowRight,
  Tag,
  FileSearch,
} from "lucide-react";
import { timeAgo } from "@/utils/timeAgo";
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

interface VendorProductLite {
  id: string;
  name: string;
  price: number;
  discount_price: number | null;
  duration: number | null;
  is_popular: boolean;
}

interface ApiResponse {
  tag: VendorTagInfo | null;
  posts: PostWithAuthor[];
  vendor: VendorMatch | null;
  products: VendorProductLite[];
}

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

// 데모용 슬롯 생성 — vendor_timeslots 테이블 미연동 시 fallback.
// 실제 슬롯 연동되면 이 함수만 fetch로 교체.
function generateDemoSlots(seedKey: string): Array<{
  date: Date;
  slots: Array<{ hour: number; available: boolean; remaining: number }>;
}> {
  // seed 기반 deterministic — 같은 vendor면 항상 같은 슬롯 보여주게
  let seed = 0;
  for (let i = 0; i < seedKey.length; i++) seed = (seed * 31 + seedKey.charCodeAt(i)) >>> 0;
  const random = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 0xffffffff;
  };

  const days: Array<{
    date: Date;
    slots: Array<{ hour: number; available: boolean; remaining: number }>;
  }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const slots: Array<{ hour: number; available: boolean; remaining: number }> = [];
    for (let h = 10; h <= 18; h++) {
      const r = random();
      const available = r > 0.35;
      slots.push({ hour: h, available, remaining: available ? Math.ceil(random() * 3) : 0 });
    }
    days.push({ date, slots });
  }
  return days;
}

function formatPrice(value: number): string {
  if (value >= 10000) return `${Math.round(value / 10000).toLocaleString()}만원`;
  return `${value.toLocaleString()}원`;
}

function formatDateLabel(date: Date, isToday: boolean, isTomorrow: boolean): string {
  if (isToday) return "오늘";
  if (isTomorrow) return "내일";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function VendorDetailPage() {
  const params = useParams<{ name: string }>();
  const decodedName = decodeURIComponent(params.name);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/community/vendor-tags/${encodeURIComponent(decodedName)}`);
        if (!res.ok) return;
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) {
          setData(json);
          if (json.products.length > 0) setSelectedProductId(json.products[0].id);
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

  const demoSlots = useMemo(
    () => (data?.vendor ? generateDemoSlots(data.vendor.id) : []),
    [data?.vendor]
  );

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
  const products = data?.products ?? [];

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
            <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-2xl bg-gradient-to-br from-[#fcf9f8] to-[#f0efed] flex items-center justify-center shrink-0">
              <Tag className="w-8 h-8 text-[#B5ADA3]" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1
              className="font-serif text-2xl sm:text-3xl font-medium text-[#1A1A1F] mb-2 leading-tight"
              style={{ fontFamily: "'Noto Serif KR', serif" }}
            >
              {decodedName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-[#878680]">
              <span>{vendor?.category ?? tag?.category ?? "업체"}</span>
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
                  <span className="inline-flex items-center gap-1 text-[#C9A96E]">
                    <Star className="w-3.5 h-3.5 fill-[#C9A96E]" />
                    {vendor.rating.toFixed(1)}
                    {vendor.review_count != null && (
                      <span className="text-[#B5ADA3]">({vendor.review_count})</span>
                    )}
                  </span>
                </>
              )}
            </div>
            {vendor?.description && (
              <p className="mt-2.5 text-sm text-[#504444] leading-relaxed line-clamp-2">
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
          accent={tag?.avg_rating != null ? "#C9A96E" : undefined}
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

      {/* ─── 예약 섹션 ─── */}
      {vendor ? (
        <BookingSection
          vendor={vendor}
          products={products}
          selectedProductId={selectedProductId}
          onSelectProduct={setSelectedProductId}
          demoSlots={demoSlots}
          selectedDayIndex={selectedDayIndex}
          onSelectDay={setSelectedDayIndex}
        />
      ) : (
        <NoBookingFallback name={decodedName} />
      )}

      {/* ─── 관련 게시글 ─── */}
      <section className="mt-10">
        <h2 className="font-serif text-xl font-medium text-[#1A1A1F] mb-4">
          관련 게시글{" "}
          {posts.length > 0 && <span className="text-[#C4967E]">{posts.length}</span>}
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
                  className="block bg-white border border-[#F0EFED] rounded-2xl p-5 sm:p-6 hover:border-[#C4967E] transition"
                >
                  <div className="flex items-center gap-2 text-sm text-[#B5ADA3] mb-2">
                    <span className="text-[#C4967E] font-medium">
                      {post.author?.nickname ?? "익명"}
                    </span>
                    <span>·</span>
                    <span>{timeAgo(post.created_at)}</span>
                    {post.rating != null && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-[#C9A96E]">
                          <Star className="w-3.5 h-3.5 fill-[#C9A96E]" />
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

function BookingSection({
  vendor,
  products,
  selectedProductId,
  onSelectProduct,
  demoSlots,
  selectedDayIndex,
  onSelectDay,
}: {
  vendor: VendorMatch;
  products: VendorProductLite[];
  selectedProductId: string | null;
  onSelectProduct: (id: string) => void;
  demoSlots: Array<{
    date: Date;
    slots: Array<{ hour: number; available: boolean; remaining: number }>;
  }>;
  selectedDayIndex: number;
  onSelectDay: (idx: number) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selectedDay = demoSlots[selectedDayIndex];

  return (
    <section className="bg-white border border-[#F0EFED] rounded-2xl overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-[#F0EFED] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#1A1A1F]">
          <Calendar className="w-4 h-4 text-[#795252]" />
          <h2 className="font-serif text-lg font-medium" style={{ fontFamily: "'Noto Serif KR', serif" }}>
            예약 가능 시간
          </h2>
        </div>
        <span className="text-xs text-[#928980]">앞으로 7일</span>
      </div>

      {/* 상품 선택 */}
      {products.length > 0 && (
        <div className="px-5 sm:px-6 py-4 border-b border-[#F0EFED]">
          <p className="text-xs font-medium text-[#928980] mb-2.5 uppercase tracking-wider">
            상품
          </p>
          <div className="flex flex-wrap gap-2">
            {products.map((product) => {
              const selected = product.id === selectedProductId;
              const displayPrice = product.discount_price ?? product.price;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => onSelectProduct(product.id)}
                  className={`group flex-1 min-w-[200px] text-left rounded-xl border px-4 py-3 transition-all ${
                    selected
                      ? "border-[#795252] bg-[#fffdfb] shadow-sm"
                      : "border-[#F0EFED] bg-white hover:border-[#d9c8c8]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-[#1A1A1F]">{product.name}</span>
                    {product.is_popular && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#C9A96E]/10 text-[10px] text-[#C9A96E] font-medium">
                        <Star className="w-2.5 h-2.5 fill-[#C9A96E]" />
                        인기
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-semibold text-[#795252]">
                      {formatPrice(displayPrice)}
                    </span>
                    {product.discount_price && (
                      <span className="text-xs text-[#B5ADA3] line-through">
                        {formatPrice(product.price)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 날짜 탭 */}
      <div className="px-5 sm:px-6 py-4 border-b border-[#F0EFED] overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {demoSlots.map((day, idx) => {
            const isToday = day.date.getTime() === today.getTime();
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            const isTomorrow = day.date.getTime() === tomorrow.getTime();
            const dayLabel = DAY_LABELS[day.date.getDay()];
            const availableCount = day.slots.filter((s) => s.available).length;
            const selected = idx === selectedDayIndex;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectDay(idx)}
                className={`flex flex-col items-center justify-center px-3.5 py-2.5 rounded-xl border transition-all min-w-[64px] ${
                  selected
                    ? "border-[#795252] bg-[#795252] text-white"
                    : availableCount === 0
                      ? "border-[#F0EFED] bg-[#fafaf8] text-[#B5ADA3]"
                      : "border-[#F0EFED] bg-white text-[#1A1A1F] hover:border-[#d9c8c8]"
                }`}
              >
                <span
                  className={`text-[11px] font-medium ${
                    selected ? "text-white/80" : "text-[#928980]"
                  }`}
                >
                  {dayLabel}
                </span>
                <span className="text-sm font-semibold mt-0.5">
                  {formatDateLabel(day.date, isToday, isTomorrow)}
                </span>
                <span
                  className={`text-[10px] mt-1 ${
                    selected ? "text-white/70" : "text-[#B5ADA3]"
                  }`}
                >
                  {availableCount > 0 ? `${availableCount}자리` : "마감"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 시간 슬롯 그리드 */}
      <div className="px-5 sm:px-6 py-5">
        {selectedDay ? (
          <>
            <div className="flex items-center gap-2 mb-3 text-xs text-[#928980]">
              <Clock className="w-3.5 h-3.5" />
              <span>
                {selectedDay.date.getMonth() + 1}월 {selectedDay.date.getDate()}일 · 시간 선택
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {selectedDay.slots.map((slot) => {
                const available = slot.available;
                const href = available
                  ? `/vendors/${vendor.id}${
                      selectedProductId ? `?product=${selectedProductId}` : ""
                    }`
                  : undefined;
                const content = (
                  <div
                    className={`rounded-lg px-2.5 py-3 text-center transition-colors ${
                      available
                        ? "bg-[#fffdfb] border border-[#d9c8c8] text-[#795252] hover:bg-[#795252] hover:text-white hover:border-[#795252]"
                        : "bg-[#fafaf8] border border-[#f0efed] text-[#B5ADA3] cursor-not-allowed"
                    }`}
                  >
                    <div className="text-sm font-semibold">{slot.hour}:00</div>
                    <div className="text-[10px] mt-0.5">
                      {available ? `잔여 ${slot.remaining}` : "마감"}
                    </div>
                  </div>
                );
                return href ? (
                  <Link key={slot.hour} href={href} className="block">
                    {content}
                  </Link>
                ) : (
                  <div key={slot.hour}>{content}</div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-sm text-[#B5ADA3] text-center py-6">
            이 날짜에는 예약 가능 시간이 없습니다.
          </p>
        )}
      </div>

      {/* CTA */}
      <div className="px-5 sm:px-6 py-4 border-t border-[#F0EFED] bg-[#fcf9f8] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-[#928980] leading-relaxed">
          슬롯을 누르면 업체 상세 페이지에서 예약을 확정합니다. 확정 시 등록한 연락처로
          안내됩니다.
        </p>
        <Link
          href={`/vendors/${vendor.id}${
            selectedProductId ? `?product=${selectedProductId}` : ""
          }`}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#795252] text-white text-sm font-medium hover:bg-[#946a6a] transition-colors shrink-0"
        >
          업체 상세로 가기
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}

function NoBookingFallback({ name }: { name: string }) {
  // 데모/온보딩용 미리보기 슬롯 — 진짜 데이터가 아님을 명시. 실제 예약은 연동 후 가능.
  const previewDays = ["오늘", "내일", "금"];
  const previewHours = [11, 13, 15, 17];
  return (
    <section className="bg-white border border-[#F0EFED] rounded-2xl overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-[#F0EFED] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#1A1A1F]">
          <Calendar className="w-4 h-4 text-[#795252]" />
          <h2
            className="font-serif text-lg font-medium"
            style={{ fontFamily: "'Noto Serif KR', serif" }}
          >
            예약 가능 시간
          </h2>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#fcf9f8] border border-[#F0EFED] text-[11px] text-[#928980]">
          연동 준비 중
        </span>
      </div>

      <div className="px-5 sm:px-6 py-5">
        <div className="bg-[#fcf9f8] border border-[#F0EFED] rounded-xl p-4 flex items-start gap-3 mb-4">
          <Sparkles className="w-5 h-5 text-[#795252] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#1A1A1F] mb-0.5">
              <span className="font-semibold">{name}</span>은(는) 아직 예약 연동 전입니다
            </p>
            <p className="text-xs text-[#504444] leading-relaxed">
              커뮤니티 데이터는 모이고 있지만 실시간 슬롯은 곧 오픈됩니다. 아래는 슬롯 UI
              미리보기 — 연동 완료된 업체는 이 화면에서 바로 예약합니다.
            </p>
          </div>
        </div>

        {/* 미리보기 슬롯 — 클릭 비활성 */}
        <div className="opacity-60 pointer-events-none select-none">
          <div className="flex gap-2 overflow-x-auto mb-3">
            {previewDays.map((d, i) => (
              <div
                key={d}
                className={`flex flex-col items-center justify-center px-3.5 py-2 rounded-xl border ${
                  i === 0
                    ? "border-[#795252] bg-[#795252] text-white"
                    : "border-[#F0EFED] bg-white text-[#1A1A1F]"
                } min-w-[64px]`}
              >
                <span className="text-[11px] font-medium opacity-80">
                  {["일", "월", "화", "수", "목", "금", "토"][(new Date().getDay() + i) % 7]}
                </span>
                <span className="text-sm font-semibold mt-0.5">{d}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {previewHours.map((h) => (
              <div
                key={h}
                className="rounded-lg px-2.5 py-3 text-center bg-[#fffdfb] border border-[#d9c8c8] text-[#795252]"
              >
                <div className="text-sm font-semibold">{h}:00</div>
                <div className="text-[10px] mt-0.5">잔여 2</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 sm:px-6 py-4 border-t border-[#F0EFED] bg-[#fcf9f8] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-[#928980] leading-relaxed">
          연동 완료까지는 받은 견적을 먼저 진단하고, 계약 함정을 확인해 보세요.
        </p>
        <Link
          href="/community/quote-check"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#795252] text-white text-sm font-medium hover:bg-[#946a6a] transition-colors shrink-0"
        >
          <FileSearch className="w-4 h-4" />
          아모라 견적 진단 받기
        </Link>
      </div>
    </section>
  );
}
