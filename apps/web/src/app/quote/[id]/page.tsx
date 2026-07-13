import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, ClipboardCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AMORA_QUOTE_CATEGORY_LABELS,
  AMORA_QUOTE_REGION_LABELS,
  type AmoraQuoteCategory,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import { QUOTE_CHECK_SURVEY_REFERENCE } from "@/constants/hiddenCosts";
import ShareButtons from "@/components/quote/ShareButtons";
import { weddingPath } from "@/lib/weddingPaths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
}

interface PublicQuoteData {
  id: string;
  category: AmoraQuoteCategory;
  region: AmoraQuoteRegion;
  analysis: {
    category: AmoraQuoteCategory;
    quotePriceManwon: number;
    unconfirmedItemCount: number;
    summaryTitle: string;
    summaryText: string;
    sourceNote: string;
    sourceUrl: string;
  };
  createdAt: string;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function publicSafeAnalysis(
  rawAnalysis: unknown,
  category: AmoraQuoteCategory,
  storedQuotePrice: unknown
): PublicQuoteData["analysis"] {
  const raw =
    rawAnalysis && typeof rawAnalysis === "object"
      ? (rawAnalysis as Record<string, unknown>)
      : {};
  const newCount = nonNegativeInteger(raw.unconfirmedItemCount);
  const legacyCount =
    nonNegativeInteger(raw.missingCriticalCount) +
    nonNegativeInteger(raw.missingHighCount) +
    nonNegativeInteger(raw.missingMediumCount);
  const unconfirmedItemCount =
    Object.prototype.hasOwnProperty.call(raw, "unconfirmedItemCount") ? newCount : legacyCount;
  const rawQuotePrice = Number(raw.quotePriceManwon ?? storedQuotePrice);
  const quotePriceManwon =
    Number.isFinite(rawQuotePrice) && rawQuotePrice > 0 ? rawQuotePrice : 0;

  return {
    category,
    quotePriceManwon,
    unconfirmedItemCount,
    summaryTitle:
      unconfirmedItemCount > 0
        ? `${unconfirmedItemCount}개 항목의 포함 여부를 더 확인해보세요`
        : "선택한 확인 항목을 모두 포함으로 표시했어요",
    summaryText:
      "체크하지 않은 항목은 미포함 판정이 아니라 사용자가 아직 포함으로 표시하지 않은 항목입니다. 실제 포함 범위와 금액은 업체 답변과 계약서로 확인하세요.",
    sourceNote: `${QUOTE_CHECK_SURVEY_REFERENCE.label}: 스드메 기본금 평균 ${QUOTE_CHECK_SURVEY_REFERENCE.basicPriceManwon}만원, 추가 지불 평균 ${QUOTE_CHECK_SURVEY_REFERENCE.additionalPaymentManwon}만원. ${QUOTE_CHECK_SURVEY_REFERENCE.note}`,
    sourceUrl: QUOTE_CHECK_SURVEY_REFERENCE.url,
  };
}

async function fetchQuoteData(id: string): Promise<PublicQuoteData | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("amora_quote_checks")
    .select("id, category, region, quote_price_manwon, analysis, created_at")
    .eq("id", id)
    .eq("is_public", true)
    .maybeSingle();

  if (error || !data) return null;

  const category = data.category as AmoraQuoteCategory;
  return {
    id: data.id,
    category,
    region: data.region as AmoraQuoteRegion,
    analysis: publicSafeAnalysis(data.analysis, category, data.quote_price_manwon),
    createdAt: data.created_at,
  };
}

