import type { Metadata } from "next";
import WeddingCodeTogether from "./WeddingCodeTogether";

const title = "두 사람의 웨딩코드 | 웨딩한방";
const description = "각자 답한 결혼식 취향과 준비 방식을 함께 살펴봐요.";

/**
 * 초대 링크(`#room=…&invite=…`)는 대화창에 붙여 보내는 주소라 공유 카드가 곧 첫 화면이다.
 * 여기서 openGraph 를 정하지 않으면 루트 layout 의 카드(아모라 문구, `og:url=/landing`)가 나온다.
 *
 * - 카드는 일반 카드다. 방 번호와 초대 토큰은 `#` 뒤에 있어 서버가 못 읽는다.
 * - `og:url` 은 적지 않는다. 적으면 그 주소를 따라가는 곳에서 `#` 뒤 초대 토큰이 빠진
 *   주소가 열릴 수 있다. 없으면 붙여 넣은 주소를 그대로 쓴다.
 * - openGraph 를 여기서 정하면 부모 폴더의 `opengraph-image.tsx` 가 붙지 않으므로
 *   같은 이미지 주소를 직접 적는다.
 */
export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false }, referrer: "no-referrer",
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
export default function WeddingCodeTogetherPage() { return <WeddingCodeTogether />; }
