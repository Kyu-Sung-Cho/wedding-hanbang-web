import type { Metadata } from "next";

import { HallListingsAdmin } from "./HallListingsAdmin";

export const metadata: Metadata = {
  title: "웨딩홀 자료 | 웨딩한방 관리자",
  robots: { index: false, follow: false },
};

export default function HallListingsAdminPage() {
  return <HallListingsAdmin />;
}
