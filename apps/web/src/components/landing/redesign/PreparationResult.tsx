import {
  CalendarDays,
  Check,
  ListChecks,
  WalletCards,
} from "lucide-react";

import { landingContent, preparationRecords } from "./landingContent";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

const recordIcons = {
  budget: WalletCards,
  task: ListChecks,
  schedule: CalendarDays,
} as const;

const destinationLabels = {
  budget: "예산에 반영",
  task: "할 일에 반영",
  schedule: "일정에 반영",
} as const;

const exampleUtterances = {
  budget: "우리 총예산은 3,000만 원으로 정했어.",
  task: "이번 주에 드레스숍 세 곳에 문의하자.",
  schedule: "10월 17일 오후 2시에 드레스 투어야.",
} as const;

export default function PreparationResult() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 bg-[#FBF8F2] text-[#243832]"
      aria-labelledby="landing-outcome-title"
    >
      <div className={`${shell} py-16 sm:py-20 lg:py-24`}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-end lg:gap-16">
          <div>
            <p className="text-[13px] font-semibold text-[#8F6662]">
              {landingContent.outcome.eyebrow}
            </p>
            <h2
              id="landing-outcome-title"
              className="mt-4 max-w-[720px] text-[clamp(2.25rem,7vw,3.8rem)] font-semibold leading-[1.04] tracking-[-0.045em]"
            >
              {landingContent.outcome.title}
            </h2>
          </div>
          <p className="max-w-2xl text-[15px] leading-[1.8] text-[#36534E]/82 sm:text-[17px] lg:pb-1">
            {landingContent.outcome.body}
          </p>
        </div>

        <div className="mt-10 border-y border-[#243832]/16 lg:mt-14">
          <div className="flex flex-col gap-3 border-b border-[#243832]/12 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[12px] font-semibold text-[#8F6662]">서로 다른 변경의 목적지</p>
              <h3 className="mt-1 text-[21px] font-semibold">확인한 한 가지가 알맞은 기록으로</h3>
            </div>
            <p className="flex items-center gap-2 text-[12px] font-semibold text-[#36534E]">
              <Check className="h-4 w-4 text-[#8F6662]" aria-hidden="true" />
              제안마다 따로 확인
            </p>
          </div>

          <ul aria-label="각기 다른 대화와 준비 기록 예시">
            {preparationRecords.map((record, index) => {
              const Icon = recordIcons[record.id];
              return (
                <li
                  key={record.id}
                  className="grid gap-4 border-b border-[#243832]/10 py-6 last:border-b-0 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(180px,0.62fr)] sm:items-center sm:gap-6 lg:py-7"
                >
                  <div className="flex items-center gap-3 sm:block">
                    <span className="text-[12px] font-semibold text-[#8F6662]">0{index + 1}</span>
                    <span className="ml-auto flex h-10 w-10 items-center justify-center text-[#8F6662] sm:ml-0 sm:mt-2">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-[#8F6662]">{record.note}</p>
                    <p className="mt-1 text-[15px] font-medium leading-6 text-[#243832]">
                      “{exampleUtterances[record.id]}”
                    </p>
                  </div>
                  <div className="border-l-2 border-[#A77B74] pl-4 sm:pl-5">
                    <p className="text-[12px] font-semibold text-[#4E6A62]">
                      {destinationLabels[record.id]}
                    </p>
                    <p className="mt-1 text-[16px] font-semibold leading-6 text-[#243832]">{record.value}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="flex items-start gap-2 border-t border-[#243832]/12 py-5 text-[13px] font-medium leading-6 text-[#36534E]">
            <Check className="mt-1 h-4 w-4 shrink-0 text-[#8F6662]" aria-hidden="true" />
            계정 베타 기능 예시예요. 한 번의 확인에는 한 가지 변경만 포함돼요.
          </p>
        </div>
      </div>
    </section>
  );
}
