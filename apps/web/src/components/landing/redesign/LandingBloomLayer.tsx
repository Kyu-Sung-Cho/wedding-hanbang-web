import { LandingBloom } from "./LandingBloom";

/** 장식만 잘라서 본문과 sticky 헤더의 스크롤·초점 동작을 유지한다. */
export default function LandingBloomLayer() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      {/* 헤더 높이를 더한 위치다. 좁은 화면에는 오른쪽 가지 하나만 둔다. */}
      <LandingBloom
        variant="mobile"
        className="absolute -right-[46px] top-[calc(52px+env(safe-area-inset-top))] w-[250px] opacity-[0.85] lg:hidden"
      />
      <LandingBloom
        variant="left"
        className="absolute -left-[30px] top-[calc(88px+env(safe-area-inset-top))] hidden w-[420px] opacity-[0.85] lg:block"
      />
      <LandingBloom
        variant="right"
        className="absolute -right-[40px] top-[calc(58px+env(safe-area-inset-top))] hidden w-[460px] opacity-[0.85] lg:block"
      />
    </div>
  );
}
