import Link from "next/link";
import { ArrowRight, CheckCircle2, HeartHandshake, MessageCircle, NotebookPen } from "lucide-react";

const PRINCIPLES = [
  {
    icon: HeartHandshake,
    title: "두 사람의 기준을 먼저 맞추기",
    body: "가족의 기대를 듣되, 누가 무엇을 결정할지 두 사람이 먼저 합의해 두세요.",
  },
  {
    icon: MessageCircle,
    title: "관습을 정답처럼 가정하지 않기",
    body: "축의금·예단·호칭·방문 순서는 가족과 지역마다 달라요. 필요한 범위를 당사자에게 편하게 확인하세요.",
  },
  {
    icon: NotebookPen,
    title: "합의한 내용은 짧게 기록하기",
    body: "담당자, 날짜, 비용 부담, 준비물을 한곳에 남기면 서로 다르게 기억해 생기는 부담을 줄일 수 있어요.",
  },
] as const;

export default function EtiquettePage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <section className="rounded-[28px] border border-[#eadfc9] bg-[#fffdf8] px-5 py-8 shadow-[0_20px_50px_rgba(8,22,38,0.05)] sm:px-10 sm:py-12">
        <p className="text-sm font-semibold text-[#9d6f36]">가족과 편안하게 준비하기</p>
        <h1 className="mt-3 font-serif-kr text-3xl font-semibold leading-tight text-[#263832] sm:text-4xl">
          가족 조율 가이드
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[#635b51]">
          결혼 준비 방식은 가족·지역·문화마다 다를 수 있어요. 누구에게나 맞는 하나의 정답보다,
          두 사람이 편안한 기준을 정하고 필요한 내용을 직접 확인하는 데 초점을 맞췄어요.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-2xl border border-[#eee5d8] bg-white p-5">
              <Icon aria-hidden="true" className="h-6 w-6 text-[#36534E]" />
              <h2 className="mt-4 text-base font-semibold text-[#263832]">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#6d7a76]">{body}</p>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-2xl bg-[#f6f1e8] p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#9d6f36]" />
            <div>
              <h2 className="text-base font-semibold text-[#263832]">상세 가이드는 근거를 다시 확인하고 있어요</h2>
              <p className="mt-1 text-sm leading-6 text-[#635b51]">
                금액·법률·휴가·가족 역할처럼 상황에 따라 달라지는 내용은 공식 원문, 적용 범위,
                확인 날짜를 갖춘 뒤 다시 공개할게요.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/wedding/chat"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#36534E] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2B423E]"
          >
            내 상황을 아모라와 정리하기
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <Link
            href="/wedding/community/quote-check"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#dfc9c1] bg-white px-5 py-3 text-sm font-semibold text-[#36534E] hover:bg-[#f8f4ed]"
          >
            계약 전 확인 질문 정리하기
          </Link>
        </div>
      </section>
    </main>
  );
}
