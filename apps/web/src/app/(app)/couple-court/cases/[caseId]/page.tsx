import type { Metadata } from "next";
import CaseDetail from "@/components/couple-court/CaseDetail";

export const metadata: Metadata = {
  title: "사건 진행 현황 | 한방 커플재판소",
};

export default async function CoupleCourtCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <CaseDetail caseId={caseId} />;
}
