import type { Metadata } from "next";
import MissionView from "@/components/couple-court/MissionView";

export const metadata: Metadata = {
  title: "화해 처방 | 한방 커플재판소",
};

export default async function CoupleCourtMissionPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <MissionView caseId={caseId} />;
}
