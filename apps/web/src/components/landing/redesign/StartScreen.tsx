import Image from "next/image";
import { START_COPY } from "@hanbang/shared/invitation";

import AmoraOrb from "@/components/ui/AmoraOrb";

import { landingContent } from "./landingContent";
import TrackedLandingLink from "./TrackedLandingLink";

/** 시작 화면 바탕 사진. 아티팩트의 보케 사진이다(직접 렌더링한 예시 이미지, 사람·장소 없음). */
export const START_PHOTO = "/images/amora/bokeh-blush.webp";

/**
 * 시작 화면 — 2026-11-17 파운더 디자인 아티팩트 `Main.dc.html`(390×844).
 * 파운더 원문: 이 디자인 완전 같아야해. 값은 원본 인라인 스타일 그대로 옮겼다.
 *
 *   바탕 #F3E4E1 위에 사진을 꽉 채운다(cover).
 *   위: 64px 아래 amora(Cormorant 이탤릭 500, 40px, 흰색, 자간 0.01em),
 *       4px 아래 한 줄(12px, 자간 0.08em, 흰색 90%).
 *   오브: 위에서 210px, 150px, 차분한 모습.
 *   카드: 좌우·아래 12px, 흰색 86% 와 24px 흐림, 반경 36px, 안쪽 위 32·옆 26·아래 22px, 사이 14px.
 *     제목 고운바탕 400 27px 줄 1.45 자간 -0.01em · 본문 15px 줄 1.7 #4E4852 ·
 *     시작하기(먹색 알약 56px, 위로 10px 더) · 예시 커플로 둘러보기(글자 링크 44px).
 *   줄높이: 아티팩트처럼 기본값(normal)을 물려준다. 웹 본문의 1.6 을 물려받으면 알약 안
 *     "시작하기" 글자가 1px 위로 뜬다(2026-11-17 같은 Chrome 으로 잰 값).
 *
 * 아티팩트와 다르게 한 곳(전부 390×844 에서는 아티팩트 값 그대로다):
 *   1. 세로. 아티팩트 틀은 844px 전화기 화면이고 브라우저의 첫 화면은 그보다 짧다(같은
 *      전화기도 주소창 때문에 대개 650~720px). 카드는 늘 아래에 붙인다. 카드가 오브를 덮기
 *      시작하는 높이(749px, 넓은 화면은 777px)보다 짧으면 위쪽 여백(64→24px)과 오브 위치
 *      (210→110px)를 최대 100px 까지 당긴다. 그보다 더 짧으면 첫 화면이 화면보다 길어지고
 *      내려 볼 수 있다.
 *   2. 좁은 전화기. 제목은 390px 이상에서 27px 이고, 더 좁으면 폭에 맞춰 줄어든다. 360px
 *      전화기에서 첫 줄이 갈라져 세 줄이 되지 않게 하려는 것이다.
 *   3. 넓은 화면. 사진은 화면 전체를 덮고 글자와 오브는 가운데에 그대로 둔다. 카드는 너비를
 *      440px 로 막아 가운데 아래에 두고, 768px 이상에서는 아래 여백을 40px 로 둔다.
 *   4. 한글 줄바꿈은 웹 전체 규칙(낱말 단위)을 따른다. 아티팩트 HTML 은 글자 단위로 끊긴다.
 *
 * 문구는 `START_COPY`(앱과 같은 정본)에서만 읽는다. 버튼은 공유 `Button` 의 알약이다.
 */
export default function StartScreen() {
  const { start } = landingContent;

  return (
    <div className="relative h-[100svh] min-h-[649px] overflow-hidden bg-inv-blush font-inv-sans leading-[normal] text-inv-ink [word-break:normal] [overflow-wrap:normal] [--start-squeeze:clamp(0px,749px_-_100svh,100px)] md:min-h-[677px] md:[--start-squeeze:clamp(0px,777px_-_100svh,100px)]">
      <Image
        src={START_PHOTO}
        alt=""
        fill
        sizes="100vw"
        loading="eager"
        fetchPriority="high"
        className="object-cover"
      />

      <div className="absolute inset-x-0 top-0 flex flex-col items-center gap-1 pt-[calc(64px_-_var(--start-squeeze)*0.4)]">
        <span className="font-inv-numeral text-[40px] font-medium italic leading-[normal] tracking-[0.01em] text-inv-white">
          {START_COPY.wordmark}
        </span>
        <span className="text-[12px] leading-[normal] tracking-[0.08em] text-inv-white/90">
          {START_COPY.tagline}
        </span>
      </div>

      {/* 이름(amora)이 바로 위에 적혀 있어 오브는 읽어 주지 않는다. */}
      <div className="absolute inset-x-0 top-[calc(210px_-_var(--start-squeeze))] flex justify-center">
        <AmoraOrb size={150} mood="calm" decorative />
      </div>

      <section
        aria-labelledby="start-title"
        className="absolute inset-x-3 bottom-3 mx-auto flex max-w-[440px] flex-col gap-3.5 rounded-[36px] bg-inv-white/86 px-[26px] pb-[22px] pt-8 backdrop-blur-[24px] md:bottom-10"
      >
        <h1
          id="start-title"
          className="m-0 font-inv-serif text-[clamp(22px,6.924vw,27px)] font-normal leading-[1.45] tracking-[-0.01em]"
        >
          {START_COPY.headingLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>
        <p className="m-0 text-[15px] leading-[1.7] text-inv-body">{START_COPY.body}</p>
        <TrackedLandingLink
          href={start.primary.href}
          source="landing_hero_primary"
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
          source="landing_hero_secondary"
          variant="text"
          size="pill-44"
          weight="medium"
        >
          {START_COPY.example}
        </TrackedLandingLink>
      </section>
    </div>
  );
}
