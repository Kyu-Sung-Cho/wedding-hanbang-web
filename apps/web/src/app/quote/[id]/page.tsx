import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, AlertTriangle, CheckCircle2, ClipboardCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AMORA_QUOTE_CATEGORY_LABELS,
  AMORA_QUOTE_REGION_LABELS,
  type AmoraQuoteCategory,
  type AmoraQuoteCheckResult,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import ShareButtons from "@/components/quote/ShareButtons";
import { weddingPath } from "@/lib/weddingPaths";

// 카톡 공유 진단 결과 페이지 — 공개 (RLS service role 우회).
// 캐논 v2 referral 루프 핵심: 공유 받은 친구가 → "나도 진단 받기" CTA 클릭
// 원칙: 판정(점수·등급·안전/위험) 없음 — 빠진 항목 개수와 출처 있는 참고 시세만.

interface PageProps {
  params: Promise<{ id: string }>;
}

interface PublicQuoteData {
  id: string;
  category: AmoraQuoteCategory;
  region: AmoraQuoteRegion;
  analysis: Pick<
    AmoraQuoteCheckResult,
    | "category"
    | "quotePriceManwon"
    | "marketMedianManwon"
    | "priceDiffPercent"
    | "missingCriticalCount"
    | "missingHighCount"
    | "missingMediumCount"
    | "summaryTitle"
    | "summaryText"
    | "sourceNote"
  > & { marketComparatorLabel?: string };
  createdAt: string;
}

