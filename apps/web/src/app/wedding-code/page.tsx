import type { Metadata } from "next";
import WeddingCodeClient from "./WeddingCodeClient";

// 사람 대상 검증 전 웨딩코드 베타 — 직접 링크로만 접근. 검색 비노출(noindex + robots.ts disallow).
export const metadata: Metadata = {
  title: "웨딩 준비 순서 체크 | 웨딩한방",
  robots: { index: false, follow: false },
};

export default function WeddingCodePage() {
  return <WeddingCodeClient />;
}
