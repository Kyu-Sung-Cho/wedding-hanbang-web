"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, Eye, Users, Heart, CalendarCheck, TrendingUp, TrendingDown,
  Clock, Search, Loader2, ArrowUpRight, Minus,
} from "lucide-react";

interface AnalyticsData {
  overview: {
    totalViews: number;
    viewChange: number;
    uniqueVisitors: number;
    favoriteCount: number;
    favoriteChange: number;
    bookingRequests: number;
    bookingConfirmed: number;
    bookingChange: number;
    conversionRate: number;
    avgViewDuration: number;
  };
  trend: { date: string; views: number; bookings: number; favorites: number }[];
  favoriteTrend: { date: string; count: number }[];
  products: { id: string; name: string; views: number; bookings: number; conversionRate: number }[];
  customerInsights: {
    topSearchTerms: { term: string; count: number }[];
    viewSources: { search: number; recommendation: number; direct: number };
    peakHours: number[];
  };
}

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: "easeOut" as const },
};

function ChangeIndicator({ value }: { value: number }) {
  if (value === 0) return <span className="flex items-center gap-0.5 text-[23px] text-taupe-400"><Minus className="w-3 h-3" />변동 없음</span>;
  const isUp = value > 0;
  return (
    <span className={`flex items-center gap-0.5 text-[23px] font-medium ${isUp ? "text-[#2E7D5A]" : "text-rose-500"}`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? "+" : ""}{value}%
    </span>
  );
}

function StatCard({ icon: Icon, label, value, change, suffix }: {
  icon: typeof Eye;
  label: string;
  value: number | string;
  change?: number;
  suffix?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-black/[0.04] p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-ivory-warm flex items-center justify-center">
          <Icon className="w-4 h-4 text-rose-500" />
        </div>
        <span className="text-[23px] text-taupe-400 font-medium">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <span className="text-[27px] font-semibold text-noir-800 font-cormorant">{value}</span>
          {suffix && <span className="text-[21px] text-taupe-400 ml-1">{suffix}</span>}
        </div>
        {change !== undefined && <ChangeIndicator value={change} />}
      </div>
    </div>
  );
}

