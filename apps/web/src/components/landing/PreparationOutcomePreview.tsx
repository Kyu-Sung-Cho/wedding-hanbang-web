import {
  ArrowDown,
  ArrowRight,
  CalendarDays,
  Check,
  ListChecks,
  LockKeyhole,
  MessageCircle,
  WalletCards,
} from "lucide-react";

const shell = "mx-auto w-full max-w-[1160px] px-6 sm:px-8 lg:px-10";

const preparationRecords = [
  {
    label: "우리 예산",
    value: "총예산 3,000만원",
    note: "둘이 확인한 금액",
    icon: WalletCards,
  },
  {
    label: "우리 할 일",
    value: "드레스숍 3곳 예약 문의",
    note: "민지와 현우가 같이 해요",
    icon: ListChecks,
  },
  {
    label: "우리 일정",
    value: "10월 17일 오후 2시",
    note: "드레스 투어",
    icon: CalendarDays,
  },
];

export default function PreparationOutcomePreview() {
  return (
    <>
      <section
        id="amora"
        className="scroll-mt-20 border-t border-[#243832]/[0.06] bg-[#FBF8F2]"
        aria-labelledby="landing-outcome-title"
      >
        <div className={`${shell} py-20 sm:py-24 md:py-28`}>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-end lg:gap-16">
            <div>
              <p className="text-[13px] font-semibold text-[#8F6662]">
                대화가 끝난 뒤
              </p>
              <h2
                id="landing-outcome-title"
                className="mt-4 max-w-xl text-[36px] font-semibold leading-[1.08] tracking-[-0.025em] text-[#243832] md:text-[50px]"
              >
                말한 내용이
                <br />
                우리 준비에 이렇게 남아요.
              </h2>
            </div>
            <p className="max-w-2xl text-[16px] leading-[1.8] text-[#36534E] lg:pb-1">
              아모라는 대화를 요약하는 데서 멈추지 않아요. 무엇이 저장될지 먼저
              보여주고, 확인 버튼을 누른 것만 예산·할 일·일정에 남겨요.
            </p>
          </div>

          <div className="relative mt-10 overflow-hidden border-y border-[#243832]/16 bg-white lg:mt-14 lg:grid lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
            <div className="bg-[#36534E] px-5 py-7 text-white sm:px-8 sm:py-9 lg:px-10 lg:py-12">
              <div className="flex items-center gap-3">
                <MessageCircle className="h-5 w-5 text-[#E2D3C8]" aria-hidden="true" />
                <p className="text-[13px] font-semibold text-white/82">
                  민지 · 현우의 대화방
                </p>
              </div>
              <blockquote className="mt-8 max-w-md text-[22px] font-semibold leading-[1.48] tracking-[-0.015em] text-white sm:text-[25px]">
                “총예산은 3천만 원으로 하고, 10월 17일 드레스 투어랑 업체 세
                곳에 문의할 일도 넣어줘.”
              </blockquote>
              <div className="mt-8 border-t border-white/16 pt-5">
                <p className="text-[13px] font-semibold text-[#E2D3C8]">
                  아모라의 제안
                </p>
                <p className="mt-2 text-[15px] leading-7 text-white/82">
                  세 가지로 정리했어요. 하나씩 확인한 뒤 저장할 수 있어요.
                </p>
              </div>
            </div>

            <div className="relative px-5 py-7 sm:px-8 sm:py-9 lg:px-10 lg:py-12">
              <div
                className="absolute left-1/2 top-0 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#243832]/12 bg-[#FBF8F2] text-[#8F6662] lg:left-0 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2"
                aria-hidden="true"
              >
                <ArrowDown className="h-4 w-4 lg:hidden" />
                <ArrowRight className="hidden h-4 w-4 lg:block" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243832]/12 pb-5">
                <div>
                  <p className="text-[13px] font-semibold text-[#8F6662]">확인하고 저장</p>
                  <h3 className="mt-1 text-[21px] font-semibold text-[#243832]">
                    확인한 내용이 이렇게 저장돼요
                  </h3>
                </div>
                <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#EDF2EA] px-3 text-[12px] font-semibold text-[#36534E]">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  우리 준비에 저장됨
                </span>
              </div>

              <dl>
                {preparationRecords.map((record) => {
                  const Icon = record.icon;
                  return (
                    <div
                      key={record.label}
                      className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 border-b border-[#243832]/10 py-5 last:border-b-0 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                    >
                      <span className="flex h-10 w-10 items-center justify-center text-[#8F6662] sm:h-11 sm:w-11">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div>
                        <dt className="text-[13px] font-semibold text-[#36534E]">
                          {record.label}
                        </dt>
                        <dd className="mt-1 text-[17px] font-semibold leading-6 text-[#243832]">
                          {record.value}
                        </dd>
                      </div>
                      <p className="col-start-2 text-[13px] leading-5 text-[#36534E]/78 sm:col-start-auto sm:max-w-[10rem] sm:text-right">
                        {record.note}
                      </p>
                    </div>
                  );
                })}
              </dl>

              <p className="mt-5 flex items-start gap-2 text-[13px] font-medium leading-6 text-[#36534E]">
                <Check className="mt-1 h-4 w-4 shrink-0 text-[#8F6662]" aria-hidden="true" />
                확인 버튼을 누르기 전에는 아무것도 저장되지 않아요.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="privacy"
        className="scroll-mt-20 border-y border-[#243832]/10 bg-[#F3E9DD]"
        aria-labelledby="landing-privacy-title"
      >
        <div className={`${shell} py-18 sm:py-20`}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-16">
            <div>
              <p className="text-[13px] font-semibold text-[#8F6662]">
                함께 보는 준비, 나만 보는 고민
              </p>
              <h2
                id="landing-privacy-title"
                className="mt-4 max-w-lg text-[32px] font-semibold leading-[1.12] tracking-[-0.02em] text-[#243832] sm:text-[40px]"
              >
                같이 볼 것과
                <br />
                나만 볼 것을 나눠요.
              </h2>
            </div>

            <div className="grid border-y border-[#243832]/14 sm:grid-cols-2">
              <div className="border-b border-[#243832]/12 py-7 sm:border-b-0 sm:border-r sm:py-8 sm:pr-8">
                <MessageCircle className="h-5 w-5 text-[#8F6662]" aria-hidden="true" />
                <h3 className="mt-5 text-[20px] font-semibold text-[#243832]">
                  같이 보는 우리 준비
                </h3>
                <p className="mt-3 text-[15px] leading-7 text-[#36534E]">
                  한 대화방에서 둘이 확인한 예산·할 일·일정과 저장해 둔 아모라
                  답변을 함께 봐요.
                </p>
              </div>
              <div className="py-7 sm:py-8 sm:pl-8">
                <LockKeyhole className="h-5 w-5 text-[#8F6662]" aria-hidden="true" />
                <h3 className="mt-5 text-[20px] font-semibold text-[#243832]">
                  나만 보는 상담
                </h3>
                <p className="mt-3 text-[15px] leading-7 text-[#36534E]">
                  혼자 정리하고 싶은 고민은 ‘나만 상담’에서 말해요. 상담 내용은
                  서비스에 저장되지만 파트너 화면에는 보이지 않아요.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
