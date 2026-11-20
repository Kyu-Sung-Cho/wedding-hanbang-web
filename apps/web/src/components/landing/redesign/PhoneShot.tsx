import Image from "next/image";

/** 랜딩에 싣는 예시 화면 한 장. `landingContent` 의 `shot` 모양 그대로다. */
export type LandingShot = {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
};

/**
 * 전화기 틀에 담은 예시 화면.
 *
 * 2026-11-18 파운더 요청(원문: "랜딩도 만들어야지 비슷하게")으로 첫 화면 아래 섹션이 생기며 만든 틀이다.
 * 화면은 예시 커플(`/example`) 화면을 390×844 로 찍은 것이다. 바깥은 아티팩트의 시트 반경(36px),
 * 8px 안쪽의 화면은 28px 이라 두 곡선이 나란하다. 테두리는 아티팩트 카드 고리 색, 그림자는 제품의
 * 띄움 토큰 하나뿐이다. 첫 화면 밖이라 늦게 받는다(next/image 기본값).
 */
export default function PhoneShot({
  shot,
  sizes,
  className,
}: {
  shot: LandingShot;
  sizes: string;
  className?: string;
}) {
  return (
    <div className={`rounded-[36px] border border-inv-ring bg-inv-white p-2 shadow-overlay ${className ?? ""}`}>
      <Image
        src={shot.src}
        width={shot.width}
        height={shot.height}
        alt={shot.alt}
        sizes={sizes}
        className="block h-auto w-full rounded-[28px]"
      />
    </div>
  );
}
