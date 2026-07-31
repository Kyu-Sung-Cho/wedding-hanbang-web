import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileCheck2 } from "lucide-react";
import { cache } from "react";

import { VendorAvatar } from "@/components/price/VendorAvatar";
import VendorDetailActions from "@/components/vendor-price/VendorDetailActions";
import { krwRangeLabel } from "@/lib/format/krw";
import { isPriceCatalogBuildPlaceholderEnvironment } from "@/lib/price/buildCatalog";
import { disclosureRoundLabel, displaySourceLabel } from "@/lib/price/period";
import { PRICE_DISCLOSURE_FAQ_MAIN_ENTITY } from "@/lib/price/categoryJsonLd";
import { buildPriceVendorStructuredData } from "@/lib/price/vendorJsonLd";
import { withParticle } from "@/lib/korean/particles";
import { isPreviewStubMode } from "@/lib/previewStub";
import {
  assertPublishedVendorCatalog,
  collectPublishedVendorSlugs,
  requiredPublishedVendorCatalogExpectation,
} from "@/lib/price/staticVendorSlugs";
import {
  getAttributeFieldDefinitions,
  type VendorAttributeCategory,
} from "@/lib/vendors/attributeSchemas";
import { createPublicClient } from "@/lib/supabase/public";
import {
  loadPublicVendorPolicies,
  loadPublicVendorPriceProfile,
} from "@/lib/vendors/publicVendorPriceData";

export const revalidate = 86_400;
export const dynamicParams = true;

const CATEGORY_LABELS: Record<string, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
  hall: "결혼식장",
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

export function resolveRequestedPriceRegion(
  value: string | string[] | undefined,
  availableRegionCodes: string[],
): string | null {
  if (
    typeof value !== "string"
    || !Object.prototype.hasOwnProperty.call(REGION_LABELS, value)
    || !availableRegionCodes.includes(value)
  ) {
    return null;
  }
  return value;
}

const loadProfile = cache((slug: string) =>
  loadPublicVendorPriceProfile(createPublicClient(), slug)
);

// cache 키는 문자열이어야 해서 업체 id 목록을 이어 붙인다.
const loadPolicies = cache((vendorIdKey: string) =>
  loadPublicVendorPolicies(createPublicClient(), vendorIdKey.split(","))
);

// 원문 그대로 보여주되 종류만 라벨링한다 — 요약·해석은 판정이 되므로 하지 않는다.
const POLICY_SECTION_LABELS: Record<string, string> = {
  penalty: "위약금",
  refund: "환불",
  refund_policy: "환불",
  change: "일정 변경",
};

function policySectionLabel(semanticType: string): string {
  return POLICY_SECTION_LABELS[semanticType] ?? "기타 계약 조건";
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  if (isPreviewStubMode()) return [];
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
  const catalogExpectation = requiredPublishedVendorCatalogExpectation(process.env);
  if (catalogExpectation) {
    assertPublishedVendorCatalog(slugs, catalogExpectation);
  }
  return slugs.map((slug) => ({ slug }));
}

