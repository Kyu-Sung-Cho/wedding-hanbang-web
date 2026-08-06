import { ArrowRight, CalendarCheck, FileSearch, ReceiptText, Sparkles, Users } from "lucide-react";
import Link from "next/link";

import { availableNow, availableNowLead, landingContent } from "./landingContent";
import {
  displaySection,
  eyebrowGlyph,
  primaryActionMd,
  secondaryLink,
  sectionEyebrow,
  sectionLede,
  sectionRhythm,
} from "./landingType";
import TrackedLandingLink from "./TrackedLandingLink";

/**
 * 지금 가입 없이 되는 것.
 *
 * 왜 이 섹션이 필요한가: 랜딩 지면의 대부분이 **아직 제공하지 않는** 계정 베타를
 * 설명하는 데 쓰이고 있었다(문서의 65%). 그런데 코드 전수 조사에서 로그인 없이
 * 오늘 실제로 되는 것이 16가지 확인됐고, 랜딩은 그중 사실상 아무것도 말하지
 * 않았다. 처음 온 사람이 자기가 지금 가질 수 없는 것에 대한 페이지를 읽고 있었다.
 *
 * 여기 싣는 네 가지는 전부 **로그인 없이 200 응답을 직접 확인**한 경로다. 링크를
 * 걸었는데 막혀 있으면 그 자체가 거짓말이 되므로, 새 항목을 추가할 때도 실제
 * 응답을 확인하고 넣는다. 게이트로 막힌 기능(업체 추천·예약·축의금·동기방 등
 * 16가지)은 코드에 있어도 여기 넣지 않는다.
 */

const cardIcons = {
  "start-here": CalendarCheck,
  price: ReceiptText,
  "quote-check": FileSearch,
  "wedding-code": Users,
} as const;

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

export default function AvailableNowSection() {
  return (
    <section
      id="available-now"
      className="scroll-mt-20 bg-white text-[#243832]"
      aria-labelledby="landing-available-now-title"
    >
      <div className={`${shell} ${sectionRhythm}`}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-end lg:gap-16">
          <div>
            <p className={sectionEyebrow}>{landingContent.availableNow.eyebrow}</p>
            <h2
              id="landing-available-now-title"
              className={`mt-4 max-w-[680px] ${displaySection}`}
            >
              {landingContent.availableNow.title}
            </h2>
          </div>
          <p className={`max-w-[34rem] ${sectionLede} text-[#36534E]/82 lg:pb-1`}>
            {landingContent.availableNow.body}
          </p>
        </div>

        {/* 아모라를 넷과 같은 크기로 늘어놓으면 제품의 중심이 주변 도구와 같은
            무게로 읽힌다. 대표 항목으로 먼저 세우고, 아래 넷이 그걸 뒷받침한다. */}
        <div className="mt-10 border border-[#243832]/14 bg-ivory-blush p-6 sm:p-8 lg:mt-14">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
            <div className="flex-1">
              <p className={`flex items-center gap-2 ${sectionEyebrow}`}>
                <Sparkles className={eyebrowGlyph} aria-hidden="true" />
                {landingContent.hero.aiRole}
              </p>
              <h3 className="mt-3 text-[24px] font-semibold leading-[1.25] tracking-[-0.025em] sm:text-[30px]">
                {availableNowLead.title}
              </h3>
              <p className="mt-3 max-w-[38rem] text-[16px] leading-[1.7] text-[#36534E]">
                {availableNowLead.body}
              </p>
            </div>
            <div className="lg:w-[19rem] lg:shrink-0">
              <p className="text-[12px] leading-5 text-[#243832]/76">{availableNowLead.note}</p>
              <TrackedLandingLink
                href={availableNowLead.href}
                source="landing_available_now"
                className={`${primaryActionMd} mt-4 justify-between focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-blush`}
              >
                {availableNowLead.action}
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </TrackedLandingLink>
            </div>
          </div>
        </div>

        <ul className="mt-px grid gap-px overflow-hidden border border-[#243832]/14 bg-[#243832]/14 sm:grid-cols-2">
          {availableNow.map((item) => {
            const Icon = cardIcons[item.id];
            return (
              <li key={item.id} className="flex flex-col bg-white p-6 sm:p-8">
                <Icon className="h-6 w-6 text-rose-700" aria-hidden="true" />
                <h3 className="mt-5 text-[20px] font-semibold leading-[1.3] tracking-[-0.02em]">
                  {item.title}
                </h3>
                <p className="mt-3 text-[16px] leading-[1.7] text-[#36534E]">{item.body}</p>
                {/* 각 항목이 "왜 안심해도 되는지"를 카드 안에서 끝낸다 —
                    저장 여부·출처처럼 이용 전에 알아야 할 사실이다(P6). */}
                <p className="mt-3 text-[12px] leading-5 text-[#243832]/72">{item.note}</p>
                {/* `TrackedLandingLink`를 쓰지 않는다. 그건 아모라를 여는 링크 전용이라
                    `landing_amora_start_click`을 쏘고 날짜 handoff를 지운다 — 여기 넷은
                    아모라를 열지 않으므로 둘 다 틀린 동작이 된다. */}
                <Link
                  href={item.href}
                  className={`group mt-auto gap-2 pt-5 ${secondaryLink} focus-visible:ring-offset-2`}
                >
                  {item.action}
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 text-[14px] leading-[1.7] text-[#36534E]/82">
          {landingContent.availableNow.boundary}
        </p>
      </div>
    </section>
  );
}
