"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { captureEvent } from "@/lib/analytics";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Copy,
  Loader2,
  MessageCircle,
  Minus,
  PenLine,
} from "lucide-react";
import {
  AMORA_QUOTE_CATEGORY_LABELS,
  getQuoteCheckItems,
  type AmoraQuoteCategory,
  type AmoraQuoteCheckResult,
} from "@/lib/amora/quoteCheck";
import { weddingPath } from "@/lib/weddingPaths";
import ReportCardButton from "./ReportCardButton";

const CATEGORY_OPTIONS: AmoraQuoteCategory[] = ["studio", "dress", "makeup"];

type ItemDecision = "included" | "not_needed" | "unknown";

const ITEM_DECISION_OPTIONS = [
  { value: "included", label: "포함", icon: Check },
  { value: "not_needed", label: "이용 안 함", icon: Minus },
  { value: "unknown", label: "확인 필요", icon: CircleHelp },
] as const;

// 톤: 평가가 아닌 정보 노출 — 아직 확인하지 않은 항목 수에서 시각적 강도만 유도.
const INTENSITY_STYLES = {
  clear: {
    icon: CheckCircle2,
    bg: "bg-white",
    border: "border-[var(--hb-hairline)]",
    text: "text-[var(--hb-text-strong)]",
  },
  attention: {
    icon: ClipboardCheck,
    bg: "bg-[var(--hb-surface-hover)]",
    border: "border-[var(--hb-hairline)]",
    text: "text-[var(--hb-text-strong)]",
  },
  critical: {
    icon: ClipboardCheck,
    bg: "bg-[#F3F7F1]",
    border: "border-[#C7D1C2]",
    text: "text-[var(--hb-text-strong)]",
  },
} as const;

function formatManwon(value: number) {
  return `${Math.round(value).toLocaleString()}만원`;
}

