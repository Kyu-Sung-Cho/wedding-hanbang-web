import type { Metadata } from "next";

import ProviderParticipationQueue from "@/components/admin/ProviderParticipationQueue";

export const metadata: Metadata = {
  title: "제공자 참여 관리 | 웨딩한방 관리자",
  robots: { index: false, follow: false },
};

export default function ProviderParticipationPage() {
  return <ProviderParticipationQueue />;
}
