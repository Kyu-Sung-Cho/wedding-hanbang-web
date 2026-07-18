import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileCheck2 } from "lucide-react";
import { cache } from "react";

import VendorDetailActions from "@/components/vendor-price/VendorDetailActions";
import { krwRangeLabel } from "@/lib/format/krw";
import { marketPriceProvider } from "@/lib/marketPrice/provider";
import { isPriceCatalogBuildPlaceholderEnvironment } from "@/lib/price/buildCatalog";
import { PRICE_DISCLOSURE_FAQ_MAIN_ENTITY } from "@/lib/price/categoryJsonLd";
import { buildPriceVendorStructuredData } from "@/lib/price/vendorJsonLd";
import {
  assertPublishedVendorMinimum,
  collectPublishedVendorSlugs,
  requiredPublishedVendorMinimum,
} from "@/lib/price/staticVendorSlugs";
import {
  getAttributeFieldDefinitions,
  type VendorAttributeCategory,
} from "@/lib/vendors/attributeSchemas";
import { createPublicClient } from "@/lib/supabase/public";
import { loadPublicVendorPriceProfile } from "@/lib/vendors/publicVendorPriceData";

export const revalidate = 86_400;
export const dynamicParams = true;

const CATEGORY_LABELS: Record<string, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  hall: "예식장",
};

const REGION_LABELS: Record<string, string> = {
  seoul_gangnam3: "서울 강남권",
  seoul_etc: "서울 기타 지역",
  gyeonggi: "경기도",
  incheon: "인천",
  gangwon: "강원도",
  chungcheong: "충청도",
  daejeon: "대전",
  gyeongsang: "경상도",
  busan: "부산",
  ulsan: "울산",
  daegu: "대구",
  jeolla: "전라도",
  gwangju: "광주",
  jeju: "제주",
};

const loadProfile = cache((slug: string) =>
  loadPublicVendorPriceProfile(createPublicClient(), slug)
);

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  if (isPriceCatalogBuildPlaceholderEnvironment(process.env)) return [];

  const client = createPublicClient();
  const slugs = await collectPublishedVendorSlugs(async (from, to) => {
    const { data, error } = await client
      .from("v_public_prices")
      .select("vendor_slug, official_price_id")
      .eq("is_current", true)
      .order("vendor_slug", { ascending: true })
      .order("official_price_id", { ascending: true })
      .range(from, to);
    return { data, error };
  });
  assertPublishedVendorMinimum(
    slugs.length,
    requiredPublishedVendorMinimum(process.env),
  );
  return slugs.map((slug) => ({ slug }));
}

function periodLabel(value: string): string {
  const match = /^(\d{4})Q([1-4])$/.exec(value);
  return match ? `${match[1]}년 ${match[2]}분기` : value;
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) return {};
  const profile = await loadProfile(slug);
  if (!profile) return {};
  const category = CATEGORY_LABELS[profile.vendor.category] ?? "웨딩 업체";
  const region = profile.vendor.region_code
    ? REGION_LABELS[profile.vendor.region_code] ?? profile.vendor.region_code
    : null;
  const currentPrices = profile.prices.filter((price) => price.is_current);
  if (currentPrices.length === 0) return {};
  const minimums = currentPrices.flatMap((price) => (
    price.price_min_krw === null ? [] : [price.price_min_krw]
  ));
  const maximums = currentPrices.flatMap((price) => (
    price.price_max_krw === null ? [] : [price.price_max_krw]
  ));
  const range = krwRangeLabel(
    minimums.length > 0 ? Math.min(...minimums) : null,
    maximums.length > 0 ? Math.max(...maximums) : null,
  );
  return {
    title: `${profile.vendor.name} 공시 가격 | 웨딩한방`,
    description: `${region ? `${region} ` : ""}${category} ${profile.vendor.name}의 공시 가격 ${range}과 공개 근거를 확인하세요.`,
    alternates: { canonical: `/price/vendor/${profile.vendor.slug}` },
    openGraph: {
      title: `${profile.vendor.name} 공시 가격 | 웨딩한방`,
      description: `${category} 공시 가격 ${range}`,
      url: `/price/vendor/${profile.vendor.slug}`,
      type: "website",
    },
  };
}

