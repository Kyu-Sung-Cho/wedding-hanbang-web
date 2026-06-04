import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  FileSearch,
  MessageCircle,
  Wallet,
} from "lucide-react";
import SectionLabel from "./SectionLabel";
import { weddingPath } from "@/lib/weddingPaths";

const SERVICE_ITEMS = [
  {
    icon: FileSearch,
    title: "받은 견적 확인하기",
    desc: "금액보다 먼저 빠진 항목, 추가금 가능성, 계약 전 질문을 정리합니다.",
    flow: ["견적 입력", "포함 항목 확인", "질문 리스트"],
    href: weddingPath("/community/quote-check"),
  },
  {
    icon: MessageCircle,
    title: "업체 답변 같이 해석하기",
    desc: "애매한 답변을 그대로 넘기지 않고, 다시 물어볼 문장까지 정리합니다.",
    flow: ["상담 내용", "위험 문장 확인", "답장 초안"],
    href: weddingPath("/chat"),
  },
  {
    icon: Wallet,
    title: "예산에 바로 반영하기",
    desc: "견적에서 확인한 금액과 숨은 비용을 내 예산표에 이어서 관리합니다.",
    flow: ["견적 금액", "추가 비용", "예산 반영"],
    href: weddingPath("/budget"),
  },
  {
    icon: CalendarCheck,
    title: "다음 할 일 놓치지 않기",
    desc: "계약 전 확인할 질문과 마감일을 일정으로 넘겨 준비 흐름을 이어갑니다.",
    flow: ["확인 항목", "마감일", "일정 저장"],
    href: weddingPath("/schedule"),
  },
];

export default function ServicePreview() {
  return (
    <section className="bg-ivory-warm px-[clamp(20px,5vw,60px)] py-[clamp(96px,14vw,160px)]">
      <div className="mx-auto max-w-[1240px]">
        <div className="mb-12 flex flex-col gap-6 md:mb-16 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <SectionLabel label="서비스" />
            <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light leading-[1.2] text-noir-800">
              커뮤니티에서 확인한 고민을
              <br />
              <em className="not-italic text-rose-500">내 준비 흐름으로 이어가요.</em>
            </h2>
            <p className="mt-5 text-[15px] font-light leading-[1.9] text-charcoal md:text-base">
              견적, 후기, 계약 질문이 흩어지지 않도록 아모라가 확인할 것과 다음 행동을
              조용히 정리합니다.
            </p>
          </div>

          <Link
            href={weddingPath()}
            className="group inline-flex shrink-0 items-center gap-2 self-start border-b border-noir-800 pb-2 text-[14px] font-medium tracking-[0.02em] text-noir-800 transition-colors hover:border-rose-500 hover:text-rose-500 md:self-end"
          >
            커뮤니티에서 시작하기
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          {SERVICE_ITEMS.map((item, index) => (
            <Link
              key={item.title}
              href={item.href}
              className="group flex min-h-[280px] flex-col rounded-lg border border-platinum/80 bg-white px-5 py-5 transition-colors hover:border-[#d9c8c8] hover:bg-[#fffdfb]"
            >
              <div className="mb-6 flex items-start justify-between gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#eee6e0] bg-[#f8f4f1] text-[#795252]">
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="font-jakarta text-xs text-taupe-400">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>

              <h3 className="font-serif-kr text-xl font-medium leading-snug text-noir-800 transition-colors group-hover:text-rose-500">
                {item.title}
              </h3>
              <p className="mt-3 text-sm font-light leading-relaxed text-charcoal">
                {item.desc}
              </p>

              <div className="mt-auto pt-6">
                <div className="flex flex-wrap gap-1.5">
                  {item.flow.map((step) => (
                    <span
                      key={step}
                      className="rounded-full border border-[#eee6e0] bg-[#fcf9f8] px-2.5 py-1 text-[11px] text-[#625b4d]"
                    >
                      {step}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex items-center gap-2 text-sm font-medium text-[#795252]">
                  바로 가기
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
