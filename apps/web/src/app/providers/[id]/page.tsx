import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicProviderDetail from "@/components/providers/PublicProviderDetail";
import ProviderShell from "@/components/providers/ProviderShell";
import { getPublicProviders } from "@/lib/providers/publicData";
import { isUuid } from "@/utils/requestValidation";
import ProviderPageRetry from "@/components/providers/ProviderPageRetry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "웨딩 서비스 소개 | 웨딩한방", robots: { index: false, follow: true } };

export default async function ProviderPublicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  let providers;
  try { providers = await getPublicProviders(id); } catch { providers = null; }
  if (!providers) return <ProviderShell active="discover"><section role="alert" className="space-y-4 py-8"><h1 className="text-xl text-[var(--hb-text-strong)]">소개를 불러올 수 없어요</h1><p className="text-sm">잠시 뒤 다시 확인해 주세요.</p><ProviderPageRetry /></section></ProviderShell>;
  const provider = providers.find((item) => item.id === id);
  if (!provider) notFound();
  return <ProviderShell active="discover"><PublicProviderDetail provider={provider} /></ProviderShell>;
}
