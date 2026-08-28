import { BloomGarland, BloomSprig, BouquetCorner } from "./LandingBloom";

/**
 * 페이지 여백에 그린 꽃 — **정본 시안의 배치 그대로.**
 *
 * 출처: `웨딩한방-랜딩시안/NotebookBest.html` 의 `.bq-*` 규칙.
 *
 * ## 왜 컴포넌트 하나로 묶나
 *
 * 2026-08-28까지 랜딩에는 히어로 오른쪽에 부케 **하나**만 있었다. 시안은 다섯 자리에
 * 놓는다 — 위를 가로지르는 화환과 좌우 곁가지 넷. 하나만 두면 첫 화면만 꾸며진
 * 페이지가 되고, 아래로 내려갈수록 그냥 흰 종이가 된다. 시안이 노리는 것은
 * **여백에 계속 꽃이 스치는** 노트다.
 *
 * ## 좁은 화면에서 줄인다
 *
 * 시안의 미디어 쿼리를 따른다 — 태블릿에서 `l2` 를 감추고 화환을 옅게, 폰에서
 * `r2` 까지 감춘다. 좁은 폭에서 장식이 본문 위로 올라오면 글을 덮는다.
 * (1024px 미만에서 부케가 H1 을 293x171px 덮은 적이 있다.)
 *
 * 전부 `aria-hidden` 이다. 읽어 줄 내용이 없다.
 */
export default function LandingBloomLayer() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      {/* 위를 가로지르는 화환. 폭을 꽉 채운다. */}
      <BloomGarland className="absolute -top-[10px] left-0 right-0 w-full opacity-[0.34] sm:opacity-[0.44] lg:opacity-[0.58]" />

      {/* 왼쪽 위 곁가지 */}
      <BloomSprig className="absolute -left-[74px] top-[26%] w-[clamp(120px,13vw,206px)] opacity-[0.46]" />

      {/* 오른쪽 가운데 — 뒤집어 바깥을 향하게 */}
      <BouquetCorner className="absolute -right-[62px] top-[48%] w-[clamp(132px,15vw,232px)] -scale-x-100 opacity-[0.42]" />

      {/* 왼쪽 아래 — 태블릿 아래에서는 감춘다 */}
      <BloomSprig className="absolute -left-[58px] top-[71%] hidden w-[clamp(104px,11vw,176px)] opacity-[0.38] lg:block" />

      {/* 오른쪽 아래 — 폰에서는 감추고, 태블릿에서는 줄인다 */}
      <BouquetCorner className="absolute -right-[46px] bottom-6 hidden w-[118px] -scale-x-100 opacity-[0.26] sm:block lg:-right-[70px] lg:w-[clamp(126px,14vw,216px)] lg:opacity-[0.34]" />
    </div>
  );
}
