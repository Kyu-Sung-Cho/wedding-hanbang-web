import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { krwRangeLabel } from "@/lib/format/krw";
import { loadAdminPreviewVendor } from "@/lib/price/adminPreviewData";
import { pricePolicyBadgeClass, pricePolicyLabel } from "@/lib/price/catalog";
import { priceRegionLabel } from "@/lib/price/labels";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { resolveCanonicalVendorDestination } from "@/lib/vendors/canonicalVendorDestination";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function LegacyVendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  const { id } = await params;
  const previewParam = (await searchParams).preview;
  const preview = (Array.isArray(previewParam) ? previewParam[0] : previewParam) === "1";
  if (preview) {
    noStore();
    const admin = await verifyAdmin(new Request("http://localhost/wedding/vendors/detail?preview=1"));
    if (!admin.authorized) notFound();
    const profile = await loadAdminPreviewVendor(getServiceClient(), id);
    if (!profile) notFound();
    return (
      <main className="ph-no-capture min-h-screen bg-[#FBF8F2] text-[#243832]">
        <div
          role="status"
          aria-label="관리자 미리보기 상태"
          className="border-b border-[#B89785]/35 bg-[#F7F1E8] px-4 py-3 text-center text-sm font-bold text-[#36534E]"
        >
          검수 전 미리보기 — 일반 사용자에게는 보이지 않음 · 자동 추출·정확성 미보장
        </div>
        <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
          <Link
            href={`/wedding/vendors?category=${profile.vendor.category}&preview=1`}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-[#36534E]"
          >
            업체 목록으로 돌아가기
          </Link>
          <header className="mt-6 border-b border-[#243832]/15 pb-7">
            <p className="text-xs font-bold tracking-[0.12em] text-[#8F6662]">
              {profile.periodLabel} · 자동 추출 · 검수 전
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-normal">
              {profile.vendor.name}
            </h1>
            <span className="mt-3 inline-flex rounded-full bg-[#36534E]/8 px-2.5 py-1 text-xs font-bold text-[#36534E]/75">
              {priceRegionLabel(profile.vendor.regionCode)}
            </span>
            <p className="mt-4 rounded-2xl border border-[#B89785]/35 bg-[#F7F1E8] px-4 py-3 text-sm leading-6 text-[#36534E]">
              이 화면의 업체·가격·연결 정보는 자동 추출 결과이며 정확성이 보장되지 않습니다. 승인 전 원문과 대조해 주세요.
            </p>
          </header>
          <section aria-labelledby="preview-price-heading" className="py-8">
            <h2 id="preview-price-heading" className="text-2xl font-bold">자동 추출 가격 (검수 전)</h2>
            {profile.vendor.offers.length === 0 ? (
              <p className="mt-5 border-y border-[#243832]/12 py-8 text-sm text-[#36534E]/70">
                가격 없이 정책 정보만 추출된 업체입니다. 개별 검수를 진행해 주세요.
              </p>
            ) : (
              <div className="mt-5 divide-y divide-[#243832]/12 border-y border-[#243832]/12">
                {profile.vendor.offers.map((offer) => (
                  <article key={offer.id} className="py-5">
                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                      <div>
                        <p className="text-xs font-semibold text-[#36534E]/65">
                          {offer.agencyName}
                        </p>
                        <h3 className="mt-1 text-lg font-bold">
                          {offer.itemName ?? "공시 가격 항목"}
                        </h3>
                      </div>
                      <p className="shrink-0 text-lg font-bold tabular-nums">
                        {krwRangeLabel(offer.minimumKrw, offer.maximumKrw)}
                      </p>
                    </div>
                    {offer.baseSpec ? <p className="mt-2 text-sm text-[#36534E]/75">{offer.baseSpec}</p> : null}
                    {offer.priceNote ? <p className="mt-2 text-sm text-[#36534E]/75">{offer.priceNote}</p> : null}
                    {offer.options.length > 0 ? (
                      <ul className="mt-4 divide-y divide-[#243832]/10 bg-[#F7F1E8] px-4">
                        {offer.options.map((option) => (
                          <li key={option.id} className="flex justify-between gap-4 py-3 text-sm">
                            <span className="font-semibold">{option.name}</span>
                            <span className="shrink-0 tabular-nums">
                              {krwRangeLabel(option.minimumKrw, option.maximumKrw)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
          {profile.vendor.policies?.length ? (
            <section aria-labelledby="preview-policy-heading" className="border-t border-[#243832]/12 py-8">
              <h2 id="preview-policy-heading" className="text-2xl font-bold">계약·취소 규정 (검수 전)</h2>
              <div className="mt-5 divide-y divide-[#243832]/12 border-y border-[#243832]/12">
                {profile.vendor.policies.map((policy) => (
                  <article key={policy.id} className="py-5">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${pricePolicyBadgeClass(policy.type)}`}>
                      {pricePolicyLabel(policy.type)}
                    </span>
                    {policy.title ? <h3 className="mt-3 text-lg font-bold">{policy.title}</h3> : null}
                    {policy.summary ? (
                      <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-6 text-[#36534E]">
                        {policy.summary}
                      </p>
                    ) : null}
                    <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[#36534E]/80">
                      {policy.content}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    );
  }
  redirect(await resolveCanonicalVendorDestination(id));
}
