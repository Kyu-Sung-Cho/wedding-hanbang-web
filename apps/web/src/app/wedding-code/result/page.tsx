import type { Metadata } from "next";
import PublicBetaUnavailable from "@/components/app/PublicBetaUnavailable";

export const metadata: Metadata = {
  title: "웨딩코드 미제공 안내 | 웨딩한방",
  robots: { index: false, follow: false },
};

export default function WeddingCodeResultPage() {
  return <PublicBetaUnavailable feature="weddingCode" />;
}
