import type { Metadata } from "next";

import { DecisionOutcomeReviewQueue } from "@/components/admin/DecisionOutcomeReviewQueue";

export const metadata: Metadata = {
  title: "결정 결과 공개 검수 | 웨딩한방 관리자",
  robots: { index: false, follow: false },
};

export default function DecisionOutcomeReviewPage() {
  return <DecisionOutcomeReviewQueue />;
}
