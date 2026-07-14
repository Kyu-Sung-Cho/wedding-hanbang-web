import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "웨딩코드 검증 준비 안내 | 웨딩한방",
  robots: { index: false, follow: false },
};

export default function WeddingCodeResultPage() {
  redirect("/wedding-code");
}
