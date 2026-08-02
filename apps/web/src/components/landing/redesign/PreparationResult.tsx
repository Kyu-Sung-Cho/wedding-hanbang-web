import {
  ArrowDown,
  ArrowRight,
  CalendarDays,
  Check,
  ListChecks,
  MessageCircle,
  WalletCards,
} from "lucide-react";

import { landingContent, preparationRecords } from "./landingContent";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

const recordIcons = {
  budget: WalletCards,
  task: ListChecks,
  schedule: CalendarDays,
} as const;

export default function PreparationResult() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 bg-[#FBF8F2] text-[#243832]"
      aria-labelledby="landing-outcome-title"
    >
      <div className={`${shell} py-20 sm:py-24 lg:py-32`}>
        <div className="grid gap-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end lg:gap-20">
          <div>
            <p className="text-[13px] font-semibold text-[#8F6662]">
              {landingContent.outcome.eyebrow}
            </p>
            <h2
              id="landing-outcome-title"
              className="mt-4 max-w-[680px] text-[clamp(2.25rem,7vw,4rem)] font-semibold leading-[1.04] tracking-[-0.045em]"
            >
              {landingContent.outcome.title}
            </h2>
          </div>
          <p className="max-w-2xl text-[15px] leading-[1.8] text-[#36534E]/82 sm:text-[17px] lg:pb-1">
            {landingContent.outcome.body}
          </p>
        </div>

        <div className="relative mt-12 overflow-hidden border-y border-[#243832]/16 bg-white lg:mt-16 lg:grid lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <div className="relative overflow-hidden bg-[#36534E] px-5 py-9 text-white sm:px-8 sm:py-12 lg:px-12 lg:py-16">
            <div
              className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/10"
              aria-hidden="true"
            />
            <div
              className="absolute -right-8 -top-10 h-36 w-36 rounded-full border border-white/10"
              aria-hidden="true"
            />
            <div className="relative">
              <div className="flex items-center gap-3">
                <MessageCircle className="h-5 w-5 text-[#E2D3C8]" aria-hidden="true" />
                <p className="text-[13px] font-semibold text-white/78">
                  민지 · 현우의 대화방
                </p>
              </div>
              <blockquote className="mt-9 max-w-lg text-[24px] font-semibold leading-[1.48] tracking-[-0.025em] sm:text-[30px]">
                “{landingContent.outcome.quote}”
              </blockquote>
              <div className="mt-10 border-t border-white/16 pt-5">
                <p className="text-[13px] font-semibold text-[#E2D3C8]">
                  아모라의 제안
                </p>
                <p className="mt-2 max-w-md text-[15px] leading-7 text-white/76">
                  세 가지로 정리했어요. 하나씩 확인한 뒤 저장할 수 있어요.
                </p>
              </div>
            </div>
          </div>

          <div className="relative px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-14">
            <div
              className="absolute left-1/2 top-0 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#243832]/12 bg-[#FBF8F2] text-[#8F6662] lg:left-0 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2"
              aria-hidden="true"
            >
              <ArrowDown className="h-4 w-4 lg:hidden" />
              <ArrowRight className="hidden h-4 w-4 lg:block" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243832]/12 pb-5">
              <div>
                <p className="text-[13px] font-semibold text-[#8F6662]">확인하고 저장</p>
                <h3 className="mt-1 text-[21px] font-semibold">확인한 준비 결과</h3>
              </div>
              <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#EDF2EA] px-3 text-[12px] font-semibold text-[#36534E]">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                우리 준비에 저장됨
              </span>
            </div>

            <ul>
              {preparationRecords.map((record) => {
                const Icon = recordIcons[record.id];
                return (
                  <li
                    key={record.id}
                    className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-[#243832]/10 py-5 last:border-b-0 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:items-center sm:gap-5"
                  >
                    <span className="flex h-11 w-11 items-center justify-center text-[#8F6662]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[13px] font-semibold text-[#36534E]">{record.label}</p>
                      <p className="mt-1 text-[17px] font-semibold leading-6">{record.value}</p>
                    </div>
                    <p className="col-start-2 text-[13px] leading-5 text-[#4E6A62] sm:col-start-auto sm:max-w-[10rem] sm:text-right">
                      {record.note}
                    </p>
                  </li>
                );
              })}
            </ul>

            <p className="mt-5 flex items-start gap-2 text-[13px] font-medium leading-6 text-[#36534E]">
              <Check className="mt-1 h-4 w-4 shrink-0 text-[#8F6662]" aria-hidden="true" />
              확인 버튼을 누르기 전에는 예산·할 일·일정에 반영되지 않아요.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
