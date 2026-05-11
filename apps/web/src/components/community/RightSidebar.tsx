"use client";

import Link from "next/link";
import { Sparkles, TrendingUp } from "lucide-react";

interface PopularTag {
  vendor_name: string;
  mention_count: number;
}

interface WeeklySummary {
  newPostsThisWeek?: number;
  topVendor?: string | null;
  avgStudioPrice?: number | null;
}

interface RightSidebarProps {
  popularTags?: PopularTag[];
  weekly?: WeeklySummary;
}

export default function RightSidebar({ popularTags = [], weekly }: RightSidebarProps) {
  const postCount = weekly?.newPostsThisWeek ?? 0;
  const postTrend = postCount > 50 ? "up" : postCount > 20 ? "steady" : "down";
  const postTrendLabel =
    postTrend === "up" ? "Trending Up" : postTrend === "steady" ? "Steady" : "Trending Down";
  const postTrendWidth = postTrend === "up" ? "78%" : postTrend === "steady" ? "52%" : "28%";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#e4e2e1] bg-white p-4">
        <h3 className="mb-4 border-b border-[#e4e2e1] pb-2 font-serif-kr text-lg text-[#1b1c1c]">
          이번 주 요약
        </h3>
        <div className="space-y-3.5">
          <MetricRow label="새 글" value={postTrendLabel} width={postTrendWidth} color="bg-sage-500" />
          <MetricRow
            label="인기 업체"
            value={weekly?.topVendor ?? "---"}
            width="62%"
            color="bg-[#795252]"
          />
          <MetricRow
            label="스튜디오 평균"
            value={weekly?.avgStudioPrice ? `${weekly.avgStudioPrice}만원` : "---"}
            width="42%"
            color="bg-[#625b4d]"
          />
        </div>
      </section>

      {popularTags.length > 0 && (
        <section className="rounded-xl border border-[#e4e2e1] bg-white p-4">
          <h3 className="mb-3 border-b border-[#e4e2e1] pb-2 font-serif-kr text-lg text-[#1b1c1c]">
            많이 찾는 업체
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

      <section className="rounded-xl border border-[#e4e2e1] bg-white p-4">
        <div className="mb-3 flex items-center gap-2 border-b border-[#e4e2e1] pb-2">
          <TrendingUp className="h-4 w-4 text-[#795252]" />
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

      <section className="rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] p-5 text-white">
        <div className="mb-4 flex items-center gap-2.5">
          <Sparkles className="h-5 w-5 text-[#dee6c4]" />
          <h3 className="font-serif-kr text-lg italic">웨딩한방 AI</h3>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-white/75">
          가격이 정상인지, 일정은 맞는지, AI 아모라가 답해드려요.
        </p>
        <Link
          href="/chat"
          className="block w-full rounded-lg bg-white py-2.5 text-center text-sm font-medium text-[#795252] shadow-[0_4px_14px_0_rgba(0,0,0,0.1)] transition-shadow hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)]"
        >
          아모라와 대화하기
        </Link>
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
