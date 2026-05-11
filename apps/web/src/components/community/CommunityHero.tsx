"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  BadgeCheck,
  ChevronRight,
  FileSearch,
  Handshake,
  MessageSquarePlus,
  ReceiptText,
  SearchCheck,
  Store,
  UsersRound,
} from "lucide-react";

interface CommunityHeroProps {
  postCount?: number;
  topVendor?: string | null;
}

export default function CommunityHero({ postCount = 0, topVendor }: CommunityHeroProps) {
  const displayCount = postCount > 0 ? `${postCount.toLocaleString("ko-KR")}개` : "실시간";

  return (
    <section className="overflow-hidden rounded-lg border border-[#d8d1cc] bg-[#fffdfb]">
      <div className="grid gap-0 lg:grid-cols-[1.35fr_0.9fr]">
        <div className="min-w-0 p-4 sm:p-5 lg:p-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#d9c8c8] bg-[#f8f4f1] px-3 py-1.5 text-xs font-medium text-[#795252]">
            <Handshake className="h-3.5 w-3.5" />
            예비부부와 투명한 업체를 연결하는 거래 신뢰 네트워크
          </div>

          <h1 className="font-serif-kr text-[26px] leading-tight text-[#1b1c1c] sm:text-[32px] lg:text-[38px]">
            계약 전 불안을 줄이고,
            <br className="hidden sm:block" /> 좋은 업체가 선택받게.
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#504444] sm:text-[15px]">
            받은 견적의 빠진 항목, 추가금 가능성, 계약 전 질문을 아모라와 커뮤니티가
            근거 중심으로 정리해요. 소비자는 손해를 줄이고, 투명한 업체는 더 준비된
            고객을 만납니다.
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
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d9c8c8] bg-white px-4 py-3 text-sm font-medium text-[#795252] transition-colors hover:border-[#c6abab] hover:bg-[#fcf9f8]"
            >
              <MessageSquarePlus className="h-4 w-4" />
              익명 견적 카드 올리기
            </Link>
          </div>

          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
            <ValuePill icon={ReceiptText} label="실제 총액" text="누락·추가금 확인" />
            <ValuePill icon={UsersRound} label="비슷한 사례" text="익명 견적 비교" />
            <ValuePill icon={Store} label="투명 업체" text="명확한 조건이 강점" />
          </div>
        </div>

        <div className="border-t border-[#e4e2e1] bg-[#f8f4f1] p-4 sm:p-5 lg:border-l lg:border-t-0 lg:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[#928980]">오늘의 신뢰 리포트</p>
              <h2 className="mt-1 font-serif-kr text-xl text-[#1b1c1c]">3분 거래 점검</h2>
            </div>
            <span className="rounded-full bg-[#dee6c4]/55 px-2.5 py-1 text-xs font-medium text-[#5a6147]">
              {displayCount}
            </span>
          </div>

          <div className="space-y-2.5">
            <ChecklistItem
              icon={FileSearch}
              title="견적의 빈칸 찾기"
              text="원본비, 헬퍼비, 피팅비처럼 뒤에 붙는 비용 확인"
            />
            <ChecklistItem
              icon={SearchCheck}
              title="업체 응대 비교"
              text={topVendor ? `지금 ${topVendor} 이야기가 많이 올라와요` : "비슷한 조건의 후기와 질문 흐름 확인"}
            />
            <ChecklistItem
              icon={BadgeCheck}
              title="투명한 조건이 보상받게"
              text="가격·포함항목·변경 기준을 명확히 공개한 업체가 더 신뢰받아요"
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
