import type { Metadata } from "next";
import PublicCourtList from "@/components/couple-court/PublicCourtList";
import { notFound } from "next/navigation";
import { isCoupleCourtPublicEnabled } from "@/app/api/couple-court/_shared";

export const metadata: Metadata = {
  title: "웨딩한방 공개재판",
  description: "개인정보를 뺀 익명 판결과 다른 예비부부의 현실적인 합의를 살펴보세요.",
};

export default function CoupleCourtPublicPage() {
  if (!isCoupleCourtPublicEnabled()) notFound();
  return <PublicCourtList />;
}
