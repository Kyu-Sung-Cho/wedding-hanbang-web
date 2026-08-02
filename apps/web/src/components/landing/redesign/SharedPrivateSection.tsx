import Link from "next/link";
import { LockKeyhole, MessageCircle } from "lucide-react";

import { landingContent } from "./landingContent";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

export default function SharedPrivateSection() {
  return (
    <section
      id="privacy"
      className="scroll-mt-20 border-y border-[#243832]/10 bg-[#F3E9DD] text-[#243832]"
      aria-labelledby="landing-privacy-title"
    >
      <div className={`${shell} py-20 sm:py-24 lg:py-28`}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:items-end lg:gap-20">
          <div>
            <p className="text-[13px] font-semibold text-[#7D5753]">
              {landingContent.privacy.eyebrow}
            </p>
            <h2
              id="landing-privacy-title"
              className="mt-4 max-w-2xl text-[clamp(2.2rem,6.8vw,3.8rem)] font-semibold leading-[1.06] tracking-[-0.04em]"
            >
              {landingContent.privacy.title}
            </h2>
          </div>
          <p className="max-w-xl text-[15px] leading-7 text-[#4E6A62] sm:text-[16px] lg:pb-1">
            계정 이용 시 함께 관리할 준비와 파트너에게 보이지 않을 상담을 분리할 수 있어요.
            로그인 없는 체험은 공유 모드로만 열립니다.
          </p>
        </div>

        <div className="mt-12 grid overflow-hidden border border-[#243832]/12 bg-white lg:mt-16 lg:grid-cols-2">
          <article className="relative min-h-[360px] border-b border-[#243832]/12 px-6 py-8 sm:px-10 sm:py-12 lg:border-b-0 lg:border-r lg:px-12 lg:py-14">
            <p className="text-[12px] font-semibold text-[#8F6662]">01 · 함께</p>
            <MessageCircle className="mt-12 h-6 w-6 text-[#8F6662]" aria-hidden="true" />
            <h3 className="mt-5 text-[26px] font-semibold tracking-[-0.025em]">
              {landingContent.privacy.sharedTitle}
            </h3>
            <p className="mt-4 max-w-md text-[15px] leading-7 text-[#4E6A62] sm:text-[16px]">
              {landingContent.privacy.sharedBody}
            </p>
            <div className="absolute inset-x-6 bottom-8 flex items-center gap-3 border-t border-[#243832]/10 pt-5 text-[12px] font-semibold text-[#4E6A62] sm:inset-x-10 lg:inset-x-12">
              <span className="h-2 w-2 rounded-full bg-[#6D806E]" aria-hidden="true" />
              확인해 반영한 결과를 함께 보기
            </div>
          </article>

          <article className="relative min-h-[400px] bg-[#243832] px-6 py-8 text-white sm:px-10 sm:py-12 lg:px-12 lg:py-14">
            <p className="text-[12px] font-semibold text-[#E2D3C8]">02 · 나만</p>
            <LockKeyhole className="mt-12 h-6 w-6 text-[#E2D3C8]" aria-hidden="true" />
            <h3 className="mt-5 text-[26px] font-semibold tracking-[-0.025em]">
              {landingContent.privacy.privateTitle}
            </h3>
            <p className="mt-4 max-w-md text-[15px] leading-7 text-white/82 sm:text-[16px]">
              {landingContent.privacy.privateBody}
            </p>
            <Link
              href="/privacy"
              className="mt-5 inline-flex min-h-11 items-center text-[13px] font-semibold text-[#E2D3C8] underline decoration-[#E2D3C8]/40 underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8]"
            >
              개인정보 처리 기준 보기
            </Link>
            <div className="absolute inset-x-6 bottom-8 flex items-center gap-3 border-t border-white/14 pt-5 text-[12px] font-semibold text-white/78 sm:inset-x-10 lg:inset-x-12">
              <LockKeyhole className="h-3.5 w-3.5 text-[#E2D3C8]" aria-hidden="true" />
              파트너 화면에는 표시하지 않음 · 서비스 처리 대상
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
