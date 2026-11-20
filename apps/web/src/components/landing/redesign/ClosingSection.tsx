import Image from "next/image";
import { START_COPY } from "@hanbang/shared/invitation";

import AmoraOrb from "@/components/ui/AmoraOrb";

import { landingContent } from "./landingContent";
import { START_PHOTO } from "./StartScreen";
import TrackedLandingLink from "./TrackedLandingLink";

/**
 * 마무리: 첫 화면을 작게 한 번 더.
 *
 * 2026-11-18 파운더 요청(원문: "랜딩도 만들어야지 비슷하게", 범위 "전체다"). 페이지 끝에서 다시 시작할 수
 * 있게 첫 화면과 같은 보케 사진·오브·흰 유리 카드를 반경 36px 판 안에 담는다. 카드 값(흰색 86%, 24px 흐림,
 * 반경 36px, 안쪽 32·26·22px, 사이 14px)과 두 행동(먹색 알약 56px, 글자 링크 44px)은 시작 화면 그대로다.
 *
 * 행동의 목적지와 글자는 첫 화면과 같은 정본이다(`landingContent.start`, `START_COPY`). 누른 자리는 따로
 * 센다(`landing_closing_primary`·`landing_closing_secondary`). 사진과 오브는 장식이라 읽어 주지 않는다.
 */
export default function ClosingSection() {
  const { start, closing } = landingContent;

  return (
    <section aria-labelledby="landing-closing-title" className="bg-inv-white font-inv-sans leading-[normal] text-inv-ink">
      <div className="mx-auto w-full max-w-[960px] px-4 pb-16 md:px-8 md:pb-24">
        <div className="relative flex min-h-[600px] flex-col items-center overflow-hidden rounded-[36px] bg-inv-blush px-3 pt-16 pb-3 md:pb-10">
          <Image
            src={START_PHOTO}
            alt=""
            fill
            sizes="(min-width: 960px) 896px, (min-width: 768px) calc(100vw - 64px), calc(100vw - 32px)"
            className="object-cover"
          />
          <div className="relative flex justify-center">
            <AmoraOrb size={120} mood="calm" decorative />
          </div>
          <div className="relative mt-auto flex w-full max-w-[440px] flex-col gap-3.5 rounded-[36px] bg-inv-white/86 px-[26px] pt-8 pb-[22px] backdrop-blur-[24px]">
            <h2
              id="landing-closing-title"
              className="m-0 font-inv-serif text-[clamp(22px,6.924vw,27px)] font-normal leading-[1.45] text-balance"
            >
              {closing.title}
            </h2>
            <p className="m-0 text-[15px] leading-[1.7] text-inv-body">{closing.body}</p>
            <TrackedLandingLink
              href={start.primary.href}
              source="landing_closing_primary"
              prefetch={false}
              variant="ink"
              size="pill-56"
              weight="bold"
              className="mt-2.5"
            >
              {START_COPY.start}
            </TrackedLandingLink>
            <TrackedLandingLink
              href={start.example.href}
              source="landing_closing_secondary"
              variant="text"
              size="pill-44"
              weight="medium"
            >
              {START_COPY.example}
            </TrackedLandingLink>
          </div>
        </div>
      </div>
    </section>
  );
}
