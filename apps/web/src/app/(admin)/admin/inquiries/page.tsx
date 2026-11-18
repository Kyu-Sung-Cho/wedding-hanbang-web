import type { Metadata } from "next";

import { InquiryQueueAdmin } from "./InquiryQueueAdmin";

export const metadata: Metadata = {
  title: "상담 문의 대기열 | 웨딩한방 관리자",
  robots: { index: false, follow: false },
};

export default function InquiryQueueAdminPage() {
  return <InquiryQueueAdmin />;
}
