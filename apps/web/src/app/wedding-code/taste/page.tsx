import type { Metadata } from "next";
import WeddingTasteClient from "./WeddingTasteClient";

export const metadata: Metadata = {
  title: "내가 원하는 결혼식 | 웨딩코드 · 웨딩한방",
  description: "어떤 분위기가 좋은지, 뭘 피하고 싶은지 골라 보세요. 링크로 보내면 둘이 고른 걸 나란히 볼 수 있어요.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function WeddingTastePage() {
  return <WeddingTasteClient />;
}
