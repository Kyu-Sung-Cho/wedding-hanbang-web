/**
 * 첫 화면 아래 섹션의 제목(h2)과 이끄는 글.
 *
 * 2026-11-18 파운더 요청(원문: "랜딩도 만들어야지 비슷하게", 범위 "전체다")으로 생긴 섹션들이 함께 쓴다.
 * 제목은 아티팩트의 한글 제목 글꼴(고운바탕 400)이고, 390px 에서 시작 화면 제목(27px)보다 조금 작은
 * 25px 에서 넓은 화면 34px 까지 자란다. 본문은 Noto Sans KR 이다.
 *
 * `id` 는 섹션의 `aria-labelledby` 가 가리킨다. 섹션 파일이 같은 값을 글자로 적어 넘긴다
 * (`landingLandmarks.test.ts` 가 같은 파일 안에서 짝을 찾는다).
 */
export default function LandingSectionHeading({
  id,
  title,
  body,
  centered = false,
}: {
  id: string;
  title: string;
  body?: string;
  centered?: boolean;
}) {
  return (
    <div className={centered ? "mx-auto max-w-[640px] text-center" : "max-w-[640px]"}>
      <h2
        id={id}
        className="m-0 font-inv-serif text-[clamp(24px,6.4vw,34px)] font-normal leading-[1.45] text-inv-ink text-balance"
      >
        {title}
      </h2>
      {body ? (
        <p className="m-0 mt-3 text-[15px] leading-[1.75] text-inv-body md:mt-4 md:text-[17px]">{body}</p>
      ) : null}
    </div>
  );
}
