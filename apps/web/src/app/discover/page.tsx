import type { Metadata } from "next";
import ProviderDiscovery from "@/components/providers/ProviderDiscovery";
import ProviderShell, { ProviderHeading } from "@/components/providers/ProviderShell";
import { getPublicProviders } from "@/lib/providers/publicData";
import ProviderPageRetry from "@/components/providers/ProviderPageRetry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "서비스·공간 찾기 | 웨딩한방", description: "결혼 준비를 돕는 개인·팀·업체와 공간의 공개 서비스 조건을 확인하세요.", robots: { index: false, follow: true } };

export default async function ProviderDiscoveryPage() {
  let providers;
  try { providers = await getPublicProviders(); } catch { providers = null; }
  return <ProviderShell active="discover"><ProviderHeading title="서비스·공간 찾기"><p>개인·팀·업체의 작업과 서비스 조건을 확인해 보세요. 한방의 등록 승인과 제공자가 작성한 소개, 서비스 가격의 출처를 구분해 안내합니다.</p></ProviderHeading>{providers ? <ProviderDiscovery providers={providers} /> : <section role="alert" className="space-y-4 rounded-lg border border-[var(--hb-hairline)] p-5"><p className="text-sm leading-7">현재 공개 정보를 불러올 수 없어요. 잠시 뒤 다시 확인해 주세요.</p><ProviderPageRetry /></section>}</ProviderShell>;
}
