import { ArrowRight } from "lucide-react";

import Link from "next/link";

import { landingContent, startConditions } from "./landingContent";
import {
  displaySection,
  primaryActionLg,
  secondaryLink,
  sectionEyebrow,
  sectionLede,
  sectionRhythm,
} from "./landingType";
import TrackedLandingLink from "./TrackedLandingLink";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

export default function ClosingAction() {
  return (
    <section
      id="start-conditions"
      className="relative isolate scroll-mt-20 overflow-hidden bg-ivory-blush text-[#243832]"
      aria-labelledby="landing-closing-title"
    >
      <div
        className="absolute -left-28 -top-40 -z-10 h-[420px] w-[420px] rounded-full border border-[#8F6662]/14"
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-48 -right-24 -z-10 h-[440px] w-[440px] rounded-full border border-[#36534E]/12"
        aria-hidden="true"
      />
      <div className={`${shell} ${sectionRhythm} text-center`}>
        <p className={sectionEyebrow}>{landingContent.closing.eyebrow}</p>
        <h2
          id="landing-closing-title"
          className={`mx-auto mt-4 max-w-4xl ${displaySection}`}
        >
          {landingContent.closing.title}
        </h2>
        <p className={`mx-auto mt-6 max-w-[34rem] ${sectionLede} text-[#36534E]/82`}>
          {landingContent.closing.body}
        </p>
        {/* 조건 네 개를 한 덩어리로 버튼 앞에 쌓아 두니, 실측에서 미세문구가 섹션의
            34.9%(1280) · 53.1%(390)를 차지하고 페이지의 마지막 행동이 접힘선 아래
            53px(1280) · 266px(390)로 밀렸다. 지우지 않고 나눈다 — 이 버튼이 지금
            여는 것을 설명하는 두 개는 앞에(P6: 이용 전 고지), 이 버튼이 열지 않는
            계정 베타를 설명하는 두 개는 행동 뒤에 둔다. */}
        <dl className="mx-auto mt-8 grid max-w-[46rem] gap-x-8 gap-y-4 text-left sm:grid-cols-2">
          {startConditions.slice(0, 2).map((condition) => (
            <div key={condition.label} className="border-t border-[#243832]/14 pt-3">
              <dt className={sectionEyebrow}>{condition.label}</dt>
              <dd className="mt-1 text-[12px] leading-5 text-[#243832]/76">
                {condition.value}
              </dd>
            </div>
          ))}
        </dl>
        {/* 두 링크 모두 `inline-flex`라 `mx-auto`가 아무 일도 하지 않는다. 그래서
            둘이 같은 line box에 나란히 놓여 로그인 링크가 버튼 위로 겹쳐 있었다
            (1280 실측). 가운데 정렬과 세로 쌓기는 부모가 책임진다. */}
        <div className="mt-8 flex flex-col items-center gap-4">
          <TrackedLandingLink
            href="/start-here"
            source="landing_closing"
            className={`${primaryActionLg} max-w-full justify-center focus-visible:ring-[#8F6662] focus-visible:ring-offset-4 focus-visible:ring-offset-ivory-blush`}
          >
            아모라와 시작하기
            <ArrowRight className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-1" aria-hidden="true" />
          </TrackedLandingLink>
          <Link
            href="/login"
            className={`${secondaryLink} focus-visible:ring-offset-4 focus-visible:ring-offset-ivory-blush`}
          >
            계정이 있다면 로그인
          </Link>
        </div>
        <dl className="mx-auto mt-10 grid max-w-4xl overflow-hidden border border-[#243832]/14 bg-white/34 text-left sm:grid-cols-2">
          {startConditions.slice(2).map((condition, index) => (
            <div
              key={condition.label}
              className={`p-5 sm:p-6 ${index === 0 ? "border-b border-[#243832]/10 sm:border-b-0 sm:border-r sm:border-[#243832]/10" : ""}`}
            >
              <dt className="text-[14px] font-semibold text-rose-700">{condition.label}</dt>
              <dd className="mt-2 text-[14px] font-medium leading-6 text-[#243832]/76">
                {condition.value}
              </dd>
            </div>
          ))}
        </dl>
        {/* 위 문구가 "제공 기능·이용 기간·무료 상담 한도는 참여 안내에서 확인하고
            참여 여부를 결정해요"라고 말하는데, 정작 그 참여 안내(/beta)로 가는 링크가
            살아 있는 랜딩에는 없었다(기존 링크 3개는 모두 렌더되지 않는 컴포넌트에
            있었다). 근거로 인용한 문서는 그 자리에서 열 수 있어야 한다. */}
        <div className="mt-5 flex justify-center">
          <Link
            href="/beta"
            className={`${secondaryLink} focus-visible:ring-offset-4 focus-visible:ring-offset-ivory-blush`}
          >
            계정 베타 참여 안내 보기
          </Link>
        </div>
      </div>
    </section>
  );
}
