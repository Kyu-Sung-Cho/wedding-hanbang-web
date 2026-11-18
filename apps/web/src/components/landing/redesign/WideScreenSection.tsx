import Image from "next/image";

import LandingSectionHeading from "./LandingSectionHeading";
import { landingContent } from "./landingContent";

/**
 * 넓은 화면의 두 칸 모습: 왼쪽 아모라와 대화, 오른쪽 두 사람의 준비 공간(아티팩트 `Web.dc`, 1440 폭).
 *
 * 2026-11-18 파운더 요청(원문: "랜딩도 만들어야지 비슷하게", 범위 "전체다"). 그림은 예시 커플 화면
 * (`/example`, 1440×900)을 찍은 것이다. 찍을 때 문의를 보내고 답장을 받는 대화·오늘 한 일·정할 일 한 줄은
 * 가렸다(파운더 결정 D-83: 아모라가 업체에 대신 보내지 않는다). 남은 것 가운데 "웨딩홀 후보" 칸이 아직 열리지
 * 않아서, 그림 바로 아래 줄이 예시라는 것과 그 칸이 곧 열린다는 것을 함께 말한다. 그림과 그 줄은
 * 한 묶음(`figure`)이고 `data-landing-soon` 을 단다.
 *
 * 틀은 아티팩트 웹 카드 반경(26px)과 카드 고리, 바탕은 웹 준비 공간의 종이색이다.
 */
export default function WideScreenSection() {
  const { wide } = landingContent;

  return (
    <section aria-labelledby="landing-wide-title" className="bg-inv-white font-inv-sans text-inv-ink">
      <div className="mx-auto w-full max-w-[960px] px-4 py-16 md:px-8 md:py-24">
        <LandingSectionHeading id="landing-wide-title" title={wide.title} body={wide.body} />
        <figure className="m-0 mt-10 md:mt-14" data-landing-soon="">
          <div className="overflow-hidden rounded-[26px] border border-inv-ring bg-inv-paper-panel shadow-raised">
            <Image
              src={wide.shot.src}
              width={wide.shot.width}
              height={wide.shot.height}
              alt={wide.shot.alt}
              sizes="(min-width: 960px) 896px, (min-width: 768px) calc(100vw - 64px), calc(100vw - 32px)"
              className="block h-auto w-full"
            />
          </div>
          <figcaption className="mt-4 text-[13px] leading-[1.7] text-inv-muted">{wide.caption}</figcaption>
        </figure>
      </div>
    </section>
  );
}
