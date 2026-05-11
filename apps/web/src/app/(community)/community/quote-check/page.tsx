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
  FileSearch,
  Loader2,
  MessageCircle,
  PenLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  AMORA_QUOTE_CATEGORY_LABELS,
  AMORA_QUOTE_REGION_LABELS,
  getQuoteCheckItems,
  type AmoraQuoteCategory,
  type AmoraQuoteCheckResult,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";

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

const VERDICT_STYLES = {
  safe: {
    icon: ShieldCheck,
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
  },
  caution: {
    icon: AlertTriangle,
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
  },
  danger: {
    icon: AlertTriangle,
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const submit = async () => {
    setError(null);
    setLoading(true);
    setResult(null);

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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "견적 진단에 실패했습니다.");
      setResult(data.analysis as AmoraQuoteCheckResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "견적 진단에 실패했습니다.");
    } finally {
      setLoading(false);
    }
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
                  <Sparkles className="h-3.5 w-3.5" />
                  Amora Quote Check
                </div>
                <h1 className="font-serif-kr text-3xl text-[#1b1c1c] sm:text-4xl">
                  이 견적 정상인가요?
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#625b4d] sm:text-base">
                  견적 금액보다 중요한 건 빠진 항목입니다. 아모라가 시세, 숨은비용, 계약 전 질문을 한 번에 정리합니다.
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
              onClick={submit}
              disabled={loading}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#795252] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(121,82,82,0.18)] transition-colors hover:bg-[#946a6a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
              아모라로 견적 진단하기
            </button>
          </section>

          {result && <ResultPanel result={result} />}
        </main>

        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <section className="rounded-xl border border-[#e4e2e1] bg-white p-5">
            <h2 className="font-serif-kr text-2xl text-[#1b1c1c]">아모라가 차별점이 되는 이유</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#625b4d]">
              <p>
                업체 추천보다 먼저 필요한 건 계약 전 안전장치입니다. 견적을 확인하는 순간마다 숨은비용 데이터가 쌓이고, 그 데이터가 다음 커플의 기준이 됩니다.
              </p>
              <p>
                웨딩한방은 유료 광고 순위가 아니라 견적 투명도, 증빙 후기, 계약 조건으로 신뢰를 쌓아야 합니다.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
              <Metric label="체크" value="견적" />
              <Metric label="보호" value="계약" />
              <Metric label="축적" value="시세" />
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

function ResultPanel({ result }: { result: AmoraQuoteCheckResult }) {
  const style = VERDICT_STYLES[result.verdict];
  const Icon = style.icon;
  const [copied, setCopied] = useState(false);

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

  return (
    <section className={`mt-5 rounded-xl border ${style.border} ${style.bg} p-4 sm:p-5 lg:p-6`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white ${style.text}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className={`text-xl font-semibold ${style.text}`}>{result.summaryTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-[#504444]">{result.summaryText}</p>
          </div>
        </div>
        <div className="rounded-lg bg-white px-4 py-3 text-center">
          <div className={`text-3xl font-bold ${style.text}`}>{result.grade}</div>
          <div className="text-xs text-[#928980]">{result.score}점</div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <ResultMetric label="견적가" value={formatManwon(result.quotePriceManwon)} />
        <ResultMetric label="시세 기준" value={formatManwon(result.marketMedianManwon)} />
        <ResultMetric
          label="예상 추가금"
          value={`${formatManwon(result.estimatedHiddenMinManwon)}~${formatManwon(result.estimatedHiddenMaxManwon)}`}
        />
        <ResultMetric label="예상 총액" value={`${formatManwon(result.estimatedTotalMinManwon)}~${formatManwon(result.estimatedTotalMaxManwon)}`} />
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
          <h3 className="text-sm font-semibold text-[#1b1c1c]">감지된 리스크</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {result.redFlags.map((flag) => (
              <div key={flag.id} className="rounded-lg border border-red-100 bg-red-50 px-3 py-3">
                <div className="text-sm font-medium text-red-700">{flag.name}</div>
                <div className="mt-1 text-xs leading-5 text-red-700/75">{flag.description}</div>
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
