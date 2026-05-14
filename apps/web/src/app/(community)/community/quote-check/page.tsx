"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Loader2,
  MessageCircle,
  PenLine,
  Share2,
} from "lucide-react";
import {
  AMORA_QUOTE_CATEGORY_LABELS,
  AMORA_QUOTE_REGION_LABELS,
  getQuoteCheckItems,
  type AmoraPriceTier,
  type AmoraQuoteCategory,
  type AmoraQuoteCheckResult,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";

const PRICE_TIER_LABELS: Record<AmoraPriceTier, string> = {
  suspicious_low: "이상하게 낮은 가격대",
  standard: "일반 가격대",
  premium: "프리미엄 가격대",
  highend: "하이엔드 가격대",
};

const PRICE_TIER_DESCRIPTIONS: Record<AmoraPriceTier, string> = {
  suspicious_low: "시장 평균보다 현저히 낮음 — 미끼 가격 의심",
  standard: "한국소비자원 중위가 기준 일반 가격대",
  premium: "중위가의 1.3~2배 — 프리미엄급",
  highend: "중위가의 2배+ — 가격 비교 의미 적음. 함정 분석 중심으로 봐주세요.",
};

const PRICE_TIER_PILL_STYLES: Record<AmoraPriceTier, string> = {
  suspicious_low: "bg-amber-50 text-amber-700 border-amber-200",
  standard: "bg-sky-50 text-sky-700 border-sky-200",
  premium: "bg-violet-50 text-violet-700 border-violet-200",
  highend: "bg-slate-100 text-slate-700 border-slate-300",
};

const CATEGORY_OPTIONS: AmoraQuoteCategory[] = ["sdm_package", "studio", "dress", "makeup"];
const REGION_OPTIONS: AmoraQuoteRegion[] = ["seoul", "gyeonggi", "busan", "daegu", "other"];

const SEVERITY_LABELS = {
  critical: "필수",
  high: "고빈도",
  medium: "선택",
} as const;

const SEVERITY_STYLES = {
  critical: "border-red-200 bg-red-50 text-red-700",
  high: "border-amber-200 bg-amber-50 text-amber-700",
  medium: "border-[#e4e2e1] bg-[#f6f3f2] text-[#625b4d]",
} as const;

// 톤: 평가가 아닌 정보 노출 — 빠진 항목이 많을수록 시각적 강도만 올림.
const VERDICT_STYLES = {
  safe: {
    icon: CheckCircle2,
    bg: "bg-white",
    border: "border-[#e4e2e1]",
    text: "text-[#1b1c1c]",
  },
  caution: {
    icon: ClipboardCheck,
    bg: "bg-[#fffdfb]",
    border: "border-[#e4d8d1]",
    text: "text-[#795252]",
  },
  danger: {
    icon: AlertTriangle,
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
  },
} as const;

function formatManwon(value: number) {
  return `${Math.round(value).toLocaleString()}만원`;
}

export default function AmoraQuoteCheckPage() {
  const [category, setCategory] = useState<AmoraQuoteCategory>("sdm_package");
  const [region, setRegion] = useState<AmoraQuoteRegion>("seoul");
  const [quotePrice, setQuotePrice] = useState("320");
  const [vendorName, setVendorName] = useState("");
  const [memo, setMemo] = useState("");
  const [includedItemIds, setIncludedItemIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AmoraQuoteCheckResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [priceTierOverride, setPriceTierOverride] = useState<AmoraPriceTier | null>(null);

  const items = useMemo(() => getQuoteCheckItems(category, region), [category, region]);
  const requiredItems = items.filter((item) => item.severity === "critical");
  const highItems = items.filter((item) => item.severity === "high");
  const mediumItems = items.filter((item) => item.severity === "medium");

  const resetSelection = (nextCategory: AmoraQuoteCategory, nextRegion = region) => {
    setCategory(nextCategory);
    setRegion(nextRegion);
    setIncludedItemIds(new Set());
    setResult(null);
    setError(null);
  };

  const toggleItem = (id: string) => {
    setIncludedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const submit = async (overrideTier?: AmoraPriceTier | null) => {
    setError(null);
    setLoading(true);
    setResult(null);
    setSavedId(null);

    try {
      const res = await fetch("/api/amora/quote-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          region,
          quotePriceManwon: Number(quotePrice),
          vendorName,
          memo,
          includedItemIds: [...includedItemIds],
          userPriceTierOverride: overrideTier ?? priceTierOverride ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "결과를 가져오지 못했습니다.");
      setResult(data.analysis as AmoraQuoteCheckResult);
      setSavedId(typeof data.savedId === "string" ? data.savedId : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "결과를 가져오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleTierOverride = (tier: AmoraPriceTier) => {
    setPriceTierOverride(tier);
    void submit(tier);
  };

  const clearTierOverride = () => {
    setPriceTierOverride(null);
    void submit(null);
  };

  return (
    <div className="min-h-screen bg-[#fcf9f8]">
      <div className="mx-auto grid w-full max-w-[1480px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-7">
        <main className="min-w-0">
          <Link
            href="/community"
            className="mb-4 inline-flex items-center gap-2 text-sm text-[#928980] transition-colors hover:text-[#795252]"
          >
            <ArrowLeft className="h-4 w-4" />
            커뮤니티로 돌아가기
          </Link>

          <section className="rounded-xl border border-[#e4e2e1] bg-white p-4 sm:p-5 lg:p-6">
            <div className="flex flex-col gap-4 border-b border-[#f0efed] pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#d9c8c8] bg-[#fffdfb] px-3 py-1 text-xs font-medium text-[#795252]">
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  계약 전 체크리스트
                </div>
                <h1 className="font-serif-kr text-3xl text-[#1b1c1c] sm:text-4xl">
                  견적에 빠진 게 없는지 같이 봐드려요
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#625b4d] sm:text-base">
                  결혼 처음 준비하면 놓치기 쉬운 항목 + 한국소비자원 평균 가격 + 계약 전 업체에 물어볼 질문을 정리해 드려요.
                  견적이 좋다·나쁘다를 판단하는 게 아니라, 빠진 게 없는지 확인하는 체크리스트입니다.
                </p>
              </div>
              <Link
                href="/community/post/write?category=is_normal"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#e4e2e1] px-4 py-2.5 text-sm font-medium text-[#795252] transition-colors hover:bg-[#fffdfb]"
              >
                <ClipboardCheck className="h-4 w-4" />
                커뮤니티에 같이 묻기
              </Link>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#1b1c1c]">분야</span>
                <select
                  value={category}
                  onChange={(event) => resetSelection(event.target.value as AmoraQuoteCategory)}
                  className="w-full rounded-lg border border-[#e4e2e1] bg-white px-3 py-3 text-sm text-[#1b1c1c] outline-none transition-colors focus:border-[#795252]"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {AMORA_QUOTE_CATEGORY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#1b1c1c]">지역</span>
                <select
                  value={region}
                  onChange={(event) => {
                    setRegion(event.target.value as AmoraQuoteRegion);
                    setResult(null);
                    setError(null);
                  }}
                  className="w-full rounded-lg border border-[#e4e2e1] bg-white px-3 py-3 text-sm text-[#1b1c1c] outline-none transition-colors focus:border-[#795252]"
                >
                  {REGION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {AMORA_QUOTE_REGION_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#1b1c1c]">견적 금액</span>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={quotePrice}
                    onChange={(event) => {
                      setQuotePrice(event.target.value);
                      setResult(null);
                    }}
                    className="w-full rounded-lg border border-[#e4e2e1] bg-white px-3 py-3 pr-12 text-sm text-[#1b1c1c] outline-none transition-colors focus:border-[#795252]"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#928980]">
                    만원
                  </span>
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#1b1c1c]">업체명</span>
                <input
                  type="text"
                  value={vendorName}
                  onChange={(event) => setVendorName(event.target.value)}
                  placeholder="선택 입력"
                  className="w-full rounded-lg border border-[#e4e2e1] bg-white px-3 py-3 text-sm text-[#1b1c1c] outline-none transition-colors placeholder:text-[#b5ada3] focus:border-[#795252]"
                />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-[#1b1c1c]">견적 메모</span>
              <textarea
                rows={3}
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="상담 중 들은 추가금, 계약 조건, 헷갈리는 문장을 적어두세요"
                className="w-full resize-none rounded-lg border border-[#e4e2e1] bg-white px-3 py-3 text-sm text-[#1b1c1c] outline-none transition-colors placeholder:text-[#b5ada3] focus:border-[#795252]"
              />
            </label>
          </section>

          <section className="mt-5 rounded-xl border border-[#e4e2e1] bg-white p-4 sm:p-5 lg:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#1b1c1c]">견적서에 포함된 항목</h2>
                <p className="mt-1 text-sm text-[#928980]">
                  확인된 항목만 선택하면 빠진 비용을 계산합니다.
                </p>
              </div>
              <span className="rounded-full bg-[#f6f3f2] px-3 py-1 text-xs text-[#625b4d]">
                {includedItemIds.size}/{items.length}
              </span>
            </div>

            <ItemGroup title="필수 확인" items={requiredItems} selected={includedItemIds} onToggle={toggleItem} />
            <ItemGroup title="자주 붙는 추가금" items={highItems} selected={includedItemIds} onToggle={toggleItem} />
            <ItemGroup title="선택 항목" items={mediumItems} selected={includedItemIds} onToggle={toggleItem} compact />

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => submit()}
              disabled={loading}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#795252] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(121,82,82,0.18)] transition-colors hover:bg-[#946a6a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              체크리스트 결과 보기
            </button>
          </section>

          {result && (
            <ResultPanel
              result={result}
              savedId={savedId}
              onTierOverride={handleTierOverride}
              onClearTierOverride={clearTierOverride}
            />
          )}
        </main>

        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <section className="rounded-xl border border-[#e4e2e1] bg-white p-5">
            <h2 className="font-serif-kr text-2xl text-[#1b1c1c]">이 체크리스트, 솔직히 말하면</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#625b4d]">
              <p>
                견적이 좋다·나쁘다를 평가하는 도구가 아닙니다. 결혼 처음 준비하면 모르고 빠뜨릴 수 있는 항목들을 한 번에 보여주는 체크리스트예요.
              </p>
              <p>
                가격 비교는 한국소비자원 평균을 참고로만 표시해요. 예산·우선순위·하객 규모에 따라 같은 가격도 적정선이 달라지니, 판단은 본인이 하세요.
              </p>
              <p>
                계약 전 빠진 항목을 업체에 한 번이라도 묻고 답변을 받으면 — 그게 가장 큰 안전장치예요.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
              <Metric label="확인" value="항목" />
              <Metric label="참고" value="평균" />
              <Metric label="준비" value="질문" />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ItemGroup({
  title,
  items,
  selected,
  onToggle,
  compact = false,
}: {
  title: string;
  items: ReturnType<typeof getQuoteCheckItems>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  compact?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-semibold text-[#1b1c1c]">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const active = selected.has(item.id);
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onToggle(item.id)}
              className={`flex min-h-[64px] items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                active
                  ? "border-[#795252] bg-[#fffdfb]"
                  : "border-[#e4e2e1] bg-white hover:border-[#d9c8c8] hover:bg-[#fffdfb]"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  active ? "border-[#795252] bg-[#795252] text-white" : "border-[#d4c2c2] text-transparent"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[#1b1c1c]">{item.name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${SEVERITY_STYLES[item.severity]}`}>
                    {SEVERITY_LABELS[item.severity]}
                  </span>
                </span>
                {!compact && (
                  <span className="mt-1 block text-xs text-[#928980]">
                    평균 {formatManwon(item.priceManwon)} · 이용률 {item.usageRatePercent}%
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResultPanel({
  result,
  savedId,
  onTierOverride,
  onClearTierOverride,
}: {
  result: AmoraQuoteCheckResult;
  savedId: string | null;
  onTierOverride: (tier: AmoraPriceTier) => void;
  onClearTierOverride: () => void;
}) {
  const style = VERDICT_STYLES[result.verdict];
  const Icon = style.icon;
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareSharing, setShareSharing] = useState(false);
  const [showTierMenu, setShowTierMenu] = useState(false);
  const isOverridden = result.priceTier !== result.priceTierAutoInferred;

  const copyQuestions = async () => {
    const text = [
      result.negotiationScript,
      "",
      "계약 전 확인 질문",
      ...result.contractQuestions.map((question, index) => `${index + 1}. ${question}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const shareResult = async () => {
    if (!savedId) return;
    const url = `${window.location.origin}/quote/${savedId}`;
    const missing =
      result.missingCriticalCount + result.missingHighCount + result.missingMediumCount;
    const title = `${result.summaryTitle}`;
    const text = `${formatManwon(result.quotePriceManwon)} 견적 체크리스트 — 빠진 항목 ${missing}개, 추가금 추정 ${formatManwon(result.estimatedHiddenMinManwon)}~${formatManwon(result.estimatedHiddenMaxManwon)}`;

    if (typeof navigator.share === "function") {
      try {
        setShareSharing(true);
        await navigator.share({ title, text, url });
      } catch {
        // 취소 등 — 무시
      } finally {
        setShareSharing(false);
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      window.prompt("이 링크를 복사해 공유하세요", `${text}\n${url}`);
    }
  };

  return (
    <section className={`mt-5 rounded-xl border ${style.border} ${style.bg} p-4 sm:p-5 lg:p-6`}>
      {/* 가격대 분류 배너 — 사용자가 어느 가격대로 분석됐는지 명확히 + 보정 옵션 */}
      <div className="mb-4 rounded-lg border border-white/60 bg-white/70 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${PRICE_TIER_PILL_STYLES[result.priceTier]}`}
              >
                {PRICE_TIER_LABELS[result.priceTier]}
              </span>
              {isOverridden && (
                <span className="text-[11px] text-[#928980]">
                  · 직접 보정함 (자동: {PRICE_TIER_LABELS[result.priceTierAutoInferred]})
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[#625b4d] sm:text-sm">
              {PRICE_TIER_DESCRIPTIONS[result.priceTier]}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start sm:items-end">
            <button
              type="button"
              onClick={() => setShowTierMenu((v) => !v)}
              className="text-xs font-medium text-[#795252] underline-offset-2 hover:underline"
            >
              {showTierMenu ? "닫기" : "이 분석이 안 맞아요"}
            </button>
            {isOverridden && (
              <button
                type="button"
                onClick={onClearTierOverride}
                className="mt-1 text-xs text-[#928980] underline-offset-2 hover:underline"
              >
                자동 분류로 되돌리기
              </button>
            )}
          </div>
        </div>
        {showTierMenu && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["suspicious_low", "standard", "premium", "highend"] as AmoraPriceTier[]).map(
              (tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => {
                    onTierOverride(tier);
                    setShowTierMenu(false);
                  }}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    result.priceTier === tier
                      ? "border-[#795252] bg-[#fffdfb] text-[#1b1c1c]"
                      : "border-[#e4e2e1] bg-white text-[#625b4d] hover:border-[#d9c8c8] hover:bg-[#fffdfb]"
                  }`}
                >
                  <div className="text-sm font-medium text-[#1b1c1c]">
                    {PRICE_TIER_LABELS[tier]}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-4 text-[#928980]">
                    {PRICE_TIER_DESCRIPTIONS[tier]}
                  </div>
                </button>
              )
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white ${style.text}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className={`text-xl font-semibold ${style.text}`}>{result.summaryTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-[#504444]">{result.summaryText}</p>
            <p className="mt-2 text-xs leading-5 text-[#928980]">
              평가가 아니라 빠진 항목 카운트입니다. 각자 예산·우선순위에 따라 적정선은 다를 수 있어요.
            </p>
          </div>
        </div>
      </div>

      {/* 메트릭 카드 — 하이엔드는 한국 평균 비교 숨김 */}
      <div className={`mt-5 grid gap-3 ${result.showPriceComparison ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <ResultMetric label="입력한 견적가" value={formatManwon(result.quotePriceManwon)} />
        {result.showPriceComparison && (
          <ResultMetric label="한국 평균 (참고)" value={formatManwon(result.marketMedianManwon)} />
        )}
        <ResultMetric
          label="빠진 항목 추가금 추정"
          value={`${formatManwon(result.estimatedHiddenMinManwon)}~${formatManwon(result.estimatedHiddenMaxManwon)}`}
        />
        <ResultMetric label="합산 추정 (참고)" value={`${formatManwon(result.estimatedTotalMinManwon)}~${formatManwon(result.estimatedTotalMaxManwon)}`} />
      </div>

      <div className="mt-5 rounded-lg bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-[#1b1c1c]">계약 전 그대로 보낼 질문</h3>
          <button
            type="button"
            onClick={copyQuestions}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#e4e2e1] px-3 py-2 text-xs font-medium text-[#795252] transition-colors hover:bg-[#fffdfb]"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "복사됨" : "질문 복사"}
          </button>
        </div>
        <p className="mt-2 rounded-lg bg-[#fcf9f8] px-3 py-3 text-sm leading-6 text-[#625b4d]">
          {result.negotiationScript}
        </p>
        <ul className="mt-3 space-y-2">
          {result.contractQuestions.map((question) => (
            <li key={question} className="flex gap-2 text-sm leading-6 text-[#1b1c1c]">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#795252]" />
              {question}
            </li>
          ))}
        </ul>
      </div>

      {result.redFlags.length > 0 && (
        <div className="mt-4 rounded-lg bg-white p-4">
          <h3 className="text-sm font-semibold text-[#1b1c1c]">참고: 자주 보이는 패턴</h3>
          <p className="mt-1 text-xs text-[#928980]">아래는 입력한 견적과 비슷한 형태에서 흔히 나타난 패턴이에요. 단정은 아니에요.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {result.redFlags.map((flag) => (
              <div key={flag.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="text-sm font-medium text-amber-800">{flag.name}</div>
                <div className="mt-1 text-xs leading-5 text-amber-800/80">{flag.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg bg-white px-4 py-3 text-sm font-medium text-[#795252]">
        {result.recommendedAction}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          href="/chat"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#795252] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#946a6a]"
        >
          <MessageCircle className="h-4 w-4" />
          아모라에게 이어서 묻기
        </Link>
        <Link
          href="/community/post/write?category=is_normal"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d9c8c8] bg-white px-4 py-3 text-sm font-semibold text-[#795252] transition-colors hover:bg-[#fffdfb]"
        >
          <PenLine className="h-4 w-4" />
          익명 사례로 공유하기
        </Link>
      </div>

      {savedId && (
        <div className="mt-3 rounded-lg border border-[#e4e2e1] bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-[#625b4d]">
              <strong className="text-[#1b1c1c]">고민되면 친구·파트너에게 보내세요.</strong>
              <br className="sm:hidden" />
              공유 페이지에는 견적가·빠진 항목 요약만 표시되고 메모·업체명은 빠집니다.
            </p>
            <button
              type="button"
              onClick={shareResult}
              disabled={shareSharing}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#795252] bg-white px-3 py-2 text-xs font-medium text-[#795252] transition-colors hover:bg-[#fffdfb] disabled:opacity-60"
            >
              {shareCopied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  링크 복사됨
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" />
                  결과 공유하기
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs leading-5 text-[#928980]">{result.sourceNote}</p>
    </section>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-3">
      <div className="text-xs text-[#928980]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[#1b1c1c]">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#fcf9f8] px-3 py-3">
      <div className="text-xs text-[#928980]">{label}</div>
      <div className="mt-1 text-base font-semibold text-[#795252]">{value}</div>
    </div>
  );
}
