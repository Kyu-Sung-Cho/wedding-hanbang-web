import type { Metadata } from "next";

import ResearchEmailVerificationClient from "./ResearchEmailVerificationClient";
import VerificationResultCard, {
  type VerificationResultKind,
} from "./VerificationResultCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "이메일 확인 · 웨딩한방",
  description: "사용자 연구 신청 이메일 확인 결과입니다.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

function normalizeStatus(status: string | string[]): VerificationResultKind {
  if (Array.isArray(status)) return "invalid";
  return status === "verified" || status === "expired" || status === "unavailable"
    ? status
    : "invalid";
}

export default async function VerificationResultPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { status } = await searchParams;
  if (status === undefined) return <ResearchEmailVerificationClient />;
  return <VerificationResultCard resultKind={normalizeStatus(status)} />;
}
