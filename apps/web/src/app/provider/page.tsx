import type { Metadata } from "next";
import ProviderAccountGate from "@/components/providers/ProviderAccountGate";
import ProviderCenter from "@/components/providers/ProviderCenter";
import ProviderShell, { ProviderHeading } from "@/components/providers/ProviderShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "제공자 센터 | 웨딩한방", robots: { index: false, follow: false } };

export default function ProviderCenterPage() {
  return <ProviderAccountGate destination="/provider"><ProviderShell active="provider"><ProviderHeading title="제공자 센터"><p>참여 신청과 보완 요청을 확인하고, 승인된 프로필의 소개글·사진과 서비스를 관리하세요. 비즈니스 문의 답변도 이곳에 모아드립니다.</p></ProviderHeading><ProviderCenter /></ProviderShell></ProviderAccountGate>;
}
