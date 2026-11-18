import { EXAMPLE_COPY } from "@hanbang/shared/invitation";

import LandingSectionHeading from "./LandingSectionHeading";
import { landingContent } from "./landingContent";
import PhoneShot, { type LandingShot } from "./PhoneShot";
import SoonBadge from "./SoonBadge";

/** 전화기 틀은 좁은 화면에서 260px, 넓은 화면에서 280px 까지다(next/image 가 고를 크기). */
const PHONE_SIZES = "(min-width: 768px) 280px, 260px";

type Feature = { readonly title: string; readonly body: string; readonly shot: LandingShot };

/** 카드. 곧 열리는 카드는 넓은 화면에서 두 칸을 가로로 쓴다(전화기 왼쪽, 글 오른쪽). */
const CARD = "flex flex-col overflow-hidden rounded-[36px] border border-inv-ring bg-inv-white";
const CARD_SOON = "md:col-span-2 md:flex-row";
/** 전화기를 세운 면. 오늘 되는 화면은 분홍(시작 화면 바탕), 곧 열리는 화면은 돌빛이다. */
const STAGE = "h-[340px] overflow-hidden px-10 pt-9 md:h-[420px]";
const STAGE_TODAY = "bg-inv-blush";
const STAGE_SOON = "bg-inv-stone md:w-1/2 md:flex-none";
const TEXT = "flex flex-col items-start gap-2 px-6 pt-6 pb-7 md:px-8";
const TEXT_SOON = "md:justify-center md:px-10 md:py-10";

/**
 * 화면 한 장과 설명. 위는 전화기를 세운 면이고 전화기 아래쪽은 면 밖으로 잘린다(화면 위쪽이 이야기다).
 * 오늘 되는 화면은 분홍 면, 곧 열리는 화면은 돌빛 면과 "곧 열려요" 꼬리표다.
 */
function FeatureCard({ feature, soon }: { feature: Feature; soon: boolean }) {
  return (
    <li className={soon ? `${CARD} ${CARD_SOON}` : CARD} data-landing-soon={soon ? "" : undefined}>
      <div className={soon ? `${STAGE} ${STAGE_SOON}` : `${STAGE} ${STAGE_TODAY}`}>
        <PhoneShot shot={feature.shot} sizes={PHONE_SIZES} className="mx-auto w-full max-w-[260px] md:max-w-[280px]" />
      </div>
      <div className={soon ? `${TEXT} ${TEXT_SOON}` : TEXT}>
        {soon ? <SoonBadge /> : null}
        <h3 className="m-0 font-inv-serif text-[20px] font-normal leading-[1.45] text-inv-ink">{feature.title}</h3>
        <p className="m-0 text-[15px] leading-[1.7] text-inv-body">{feature.body}</p>
      </div>
    </li>
  );
}

/**
 * 첫 화면 아래 첫 섹션: 아모라가 오늘 하는 일.
 *
 * 2026-11-18 파운더 요청(원문: "랜딩도 만들어야지 비슷하게", 범위 "전체다"). 오늘 되는 화면 둘(청첩장 홈,
 * 준비 순서)을 먼저 크게 두고, 곧 열리는 화면 하나(웨딩홀 비교와 문의 글 준비)는 꼬리표를 달아 그 아래에
 * 둔다. 파운더 결정 D-83(문의 글은 아모라와 함께 쓰고 두 분이 직접 보낸다)으로 보내기 전 편지 승인 화면은 싣지
 * 않는다. 화면은 모두 예시 커플 화면이라 맨 아래에 예시 커플 화면의 안내 줄을 그대로 단다.
 */
export default function TodaySection() {
  const { today } = landingContent;

  return (
    <section aria-labelledby="landing-today-title" className="bg-inv-paper font-inv-sans text-inv-ink">
      <div className="mx-auto w-full max-w-[960px] px-4 py-16 md:px-8 md:py-24">
        <LandingSectionHeading id="landing-today-title" title={today.title} body={today.body} />
        <ul className="m-0 mt-10 grid list-none gap-5 p-0 md:mt-14 md:grid-cols-2 md:gap-6">
          {today.features.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} soon={false} />
          ))}
          {today.soonFeatures.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} soon />
          ))}
        </ul>
        <p className="m-0 mt-6 text-[13px] leading-[1.7] text-inv-muted">{EXAMPLE_COPY.banner}</p>
      </div>
    </section>
  );
}
