import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Result36Client from "./Result36Client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "내 결혼 준비 방식 | 웨딩코드 · 웨딩한방",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function WeddingCodeResultPage({ searchParams }: { searchParams?: Promise<{ v?: string; rid?: string }> } = {}) {
  const search = await searchParams;
  if (search?.v !== "36") redirect("/wedding-code");
  return <Suspense fallback={<p role="status" className="p-8 text-sm">내 결과를 불러오고 있어요.</p>}><Result36Client key={search?.rid ?? "latest"} /></Suspense>;
}
