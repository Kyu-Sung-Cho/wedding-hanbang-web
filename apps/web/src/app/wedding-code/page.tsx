import type { Metadata } from "next";
import WeddingCodeClient from "./WeddingCodeClient";

// 미링크 프로토타입 — 직접 링크로만 접근. 검색 비노출(noindex + robots.ts disallow).
export const metadata: Metadata = {
  title: "웨딩코드 3분 테스트 — 프로토타입 | 웨딩한방",
  robots: { index: false, follow: false },
};

export default function WeddingCodePage() {
  return <WeddingCodeClient />;
}
