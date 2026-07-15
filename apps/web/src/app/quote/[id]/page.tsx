import type { Metadata } from "next";
import PublicBetaUnavailable from "@/components/app/PublicBetaUnavailable";

export const metadata: Metadata = {
  title: "이전 견적 체크 미제공 안내 | 웨딩한방",
  robots: { index: false, follow: false },
};

export default function RetiredPublicQuotePage() {
  return <PublicBetaUnavailable feature="quoteChecklist" />;
}
