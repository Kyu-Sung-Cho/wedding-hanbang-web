"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  BadgeCheck,
  ChevronRight,
  FileSearch,
  MessageSquarePlus,
  ReceiptText,
  SearchCheck,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

interface CommunityHeroProps {
  postCount?: number;
  topVendor?: string | null;
}

export default function CommunityHero({ postCount = 0, topVendor }: CommunityHeroProps) {
  const displayCount = postCount > 0 ? `${postCount.toLocaleString("ko-KR")}개` : "실시간";

  return (
    <section className="overflow-hidden rounded-lg border border-[#e4e2e1] bg-[linear-gradient(135deg,#fffdfb_0%,#f8f1ec_52%,#f2f4eb_100%)]">
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1.35fr_0.85fr] lg:p-6">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-xs font-medium text-[#795252] shadow-[0_1px_0_rgba(255,255,255,0.8)]">
            <ShieldCheck className="h-3.5 w-3.5" />
            예비부부가 같이 검증하는 웨딩 커뮤니티
          </div>

          <h1 className="font-serif-kr text-[26px] leading-tight text-[#1b1c1c] sm:text-[32px] lg:text-[36px]">
            견적, 업체, 계약 조건을
            <br className="hidden sm:block" /> 혼자 판단하지 않게.
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#504444] sm:text-[15px]">
            받은 견적서의 빠진 항목, 업체 응대가 정상인지, 계약 전에 물어봐야 할 질문을
            아모라와 실제 예비부부 경험으로 함께 확인하는 공간이에요.
          </p>

          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <Link
              href="/community/quote-check"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#795252] px-4 py-3 text-sm font-medium text-white shadow-[0_4px_16px_rgba(121,82,82,0.18)] transition-colors hover:bg-[#946a6a]"
            >
              <FileSearch className="h-4 w-4" />
              견적 진단하기
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link
              href="/community/post/write?category=is_normal"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d9c8c8] bg-white/75 px-4 py-3 text-sm font-medium text-[#795252] transition-colors hover:border-[#c6abab] hover:bg-white"
            >
              <MessageSquarePlus className="h-4 w-4" />
              질문 올리기
            </Link>
          </div>

          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
            <ValuePill icon={ReceiptText} label="견적 누락" text="추가금 리스크 확인" />
            <ValuePill icon={UsersRound} label="실제 경험" text="후기와 질문 축적" />
            <ValuePill icon={BadgeCheck} label="광고 표시" text="협찬·광고 분리" />
          </div>
        </div>

        <div className="rounded-lg border border-white/70 bg-white/75 p-4 shadow-[0_8px_24px_rgba(80,68,68,0.06)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[#928980]">오늘 먼저 할 일</p>
              <h2 className="mt-1 font-serif-kr text-xl text-[#1b1c1c]">3분 웨딩 점검</h2>
            </div>
            <span className="rounded-full bg-[#dee6c4]/45 px-2.5 py-1 text-xs font-medium text-[#5a6147]">
              {displayCount}
            </span>
          </div>

          <div className="space-y-2.5">
            <ChecklistItem
              icon={FileSearch}
              title="받은 견적서 붙여넣기"
              text="빠진 항목과 계약 전 질문을 바로 정리"
            />
            <ChecklistItem
              icon={SearchCheck}
              title="업체명으로 후기 찾기"
              text={topVendor ? `지금 ${topVendor} 이야기가 많이 올라와요` : "스드메·예식장 실사용 후기 확인"}
            />
            <ChecklistItem
              icon={MessageSquarePlus}
              title="애매한 답변 공유하기"
              text="정상인지, 더 물어볼 게 있는지 함께 판단"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ValuePill({
  icon: Icon,
  label,
  text,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  text: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/70 bg-white/70 px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-[#795252]" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#1b1c1c]">{label}</p>
        <p className="truncate text-xs text-[#625b4d]">{text}</p>
      </div>
    </div>
  );
}

function ChecklistItem({
  icon: Icon,
  title,
  text,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg bg-[#fcf9f8] px-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#795252]">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#1b1c1c]">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[#504444]">{text}</p>
      </div>
    </div>
  );
}
