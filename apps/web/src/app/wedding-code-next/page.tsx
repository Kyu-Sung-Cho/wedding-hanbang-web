import type { Metadata } from "next";
import WeddingCodeNextClient from "@/components/weddingCodeNext/WeddingCodeNextClient";

export const metadata: Metadata = {
  title: "나의 결혼 준비 언어 | 웨딩코드 · 웨딩한방",
  description: "30개의 문장으로 준비 기준을 살펴봐요. 둘 다 답한 뒤 두 사람 결과 링크를 직접 돌려주면 각자의 답을 나란히 읽을 수 있어요. 로그인 없이 시작해요.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: {
    title: "나의 결혼 준비 언어 | 웨딩코드 · 웨딩한방",
    description: "둘 다 답한 뒤 두 사람 결과 링크를 직접 돌려주면 나란히 볼 수 있어요.",
    siteName: "웨딩한방", locale: "ko_KR", type: "website",
    images: [{ url: "/wedding-code/likert-card/opengraph-image", width: 1200, height: 630, alt: "웨딩코드, 결혼을 준비하는 나의 언어를 찾아요" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "나의 결혼 준비 언어 | 웨딩코드 · 웨딩한방",
    description: "둘 다 답한 뒤 두 사람 결과 링크를 직접 돌려주면 나란히 볼 수 있어요.",
    images: [{ url: "/wedding-code/likert-card/opengraph-image", width: 1200, height: 630, alt: "웨딩코드, 결혼을 준비하는 나의 언어를 찾아요" }],
  },
};

export default function WeddingCodeNextPage() {
  return <WeddingCodeNextClient />;
}
