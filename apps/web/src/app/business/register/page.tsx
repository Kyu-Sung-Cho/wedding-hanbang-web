import type { Metadata } from "next";
import ProviderAccountGate from "@/components/providers/ProviderAccountGate";
import ProviderApplicationForm from "@/components/providers/ProviderApplicationForm";
import ProviderShell, { ProviderHeading } from "@/components/providers/ProviderShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "웨딩 서비스 등록 신청 | 웨딩한방", robots: { index: false, follow: false } };

export default function ProviderRegistrationPage() {
  return <ProviderAccountGate destination="/business/register"><ProviderShell active="business"><ProviderHeading title="웨딩 서비스 등록 신청"><p>사진·영상, 헤어·메이크업, 예식·행사 장소 등 결혼 준비를 돕는 개인·팀·업체 모두 신청할 수 있어요. 한방이 등록과 관리 권한을 승인하면 소개글과 사진을 직접 게시할 수 있습니다. 서비스·가격과 추천 자격은 별도로 검토합니다.</p></ProviderHeading><ProviderApplicationForm /></ProviderShell></ProviderAccountGate>;
}
