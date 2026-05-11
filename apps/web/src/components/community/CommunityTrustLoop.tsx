"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  ArrowRight,
  BadgeCheck,
  ClipboardList,
  FileSearch,
  MessageSquareText,
  Network,
  ShieldCheck,
  Store,
} from "lucide-react";

const LOOP_STEPS = [
  {
    icon: FileSearch,
    title: "견적 입력",
    text: "금액만 보지 않고 포함·미포함 항목을 구조화합니다.",
  },
  {
    icon: ClipboardList,
    title: "빠진 비용 감지",
    text: "원본, 헬퍼비, 변경 기준처럼 계약 후 붙는 항목을 먼저 찾습니다.",
  },
  {
    icon: MessageSquareText,
    title: "질문 생성",
    text: "업체에 그대로 보낼 확인 질문과 협상 문장을 만듭니다.",
  },
  {
    icon: Network,
    title: "사례 축적",
    text: "익명 견적 카드가 쌓일수록 다음 커플의 기준이 더 정확해집니다.",
  },
];

const MOAT_POINTS = [
  {
    icon: ShieldCheck,
    label: "소비자 보호",
    text: "가격 비교보다 먼저 실제 총액과 계약 리스크를 확인합니다.",
  },
  {
    icon: Store,
    label: "좋은 업체 보상",
    text: "상담이 투명한 업체가 광고비가 아니라 조건으로 선택받습니다.",
  },
  {
    icon: BadgeCheck,
    label: "데이터 해자",
    text: "견적서, 질문, 후기, 업체 응답이 같은 언어로 쌓입니다.",
  },
];

export default function CommunityTrustLoop() {
  return (
    <section className="rounded-lg border border-[#d8d1cc] bg-white p-4 sm:p-5 lg:p-6">
      <div className="grid gap-5 2xl:grid-cols-[1fr_0.72fr]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-[#795252] uppercase">
                Trust flywheel
              </p>
              <h2 className="mt-1 font-serif-kr text-2xl text-[#1b1c1c]">
                기능을 늘리는 대신, 신뢰 데이터가 쌓이게
              </h2>
            </div>
            <Link
              href="/community/quote-check"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#795252] hover:text-[#946a6a]"
            >
              첫 견적 점검
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {LOOP_STEPS.map((step, index) => (
              <LoopStep key={step.title} index={index + 1} {...step} />
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#e4e2e1] bg-[#fbfcf8] p-4">
          <p className="text-xs font-semibold tracking-[0.18em] text-[#5a6147] uppercase">
            Market edge
          </p>
          <h3 className="mt-1 font-serif-kr text-xl text-[#1b1c1c]">
            우리가 이길 수 있는 구조
          </h3>
          <div className="mt-4 space-y-3">
            {MOAT_POINTS.map((point) => (
              <MoatPoint key={point.label} {...point} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function LoopStep({
  icon: Icon,
  index,
  title,
  text,
}: {
  icon: ComponentType<{ className?: string }>;
  index: number;
  title: string;
  text: string;
}) {
  return (
    <div className="relative min-h-[164px] rounded-lg border border-[#eee6e0] bg-[#fffdfb] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#795252] text-white">
          <Icon className="h-4 w-4" />
        </span>
        <span className="font-jakarta text-xs font-semibold text-[#928980]">
          0{index}
        </span>
      </div>
      <p className="text-sm font-semibold text-[#1b1c1c]">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-[#504444]">{text}</p>
    </div>
  );
}

function MoatPoint({
  icon: Icon,
  label,
  text,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  text: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#5a6147]">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#1b1c1c]">{label}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-[#504444]">{text}</p>
      </div>
    </div>
  );
}
