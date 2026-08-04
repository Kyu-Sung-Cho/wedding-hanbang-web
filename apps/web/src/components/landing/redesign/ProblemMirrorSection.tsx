import { ArrowDown, CalendarDays, MessageCircle, NotebookPen } from "lucide-react";

import { landingContent } from "./landingContent";

const scatteredPlaces = [
  {
    label: "카톡",
    value: "언제 어디를 보기로 했더라?",
    Icon: MessageCircle,
  },
  {
    label: "메모장",
    value: "얼마까지 쓰기로 했더라?",
    Icon: NotebookPen,
  },
  {
    label: "머릿속",
    value: "이번 주에는 뭘 해야 하지?",
    Icon: CalendarDays,
  },
] as const;

export default function ProblemMirrorSection() {
  return (
    <section
      className="bg-[#FBF8F2]"
      aria-labelledby="landing-problem-title"
    >
      <div className="mx-auto grid w-full max-w-[1240px] gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,0.92fr)_minmax(460px,1.08fr)] lg:items-center lg:gap-20 lg:px-10 lg:py-24">
        <div className="max-w-[610px]">
          <p className="flex items-center gap-3 text-[12px] font-semibold text-[#8F6662] sm:text-[13px]">
            <span className="h-px w-8 bg-[#A77B74]" aria-hidden="true" />
            {landingContent.problem.eyebrow}
          </p>
          <h2
            id="landing-problem-title"
            className="mt-5 text-[clamp(2.25rem,7.5vw,4rem)] font-semibold leading-[1.03] tracking-[-0.055em] text-[#243832]"
          >
            카톡에는 날짜,
            <span className="mt-1 block">메모장에는 예산,</span>
            <span className="mt-1 block text-[#8F6662]">머릿속에는 해야 할 일.</span>
          </h2>
          <p className="mt-6 max-w-[35rem] text-[16px] leading-7 text-[#4E6A62] sm:text-[17px] sm:leading-8">
            {landingContent.problem.body}
          </p>
        </div>

        <div role="group" className="border-y border-[#243832]/14" aria-label="흩어진 결혼 준비의 예시">
          {scatteredPlaces.map(({ label, value, Icon }, index) => (
            <div
              key={label}
              className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4 border-b border-[#243832]/10 py-5 last:border-b-0 sm:grid-cols-[3rem_6rem_minmax(0,1fr)] sm:items-center sm:gap-5 sm:py-6"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F3E9DD] text-[#8F6662]" aria-hidden="true">
                <Icon className="h-4 w-4" />
              </span>
              <span className="hidden text-[13px] font-semibold text-[#8F6662] sm:block">
                0{index + 1} · {label}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-[#8F6662] sm:hidden">
                  0{index + 1} · {label}
                </p>
                <p className="mt-1 text-[16px] font-semibold leading-6 text-[#243832] sm:mt-0 sm:text-[18px]">
                  {value}
                </p>
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-4 border-t border-[#243832]/14 bg-[#243832] px-5 py-6 text-white sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <p className="text-[12px] font-semibold text-[#E2D3C8]">한곳으로 모으면</p>
              <p className="mt-1 text-[19px] font-semibold leading-7">
                {landingContent.problem.answer}
              </p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[#E2D3C8]" aria-hidden="true">
              <ArrowDown className="h-4 w-4 lg:-rotate-90" />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
