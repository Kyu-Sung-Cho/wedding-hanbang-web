import type { Metadata } from "next";

import PreregistrationConfirmClient from "./PreregistrationConfirmClient";

export const metadata: Metadata = {
  title: "베타 신청 이메일 확인 · 웨딩한방",
  description: "이메일 소유자가 직접 웨딩한방 베타 신청을 확인하거나 취소합니다.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PreregistrationConfirmPage() {
  return (
    <main className="min-h-screen bg-ivory-50 px-5 py-16 text-noir-800">
      <div className="mx-auto max-w-[560px]">
        <PreregistrationConfirmClient />
      </div>
    </main>
  );
}
