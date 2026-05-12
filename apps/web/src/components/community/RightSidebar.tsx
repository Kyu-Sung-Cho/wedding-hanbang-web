"use client";

import Link from "next/link";
import { ArrowRight, FileSearch, Sparkles, TrendingUp } from "lucide-react";

interface PopularTag {
  vendor_name: string;
  mention_count: number;
}

interface WeeklySummary {
  newPostsThisWeek?: number;
  topVendor?: string | null;
}

interface RightSidebarProps {
  popularTags?: PopularTag[];
  weekly?: WeeklySummary;
}

export default function RightSidebar({ popularTags = [], weekly }: RightSidebarProps) {
  const postCount = weekly?.newPostsThisWeek ?? 0;
  const postTrend = postCount > 50 ? "up" : postCount > 20 ? "steady" : "down";
  const postTrendLabel =
    postTrend === "up" ? "활발" : postTrend === "steady" ? "안정적" : "준비 중";
  const postTrendWidth = postTrend === "up" ? "78%" : postTrend === "steady" ? "52%" : "28%";

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#d9c8c8] bg-[#795252] p-4 text-white shadow-[0_8px_24px_rgba(121,82,82,0.14)]">
        <div className="mb-3 flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-[#dee6c4]" />
          <h3 className="font-serif-kr text-lg">아모라 견적진단</h3>
        </div>
        <p className="text-sm leading-relaxed text-white/80">
          받은 견적서에서 빠진 항목, 추가금 가능성, 계약 전 질문을 먼저 정리해요.
        </p>
        <Link
          href="/community/quote-check"
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-[#795252] transition-colors hover:bg-[#fff8f5]"
        >
          바로 진단하기
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <section className="rounded-lg border border-[#e4e2e1] bg-white p-4">
        <div className="mb-4 flex items-center gap-2 border-b border-[#e4e2e1] pb-2">
          <TrendingUp className="h-4 w-4 text-[#5a6147]" />
          <h3 className="font-serif-kr text-lg text-[#1b1c1c]">커뮤니티 현황</h3>
        </div>
        <div className="space-y-3.5">
          <MetricRow
            label="전체 글"
            value={postCount > 0 ? `${postCount.toLocaleString("ko-KR")}건` : postTrendLabel}
            width={postTrendWidth}
            color="bg-sage-500"
          />
          <MetricRow
            label="많이 언급된 업체"
            value={weekly?.topVendor ?? "---"}
            width="62%"
            color="bg-[#795252]"
          />
        </div>
      </section>

      {popularTags.length > 0 && (
        <section className="rounded-lg border border-[#e4e2e1] bg-white p-4">
          <h3 className="mb-3 border-b border-[#e4e2e1] pb-2 font-serif-kr text-lg text-[#1b1c1c]">
            많이 언급된 업체
          </h3>
          <div className="flex flex-wrap gap-2">
            {popularTags.slice(0, 10).map((tag) => (
              <Link
                key={tag.vendor_name}
                href={`/community/vendor/${encodeURIComponent(tag.vendor_name)}`}
                className="rounded-full bg-[#f6f3f2] px-3 py-1.5 text-xs text-[#504444] transition-colors hover:bg-[#f0eded] hover:text-[#795252]"
              >
                #{tag.vendor_name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-[#e4e2e1] bg-white p-4">
        <div className="mb-3 flex items-center gap-2 border-b border-[#e4e2e1] pb-2">
          <FileSearch className="h-4 w-4 text-[#795252]" />
          <h3 className="font-serif-kr text-lg text-[#1b1c1c]">커뮤니티 원칙</h3>
        </div>
        <div className="space-y-2.5 text-sm">
          <RuleDot color="bg-sage-500" label="일반" text="직접 쓴 글" />
          <RuleDot color="bg-[#625b4d]" label="협찬" text="혜택 받은 글" />
          <RuleDot color="bg-[#795252]" label="광고" text="추천 알고리즘 미반영" />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[#504444]">
          표시가 정확해야 정보가 오래 살아남습니다.
        </p>
      </section>

      <section className="rounded-lg border border-[#e4e2e1] bg-[#fbfcf8] p-4">
        <p className="text-xs font-medium text-[#5a6147]">좋은 글의 기준</p>
        <p className="mt-2 text-sm leading-relaxed text-[#504444]">
          업체명, 날짜, 견적 항목, 받은 혜택을 구체적으로 적을수록 다음 예비부부의 선택이 쉬워져요.
        </p>
      </section>
    </div>
  );
}
function MetricRow({
  label,
  value,
  width,
  color,
}: {
  label: string;
  value: string;
  width: string;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-3 text-sm text-[#504444]">
        <span>{label}</span>
        <span className="max-w-[150px] truncate font-medium text-[#625b4d]">{value}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#f0eded]">
        <div className={`h-full rounded-full ${color}`} style={{ width }} />
      </div>
    </div>
  );
}

function RuleDot({ color, label, text }: { color: string; label: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} />
      <div className="min-w-0">
        <span className="font-medium text-[#1b1c1c]">{label}</span>
        <span className="text-[#504444]"> -- {text}</span>
      </div>
    </div>
  );
}
