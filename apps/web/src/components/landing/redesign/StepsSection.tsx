import LandingSectionHeading from "./LandingSectionHeading";
import { landingContent } from "./landingContent";
import SoonBadge from "./SoonBadge";

/** 단계 번호. 준비 순서 화면처럼 두 자리로 쓴다(01, 02 …). */
const stepNumber = (index: number) => String(index + 1).padStart(2, "0");

/**
 * 두 분이 할 일: 오늘 되는 세 단계와 곧 열리는 한 단계.
 *
 * 2026-11-18 파운더 요청(원문: "랜딩도 만들어야지 비슷하게", 범위 "전체다"). 모양은 아티팩트의 준비 순서
 * 화면(`Journey.dc`)을 따른다: Cormorant 금빛 번호, 아래 가는 선으로 나눈 줄, 곧 열리는 단계는 흐린 글자와
 * "곧 열려요" 꼬리표. 번호는 목록 순서를 눈으로 보이는 것이라 보조기기에는 목록의 순서가 대신 읽힌다.
 */
export default function StepsSection() {
  const { steps } = landingContent;

  return (
    <section aria-labelledby="landing-steps-title" className="bg-inv-white font-inv-sans text-inv-ink">
      <div className="mx-auto grid w-full max-w-[960px] gap-8 px-4 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-16 md:px-8 md:py-24">
        <LandingSectionHeading id="landing-steps-title" title={steps.title} body={steps.body} />
        <ol className="m-0 flex list-none flex-col p-0">
          {steps.items.map((step, index) => (
            <li key={step.title} className="flex gap-4 border-b border-inv-row-line py-5 first:pt-0 md:gap-5">
              <span
                aria-hidden="true"
                className="w-8 flex-none font-inv-numeral text-[24px] font-medium leading-[1.2] text-inv-gold-ink"
              >
                {stepNumber(index)}
              </span>
              <div className="flex flex-col gap-1.5">
                <h3 className="m-0 text-[17px] font-medium leading-[1.5] text-inv-ink">{step.title}</h3>
                <p className="m-0 text-[15px] leading-[1.7] text-inv-body">{step.body}</p>
              </div>
            </li>
          ))}
          <li className="flex gap-4 py-5 md:gap-5" data-landing-soon="">
            <span
              aria-hidden="true"
              className="w-8 flex-none font-inv-numeral text-[24px] font-medium leading-[1.2] text-inv-done-number"
            >
              {stepNumber(steps.items.length)}
            </span>
            <div className="flex flex-col items-start gap-1.5">
              <SoonBadge />
              <h3 className="m-0 text-[17px] font-medium leading-[1.5] text-inv-muted">{steps.soonItem.title}</h3>
              <p className="m-0 text-[15px] leading-[1.7] text-inv-muted">{steps.soonItem.body}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
