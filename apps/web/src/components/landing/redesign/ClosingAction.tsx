import { ArrowRight, CalendarDays } from "lucide-react";

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
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#8F6662]/20 bg-white/60 text-[#8F6662]" aria-hidden="true">
          <CalendarDays className="h-5 w-5" />
        </span>
        <p className={`mt-6 ${sectionEyebrow}`}>{landingContent.closing.eyebrow}</p>
        <h2
          id="landing-closing-title"
          className={`mx-auto mt-4 max-w-4xl ${displaySection}`}
        >
          {landingContent.closing.title}
        </h2>
        <p className={`mx-auto mt-6 max-w-[34rem] ${sectionLede} text-[#36534E]/82`}>
          {landingContent.closing.body}
        </p>
        <dl className="mx-auto mt-10 grid max-w-4xl overflow-hidden border border-[#243832]/14 bg-white/34 text-left sm:grid-cols-2">
          {startConditions.map((condition, index) => (
            <div
              key={condition.label}
              className={`p-5 sm:p-6 ${index < startConditions.length - 1 ? "border-b border-[#243832]/10" : ""} ${index === 2 ? "sm:border-b-0" : ""} ${index % 2 === 0 ? "sm:border-r sm:border-[#243832]/10" : ""}`}
            >
              <dt className="text-[14px] font-semibold text-rose-700">{condition.label}</dt>
              <dd className="mt-2 text-[14px] font-medium leading-6 text-[#243832]/76">
                {condition.value}
              </dd>
            </div>
          ))}
        </dl>
        <TrackedLandingLink
          href="/start-here"
          source="landing_closing"
          className={`${primaryActionLg} mx-auto mt-9 max-w-full justify-center focus-visible:ring-[#8F6662] focus-visible:ring-offset-4 focus-visible:ring-offset-ivory-blush`}
        >
          아모라와 시작하기
          <ArrowRight className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-1" aria-hidden="true" />
        </TrackedLandingLink>
        <Link
          href="/login"
          className={`mx-auto mt-4 w-fit justify-center ${secondaryLink} focus-visible:ring-offset-4 focus-visible:ring-offset-ivory-blush`}
        >
          계정이 있다면 로그인
        </Link>
      </div>
    </section>
  );
}
