import AmoraOrb from "@/components/ui/AmoraOrb";

import LandingSectionHeading from "./LandingSectionHeading";
import { landingContent } from "./landingContent";

/**
 * 아모라가 일하는 방식 셋.
 *
 * 2026-11-18 파운더 요청(원문: "랜딩도 만들어야지 비슷하게", 범위 "전체다"). 셋 다 오늘 코드가 지키는 것만
 * 적는다(문구 옆 주석은 `landingContent.ts` 의 `promises`). 법·신뢰 고지 전문은 바닥글이 그대로 진다 — 여기는
 * 그 가운데 아모라가 일하는 방식을 앞에서 한 번 더 말하는 자리다.
 *
 * 모양은 아티팩트의 분홍 바탕(시작 화면)과 흰 카드, 차분한 오브다. 오브는 바로 아래 제목이 아모라를 말하므로
 * 읽어 주지 않는다.
 */
export default function PromiseSection() {
  const { promises } = landingContent;

  return (
    <section aria-labelledby="landing-promises-title" className="bg-inv-paper font-inv-sans text-inv-ink">
      <div className="mx-auto w-full max-w-[960px] px-4 py-16 md:px-8 md:py-24">
        <div className="rounded-[36px] bg-inv-blush px-5 pt-10 pb-5 md:px-12 md:pt-14 md:pb-12">
          <div className="flex flex-col items-center gap-5">
            <AmoraOrb size={72} mood="calm" decorative />
            <LandingSectionHeading id="landing-promises-title" title={promises.title} centered />
          </div>
          <ul className="m-0 mt-8 grid list-none gap-3 p-0 md:mt-10 md:gap-4 lg:grid-cols-3">
            {promises.items.map((item) => (
              <li key={item.title} className="rounded-[26px] bg-inv-white px-6 py-6 md:px-7 md:py-7">
                <h3 className="m-0 font-inv-serif text-[19px] font-normal leading-[1.45] text-inv-ink">{item.title}</h3>
                <p className="m-0 mt-2 text-[15px] leading-[1.7] text-inv-body">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
