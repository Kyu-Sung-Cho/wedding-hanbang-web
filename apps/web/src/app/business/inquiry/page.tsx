import type { Metadata } from "next";
import BusinessInquiryForm from "@/components/providers/BusinessInquiryForm";
import ProviderAccountGate from "@/components/providers/ProviderAccountGate";
import ProviderShell, { ProviderHeading } from "@/components/providers/ProviderShell";
import Button from "@/components/ui/Button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "협업·비즈니스 문의 | 웨딩한방", robots: { index: false, follow: false } };

export default function BusinessInquiryPage() {
  return <ProviderAccountGate destination="/business/inquiry"><ProviderShell active="business"><ProviderHeading title="협업·비즈니스 문의"><p>브랜드·콘텐츠 협업, 취재, 자료 협업 등 함께 하고 싶은 일을 알려주세요. 광고·협업 여부는 일반 추천의 후보 선정에 반영하지 않습니다.</p></ProviderHeading><div className="mb-7 flex flex-wrap items-center gap-3 border-b border-[var(--hb-hairline)] pb-6"><p className="text-sm">웨딩 서비스나 예식·행사 장소를 등록하고 싶으신가요?</p><Button href="/business/register" size="sm">웨딩 서비스 등록 신청</Button></div><BusinessInquiryForm /></ProviderShell></ProviderAccountGate>;
}
