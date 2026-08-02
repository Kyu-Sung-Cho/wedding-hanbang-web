import { continuitySteps, landingContent } from "./landingContent";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

export default function ContinuitySection() {
  return (
    <section
      id="continuity"
      className="scroll-mt-20 bg-[#243832] text-white"
      aria-labelledby="landing-continuity-title"
    >
      <div className={`${shell} py-20 sm:py-24 lg:py-28`}>
        <div className="grid gap-9 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-20">
          <div className="max-w-[590px] lg:sticky lg:top-28 lg:self-start">
            <p className="flex items-center gap-3 text-[12px] font-semibold text-[#E2D3C8] sm:text-[13px]">
              <span className="h-px w-8 bg-[#A77B74]" aria-hidden="true" />
              {landingContent.continuity.eyebrow}
            </p>
            <h2
              id="landing-continuity-title"
              className="mt-5 text-[clamp(2.3rem,7vw,4.15rem)] font-semibold leading-[1.04] tracking-[-0.05em]"
            >
              오늘 정한 한 가지가,
              <span className="mt-2 block text-[#E2D3C8]">다음 준비의 기준으로.</span>
            </h2>
            <p className="mt-6 max-w-xl text-[15px] leading-7 text-white/82 sm:text-[17px] sm:leading-8">
              {landingContent.continuity.body}
            </p>
          </div>

          <ol className="border-y border-white/18">
            {continuitySteps.map((step) => (
              <li
                key={step.number}
                className="grid gap-3 border-b border-white/14 py-7 last:border-b-0 sm:grid-cols-[3rem_minmax(0,0.78fr)_minmax(0,1.22fr)] sm:gap-6 sm:py-8"
              >
                <span className="text-[12px] font-semibold text-[#E2D3C8]">{step.number}</span>
                <div>
                  <p className="text-[12px] font-semibold text-white/70">{step.moment}</p>
                  <h3 className="mt-2 text-[18px] font-semibold leading-6 text-white sm:text-[20px]">
                    {step.title}
                  </h3>
                </div>
                <p className="text-[14px] leading-7 text-white/80 sm:text-[15px]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <p className="mt-9 border-t border-white/14 pt-6 text-[13px] leading-6 text-white/78">
          로그인 없이 여는 체험 대화와 변경은 계정의 준비 기록에 남지 않아요. 계정을 만든 뒤에는 저장·변경·공유될 내용을 먼저 확인할 수 있어요.
        </p>
      </div>
    </section>
  );
}
