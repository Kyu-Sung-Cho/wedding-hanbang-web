"use client";

import Link from "next/link";
import {
  CalendarCheck,
  Camera,
  ChevronRight,
  HelpCircle,
  Lightbulb,
  MessageCircle,
  MessageSquarePlus,
} from "lucide-react";

interface EmptyFeedStarterProps {
  title?: string;
  description?: string;
}

const STARTERS = [
  {
    href: "/chat",
    label: "아모라에게 물어보기",
    title: "받은 견적에서 헷갈리는 항목을 질문으로 정리하기",
    meta: "상담 정리",
    icon: MessageCircle,
  },
  {
    href: "/community?category=is_normal&feed=all#community-feed",
    label: "정상인가요 게시판",
    title: "다른 예비부부의 견적/계약 질문 먼저 보기",
    meta: "사례 보기",
    icon: HelpCircle,
  },
  {
    href: "/community?category=tour_review&feed=all#community-feed",
    label: "투어/이용 후기",
    title: "방문한 업체 경험과 실제 상담 포인트 공유하기",
    meta: "후기 공유",
    icon: Camera,
  },
  {
    href: "/community?category=tips_v2&feed=all#community-feed",
    label: "꿀팁",
    title: "계약 전 물어볼 질문과 숨은 추가금 체크리스트 모으기",
    meta: "체크리스트",
    icon: Lightbulb,
  },
  {
    href: "/community?category=ama&feed=all#community-feed",
    label: "결혼 선배 Q&A",
    title: "이미 끝낸 선배에게 현실적인 선택 기준 물어보기",
    meta: "경험 질문",
    icon: CalendarCheck,
  },
];

export default function EmptyFeedStarter({
  title = "첫 번째 실제 사례를 기다리고 있어요",
  description = "받은 견적, 계약 전 애매한 답변, 투어 후기를 남기면 다음 예비부부가 덜 헤매게 됩니다.",
}: EmptyFeedStarterProps) {
  return (
    <div className="space-y-3">
      <section className="rounded-[16px] border border-[#eadfc9] bg-white p-4 shadow-[0_8px_18px_rgba(8,22,38,0.035)] sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#fbefd6] px-2.5 py-1 text-xs font-medium text-[#9d6f36]">
              <MessageSquarePlus className="h-3.5 w-3.5" />
              실제 사례 대기중
            </div>
            <h3 className="font-serif-kr text-xl font-medium text-[#071629] sm:text-2xl">
              {title}
            </h3>
            <p className="mt-1.5 text-sm font-medium leading-relaxed text-[#5d6879]">
              {description}
            </p>
          </div>
          <Link
            href="/community/post/write?category=is_normal"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#061a34] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(6,26,52,0.16)] transition-colors hover:bg-[#102a4d]"
          >
            사례 남기기
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {STARTERS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-[16px] border border-[#eadfc9] bg-white p-4 shadow-[0_8px_18px_rgba(8,22,38,0.03)] transition-colors hover:border-[#d8bb86] hover:bg-[#fff8ec]"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[#fbefd6] text-[#9d6f36]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-medium text-[#7a8290]">{item.meta}</span>
              </div>
              <div className="text-sm font-semibold text-[#9d6f36]">{item.label}</div>
              <div className="mt-1 text-sm font-medium leading-snug text-[#071629]">
                {item.title}
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
