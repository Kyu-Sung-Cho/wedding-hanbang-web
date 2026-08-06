import Link from "next/link";

import { continuitySteps, landingContent } from "./landingContent";
import { displaySection, secondaryLinkOnDark, sectionEyebrowOnDark, sectionLede, sectionRhythm } from "./landingType";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

export default function ContinuitySection() {
  return (
    <section
      id="continuity"
      className="scroll-mt-20 bg-[#243832] text-white"
      aria-labelledby="landing-continuity-title"
    >
      <div className={`${shell} ${sectionRhythm}`}>
        {/* 앞뒤 섹션이 전부 "좌 헤드라인 / 우 내용"이라 스크롤 리듬이 단조로웠다.
            여기만 시각적으로 뒤집는다. DOM 순서는 헤드라인이 먼저인 채로 두어
            보조기술이 읽는 순서는 그대로 유지한다. */}
        <div className="grid gap-9 lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)] lg:gap-20">
          <div className="max-w-[590px] lg:order-2 lg:sticky lg:top-28 lg:self-start">
            <p className={sectionEyebrowOnDark}>
              {landingContent.continuity.eyebrow}
            </p>
            <h2
              id="landing-continuity-title"
              className={`mt-5 ${displaySection}`}
            >
              오늘 정한 한 가지가,
              <span className="mt-2 block text-[#E2D3C8]">다음 준비의 기준으로.</span>
            </h2>
            <p className={`mt-6 max-w-[34rem] ${sectionLede} text-white/82`}>
              {landingContent.continuity.body}
            </p>
          </div>

          <ol className="border-y border-white/18 lg:order-1">
            {continuitySteps.map((step) => (
              <li
                key={step.number}
                className="grid gap-3 border-b border-white/12 py-6 last:border-b-0 sm:grid-cols-[3rem_minmax(0,0.78fr)_minmax(0,1.22fr)] sm:gap-6 sm:py-7"
              >
                <span className="text-[12px] font-semibold text-[#E2D3C8]">{step.number}</span>
                <div>
                  <p className="text-[12px] font-semibold text-white/70">{step.moment}</p>
                  <h3 className="mt-2 text-[18px] font-semibold leading-6 text-white sm:text-[20px]">
                    {step.title}
                  </h3>
                </div>
                <p className="text-[14px] leading-[1.7] text-white/80 sm:text-[16px]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* 44px 터치 대상을 문단 안 inline 요소로 두면 line box가 44px로 벌어져
            링크가 혼자 줄을 차지한다. 문단 밖 블록으로 꺼내 대상 크기는 지킨다. */}
        <p className="mt-9 border-t border-white/12 pt-6 text-[14px] leading-[1.7] text-white/78">
          로그인 없이 여는 체험 대화와 변경은 계정의 준비 기록에 남지 않아요. 계정 베타에서는 준비 기록에 반영될 변경을 먼저 확인할 수 있어요. 대화에는 별도의 처리·저장 기준이 적용돼요.
        </p>
        <Link
          href="/privacy"
          className={`mt-2 ${secondaryLinkOnDark} focus-visible:ring-offset-2 focus-visible:ring-offset-[#243832]`}
        >
          처리 기준 보기
        </Link>
      </div>
    </section>
  );
}