export default function AmoraQuoteCheckPage() {
  const [category, setCategory] = useState<AmoraQuoteCategory>("studio");
  const [itemDecisions, setItemDecisions] = useState<Record<string, ItemDecision>>({});
  const [result, setResult] = useState<AmoraQuoteCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const items = useMemo(() => getQuoteCheckItems(category, "other"), [category]);
  const requiredItems = items.filter((item) => item.severity === "critical");
  const highItems = items.filter((item) => item.severity === "high");
  const mediumItems = items.filter((item) => item.severity === "medium");
  const includedItemIds = items
    .filter((item) => itemDecisions[item.id] === "included")
    .map((item) => item.id);
  const notNeededItemIds = items
    .filter((item) => itemDecisions[item.id] === "not_needed")
    .map((item) => item.id);
  const decidedCount = includedItemIds.length + notNeededItemIds.length;

  const resetSelection = (nextCategory: AmoraQuoteCategory) => {
    setCategory(nextCategory);
    setItemDecisions({});
    setResult(null);
    setError(null);
  };

  const setItemDecision = (id: string, decision: ItemDecision) => {
    setItemDecisions((previous) => ({ ...previous, [id]: decision }));
    setResult(null);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    setLoading(true);
    setResult(null);
    captureEvent("quote_check_submitted");

    try {
      const res = await fetch("/api/amora/quote-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          region: "other",
          includedItemIds,
          notNeededItemIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "결과를 가져오지 못했습니다.");
      setResult(data.analysis as AmoraQuoteCheckResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "결과를 가져오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)]">
      <div className="mx-auto grid w-full max-w-[1240px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-7">
        <main className="min-w-0">
          <Link
            href={weddingPath()}
            className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--hb-text-muted)] transition-colors hover:text-[var(--hb-text-strong)]"
          >
            <ArrowLeft className="h-4 w-4" />
            커뮤니티로 돌아가기
          </Link>

          <section className="rounded-[6px] border border-[var(--hb-hairline)] bg-white p-4 sm:p-5 lg:p-6">
            <div className="flex flex-col gap-4 border-b border-[#f0efed] pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#dfc9c1] bg-[var(--hb-surface-hover)] px-3 py-1 text-xs font-medium text-[var(--hb-text-strong)]">
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  계약 전 체크리스트
                </div>
                <h1 className="font-serif-kr text-[var(--hb-text-strong)]">
                  견적서에서 더 확인할 내용을 찾아드려요
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--hb-text-body)] sm:text-base">
                  견적서에 포함 여부가 분명하게 적혀 있는지 살펴보고, 계약 전 업체에 물어볼
                  질문을 정리해 드려요. 가격이 좋다·나쁘다를 판단하지 않습니다.
                </p>
              </div>
              <Link
                href={weddingPath("/community/post/write?category=is_normal")}
                className="inline-flex items-center justify-center gap-2 rounded-[6px] border border-[var(--hb-hairline)] px-4 py-2.5 text-sm font-medium text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--hb-surface-hover)]"
              >
                <ClipboardCheck className="h-4 w-4" />
                글쓰기에서 공유하기
              </Link>
            </div>

            <div className="mt-5 max-w-md">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--hb-text-strong)]">분야</span>
                <select
                  value={category}
                  onChange={(event) => resetSelection(event.target.value as AmoraQuoteCategory)}
                  className="w-full rounded-[6px] border border-[var(--hb-hairline)] bg-white px-3 py-3 text-sm text-[var(--hb-text-strong)] outline-none transition-colors focus:border-[var(--hb-primary)]"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {AMORA_QUOTE_CATEGORY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="mt-5 rounded-[6px] border border-[var(--hb-hairline)] bg-white p-4 sm:p-5 lg:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[var(--hb-text-strong)]">각 항목의 상태</h2>
                <p className="mt-1 text-sm text-[var(--hb-text-muted)]">
                  견적서에 포함이라고 적혀 있으면 ‘포함’, 이용하지 않을 항목은 ‘이용 안 함’,
                  그 외에는 ‘확인 필요’를 선택해 주세요. 아무것도 고르지 않은 항목도
                  ‘확인 필요’로 정리됩니다.
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--hb-surface-hover)] px-3 py-1 text-xs text-[var(--hb-text-body)]">
                정리 {decidedCount}/{items.length}
              </span>
            </div>

            <ItemGroup title="먼저 확인" items={requiredItems} decisions={itemDecisions} onChange={setItemDecision} />
            <ItemGroup title="함께 확인" items={highItems} decisions={itemDecisions} onChange={setItemDecision} />
            <ItemGroup title="해당하면 확인" items={mediumItems} decisions={itemDecisions} onChange={setItemDecision} />

            <div className="mt-5 rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] p-4">
              <p className="text-sm font-semibold text-[var(--hb-text-strong)]">선택한 내용은 저장하지 않습니다</p>
              <p className="text-xs leading-5 text-[var(--hb-text-body)]">
                분야와 선택 항목은 이번 결과 계산에만 사용하고 별도 서버 DB,
                업체 목록이나 공개 링크에 저장하지 않습니다.
              </p>
              <Link href="/privacy" className="mt-2 inline-flex text-xs font-medium text-[var(--hb-text-strong)] underline underline-offset-2">
                개인정보 처리 내용 보기
              </Link>
            </div>

            {error && (
              <div className="mt-4 rounded-[6px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="button"
               onClick={() => submit()}
               disabled={loading}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-raised)] transition-colors hover:bg-[var(--hb-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              체크리스트 결과 보기
            </button>
          </section>

          {result && <ResultPanel result={result} />}
        </main>

        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <section className="rounded-[6px] border border-[var(--hb-hairline)] bg-white p-5">
            <h2 className="font-serif-kr text-[var(--hb-text-strong)]">이 체크리스트, 솔직히 말하면</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--hb-text-body)]">
              <p>
                견적이 좋다·나쁘다를 평가하는 도구가 아닙니다. 견적서에 포함 여부와 별도 금액을 적어둘 항목을 보여주는 체크리스트예요.
              </p>
               <p>
                 가격 비교값은 이 결과에 고정하지 않아요. 업체별 최신 공시가에서 출처·기준 시점·구성 범위를 확인한 뒤 받은 견적과 직접 대조해 주세요.
              </p>
              <p>
                원하는 항목의 포함 여부와 별도 금액을 계약 전에 서면으로 받아두세요.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
               <Metric label="확인" value="항목" />
               <Metric label="가격" value="공시가" />
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
  decisions,
  onChange,
}: {
  title: string;
  items: ReturnType<typeof getQuoteCheckItems>;
  decisions: Record<string, ItemDecision>;
  onChange: (id: string, decision: ItemDecision) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-[var(--hb-text-strong)]">{title}</h3>
      <div className="divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">
        {items.map((item) => {
          const decision = decisions[item.id] ?? "unknown";
          return (
            <div key={item.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--hb-text-strong)]">{item.name}</span>
                </span>
                <div
                  role="group"
                  aria-label={`${item.name} 상태`}
                  className="grid w-full grid-cols-3 overflow-hidden rounded-[6px] border border-[var(--hb-hairline)] sm:w-[300px]"
                >
                  {ITEM_DECISION_OPTIONS.map((option) => {
                    const active = decision === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(item.id, option.value)}
                        className={`flex min-h-10 items-center justify-center gap-1 border-r border-[var(--hb-hairline)] px-2 text-xs font-medium last:border-r-0 ${
                          active
                            ? "bg-[var(--hb-primary)] text-white"
                            : "bg-white text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)]"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: AmoraQuoteCheckResult }) {
  const missingTotal =
    result.missingCriticalCount + result.missingHighCount + result.missingMediumCount;
  const intensity =
    result.missingCriticalCount > 0 ? "critical" : missingTotal > 0 ? "attention" : "clear";
  const style = INTENSITY_STYLES[intensity];
  const Icon = style.icon;
  const [copied, setCopied] = useState(false);

  // 확인 필요 항목 중 계약 전 확인 순서가 앞선 것부터 공유/포스트에 노출한다.
  const topMissing = useMemo(() => {
    const order = { critical: 0, high: 1, medium: 2 } as const;
    return [...result.missingItems]
      .sort((a, b) => order[a.severity] - order[b.severity])
      .slice(0, 8);
  }, [result.missingItems]);

  // 아모라 채팅에 그대로 던질 수 있는 컨텍스트 메시지
  const chatPrompt = useMemo(() => {
    const lines = [
      `방금 ${AMORA_QUOTE_CATEGORY_LABELS[result.category]} 견적 항목을 확인했어.`,
      `결과 요약: ${result.summaryTitle}`,
      result.summaryText,
    ];
    if (topMissing.length > 0) {
      lines.push("");
      lines.push("확인 필요로 남긴 항목:");
      topMissing.forEach((item) => {
        lines.push(
          `- ${item.name} (${item.severity === "critical" ? "먼저 확인" : item.severity === "high" ? "함께 확인" : "해당하면 확인"})`
        );
      });
    }
    lines.push("");
    lines.push("내 계획에 필요한 항목부터 구분하고, 업체에 어떻게 물어보면 좋을지 알려줘.");
    return lines.join("\n");
  }, [result, topMissing]);

  // 사용자가 직접 확인한 뒤 커뮤니티 글로 올리는 게시글 prefill
  const postTitle = useMemo(
    () =>
      `${AMORA_QUOTE_CATEGORY_LABELS[result.category]} 견적, 이 항목들도 포함인지 궁금해요`,
    [result]
  );
  const postContent = useMemo(() => {
    const lines = [
      `${AMORA_QUOTE_CATEGORY_LABELS[result.category]} 견적을 받았는데, 아래 항목은 포함 여부를 아직 확인하지 못해 의견을 듣고 싶어요.`,
      "",
      result.summaryTitle,
      result.summaryText,
      "",
    ];
    if (topMissing.length > 0) {
      lines.push("견적서에서 확인이 필요한 항목");
      topMissing.forEach((item) => {
        const tag = item.severity === "critical" ? "[먼저 확인]" : item.severity === "high" ? "[함께 확인]" : "[해당하면 확인]";
        lines.push(`- ${tag} ${item.name}`);
      });
      lines.push("");
    }
    lines.push("보통 계약 전에 어떤 내용을 더 확인하는지 알려주세요.");
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

  return (
    <section className={`mt-5 rounded-[6px] border ${style.border} ${style.bg} p-4 sm:p-5 lg:p-6`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] bg-white ${style.text}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className={`${style.text}`}>{result.summaryTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--hb-text-body)]">{result.summaryText}</p>
            <p className="mt-2 text-xs leading-5 text-[var(--hb-text-muted)]">
              ‘확인 필요’로 남긴 항목만 정리했어요. ‘이용 안 함’으로 고른 항목은 제외했습니다.
            </p>
          </div>
        </div>
      </div>

      {/* 메트릭 카드 — 입력값과 확인된 체크리스트 사실만 표시 */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <ResultMetric
          label="점검한 견적"
          value={AMORA_QUOTE_CATEGORY_LABELS[result.category]}
        />
        {result.marketMedianManwon > 0 ? (
          <ResultMetric
            label={`${result.marketComparatorLabel} (참고)`}
            value={formatManwon(result.marketMedianManwon)}
          />
        ) : (
          <div className="rounded-[6px] bg-white p-4">
            <p className="text-xs font-medium text-[var(--hb-text-muted)]">업체별 최신 공시가</p>
            <Link
              href="/price"
              className="mt-2 inline-flex text-sm font-semibold text-[var(--hb-text-strong)] underline decoration-[var(--hb-text-strong)]/35 underline-offset-4"
            >
              출처와 기준 시점 확인하기
            </Link>
          </div>
        )}
        <ResultMetric
          label="정리한 상태"
          value={`확인 필요 ${missingTotal}개 · 이용 안 함 ${result.notNeededItemCount}개`}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--hb-text-muted)]">
        이 결과는 가격이나 계약을 평가하지 않고, 사용자가 고른 항목 상태만 정리합니다.
      </p>

      {result.contractQuestions.length > 0 && (
      <div className="mt-5 rounded-[6px] bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-[var(--hb-text-strong)]">계약 전 그대로 보낼 질문</h3>
          <button
            type="button"
            onClick={copyQuestions}
            className="inline-flex items-center justify-center gap-1.5 rounded-[6px] border border-[var(--hb-hairline)] px-3 py-2 text-xs font-medium text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--hb-surface-hover)]"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "복사됨" : "질문 복사"}
          </button>
        </div>
        <p className="mt-2 rounded-[6px] bg-[var(--hb-surface-page)] px-3 py-3 text-sm leading-6 text-[var(--hb-text-body)]">
          {result.negotiationScript}
        </p>
        <ul className="mt-3 space-y-2">
          {result.contractQuestions.map((question) => (
            <li key={question} className="flex gap-2 text-sm leading-6 text-[var(--hb-text-strong)]">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--hb-primary)]" />
              {question}
            </li>
          ))}
        </ul>
      </div>
      )}

      <div className="mt-4 rounded-[6px] bg-white px-4 py-3 text-sm font-medium text-[var(--hb-text-strong)]">
        {result.recommendedAction}
      </div>

      {/* 리포트 PNG 카드 — 카톡·인스타에서 텍스트보다 훨씬 잘 도는 유통 단위 */}
      <div className="mt-4">
        <ReportCardButton result={result} />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          href={chatHref}
          className="inline-flex items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--hb-primary-hover)]"
        >
          <MessageCircle className="h-4 w-4" />
          아모라에게 이어서 묻기
        </Link>
        <Link
          href={postWriteHref}
          className="inline-flex items-center justify-center gap-2 rounded-[6px] border border-[#dfc9c1] bg-white px-4 py-3 text-sm font-semibold text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--hb-surface-hover)]"
        >
          <PenLine className="h-4 w-4" />
          커뮤니티에 직접 공유하기
        </Link>
      </div>

      <p className="mt-3 text-xs leading-5 text-[var(--hb-text-muted)]">{result.sourceNote}</p>
    </section>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] bg-white px-3 py-3">
      <div className="text-xs text-[var(--hb-text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--hb-text-strong)]">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] bg-[var(--hb-surface-page)] px-3 py-3">
      <div className="text-xs text-[var(--hb-text-muted)]">{label}</div>
      <div className="mt-1 text-base font-semibold text-[var(--hb-text-strong)]">{value}</div>
    </div>
  );
}
