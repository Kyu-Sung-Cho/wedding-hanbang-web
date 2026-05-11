"use client";

import Link from "next/link";
import {
  CalendarCheck,
  Camera,
  ChevronRight,
  HelpCircle,
  Lightbulb,
  MessageSquarePlus,
} from "lucide-react";

interface EmptyFeedStarterProps {
  title?: string;
  description?: string;
}

const STARTERS = [
  {
    href: "/community/is_normal",
    label: "이거 정상인가요?",
    title: "견적, 계약, 추가금이 애매할 때",
    meta: "가격 확인",
    icon: HelpCircle,
  },
  {
    href: "/community/tour_review",
    label: "투어/이용 후기",
    title: "다녀온 업체 경험을 남길 때",
    meta: "후기 공유",
    icon: Camera,
  },
  {
    href: "/community/tips_v2",
    label: "꿀팁",
    title: "준비하면서 알게 된 팁을 모을 때",
    meta: "체크리스트",
    icon: Lightbulb,
  },
  {
    href: "/community/ama",
    label: "결혼 끝났다 AMA",
    title: "이미 끝낸 사람이 답해줄 때",
    meta: "경험 질문",
    icon: CalendarCheck,
  },
];

export default function EmptyFeedStarter({
  title = "아직 올라온 글이 없습니다",
  description = "첫 글을 올리면 이 피드가 바로 채워집니다.",
}: EmptyFeedStarterProps) {
  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[#e4e2e1] bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#f6f3f2] px-2.5 py-1 text-xs font-medium text-[#795252]">
              <MessageSquarePlus className="h-3.5 w-3.5" />
              새 글 대기중
            </div>
            <h3 className="font-serif-kr text-xl text-[#1b1c1c] sm:text-2xl">
              {title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-[#504444]">
              {description}
            </p>
          </div>
          <Link
            href="/community/post/write"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#795252] px-4 py-3 text-sm font-medium text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.18)] transition-colors hover:bg-[#946a6a]"
          >
            글쓰기
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
              className="group rounded-xl border border-[#e4e2e1] bg-white p-4 transition-colors hover:border-[#d4c2c2] hover:bg-[#fffdfb]"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f6f3f2] text-[#795252]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-xs text-[#928980]">{item.meta}</span>
              </div>
              <div className="text-sm font-medium text-[#795252]">{item.label}</div>
              <div className="mt-1 text-sm leading-snug text-[#1b1c1c]">
                {item.title}
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
