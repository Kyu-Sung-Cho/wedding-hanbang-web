import type { Metadata } from "next";
import VerdictView from "@/components/couple-court/VerdictView";
import { isCoupleCourtPublicEnabled } from "@/app/api/couple-court/_shared";

export const metadata: Metadata = {
  title: "한방 판결 | 웨딩한방",
};

export default async function CoupleCourtVerdictPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <VerdictView caseId={caseId} publicEnabled={isCoupleCourtPublicEnabled()} />;
}