// 미니 바 차트 (CSS 기반)
function MiniBarChart({ data, maxHeight = 80 }: { data: { label: string; value: number }[]; maxHeight?: number }) {
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1" style={{ height: maxHeight }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center flex-1 gap-1">
          <div
            className="w-full bg-rose-500/20 rounded-t-sm min-h-[2px] transition-all"
            style={{ height: `${(d.value / maxVal) * maxHeight * 0.85}px` }}
          >
            <div
              className="w-full bg-rose-500 rounded-t-sm min-h-[2px]"
              style={{ height: "100%" }}
            />
          </div>
          <span className="text-[23px] text-taupe-400">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function TrendChart({ data }: { data: { date: string; views: number; bookings: number; favorites: number }[] }) {
  if (data.length === 0) return null;
  const maxViews = Math.max(...data.map((d) => d.views), 1);
  const chartHeight = 120;

  // 최근 N개만 표시 (7일이면 7개, 30일이면 축약)
  const displayData = data.length <= 14 ? data : data.filter((_, i) => i % Math.ceil(data.length / 14) === 0 || i === data.length - 1);

  return (
    <div className="mt-4">
      <div className="flex items-end gap-[3px]" style={{ height: chartHeight }}>
        {displayData.map((d, i) => {
          const viewH = (d.views / maxViews) * (chartHeight - 20);
          const dateLabel = d.date.slice(5); // "MM-DD"
          return (
            <div key={i} className="flex flex-col items-center flex-1 gap-1 group relative">
              {/* 호버 툴팁 */}
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-noir-800 text-white text-[23px] px-2 py-1 rounded whitespace-nowrap z-10">
                {d.date}: 조회 {d.views} | 찜 {d.favorites} | 예약 {d.bookings}
              </div>
              <div className="w-full flex flex-col items-center gap-0.5">
                {d.bookings > 0 && (
                  <div
                    className="w-2 bg-gold rounded-full"
                    style={{ height: Math.max(4, (d.bookings / maxViews) * (chartHeight - 20)) }}
                  />
                )}
                {d.favorites > 0 && (
                  <div
                    className="w-2 bg-rose-500 rounded-full"
                    style={{ height: Math.max(4, (d.favorites / maxViews) * (chartHeight - 20)) }}
                  />
                )}
                <div
                  className="w-full bg-rose-500/30 rounded-t-sm group-hover:bg-rose-500/50 transition-colors"
                  style={{ height: Math.max(2, viewH) }}
                />
              </div>
              <span className="text-[8px] text-taupe-400 truncate w-full text-center">{dateLabel}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 bg-rose-500/30 rounded-sm" />
          <span className="text-[23px] text-taupe-400">조회수</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-rose-500 rounded-full" />
          <span className="text-[23px] text-taupe-400">찜</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-gold rounded-full" />
          <span className="text-[23px] text-taupe-400">예약</span>
        </div>
      </div>
    </div>
  );
}

function SourceDonut({ sources }: { sources: { search: number; recommendation: number; direct: number } }) {
  const total = sources.search + sources.recommendation + sources.direct;
  if (total === 0) {
    return <p className="text-[21px] text-taupe-400 text-center py-4">데이터가 없습니다</p>;
  }

  const items = [
    { label: "검색", value: sources.search, color: "bg-rose-500" },
    { label: "AI 추천", value: sources.recommendation, color: "bg-gold" },
    { label: "직접 방문", value: sources.direct, color: "bg-taupe-400" },
  ];

  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const pct = total > 0 ? ((item.value / total) * 100) : 0;
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[23px] text-charcoal font-medium">{item.label}</span>
              <span className="text-[23px] text-taupe-400">{item.value}회 ({pct.toFixed(0)}%)</span>
            </div>
            <div className="h-2 bg-ivory-warm rounded-full overflow-hidden">
              <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PeakHoursChart({ hours }: { hours: number[] }) {
  const maxVal = Math.max(...hours, 1);
  // 주요 시간대 (6시~23시)
  const activeHours = hours.slice(6, 24);

  return (
    <div className="flex items-end gap-[2px]" style={{ height: 60 }}>
      {activeHours.map((count, i) => {
        const h = (count / maxVal) * 50;
        const hour = i + 6;
        const isPeak = count >= maxVal * 0.7;
        return (
          <div key={i} className="flex flex-col items-center flex-1 gap-0.5 group relative">
            <div className="absolute bottom-full mb-1 hidden group-hover:block bg-noir-800 text-white text-[23px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
              {hour}시: {count}건
            </div>
            <div
              className={`w-full rounded-t-sm transition-colors ${isPeak ? "bg-rose-500" : "bg-rose-500/30"} group-hover:bg-rose-500`}
              style={{ height: Math.max(2, h) }}
            />
            {(hour % 3 === 0) && (
              <span className="text-[8px] text-taupe-400">{hour}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FavoriteTrendChart({ data }: { data: { date: string; count: number }[] }) {
  const displayData = data.length <= 14 ? data : data.filter((_, i) => i % Math.ceil(data.length / 14) === 0 || i === data.length - 1);
  const maxVal = Math.max(...displayData.map((d) => d.count), 1);
  const totalFavs = data.reduce((s, d) => s + d.count, 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[23px] font-semibold text-noir-800 font-cormorant">{totalFavs}</span>
        <span className="text-[23px] text-taupe-400">건 (기간 내)</span>
      </div>
      <div className="flex items-end gap-[2px]" style={{ height: 50 }}>
        {displayData.map((d, i) => {
          const h = (d.count / maxVal) * 40;
          return (
            <div key={i} className="flex flex-col items-center flex-1 gap-0.5 group relative">
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-noir-800 text-white text-[23px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                {d.date.slice(5)}: {d.count}건
              </div>
              <div
                className={`w-full rounded-t-sm transition-colors ${d.count > 0 ? "bg-rose-500 group-hover:bg-rose-600" : "bg-rose-500/10"}`}
                style={{ height: Math.max(2, h) }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function VendorAnalyticsPage() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("7d");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendor/analytics?period=${period}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-[23px] text-taupe-400">분석 데이터를 불러올 수 없습니다</p>
      </div>
    );
  }

  const periodLabel = period === "7d" ? "7일" : period === "30d" ? "30일" : "90일";

  return (
    <div className="max-w-[1125px] mx-auto">
      {/* 헤더 */}
      <motion.div {...fadeIn} className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-[23px] font-medium text-noir-800">분석 대시보드</h1>
              <p className="text-[23px] text-taupe-400 font-light">최근 {periodLabel} 기준</p>
            </div>
          </div>
          <div className="flex gap-1 bg-ivory-warm rounded-lg p-1">
            {(["7d", "30d", "90d"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-md text-[23px] font-medium transition-colors ${
                  period === p ? "bg-white text-noir-800 shadow-sm" : "text-taupe-400 hover:text-charcoal"
                }`}
              >
                {p === "7d" ? "7일" : p === "30d" ? "30일" : "90일"}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* 핵심 지표 */}
      <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.05 }} className="grid grid-cols-4 gap-4 mb-6 max-md:grid-cols-2">
        <StatCard icon={Eye} label="총 조회수" value={data.overview.totalViews.toLocaleString()} change={data.overview.viewChange} />
        <StatCard icon={Users} label="고유 방문자" value={data.overview.uniqueVisitors.toLocaleString()} />
        <StatCard icon={CalendarCheck} label="예약 전환율" value={data.overview.conversionRate} suffix="%" change={data.overview.bookingChange} />
        <StatCard icon={Clock} label="평균 체류시간" value={data.overview.avgViewDuration} suffix="초" />
      </motion.div>

      {/* 부가 지표 */}
      <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.1 }} className="grid grid-cols-3 gap-4 mb-6 max-md:grid-cols-1">
        <div className="bg-white rounded-2xl border border-black/[0.04] p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#FFF0E8] flex items-center justify-center">
            <Heart className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <p className="text-[23px] text-taupe-400">찜 수</p>
            <div className="flex items-center gap-2">
              <p className="text-[23px] font-semibold text-noir-800 font-cormorant">{data.overview.favoriteCount}</p>
              <ChangeIndicator value={data.overview.favoriteChange} />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-black/[0.04] p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#E8F5EE] flex items-center justify-center">
            <CalendarCheck className="w-5 h-5 text-[#2E7D5A]" />
          </div>
          <div>
            <p className="text-[23px] text-taupe-400">예약 신청</p>
            <p className="text-[23px] font-semibold text-noir-800 font-cormorant">{data.overview.bookingRequests}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-black/[0.04] p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#E8F5EE] flex items-center justify-center">
            <ArrowUpRight className="w-5 h-5 text-[#2E7D5A]" />
          </div>
          <div>
            <p className="text-[23px] text-taupe-400">확정 예약</p>
            <p className="text-[23px] font-semibold text-noir-800 font-cormorant">{data.overview.bookingConfirmed}</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1">
        {/* 왼쪽 (3/5) */}
        <div className="col-span-3 space-y-6">
          {/* 트렌드 차트 */}
          <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.15 }}>
            <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
              <h2 className="text-[21px] font-medium text-noir-800 mb-1">일별 트렌드</h2>
              <p className="text-[23px] text-taupe-400 font-light mb-2">조회수 및 예약 추이</p>
              <TrendChart data={data.trend} />
            </div>
          </motion.div>

          {/* 상품별 성과 */}
          <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.2 }}>
            <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
              <h2 className="text-[21px] font-medium text-noir-800 mb-4">상품별 성과</h2>
              {data.products.length > 0 ? (
                <div className="space-y-3">
                  {/* 헤더 */}
                  <div className="grid grid-cols-4 gap-3 px-3 text-[23px] text-taupe-400 font-medium">
                    <span>상품명</span>
                    <span className="text-center">조회수</span>
                    <span className="text-center">예약수</span>
                    <span className="text-center">전환율</span>
                  </div>
                  {data.products.map((p, i) => (
                    <div key={p.id} className="grid grid-cols-4 gap-3 px-3 py-2.5 rounded-xl bg-ivory-warm/50 items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-[23px] text-taupe-400 font-medium w-4">{i + 1}</span>
                        <span className="text-[21px] text-noir-800 font-medium truncate">{p.name}</span>
                      </div>
                      <span className="text-[21px] text-charcoal text-center">{p.views}</span>
                      <span className="text-[21px] text-charcoal text-center">{p.bookings}</span>
                      <span className={`text-[21px] text-center font-medium ${p.conversionRate > 0 ? "text-[#2E7D5A]" : "text-taupe-400"}`}>
                        {p.conversionRate}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[21px] text-taupe-400 text-center py-6">상품 데이터가 없습니다</p>
              )}
            </div>
          </motion.div>
        </div>

        {/* 오른쪽 (2/5) */}
        <div className="col-span-2 space-y-6">
          {/* 유입 경로 */}
          <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.15 }}>
            <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
              <h2 className="text-[21px] font-medium text-noir-800 mb-4">유입 경로</h2>
              <SourceDonut sources={data.customerInsights.viewSources} />
            </div>
          </motion.div>

          {/* 피크 시간대 */}
          <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.2 }}>
            <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
              <h2 className="text-[21px] font-medium text-noir-800 mb-1">방문 시간대</h2>
              <p className="text-[23px] text-taupe-400 font-light mb-4">시간대별 조회 분포</p>
              <PeakHoursChart hours={data.customerInsights.peakHours} />
            </div>
          </motion.div>

          {/* 찜 트렌드 */}
          <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.25 }}>
            <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
              <div className="flex items-center gap-2 mb-1">
                <Heart className="w-4 h-4 text-rose-500" />
                <h2 className="text-[21px] font-medium text-noir-800">찜 트렌드</h2>
              </div>
              <p className="text-[23px] text-taupe-400 font-light mb-4">기간별 즐겨찾기 추이</p>
              {data.favoriteTrend && data.favoriteTrend.some((f) => f.count > 0) ? (
                <FavoriteTrendChart data={data.favoriteTrend} />
              ) : (
                <p className="text-[21px] text-taupe-400 text-center py-4">찜 데이터가 없습니다</p>
              )}
            </div>
          </motion.div>

          {/* 인기 검색어 */}
          <motion.div {...fadeIn} transition={{ ...fadeIn.transition, delay: 0.3 }}>
            <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
              <div className="flex items-center gap-2 mb-4">
                <Search className="w-4 h-4 text-rose-500" />
                <h2 className="text-[21px] font-medium text-noir-800">인기 검색어</h2>
              </div>
              {data.customerInsights.topSearchTerms.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {data.customerInsights.topSearchTerms.map((t, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 rounded-full bg-ivory-warm text-[23px] text-charcoal font-medium"
                    >
                      {t.term}
                      <span className="text-taupe-400 ml-1">({t.count})</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[21px] text-taupe-400 text-center py-4">검색어 데이터가 없습니다</p>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