const ATTRIBUTE_VALUE_LABELS: Record<string, string> = {
  included: "포함",
  paid: "유료 제공",
  not_provided: "미제공",
  unknown: "확인 필요",
  indoor: "실내",
  outdoor: "야외",
  hanok: "한옥",
  garden: "가든",
  rooftop: "루프톱",
  beach: "해변",
  cafe: "카페",
  night: "야간",
  underwater: "수중",
  imported: "수입",
  domestic: "국내",
  inhouse: "자체 제작",
  aline: "A라인",
  mermaid: "머메이드",
  bell: "벨라인",
  princess: "프린세스",
  slim: "슬림",
  mini: "미니",
  available: "가능",
  fee_required: "추가금 필요",
  not_available: "불가",
  hotel: "호텔",
  convention: "컨벤션",
  house: "하우스",
  chapel: "채플",
  public: "공공 예식장",
  small: "스몰웨딩",
  bright: "밝은 홀",
  dark: "어두운 홀",
  buffet: "뷔페",
  course: "코스",
  semi: "세미 코스",
  ample: "여유",
  limited: "제한적",
  valet: "발레파킹",
};

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function attributeValue(
  value: unknown,
  unit?: "krw" | "people" | "minutes",
): string {
  if (typeof value === "boolean") return value ? "가능" : "불가";
  if (typeof value === "number") {
    const formatted = value.toLocaleString("ko-KR");
    if (unit === "krw") return `${formatted}원`;
    if (unit === "people") return `${formatted}명`;
    if (unit === "minutes") return `${formatted}분`;
    return formatted;
  }
  if (typeof value === "string") return ATTRIBUTE_VALUE_LABELS[value] ?? value;
  if (Array.isArray(value)) return value.map((item) => attributeValue(item)).join(", ");
  return "확인 필요";
}

function publicAttributeRows(
  category: string,
  attributes: Record<string, unknown>,
) {
  if (!["studio", "dress", "makeup", "hall"].includes(category)) return [];
  return getAttributeFieldDefinitions(category as VendorAttributeCategory)
    .filter(({ internal, key }) => !internal && attributes[key] !== undefined)
    .map(({ key, label, unit }) => ({
      key,
      label,
      value: attributeValue(attributes[key], unit),
    }));
}