// 기간 표기는 `disclosureRoundLabel()` 하나만 쓴다. 예전에는 여기서
// `price_snapshots.period_label`(내부 스냅샷 이름 "2026Q3")을 그대로 "2026년 3분기"로
// 렌더해, 2025-11 공시를 2026년 3분기 기준이라고 주장했다.
// ※ 라운드가 둘 이상 적재되면 스냅샷별 라운드 매핑이 필요하다(현재는 1개).

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  if (isPreviewStubMode()) return {};
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
    description: `${region ? `${region} ` : ""}${category} ${profile.vendor.name}의 공시 가격 ${range}${withParticle(range)} 공개 근거를 확인하세요.`,
    // 형제 슬러그마다 같은 내용이 뜨므로 대표 주소 하나로 모은다.
    alternates: { canonical: `/price/vendor/${profile.identity.canonicalSlug}` },
    openGraph: {
      title: `${profile.vendor.name} 공시 가격 | 웨딩한방`,
      description: `${category} 공시 가격 ${range}`,
      url: `/price/vendor/${profile.identity.canonicalSlug}`,
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
  public: "공공 결혼식장",
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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ region?: string | string[] }>;
}) {
  if (isPreviewStubMode()) notFound();
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) notFound();

  const profile = await loadProfile(slug);
  if (!profile) notFound();
  const requestedSearchParams = searchParams ? await searchParams : {};
  const requestedRegion = resolveRequestedPriceRegion(
    requestedSearchParams.region,
    profile.identity.regionCodes,
  );
  // URL을 임의로 바꿔 가격이 하나도 없는 화면이 되지 않도록, 실제 현재 공시가
  // 있는 지역만 상세 문맥으로 채택한다.
  const activeRegionCode = requestedRegion && profile.prices.some((price) => (
    price.is_current && price.region_code === requestedRegion
  ))
    ? requestedRegion
    : null;
  const visiblePrices = activeRegionCode
    ? profile.prices.filter((price) => price.region_code === activeRegionCode)
    : profile.prices;
  const visibleRegionCodes = activeRegionCode
    ? [activeRegionCode]
    : profile.identity.regionCodes;

  const attributes = publicAttributeRows(profile.vendor.category, profile.attributes);
  const externalLinks = [
    ["공식 홈페이지", safeExternalUrl(profile.vendor.urls.official)],
    ["인스타그램", safeExternalUrl(profile.vendor.urls.instagram)],
    ["네이버 플레이스", safeExternalUrl(profile.vendor.urls.naver_place)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  // 확인된 공식 링크가 없어도 막다른 골목을 만들지 않는다 — 외부 API·수집 없이
  // 업체명+지역으로 구성한 네이버 지도 "검색" 링크(오배정 불가: 결과는 사용자가 봄).
  const naverSearchHref = `https://map.naver.com/p/search/${encodeURIComponent(
    [profile.vendor.name.replace(/^[[(][^\])]{1,8}[\])]\s*/u, ""),
      activeRegionCode
        ? REGION_LABELS[activeRegionCode]
        : profile.vendor.region_code
          ? REGION_LABELS[profile.vendor.region_code] ?? ""
          : ""]
      .filter(Boolean).join(" "),
  )}`;
  const currentPrices = visiblePrices.filter((price) => price.is_current);
  if (currentPrices.length === 0) notFound();
  const historyPeriods = [...new Set(visiblePrices.map((price) => price.period_label))];
  // 위약금·환불은 계약 직전에 가장 알고 싶은 정보다. 뷰가 아직 없으면 로더가
  // 빈 배열을 돌려주므로 페이지는 그대로 뜬다.
  const policies = await loadPolicies(profile.identity.vendorIds.join(","));
  // 같은 문구는 로더가 이미 합친다 — 남은 공시의 대행사 수가 곧 "서로 다른 문구"의 수다.
  const policyAgencyCount = new Set(
    policies.flatMap((policy) => (policy.sourceAgency ? [policy.sourceAgency] : [])),
  ).size;
  const categoryLabel = CATEGORY_LABELS[profile.vendor.category] ?? profile.vendor.category;
  const regionQuery = activeRegionCode
    ? `?region=${encodeURIComponent(activeRegionCode)}`
    : "";
  const structuredData = buildPriceVendorStructuredData({
    vendorName: profile.vendor.name,
    vendorSlug: profile.identity.canonicalSlug,
    category: profile.vendor.category,
    categoryLabel,
  });

  return (
    <main className="min-h-screen bg-[#FBF8F2] text-[#243832] [overflow-wrap:anywhere]">
      {structuredData.map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
        />
      ))}
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        {/* 카테고리 목록은 RSC 페이로드가 커서 미리 받지 않는다(허브와 동일 정책). */}
        <Link
          href={`/price/${profile.vendor.category}${regionQuery}`}
          prefetch={false}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#36534E] hover:text-[#8F6662] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#36534E]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {categoryLabel} 목록으로 돌아가기
        </Link>

        <header className="mt-8 border-b border-[#243832]/15 pb-8">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#36534E]/75">
            <span>{CATEGORY_LABELS[profile.vendor.category] ?? profile.vendor.category}</span>
            {/* 같은 샵을 여러 지역 대행사가 취급하면 지역도 여러 개다(목록 카드와 같은 기준). */}
            {visibleRegionCodes.map((regionCode) => (
              <span key={regionCode} className="contents">
                <span aria-hidden="true">·</span>
                <span>{REGION_LABELS[regionCode] ?? regionCode}</span>
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <VendorAvatar id={profile.vendor.id} name={profile.vendor.name} size="lg" />
            <h1 className="text-3xl font-bold tracking-normal sm:text-4xl">
              {profile.vendor.name}
            </h1>
          </div>
          {profile.vendor.aliases.length > 0 ? (
            <p className="mt-2 text-sm text-[#36534E]/75">
              다른 표기 · {profile.vendor.aliases.join(" · ")}
            </p>
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
          {/* 찜·가격알림은 목록 카드와 같은 대표 id로 저장해야 한다 — 방문한
              형제 슬러그의 id를 쓰면 같은 샵이 두 번 찜된다. */}
          <VendorDetailActions
            vendorId={profile.identity.canonicalVendorId}
            redirectPath={`/price/vendor/${profile.identity.canonicalSlug}${regionQuery}`}
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

          {activeRegionCode ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#36534E]/15 bg-white px-4 py-3 text-sm">
              <p className="font-semibold">
                현재 {REGION_LABELS[activeRegionCode]} 공시 가격만 표시하고 있어요.
              </p>
              <Link
                href={`/price/vendor/${profile.identity.canonicalSlug}`}
                className="inline-flex min-h-11 items-center font-bold text-[#8F5150] underline decoration-[#8F5150]/35 underline-offset-4"
              >
                전체 지역 가격 보기
              </Link>
            </div>
          ) : null}

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
                        {disclosureRoundLabel()}
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
                      {displaySourceLabel(price.source)}
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
                  {visiblePrices.map((price) => (
                    <tr key={`history-${price.id}`}>
                      <td className="px-4 py-3 font-medium">{disclosureRoundLabel()}</td>
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

        {policies.length > 0 ? (
          <section aria-labelledby="policy-heading" className="border-t border-[#243832]/15 py-8 sm:py-10">
            <h2 id="policy-heading" className="text-2xl font-bold">계약 전 확인 · 위약금과 환불</h2>
            <p className="mt-2 text-sm leading-6 text-[#36534E]/75">
              업체가 공시한 원문 그대로예요. 웨딩한방이 요약하거나 해석하지 않았고,
              계약 시점·조건에 따라 달라질 수 있으니 계약서에 같은 내용이 적혀 있는지 꼭 확인하세요.
            </p>
            {/* 문구가 같은 공시는 이미 하나로 합쳐 보여준다. 그래서 여러 장이 남았다는
                건 곧 대행사마다 문구가 다르다는 사실이다 — 해석이 아니라 관찰이다.
                실측(2026-07-26)에서 같은 샵인데 대행사에 따라 60일 전 위약금이
                20%와 100%로 갈리는 경우까지 있었다. 왜 여러 장인지 모르면 그냥
                스크롤로 지나친다. */}
            {policyAgencyCount >= 2 ? (
              <p className="mt-3 rounded-xl bg-[#FDE5E2] px-4 py-3 text-sm font-semibold leading-6 text-[#8F5150]">
                이 업체는 대행사 {policyAgencyCount}곳이 서로 다른 문구로 공시했어요.
                계약할 대행사의 조건을 직접 비교해 보세요.
              </p>
            ) : null}
            <ul className="mt-5 space-y-3">
              {policies.map((policy) => (
                <li key={policy.id} className="rounded-2xl border border-[#8F6662]/25 bg-[#FBF8F2] px-5 py-4">
                  <p className="text-xs font-bold text-[#8F5150]">
                    {policySectionLabel(policy.semanticType)}
                    {policy.sourceAgency ? (
                      <span className="ml-2 font-semibold text-[#36534E]/60">{policy.sourceAgency} 공시</span>
                    ) : null}
                  </p>
                  {policy.title ? (
                    <p className="mt-1 text-sm font-bold text-[#243832]">{policy.title}</p>
                  ) : null}
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#243832]/85">
                    {policy.contentVerbatim}
                  </p>
                </li>
              ))}
            </ul>
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

        <section aria-labelledby="link-heading" className="border-t border-[#243832]/15 py-8">
          <h2 id="link-heading" className="text-lg font-bold">
            {externalLinks.length > 0 ? "업체 공식 링크" : "업체 더 찾아보기"}
          </h2>
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
            <a
              href={naverSearchHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-[#36534E]/35 px-4 py-2 text-sm font-semibold text-[#36534E]/85 hover:bg-[#F7F1E8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534E]"
            >
              네이버 지도에서 검색<ExternalLink aria-hidden="true" className="size-4" />
            </a>
          </div>
          {externalLinks.length === 0 ? (
            <p className="mt-3 text-xs leading-5 text-[#36534E]/60">
              아직 확인된 공식 링크가 등록되지 않았어요. 위 버튼은 업체명으로 바로 검색해 드리는 링크예요.
            </p>
          ) : null}
        </section>

        <aside className="sticky bottom-0 z-20 -mx-5 border-t border-[#243832]/15 bg-[#F5ECE4]/95 px-5 py-4 text-sm leading-6 text-[#36534E] shadow-[0_-8px_24px_rgba(36,56,50,0.08)] backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:py-7 sm:shadow-none">
          <p>가격 출처: 한국소비자원 참가격 · {disclosureRoundLabel()} 공시 기준</p>
          <p>본 정보는 공시 기준이며 실제 계약 조건·시점에 따라 달라질 수 있습니다. 계약 전 업체에 직접 확인하세요.</p>
        </aside>
      </div>
    </main>
  );
}
