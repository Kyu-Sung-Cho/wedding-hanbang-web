import type { Metadata } from "next";
import WeddingTasteClient from "./WeddingTasteClient";

const title = "내가 원하는 결혼식 | 웨딩코드 · 웨딩한방";
const description = "어떤 분위기가 좋은지, 뭘 피하고 싶은지 골라 보세요. 링크로 보내면 둘이 고른 걸 나란히 볼 수 있어요.";

/**
 * 고른 답이 담긴 링크(`#v=…&a=…`)는 대화창에 붙여 보내는 주소라 공유 카드가 곧 첫 화면이다.
 * 여기서 openGraph 를 정하지 않으면 루트 layout 의 카드(아모라 문구, `og:url=/landing`)에 부모 폴더의
 * 웨딩코드 그림만 붙은 섞인 카드가 나온다.
 *
 * - `og:url` 은 적지 않는다. 답이 `#` 뒤에 있어, 그 주소를 따라가는 곳에서 답이 빠진 주소가 열릴 수 있다.
 * - openGraph 를 여기서 정하면 부모 폴더의 `opengraph-image.tsx` 가 붙지 않으므로 같은 이미지 주소를 직접 적는다.
 */
export const metadata: Metadata = {
  title,
  description,
  referrer: "no-referrer",
  robots: { index: false, follow: false },
  openGraph: {
    title,
    description,
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/wedding-code/opengraph-image", width: 1200, height: 630, alt: "웨딩코드, 내가 원하는 결혼식과 준비 방식을 살펴보는 곳" }],
  },
  twitter: { card: "summary_large_image", title, description },
};

export default function WeddingTastePage() {
  return <WeddingTasteClient />;
}