export default async function VendorPricePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) notFound();

  const profile = await loadProfile(slug);
  if (!profile) notFound();

  const attributes = publicAttributeRows(profile.vendor.category, profile.attributes);
  const externalLinks = [
    ["공식 홈페이지", safeExternalUrl(profile.vendor.urls.official)],
    ["인스타그램", safeExternalUrl(profile.vendor.urls.instagram)],
    ["네이버 플레이스", safeExternalUrl(profile.vendor.urls.naver_place)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const currentPrices = profile.prices.filter((price) => price.is_current);
  if (currentPrices.length === 0) notFound();
  const historyPeriods = [...new Set(profile.prices.map((price) => price.period_label))];
  const currentPeriod = currentPrices[0]?.period_label ?? profile.prices[0]?.period_label ?? "기준 시점 미정";
  const marketDistribution = process.env.NEXT_PUBLIC_FEATURE_MARKET_OVERLAY === "true"
    ? await marketPriceProvider.getDistribution(profile.vendor.id)
    : null;
  const categoryLabel = CATEGORY_LABELS[profile.vendor.category] ?? profile.vendor.category;
  const structuredData = buildPriceVendorStructuredData({
    vendorName: profile.vendor.name,
    vendorSlug: profile.vendor.slug,
    category: profile.vendor.category,
    categoryLabel,
    periodLabel: currentPeriod,
  });

  return (
    <main className="min-h-screen bg-[#FBF8F2] text-[#243832]">
      {structuredData.map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
        />
      ))}
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        <Link
          href={`/price/${profile.vendor.category}`}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#36534E] hover:text-[#8F6662] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#36534E]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {categoryLabel} 목록으로 돌아가기
        </Link>

        <header className="mt-8 border-b border-[#243832]/15 pb-8">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#36534E]/75">
            <span>{CATEGORY_LABELS[profile.vendor.category] ?? profile.vendor.category}</span>
            {profile.vendor.region_code ? <><span aria-hidden="true">·</span><span>{REGION_LABELS[profile.vendor.region_code] ?? profile.vendor.region_code}</span></> : null}
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
            {profile.vendor.name}
          </h1>
          {profile.vendor.aliases.length > 0 ? (
            <p className="mt-2 text-sm text-[#36534E]/65">구. {profile.vendor.aliases.join(" · ")}</p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {profile.prices.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#36534E] px-3 py-1.5 text-xs font-semibold text-white">
                <FileCheck2 aria-hidden="true" className="size-3.5" />
                공시 근거 확인
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-[#EFE4D7] px-3 py-1.5 text-xs font-semibold text-[#36534E]">
                공시 검수 중
              </span>
            )}
            {profile.tags.map((tag) => (
              <span key={tag.slug} className="rounded-full bg-[#EFE4D7] px-3 py-1.5 text-xs font-medium">
                {tag.label}
              </span>
            ))}
          </div>
          <VendorDetailActions
            vendorId={profile.vendor.id}
            redirectPath={`/price/vendor/${profile.vendor.slug}`}
          />
        </header>

        <section aria-labelledby="official-price-heading" className="py-8 sm:py-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8F6662]">Official disclosure</p>
              <h2 id="official-price-heading" className="mt-2 text-2xl font-bold">공시 가격</h2>
            </div>
            <span className="text-xs text-[#36534E]/65">승인된 공시만 표시</span>
          </div>

          {currentPrices.length === 0 ? (
            <div className="mt-6 border-y border-[#243832]/12 py-10 text-center">
              <p className="font-semibold">아직 승인된 공시 가격이 없어요.</p>
              <p className="mt-2 text-sm text-[#36534E]/70">검수가 끝난 가격부터 차례로 공개합니다.</p>
            </div>
          ) : (
            <div className="mt-6 divide-y divide-[#243832]/12 border-y border-[#243832]/12">
              {currentPrices.map((price) => (
                <article key={price.id} className="py-6 first:pt-5 last:pb-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <p className="text-xs font-medium text-[#36534E]/65">
                        {periodLabel(price.period_label)}
                        {price.agency?.name ? ` · ${price.agency.name}` : " · 업체 직접 공시"}
                      </p>
                      <h3 className="mt-1 text-lg font-bold">{price.item_name}</h3>
                      {price.base_spec ? <p className="mt-1 text-sm text-[#36534E]/75">{price.base_spec}</p> : null}
                    </div>
                    <p className="shrink-0 text-lg font-bold tabular-nums">
                      {krwRangeLabel(price.price_min_krw, price.price_max_krw)}
                    </p>
                  </div>
                  {[price.vat_note, price.price_note].filter(Boolean).length > 0 ? (
                    <p className="mt-3 text-sm text-[#36534E]/75">
                      {[price.vat_note, price.price_note].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}

                  {price.options.length > 0 ? (
                    <div className="mt-5 bg-[#F7F1E8] px-4 py-3 sm:px-5">
                      <p className="text-xs font-bold text-[#36534E]">추가 옵션</p>
                      <ul className="mt-2 divide-y divide-[#243832]/10">
                        {price.options.map((option) => (
                          <li key={option.id} className="flex flex-col justify-between gap-1 py-2.5 text-sm sm:flex-row sm:gap-4">
                            <span className="min-w-0">
                              <span className="font-semibold">{option.name}</span>
                              {option.is_effectively_mandatory ? (
                                <span className="ml-2 inline-flex rounded-full bg-[#FDE5E2] px-2 py-0.5 text-[11px] font-bold text-[#A43D36]">사실상 필수</span>
                              ) : null}
                              {option.unit ? ` · ${option.unit}` : ""}
                              {option.condition ? ` · ${option.condition}` : ""}
                              <span className="mt-1 block text-xs leading-5 text-[#36534E]/70">
                                공시 원문 · {option.raw_text}
                              </span>
                            </span>
                            <span className="font-semibold tabular-nums">{krwRangeLabel(option.price_min_krw, option.price_max_krw)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <details className="mt-4 group">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[#8F6662] marker:text-[#8F6662] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534E]">
                      가격 근거 보기
                    </summary>
                    <p className="mt-3 border-l-2 border-[#B89785] pl-4 text-sm leading-6 text-[#36534E]/80">
                      {price.source}
                    </p>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>

        {historyPeriods.length >= 2 ? (
          <section aria-labelledby="price-history-heading" className="border-t border-[#243832]/15 py-8 sm:py-10">
            <h2 id="price-history-heading" className="text-2xl font-bold">공시가 히스토리</h2>
            <p className="mt-2 text-sm text-[#36534E]/70">발행된 기준 시점별 가격 변화를 확인하세요.</p>
            <div className="mt-5 overflow-x-auto rounded-xl border border-[#243832]/12 bg-white">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-[#F5ECE4] text-xs text-[#36534E]/75">
                  <tr>
                    <th className="px-4 py-3 font-bold">공시 시점</th>
                    <th className="px-4 py-3 font-bold">대행사</th>
                    <th className="px-4 py-3 font-bold">항목</th>
                    <th className="px-4 py-3 text-right font-bold">가격</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#243832]/10">
                  {profile.prices.map((price) => (
                    <tr key={`history-${price.id}`}>
                      <td className="px-4 py-3 font-medium">{periodLabel(price.period_label)}</td>
                      <td className="px-4 py-3 text-[#36534E]/75">{price.agency?.name ?? "업체 직접"}</td>
                      <td className="px-4 py-3 text-[#36534E]/75">{price.item_name}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{krwRangeLabel(price.price_min_krw, price.price_max_krw)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="market-distribution-heading" className="border-t border-[#243832]/15 py-8 sm:py-10">
          <h2 id="market-distribution-heading" className="text-2xl font-bold">실거래 분포</h2>
          {marketDistribution ? (
            <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-white p-5 text-center">
              {[
                ["하위 25%", marketDistribution.p25Krw],
                ["중앙값", marketDistribution.medianKrw],
                ["상위 25%", marketDistribution.p75Krw],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <p className="text-xs text-[#36534E]/65">{label}</p>
                  <p className="mt-1 font-bold">{krwRangeLabel(value as number, value as number)}</p>
                </div>
              ))}
              <p className="col-span-3 mt-3 text-xs text-[#36534E]/60">익명 실거래 {marketDistribution.sampleSize}건 기준</p>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-[#B5977A]/30 bg-white p-5 sm:p-6">
              <p className="font-bold text-[#1D3557]">실거래 데이터 준비 중 — 내 계약 정보를 공유하면 다른 커플의 실거래 분포를 먼저 볼 수 있어요.</p>
              <Link
                href="/wedding/community/quote-check"
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D3557] px-4 text-sm font-bold text-white"
              >
                내 견적 확인하고 공유하기
              </Link>
            </div>
          )}
        </section>

        {attributes.length > 0 ? (
          <section aria-labelledby="attribute-heading" className="border-t border-[#243832]/15 py-8 sm:py-10">
            <h2 id="attribute-heading" className="text-2xl font-bold">확인된 업체 조건</h2>
            <dl className="mt-5 grid gap-x-8 sm:grid-cols-2">
              {attributes.map((attribute) => (
                <div key={attribute.key} className="flex justify-between gap-4 border-b border-[#243832]/10 py-3 text-sm">
                  <dt className="text-[#36534E]/70">{attribute.label}</dt>
                  <dd className="text-right font-semibold">{attribute.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section aria-labelledby="price-faq-heading" className="border-t border-[#243832]/15 py-8 sm:py-10">
          <h2 id="price-faq-heading" className="text-2xl font-bold">공시 가격 FAQ</h2>
          <dl className="mt-5 space-y-5">
            {PRICE_DISCLOSURE_FAQ_MAIN_ENTITY.map(({ name, acceptedAnswer }) => (
              <div key={name} className="rounded-2xl border border-[#243832]/10 bg-white px-5 py-4">
                <dt className="font-bold text-[#243832]">{name}</dt>
                <dd className="mt-2 text-sm leading-6 text-[#36534E]/80">{acceptedAnswer.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        {externalLinks.length > 0 ? (
          <section aria-labelledby="link-heading" className="border-t border-[#243832]/15 py-8">
            <h2 id="link-heading" className="text-lg font-bold">업체 공식 링크</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              {externalLinks.map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#36534E]/25 px-4 py-2 text-sm font-semibold hover:bg-[#F7F1E8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534E]"
                >
                  {label}<ExternalLink aria-hidden="true" className="size-4" />
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <aside className="sticky bottom-0 z-20 -mx-5 border-t border-[#243832]/15 bg-[#F5ECE4]/95 px-5 py-4 text-sm leading-6 text-[#36534E] shadow-[0_-8px_24px_rgba(29,53,87,0.08)] backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:py-7 sm:shadow-none">
          <p>가격 출처: 한국소비자원 참가격 · {periodLabel(currentPeriod)} 공시 기준</p>
          <p>본 정보는 공시 기준이며 실제 계약 조건·시점에 따라 달라질 수 있습니다. 계약 전 업체에 직접 확인하세요.</p>
        </aside>
      </div>
    </main>
  );
}
