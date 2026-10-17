import type { Metadata } from "next";

import AmoraDecisionBoard from "@/components/app/amora-board/AmoraDecisionBoard";

export const metadata: Metadata = { title: "결정 보드 | 웨딩한방" };

export default function AmoraDecisionBoardPage() {
  return <AmoraDecisionBoard />;
}
