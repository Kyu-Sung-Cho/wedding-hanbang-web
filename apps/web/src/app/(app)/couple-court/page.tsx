import type { Metadata } from "next";
import CoupleCourtHome from "@/components/couple-court/CoupleCourtHome";
import { isCoupleCourtPublicEnabled } from "@/app/api/couple-court/_shared";

export const metadata: Metadata = {
  title: "한방 커플재판소 | 웨딩한방",
  description: "결혼 준비 중 생긴 서운함을 정리하고 오늘 할 일까지 연결하는 둘만의 중재실",
};

export default function CoupleCourtPage() {
  return <CoupleCourtHome publicEnabled={isCoupleCourtPublicEnabled()} />;
}
