"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  BarChart3,
  ChevronRight,
  CircleDollarSign,
  FileSearch,
  Handshake,
  MessageSquarePlus,
  ReceiptText,
  SearchCheck,
  ShieldCheck,
  Store,
  UsersRound,
} from "lucide-react";

interface CommunityHeroProps {
  postCount?: number;
  topVendor?: string | null;
}

const VALUE_PILLS = [
  { icon: ReceiptText, label: "실제 총액", text: "누락·추가금 확인" },
  { icon: UsersRound, label: "비슷한 사례", text: "익명 견적 비교" },
  { icon: Store, label: "투명 업체", text: "명확한 조건이 강점" },
];

const RISK_ROWS = [
  { label: "원본·수정본 포함 여부", level: "고빈도 누락", width: "86%" },
  { label: "헬퍼비·출장비 별도 여부", level: "계약 전 확인", width: "68%" },
  { label: "변경·환불 기준", level: "서면 필요", width: "54%" },
];

export default function CommunityHero({ postCount = 0, topVendor }: CommunityHeroProps) {
  const displayCount = postCount > 0 ? `${postCount.toLocaleString("ko-KR")}개` : "실시간";

  return (
    <section className="overflow-hidden rounded-lg border border-[#d8d1cc] bg-white shadow-[0_18px_50px_rgba(80,68,68,0.06)]">
      <div className="grid gap-0 2xl:grid-cols-[1.08fr_0.92fr]">
        <div className="min-w-0 bg-[#fffdfb] p-4 sm:p-5 lg:p-7">
          <div className="mb-4 inline-flex max-w-full items-center gap-2 rounded-full border border-[#d9c8c8] bg-white px-3 py-1.5 text-xs font-medium text-[#795252]">
            <Handshake className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">예비부부와 투명한 업체를 연결하는 거래 신뢰 네트워크</span>
          </div>

          <h1 className="font-serif-kr text-[27px] leading-tight text-[#1b1c1c] sm:text-[34px] lg:text-[42px]">
            견적의 빈칸을 먼저 찾고,
            <br className="hidden sm:block" /> 투명한 선택이 이기게.
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#504444] sm:text-[15px]">
            웨딩한방은 후기 피드 위에 아모라의 견적 진단을 얹어, 가격·포함 항목·계약 질문을
            한 번에 검증합니다. 소비자는 손해를 줄이고, 명확하게 안내하는 업체는 더 준비된
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
            {VALUE_PILLS.map((pill) => (
              <ValuePill key={pill.label} {...pill} />
            ))}
          </div>
        </div>

        <div className="border-t border-[#2d2d33] bg-[#1b1c1c] p-4 text-white sm:p-5 lg:p-6 2xl:border-l 2xl:border-t-0">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-white/55">견적 진단 미리보기</p>
              <h2 className="mt-1 font-serif-kr text-2xl text-white">계약 전 확인 흐름</h2>
            </div>
            <span className="rounded-full bg-[#dee6c4] px-2.5 py-1 text-xs font-semibold text-[#2f3527]">
              {displayCount}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-[0.72fr_1fr] lg:grid-cols-1 xl:grid-cols-[0.72fr_1fr]">
            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-white/55">샘플 신뢰도</span>
                <ShieldCheck className="h-4 w-4 text-[#dee6c4]" />
              </div>
              <div className="mt-3 flex items-end gap-1">
                <span className="font-jakarta text-4xl font-semibold leading-none text-white">82</span>
                <span className="pb-1 text-sm text-white/45">/100</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-white/65">
                실제 점수는 입력한 견적과 포함 항목을 기준으로 계산됩니다.
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
              <div className="mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#d9c8c8]" />
                <p className="text-sm font-medium text-white">계약 전 확인할 리스크</p>
              </div>
              <div className="space-y-3">
                {RISK_ROWS.map((row) => (
                  <div key={row.label}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-white/78">{row.label}</span>
                      <span className="shrink-0 text-white/45">{row.level}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-[#dee6c4]" style={{ width: row.width }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <MiniTrustCard
              icon={SearchCheck}
              title={topVendor ? `${topVendor} 언급 증가` : "비슷한 조건 비교"}
              text="비슷한 예산·지역·구성의 사례를 먼저 확인합니다."
            />
            <MiniTrustCard
              icon={CircleDollarSign}
              title="광고보다 조건"
              text="가격 범위와 포함 항목이 명확한 업체가 더 잘 보이게 설계합니다."
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
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[#eee6e0] bg-white px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-[#795252]" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#1b1c1c]">{label}</p>
        <p className="truncate text-xs text-[#625b4d]">{text}</p>
      </div>
    </div>
  );
}

function MiniTrustCard({
  icon: Icon,
  title,
  text,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.06] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#dee6c4]">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="truncate text-sm font-medium text-white">{title}</p>
      </div>
      <p className="text-xs leading-relaxed text-white/62">{text}</p>
    </div>
  );
}