function formatManwon(value: number) {
  return `${Math.round(value).toLocaleString()}만원`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await fetchQuoteData(id);

  if (!data) {
    return {
      title: "결과를 찾을 수 없습니다 — 웨딩한방",
      robots: { index: false, follow: false },
    };
  }

  const categoryLabel = AMORA_QUOTE_CATEGORY_LABELS[data.category];
  const regionLabel = AMORA_QUOTE_REGION_LABELS[data.region];
  const title = `${regionLabel} ${categoryLabel} ${formatManwon(data.analysis.quotePriceManwon)} 추가비용 확인 체크리스트`;
  const description = data.analysis.summaryText;

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

const STATUS_STYLES = {
  clear: {
    icon: CheckCircle2,
    color: "text-[#1b1c1c]",
    bg: "bg-white",
    border: "border-[#e4e2e1]",
    label: "사용자가 모든 항목을 포함으로 표시했어요",
  },
  attention: {
    icon: ClipboardCheck,
    color: "text-[#795252]",
    bg: "bg-[#fffdfb]",
    border: "border-[#e4d8d1]",
    label: "포함 여부를 더 확인할 항목이 있어요",
  },
} as const;

export default async function PublicQuoteResultPage({ params }: PageProps) {
  const { id } = await params;
  const data = await fetchQuoteData(id);

  if (!data) notFound();

  const { analysis } = data;
  const categoryLabel = AMORA_QUOTE_CATEGORY_LABELS[data.category];
  const regionLabel = AMORA_QUOTE_REGION_LABELS[data.region];
  const status = analysis.unconfirmedItemCount > 0 ? "attention" : "clear";
  const statusStyle = STATUS_STYLES[status];
  const StatusIcon = statusStyle.icon;
  const shareUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://hanbang.ai"}/quote/${data.id}`;
  const shareTitle = `${regionLabel} ${categoryLabel} ${formatManwon(analysis.quotePriceManwon)} 추가비용 확인 체크리스트`;
  const shareText = `${analysis.summaryTitle} · 미포함이나 필요성을 판정한 결과가 아니에요.`;

  return (
    <div className="min-h-screen bg-[#fcf9f8]">
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6 text-center">
          <Link href="/" className="inline-block text-xs uppercase tracking-[0.18em] text-[#928980]">
            웨딩한방 · 추가비용 확인
          </Link>
        </div>

        <section className="rounded-2xl border border-[#e4e2e1] bg-white p-6 shadow-[0_8px_24px_rgba(26,26,31,0.04)] sm:p-8">
          <div className="mb-4 flex items-center gap-2 text-xs font-medium text-[#795252]">
            <span>{regionLabel}</span>
            <span className="text-[#b5ada3]">·</span>
            <span>{categoryLabel}</span>
            <span className="text-[#b5ada3]">·</span>
            <span>사용자 입력 {formatManwon(analysis.quotePriceManwon)}</span>
          </div>

          <h1 className="font-serif-kr text-2xl leading-tight text-[#1b1c1c] sm:text-3xl">
            {analysis.summaryTitle}
          </h1>

          <div className={`mt-5 flex items-center gap-3 rounded-xl border ${statusStyle.border} ${statusStyle.bg} px-4 py-3`}>
            <StatusIcon className={`h-5 w-5 ${statusStyle.color}`} />
            <div>
              <div className={`text-sm font-medium ${statusStyle.color}`}>{statusStyle.label}</div>
              <div className="text-xs text-[#625b4d]">사용자가 직접 표시한 체크 상태입니다</div>
            </div>
          </div>

          <p className="mt-5 text-sm leading-7 text-[#504444]">{analysis.summaryText}</p>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-[#f6f3f2] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[#928980]">
                사용자가 입력한 견적가
              </div>
              <div className="mt-1 text-base font-semibold text-[#1b1c1c]">
                {formatManwon(analysis.quotePriceManwon)}
              </div>
            </div>
            <div className="rounded-lg bg-[#f6f3f2] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[#928980]">
                포함 여부를 더 확인할 항목
              </div>
              <div className="mt-1 text-base font-semibold text-[#1b1c1c]">
                {analysis.unconfirmedItemCount}개
              </div>
            </div>
          </div>

          <ShareButtons shareUrl={shareUrl} shareTitle={shareTitle} shareText={shareText} />

          <Link
            href={weddingPath("/community/quote-check")}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#795252] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#946a6a]"
          >
            내 견적도 항목별로 확인하기
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        <div className="mt-6 space-y-3 rounded-xl border border-[#e4e2e1] bg-white px-5 py-4 text-xs leading-relaxed text-[#625b4d]">
          <p>
            <strong className="text-[#1b1c1c]">총괄 참고:</strong> {analysis.sourceNote}{" "}
            <a
              href={analysis.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#795252] underline underline-offset-2"
            >
              공식 조사 원문
            </a>
          </p>
          <p>
            항목 목록은 계약 범위를 확인하기 위한 웨딩한방 편집 체크리스트입니다. 개별
            항목의 가격, 발생 가능성, 필요성을 뜻하지 않으며 계약서 검토를 대신하지 않습니다.
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-[#928980]">
          <Link href="/" className="underline hover:text-[#795252]">
            웨딩한방 — 결혼 준비 체크리스트
          </Link>
        </p>
      </div>
    </div>
  );
}