async function fetchQuoteData(id: string): Promise<PublicQuoteData | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("amora_quote_checks")
    .select("id, category, region, analysis, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const analysis = data.analysis as AmoraQuoteCheckResult;

  return {
    id: data.id,
    category: data.category as AmoraQuoteCategory,
    region: data.region as AmoraQuoteRegion,
    analysis: {
      category: analysis.category,
      quotePriceManwon: analysis.quotePriceManwon,
      marketMedianManwon: analysis.marketMedianManwon,
      marketComparatorLabel: analysis.marketComparatorLabel,
      priceDiffPercent: analysis.priceDiffPercent,
      missingCriticalCount: analysis.missingCriticalCount,
      missingHighCount: analysis.missingHighCount,
      missingMediumCount: analysis.missingMediumCount,
      summaryTitle: analysis.summaryTitle,
      summaryText: analysis.summaryText,
      sourceNote: analysis.sourceNote,
    },
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
    };
  }

  const categoryLabel = AMORA_QUOTE_CATEGORY_LABELS[data.category];
  const regionLabel = AMORA_QUOTE_REGION_LABELS[data.region];
  const missingTotal =
    data.analysis.missingCriticalCount + data.analysis.missingHighCount;

  const title = `${regionLabel} ${categoryLabel} ${formatManwon(data.analysis.quotePriceManwon)} 견적 체크리스트 — 빠진 항목 ${missingTotal}개`;
  const description = `${data.analysis.summaryTitle} · ${data.analysis.summaryText}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

// 평가 라벨이 아니라 "빠진 항목 강도"만 시각화 — 저장 시점과 무관하게 개수에서 유도
const INTENSITY_STYLES = {
  clear: { icon: CheckCircle2, color: "text-[#1b1c1c]", bg: "bg-white", border: "border-[#e4e2e1]", label: "주요 항목 확인됨" },
  attention: { icon: ClipboardCheck, color: "text-[#795252]", bg: "bg-[#fffdfb]", border: "border-[#e4d8d1]", label: "확인 필요한 항목 있음" },
  critical: { icon: AlertTriangle, color: "text-amber-800", bg: "bg-amber-50", border: "border-amber-200", label: "필수 항목 누락 있음" },
} as const;

export default async function PublicQuoteResultPage({ params }: PageProps) {
  const { id } = await params;
  const data = await fetchQuoteData(id);

  if (!data) {
    notFound();
  }

  const { analysis } = data;
  const categoryLabel = AMORA_QUOTE_CATEGORY_LABELS[data.category];
  const regionLabel = AMORA_QUOTE_REGION_LABELS[data.region];
  const missingTotal =
    analysis.missingCriticalCount + analysis.missingHighCount + analysis.missingMediumCount;
  const intensity =
    analysis.missingCriticalCount > 0 ? "critical" : missingTotal > 0 ? "attention" : "clear";
  const intensityStyle = INTENSITY_STYLES[intensity];
  const IntensityIcon = intensityStyle.icon;

  const shareUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://hanbang.ai"}/quote/${data.id}`;
  const shareTitle = `${regionLabel} ${categoryLabel} ${formatManwon(analysis.quotePriceManwon)} 견적 체크리스트`;
  const shareText = `${analysis.summaryTitle} — 빠진 항목 ${missingTotal}개 (필수 ${analysis.missingCriticalCount}개)`;

  return (
    <div className="min-h-screen bg-[#fcf9f8]">
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
        {/* 헤더 */}
        <div className="mb-6 text-center">
          <Link
            href="/"
            className="inline-block text-xs uppercase tracking-[0.18em] text-[#928980]"
          >
            웨딩한방 · 견적 체크리스트
          </Link>
        </div>

        {/* 핵심 결과 카드 */}
        <section className="rounded-2xl border border-[#e4e2e1] bg-white p-6 sm:p-8 shadow-[0_8px_24px_rgba(26,26,31,0.04)]">
          <div className="mb-4 flex items-center gap-2 text-xs font-medium text-[#795252]">
            <span>{regionLabel}</span>
            <span className="text-[#b5ada3]">·</span>
            <span>{categoryLabel}</span>
            <span className="text-[#b5ada3]">·</span>
            <span>{formatManwon(analysis.quotePriceManwon)}</span>
          </div>

          <h1 className="font-serif-kr text-2xl sm:text-3xl text-[#1b1c1c] leading-tight">
            {analysis.summaryTitle}
          </h1>

          <div className={`mt-5 flex items-center gap-3 rounded-xl border ${intensityStyle.border} ${intensityStyle.bg} px-4 py-3`}>
            <IntensityIcon className={`h-5 w-5 ${intensityStyle.color}`} />
            <div>
              <div className={`text-sm font-medium ${intensityStyle.color}`}>{intensityStyle.label}</div>
              <div className="text-xs text-[#625b4d]">평가가 아닌 빠진 항목 카운트입니다</div>
            </div>
          </div>

          <p className="mt-5 text-sm leading-7 text-[#504444]">{analysis.summaryText}</p>

          {/* 숫자 요약 — 참고 시세 + 빠진 항목 (전부 사실) */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-[#f6f3f2] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[#928980]">
                {analysis.marketComparatorLabel ?? "기준 시세"} (참고)
              </div>
              <div className="mt-1 text-base font-semibold text-[#1b1c1c]">
                {formatManwon(analysis.marketMedianManwon)}
                <span className="ml-1.5 text-xs font-medium text-[#928980]">
                  대비 {analysis.priceDiffPercent >= 0 ? "+" : ""}
                  {analysis.priceDiffPercent}%
                </span>
              </div>
            </div>
            <div className="rounded-lg bg-[#f6f3f2] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[#928980]">견적서에서 확인 안 된 항목</div>
              <div className="mt-1 text-base font-semibold text-[#1b1c1c]">
                {missingTotal}개 (필수 {analysis.missingCriticalCount})
              </div>
            </div>
          </div>

          {/* 공유 + CTA */}
          <ShareButtons shareUrl={shareUrl} shareTitle={shareTitle} shareText={shareText} />

          <Link
            href={weddingPath("/community/quote-check")}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#795252] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#946a6a]"
          >
            내 견적도 체크리스트로 보기 · 무료
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        {/* 출처 + 고지 */}
        <div className="mt-6 space-y-3 rounded-xl border border-[#e4e2e1] bg-white px-5 py-4 text-xs leading-relaxed text-[#625b4d]">
          <p>
            <strong className="text-[#1b1c1c]">출처:</strong> {analysis.sourceNote}
          </p>
          <p>
            견적의 좋고 나쁨을 평가하는 도구가 아닙니다. 결혼 처음 준비하면 빠뜨리기 쉬운 항목과 한국소비자원 같은 지역 중위가를 참고로 보여드릴 뿐이에요. 시세는 구성·시즌에 따라 크게 달라지니, 최종 판단은 본인이 직접 하시고 큰 의사결정은 전문가 검토를 권장합니다.
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
