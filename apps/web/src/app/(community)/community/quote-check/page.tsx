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
  Instagram,
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
import { weddingPath } from "@/lib/weddingPaths";

const PRICE_TIER_LABELS: Record<AmoraPriceTier, string> = {
  suspicious_low: "이상하게 낮은 가격대",
  standard: "일반 가격대",
  premium: "프리미엄 가격대",
  highend: "하이엔드 가격대",
};

const PRICE_TIER_DESCRIPTIONS: Record<AmoraPriceTier, string> = {
  suspicious_low: "시장 평균보다 현저히 낮은 견적이에요 — 미끼 가격일 수 있어요",
  standard: "한국소비자원 중위가 기준의 일반 가격대예요",
  premium: "한국 평균의 1.3~2배 가격대예요 — 프리미엄 급",
  highend:
    "한국 평균의 2배 이상이라 평균값과의 비교는 의미가 적어요. 가격 비교 대신 빠진 항목과 추가금 가능성에 집중해서 봐주세요.",
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
  medium: "border-[#e5d8ca] bg-[#f6efe5] text-[#635b51]",
} as const;

// 톤: 평가가 아닌 정보 노출 — 빠진 항목이 많을수록 시각적 강도만 올림.
const VERDICT_STYLES = {
  safe: {
    icon: CheckCircle2,
    bg: "bg-white",
    border: "border-[#e5d8ca]",
    text: "text-[#263832]",
  },
  caution: {
    icon: ClipboardCheck,
    bg: "bg-[#f6efe5]",
    border: "border-[#e5d8ca]",
    text: "text-[#36534E]",
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
    <div className="min-h-screen bg-[#fbf8f2]">
      <div className="mx-auto grid w-full max-w-[1240px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-7">
        <main className="min-w-0">
          <Link
            href={weddingPath()}
            className="mb-4 inline-flex items-center gap-2 text-sm text-[#928980] transition-colors hover:text-[#36534E]"
          >
            <ArrowLeft className="h-4 w-4" />
            커뮤니티로 돌아가기
          </Link>

          <section className="rounded-xl border border-[#e5d8ca] bg-white p-4 sm:p-5 lg:p-6">
            <div className="flex flex-col gap-4 border-b border-[#f0efed] pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#dfc9c1] bg-[#f6efe5] px-3 py-1 text-xs font-medium text-[#36534E]">
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  계약 전 체크리스트
                </div>
                <h1 className="font-serif-kr text-3xl text-[#263832] sm:text-4xl">
                  견적에 빠진 게 없는지 같이 봐드려요
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#635b51] sm:text-base">
                  결혼 처음 준비하면 놓치기 쉬운 항목 + 한국소비자원 평균 가격 + 계약 전 업체에 물어볼 질문을 정리해 드려요.
                  견적이 좋다·나쁘다를 판단하는 게 아니라, 빠진 게 없는지 확인하는 체크리스트입니다.
                </p>
              </div>
              <Link
                href={weddingPath("/community/post/write?category=is_normal")}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#e5d8ca] px-4 py-2.5 text-sm font-medium text-[#36534E] transition-colors hover:bg-[#f6efe5]"
              >
                <ClipboardCheck className="h-4 w-4" />
                글쓰기에서 공유하기
              </Link>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#263832]">분야</span>
                <select
                  value={category}
                  onChange={(event) => resetSelection(event.target.value as AmoraQuoteCategory)}
                  className="w-full rounded-lg border border-[#e5d8ca] bg-white px-3 py-3 text-sm text-[#263832] outline-none transition-colors focus:border-[#36534E]"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {AMORA_QUOTE_CATEGORY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#263832]">지역</span>
                <select
                  value={region}
                  onChange={(event) => {
                    setRegion(event.target.value as AmoraQuoteRegion);
                    setResult(null);
                    setError(null);
                  }}
                  className="w-full rounded-lg border border-[#e5d8ca] bg-white px-3 py-3 text-sm text-[#263832] outline-none transition-colors focus:border-[#36534E]"
                >
                  {REGION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {AMORA_QUOTE_REGION_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#263832]">견적 금액</span>
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
                    className="w-full rounded-lg border border-[#e5d8ca] bg-white px-3 py-3 pr-12 text-sm text-[#263832] outline-none transition-colors focus:border-[#36534E]"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#928980]">
                    만원
                  </span>
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#263832]">업체명</span>
                <input
                  type="text"
                  value={vendorName}
                  onChange={(event) => setVendorName(event.target.value)}
                  placeholder="선택 입력"
                  className="w-full rounded-lg border border-[#e5d8ca] bg-white px-3 py-3 text-sm text-[#263832] outline-none transition-colors placeholder:text-[#b5ada3] focus:border-[#36534E]"
                />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-[#263832]">견적 메모</span>
              <textarea
                rows={3}
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="상담 중 들은 추가금, 계약 조건, 헷갈리는 문장을 적어두세요"
                className="w-full resize-none rounded-lg border border-[#e5d8ca] bg-white px-3 py-3 text-sm text-[#263832] outline-none transition-colors placeholder:text-[#b5ada3] focus:border-[#36534E]"
              />
            </label>
          </section>

          <section className="mt-5 rounded-xl border border-[#e5d8ca] bg-white p-4 sm:p-5 lg:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#263832]">견적서에 포함된 항목</h2>
                <p className="mt-1 text-sm text-[#928980]">
                  확인된 항목만 선택하면 빠진 비용을 계산합니다.
                </p>
              </div>
              <span className="rounded-full bg-[#f6efe5] px-3 py-1 text-xs text-[#635b51]">
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
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#36534E] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(6,26,52,0.18)] transition-colors hover:bg-[#2B423E] disabled:cursor-not-allowed disabled:opacity-60"
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
          <section className="rounded-xl border border-[#e5d8ca] bg-white p-5">
            <h2 className="font-serif-kr text-2xl text-[#263832]">이 체크리스트, 솔직히 말하면</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#635b51]">
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
      <h3 className="mb-2 text-sm font-semibold text-[#263832]">{title}</h3>
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
                  ? "border-[#36534E] bg-[#f6efe5]"
                  : "border-[#e5d8ca] bg-white hover:border-[#dfc9c1] hover:bg-[#f6efe5]"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  active ? "border-[#36534E] bg-[#36534E] text-white" : "border-[#dfc9c1] text-transparent"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[#263832]">{item.name}</span>
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
  const [instaCopied, setInstaCopied] = useState(false);
  const [showTierMenu, setShowTierMenu] = useState(false);
  const isOverridden = result.priceTier !== result.priceTierAutoInferred;

  // missingItems 중 추가금 발생 가능성이 높은 것 우선 — 공유/포스트 노출용
  const topMissing = useMemo(() => {
    const order = { critical: 0, high: 1, medium: 2 } as const;
    return [...result.missingItems]
      .sort((a, b) => order[a.severity] - order[b.severity])
      .slice(0, 8);
  }, [result.missingItems]);

  // 아모라 채팅에 그대로 던질 수 있는 컨텍스트 메시지
  const chatPrompt = useMemo(() => {
    const lines = [
      `방금 견적 체크를 돌렸어. ${AMORA_QUOTE_CATEGORY_LABELS[result.category]} ${formatManwon(result.quotePriceManwon)} 견적이야.`,
      `결과 요약: ${result.summaryTitle}`,
      result.summaryText,
    ];
    if (topMissing.length > 0) {
      lines.push("");
      lines.push("빠진 항목:");
      topMissing.forEach((item) => {
        lines.push(
          `- ${item.name} (평균 ${formatManwon(item.priceManwon)}, ${item.severity === "critical" ? "필수" : item.severity === "high" ? "추가금" : "선택"})`
        );
      });
    }
    lines.push("");
    lines.push("이 중에 계약 전에 꼭 확인해야 할 항목이랑, 업체에 어떻게 물어보면 좋을지 알려줘.");
    return lines.join("\n");
  }, [result, topMissing]);

  // "익명 사례로 공유하기" 게시글 prefill
  const postTitle = useMemo(
    () =>
      `${AMORA_QUOTE_CATEGORY_LABELS[result.category]} ${formatManwon(result.quotePriceManwon)} 견적, 이거 빠진 거 정상인가요?`,
    [result]
  );
  const postContent = useMemo(() => {
    const lines = [
      `${AMORA_QUOTE_CATEGORY_LABELS[result.category]} ${formatManwon(result.quotePriceManwon)} 견적 받았는데 체크리스트 돌려보니까 빠진 항목이 있어서 공유 + 의견 받고 싶어요.`,
      "",
      `📌 ${result.summaryTitle}`,
      result.summaryText,
      "",
    ];
    if (topMissing.length > 0) {
      lines.push("⚠️ 견적서에서 확인 안 된 항목");
      topMissing.forEach((item) => {
        const tag = item.severity === "critical" ? "[필수]" : item.severity === "high" ? "[추가금]" : "[선택]";
        lines.push(`- ${tag} ${item.name} — 평균 ${formatManwon(item.priceManwon)}`);
      });
      lines.push("");
    }
    lines.push(
      `예상 추가 청구: ${formatManwon(result.estimatedHiddenMinManwon)}~${formatManwon(result.estimatedHiddenMaxManwon)}`
    );
    lines.push("");
    lines.push("이거 보통 이렇게 빠지나요? 추가 질문 받습니다 🙏");
    return lines.join("\n");
  }, [result, topMissing]);

  const chatHref = weddingPath(`/chat?prefill=${encodeURIComponent(chatPrompt)}`);
  const postWriteHref = weddingPath(`/community/post/write?category=is_normal&prefill=quote_check&title=${encodeURIComponent(postTitle)}&body=${encodeURIComponent(postContent)}`);

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

  // 공유 텍스트 — 빠진 세부 항목까지 포함 (이슈 6)
  const buildShareText = (compact = false) => {
    const head = `${formatManwon(result.quotePriceManwon)} 견적 체크리스트 — ${result.summaryTitle}`;
    const meta = `빠진 항목 ${result.missingCriticalCount + result.missingHighCount + result.missingMediumCount}개 · 추가금 추정 ${formatManwon(result.estimatedHiddenMinManwon)}~${formatManwon(result.estimatedHiddenMaxManwon)}`;
    if (compact || topMissing.length === 0) return `${head}\n${meta}`;

    const detailLines = topMissing.slice(0, 5).map((item) => {
      const tag = item.severity === "critical" ? "[필수]" : item.severity === "high" ? "[추가금]" : "[선택]";
      return `${tag} ${item.name} (평균 ${formatManwon(item.priceManwon)})`;
    });
    return `${head}\n${meta}\n\n[견적서에 없는 항목]\n${detailLines.join("\n")}`;
  };

  const shareResult = async () => {
    if (!savedId) return;
    const url = `${window.location.origin}/quote/${savedId}`;
    const title = `${result.summaryTitle}`;
    const text = buildShareText(false);

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

  // 인스타그램은 웹에서 텍스트 직접 공유가 안 되므로 — 텍스트를 클립보드로 복사하고
  // 인스타그램을 새 탭으로 열어줌. 사용자가 스토리/DM/게시물에 붙여넣어 공유.
  const shareToInstagram = async () => {
    if (!savedId) return;
    const url = `${window.location.origin}/quote/${savedId}`;
    const text = `${buildShareText(false)}\n\n${url}\n#웨딩한방 #견적체크`;
    try {
      await navigator.clipboard.writeText(text);
      setInstaCopied(true);
      setTimeout(() => setInstaCopied(false), 2500);
    } catch {
      window.prompt("아래 텍스트를 복사해 인스타그램에 붙여넣으세요", text);
    }
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
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
            <p className="mt-1.5 text-xs leading-5 text-[#635b51] sm:text-sm">
              {PRICE_TIER_DESCRIPTIONS[result.priceTier]}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start sm:items-end">
            <button
              type="button"
              onClick={() => setShowTierMenu((v) => !v)}
              className="text-xs font-medium text-[#36534E] underline-offset-2 hover:underline"
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
                      ? "border-[#36534E] bg-[#f6efe5] text-[#263832]"
                      : "border-[#e5d8ca] bg-white text-[#635b51] hover:border-[#dfc9c1] hover:bg-[#f6efe5]"
                  }`}
                >
                  <div className="text-sm font-medium text-[#263832]">
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
            <p className="mt-2 text-sm leading-6 text-[#635b51]">{result.summaryText}</p>
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
          <h3 className="text-sm font-semibold text-[#263832]">계약 전 그대로 보낼 질문</h3>
          <button
            type="button"
            onClick={copyQuestions}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#e5d8ca] px-3 py-2 text-xs font-medium text-[#36534E] transition-colors hover:bg-[#f6efe5]"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "복사됨" : "질문 복사"}
          </button>
        </div>
        <p className="mt-2 rounded-lg bg-[#fbf8f2] px-3 py-3 text-sm leading-6 text-[#635b51]">
          {result.negotiationScript}
        </p>
        <ul className="mt-3 space-y-2">
          {result.contractQuestions.map((question) => (
            <li key={question} className="flex gap-2 text-sm leading-6 text-[#263832]">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#36534E]" />
              {question}
            </li>
          ))}
        </ul>
      </div>

      {result.redFlags.length > 0 && (
        <div className="mt-4 rounded-lg bg-white p-4">
          <h3 className="text-sm font-semibold text-[#263832]">참고: 자주 보이는 패턴</h3>
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

      <div className="mt-4 rounded-lg bg-white px-4 py-3 text-sm font-medium text-[#36534E]">
        {result.recommendedAction}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          href={chatHref}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#36534E] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2B423E]"
        >
          <MessageCircle className="h-4 w-4" />
          아모라에게 이어서 묻기
        </Link>
        <Link
          href={postWriteHref}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#dfc9c1] bg-white px-4 py-3 text-sm font-semibold text-[#36534E] transition-colors hover:bg-[#f6efe5]"
        >
          <PenLine className="h-4 w-4" />
          익명 사례로 공유하기
        </Link>
      </div>

      {savedId && (
        <div className="mt-3 rounded-lg border border-[#e5d8ca] bg-white p-3">
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-5 text-[#635b51]">
              <strong className="text-[#263832]">고민되면 친구·파트너에게 보내세요.</strong>
              <br />
              공유 텍스트에는 견적가, 요약, 빠진 항목 세부 리스트가 포함돼요. 메모·업체명은 제외됩니다.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={shareResult}
                disabled={shareSharing}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#36534E] bg-white px-3 py-2 text-xs font-medium text-[#36534E] transition-colors hover:bg-[#f6efe5] disabled:opacity-60"
              >
                {shareCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    링크·세부항목 복사됨
                  </>
                ) : (
                  <>
                    <Share2 className="h-3.5 w-3.5" />
                    카톡·메시지로 공유
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={shareToInstagram}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#dfc9c1] bg-white px-3 py-2 text-xs font-medium text-[#36534E] transition-colors hover:bg-[#f6efe5]"
              >
                {instaCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    복사 완료 · 인스타에 붙여넣기
                  </>
                ) : (
                  <>
                    <Instagram className="h-3.5 w-3.5" />
                    인스타 공유 (텍스트 복사)
                  </>
                )}
              </button>
            </div>
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
      <div className="mt-1 text-sm font-semibold text-[#263832]">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#fbf8f2] px-3 py-3">
      <div className="text-xs text-[#928980]">{label}</div>
      <div className="mt-1 text-base font-semibold text-[#36534E]">{value}</div>
    </div>
  );
}
