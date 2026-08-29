"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { captureEvent } from "@/lib/analytics";
import { weddingLinkProps } from "@/lib/weddingPaths";

export const DAILY_AMORA_SOLO_PROMPT =
  "오늘 제가 먼저 해야 할 일 한 가지만 골라서, 10분 안에 시작할 순서로 도와줘. 아직 정하지 않은 내용은 저장하지 말고 먼저 확인해줘.";

// 2026-08-23 파운더 결정으로 두 사람 승인은 없어졌다. 한 사람이 확인하면 바로
// 반영되고 상대에게 알림이 간다. 예전 문구("둘 다 확인한 뒤 반영")는 화면에
// 그대로 있었을 뿐 아니라 **아모라에게 지시문으로 실려서**, 아모라가 일어나지
// 않는 일을 사용자에게 약속했다(2026-08-24 감사).
export const DAILY_AMORA_COUPLE_PROMPT =
  "오늘 우리 둘이 먼저 확인할 일 한 가지만 골라서, 같이 볼 것과 나눠 맡아도 되는 일을 짧게 정리해줘. 담당자는 정하지 말고 우리에게 물어봐줘.";

interface DailyAmoraFocusBridgeProps {
  partnerLinked: boolean;
  /** 화면에만 표시한다. URL과 분석 이벤트에는 포함하지 않는다. */
  focusTitle?: string | null;
}

export default function DailyAmoraFocusBridge({
  partnerLinked,
  focusTitle,
}: DailyAmoraFocusBridgeProps) {
  const prompt = partnerLinked
    ? DAILY_AMORA_COUPLE_PROMPT
    : DAILY_AMORA_SOLO_PROMPT;
  const chatPath = `/chat?source=lounge_daily_focus&prefill=${encodeURIComponent(prompt)}`;

  return (
    <section
      aria-labelledby="daily-amora-focus-title"
      className="rounded-[20px] border border-[#D9E2D5] bg-[#F6F9F4] p-4 shadow-[0_10px_28px_rgba(54,83,78,0.06)] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--hb-primary)] text-white">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-[var(--color-rose-700)]">
            오늘 하나, 아모라와 정리
          </p>
          <h2
            id="daily-amora-focus-title"
            className="mt-1 text-[17px] font-semibold leading-snug text-[var(--hb-text-strong)]"
          >
            {focusTitle
              ? focusTitle
              : partnerLinked
                ? "둘이 같이 볼 한 가지만 먼저 정해요"
                : "혼자 다 해내려 하지 않아도 괜찮아요"}
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#52645F]">
            {partnerLinked
              ? "같이 확인할 일과 나눠도 되는 일을 짧게 가려드려요. 담당자는 두 분이 정하고, 확인한 변경은 바로 반영되면서 상대에게 알림이 가요."
              : "혼자 준비 중이어도 지금 먼저 할 한 가지만 고르면 돼요. 파트너는 원할 때 초대하고, 그전까지는 내 속도로 준비할 수 있어요."}
          </p>
        </div>
      </div>

      <Link
        {...weddingLinkProps(chatPath)}
        onClick={() =>
          captureEvent("daily_amora_focus_open", {
            mode: partnerLinked ? "couple" : "solo",
          })
        }
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--hb-primary)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--hb-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 sm:w-auto"
      >
        {partnerLinked ? "오늘 할 일 같이 나누기" : "오늘 한 가지 시작하기"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
      <p className="mt-2 text-[11px] leading-relaxed text-[#6D806E]">
        {partnerLinked
          ? "두 사람이 함께 보는 대화로 열려요. 개인적인 고민은 채팅의 ‘나만 상담’에서 이야기할 수 있어요."
          : "함께 준비하는 대화로 남아, 파트너가 나중에 합류하면 같이 볼 수 있어요. 개인적인 고민은 채팅의 ‘나만 상담’을 이용해 주세요."}
      </p>
    </section>
  );
}
