import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isWeddingCourtEnabled } from "@/lib/features/weddingLaunchFlags";
import WeddingCourtClient from "./WeddingCourtClient";

export const metadata: Metadata = {
  title: "오늘의 웨딩 선택 법정 | 웨딩한방",
  description:
    "합성 웨딩 사건을 고르고, 다른 참여자의 선택 분포와 새 단서를 확인해보세요.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function WeddingCourtPage() {
  if (!isWeddingCourtEnabled()) notFound();

  return <WeddingCourtClient />;
}
