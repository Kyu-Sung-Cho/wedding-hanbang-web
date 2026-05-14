import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ShieldCheck, AlertTriangle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AMORA_QUOTE_CATEGORY_LABELS,
  AMORA_QUOTE_REGION_LABELS,
  type AmoraQuoteCategory,
  type AmoraQuoteCheckResult,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import ShareButtons from "@/components/quote/ShareButtons";

// 카톡 공유 진단 결과 페이지 — 공개 (RLS service role 우회).
// 캐논 v2 referral 루프 핵심: 공유 받은 친구가 → "나도 진단 받기" CTA 클릭

interface PageProps {
  params: Promise<{ id: string }>;
}

interface PublicQuoteData {
  id: string;
  category: AmoraQuoteCategory;
  region: AmoraQuoteRegion;
  analysis: Pick<
    AmoraQuoteCheckResult,
    | "verdict"
    | "grade"
    | "score"
    | "category"
    | "quotePriceManwon"
    | "marketMedianManwon"
    | "priceDiffPercent"
    | "estimatedHiddenMinManwon"
    | "estimatedHiddenMaxManwon"
    | "estimatedTotalMinManwon"
    | "estimatedTotalMaxManwon"
    | "missingCriticalCount"
    | "missingHighCount"
    | "missingMediumCount"
    | "summaryTitle"
    | "summaryText"
    | "sourceNote"
  >;
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
      verdict: analysis.verdict,
      grade: analysis.grade,
      score: analysis.score,
      category: analysis.category,
      quotePriceManwon: analysis.quotePriceManwon,
      marketMedianManwon: analysis.marketMedianManwon,
      priceDiffPercent: analysis.priceDiffPercent,
      estimatedHiddenMinManwon: analysis.estimatedHiddenMinManwon,
      estimatedHiddenMaxManwon: analysis.estimatedHiddenMaxManwon,
      estimatedTotalMinManwon: analysis.estimatedTotalMinManwon,
      estimatedTotalMaxManwon: analysis.estimatedTotalMaxManwon,
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
      title: "진단 결과를 찾을 수 없습니다 — 웨딩한방",
    };
  }

  const categoryLabel = AMORA_QUOTE_CATEGORY_LABELS[data.category];
  const regionLabel = AMORA_QUOTE_REGION_LABELS[data.region];
  const missingTotal =
    data.analysis.missingCriticalCount + data.analysis.missingHighCount;

  const title = `${regionLabel} ${categoryLabel} ${formatManwon(data.analysis.quotePriceManwon)} 견적 — 빠진 항목 ${missingTotal}개 발견`;
  const description = `${data.analysis.summaryTitle} · ${data.analysis.summaryText} · 예상 추가금 ${formatManwon(data.analysis.estimatedHiddenMinManwon)}~${formatManwon(data.analysis.estimatedHiddenMaxManwon)}`;

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

const VERDICT_STYLES = {
  safe: { icon: ShieldCheck, color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", label: "안전" },
  caution: { icon: AlertTriangle, color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", label: "확인 필요" },
  danger: { icon: AlertTriangle, color: "text-red-700", bg: "bg-red-50", border: "border-red-200", label: "재검토 필요" },
} as const;

export default async function PublicQuoteResultPage({ params }: PageProps) {
  const { id } = await params;
  const data = await fetchQuoteData(id);

  if (!data) {
    notFound();
  }

  const { analysis } = data;
  const verdictStyle = VERDICT_STYLES[analysis.verdict] ?? VERDICT_STYLES.caution;
  const VerdictIcon = verdictStyle.icon;
  const categoryLabel = AMORA_QUOTE_CATEGORY_LABELS[data.category];
  const regionLabel = AMORA_QUOTE_REGION_LABELS[data.region];
  const missingTotal =
    analysis.missingCriticalCount + analysis.missingHighCount + analysis.missingMediumCount;

  const shareUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://hanbang.ai"}/quote/${data.id}`;
  const shareTitle = `${regionLabel} ${categoryLabel} ${formatManwon(analysis.quotePriceManwon)} 견적 진단`;
  const shareText = `${analysis.summaryTitle} — 빠진 항목 ${missingTotal}개, 예상 추가금 ${formatManwon(analysis.estimatedHiddenMinManwon)}~${formatManwon(analysis.estimatedHiddenMaxManwon)}`;

  return (
    <div className="min-h-screen bg-[#fcf9f8]">
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
        {/* 헤더 */}
        <div className="mb-6 text-center">
          <Link
            href="/"
            className="inline-block text-xs uppercase tracking-[0.18em] text-[#928980]"
          >
            웨딩한방 · 견적 진단
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

          <div className={`mt-5 flex items-center gap-3 rounded-xl border ${verdictStyle.border} ${verdictStyle.bg} px-4 py-3`}>
            <VerdictIcon className={`h-5 w-5 ${verdictStyle.color}`} />
            <div>
              <div className={`text-sm font-medium ${verdictStyle.color}`}>
                {verdictStyle.label} · 투명도 {analysis.grade}등급
              </div>
              <div className="text-xs text-[#625b4d]">투명도 점수 {analysis.score}/100</div>
            </div>
          </div>

          <p className="mt-5 text-sm leading-7 text-[#504444]">{analysis.summaryText}</p>

          {/* 숫자 요약 */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-[#f6f3f2] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[#928980]">시세 대비</div>
              <div className="mt-1 text-base font-semibold text-[#1b1c1c]">
                {analysis.priceDiffPercent >= 0 ? "+" : ""}
                {analysis.priceDiffPercent}%
              </div>
            </div>
            <div className="rounded-lg bg-[#f6f3f2] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[#928980]">예상 추가금</div>
              <div className="mt-1 text-base font-semibold text-[#1b1c1c]">
                {formatManwon(analysis.estimatedHiddenMinManwon)}~{formatManwon(analysis.estimatedHiddenMaxManwon)}
              </div>
            </div>
            <div className="rounded-lg bg-[#f6f3f2] p-3 col-span-2 sm:col-span-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[#928980]">빠진 항목</div>
              <div className="mt-1 text-base font-semibold text-[#1b1c1c]">
                {missingTotal}개 (필수 {analysis.missingCriticalCount})
              </div>
            </div>
          </div>

          {/* 공유 + CTA */}
          <ShareButtons shareUrl={shareUrl} shareTitle={shareTitle} shareText={shareText} />

          <Link
            href="/community/quote-check"
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#795252] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#946a6a]"
          >
            내 견적도 30초에 진단받기 · 무료
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        {/* 출처 + AI 고지 */}
        <div className="mt-6 space-y-3 rounded-xl border border-[#e4e2e1] bg-white px-5 py-4 text-xs leading-relaxed text-[#625b4d]">
          <p>
            <strong className="text-[#1b1c1c]">출처:</strong> {analysis.sourceNote}
          </p>
          <p>
            본 진단은 AI 생성 결과이며 공정거래위원회 표준계약서·한국소비자원 참가격 기준의 참고 정보입니다.
            최종 계약 판단은 본인이 직접 확인하시고, 고위험 케이스는 전문가 검토를 권장합니다.
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-[#928980]">
          <Link href="/" className="underline hover:text-[#795252]">
            웨딩한방 — 한국 첫 웨딩 견적 진단 엔진
          </Link>
        </p>
      </div>
    </div>
  );
}
