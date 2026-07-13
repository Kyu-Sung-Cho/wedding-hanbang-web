import type { Metadata } from "next";
import InviteAccept from "@/components/couple-court/InviteAccept";
import { notFound } from "next/navigation";
import { isCoupleCourtEnabled, isCoupleCourtPublicEnabled } from "@/app/api/couple-court/_shared";

export const metadata: Metadata = {
  title: "둘만의 중재실 초대 | 웨딩한방",
  robots: { index: false, follow: false },
};

export default function CoupleCourtInvitePage() {
  if (!isCoupleCourtEnabled()) notFound();
  return <InviteAccept publicEnabled={isCoupleCourtPublicEnabled()} />;
}
