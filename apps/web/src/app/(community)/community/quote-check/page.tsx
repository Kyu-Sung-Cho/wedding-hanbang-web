"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { captureEvent } from "@/lib/analytics";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Instagram,
  Loader2,
  LockKeyhole,
  MessageCircle,
  PenLine,
  Share2,
} from "lucide-react";
import {
  AMORA_QUOTE_CATEGORY_LABELS,
  AMORA_QUOTE_REGION_LABELS,
  getQuoteCheckItems,
  type AmoraQuoteCategory,
  type AmoraQuoteCheckResult,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import { weddingPath } from "@/lib/weddingPaths";
import ReportCardButton from "./ReportCardButton";

const CATEGORY_OPTIONS: AmoraQuoteCategory[] = ["sdm_package", "studio", "dress", "makeup"];
const REGION_OPTIONS: AmoraQuoteRegion[] = ["seoul", "gyeonggi", "busan", "daegu", "other"];

type QuoteSaveStatus =
  | "not_requested"
  | "authentication_required"
  | "saved"
  | "save_failed";

// 톤: 평가가 아닌 사용자 확인 상태만 시각화한다.
const INTENSITY_STYLES = {
  clear: {
    icon: CheckCircle2,
    bg: "bg-white",
    border: "border-[#e5d8ca]",
    text: "text-[#263832]",
  },
  attention: {
    icon: ClipboardCheck,
    bg: "bg-[#f6efe5]",
    border: "border-[#e5d8ca]",
    text: "text-[#36534E]",
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
  const [bookingChannel, setBookingChannel] = useState("unknown");
  const [quoteStage, setQuoteStage] = useState("quote_only");
  const [saveToAccount, setSaveToAccount] = useState(false);
  const [includedItemIds, setIncludedItemIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AmoraQuoteCheckResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<QuoteSaveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const items = useMemo(() => getQuoteCheckItems(category, region), [category, region]);
  const groupedItems = useMemo(
    () =>
      items.reduce<Record<string, typeof items>>((groups, item) => {
        (groups[item.category] ??= []).push(item);
        return groups;
      }, {}),
    [items]
  );

  const resetSelection = (nextCategory: AmoraQuoteCategory, nextRegion = region) => {
    setCategory(nextCategory);
    setRegion(nextRegion);
    setIncludedItemIds(new Set());
    setResult(null);
    setSavedId(null);
    setSaveStatus(null);
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
    setSavedId(null);
    setSaveStatus(null);
    captureEvent("quote_check_submitted", { category, region });

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
          bookingChannel,
          quoteStage,
          saveToAccount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "결과를 가져오지 못했습니다.");
      setResult(data.analysis as AmoraQuoteCheckResult);
      setSavedId(typeof data.savedId === "string" ? data.savedId : null);
      setSaveStatus(
        ["not_requested", "authentication_required", "saved", "save_failed"].includes(
          data.saveStatus
        )
          ? (data.saveStatus as QuoteSaveStatus)
          : "save_failed"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "결과를 가져오지 못했습니다.");
    } finally {
      setLoading(false);
    }
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
                  계약 전에 추가비용 항목을 확인해보세요
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#635b51] sm:text-base">
                  받은 견적서에 각 항목이 포함됐는지 직접 표시하고, 업체에 물어볼 질문을
                  정리하는 체크리스트예요. 항목별 가격·발생률·필수성을 판정하지 않습니다.
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
                    setSavedId(null);
                    setSaveStatus(null);
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
                <span className="mt-1 block text-xs text-[#928980]">
                  체크리스트 항목은 지역에 따라 달라지지 않아요. 계정 저장을 선택한 경우에만
                  견적 조건을 기억하기 위해 함께 저장됩니다.
                </span>
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
                      setSavedId(null);
                      setSaveStatus(null);
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

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#263832]">견적 받은 경로</span>
                <select
                  value={bookingChannel}
                  onChange={(event) => setBookingChannel(event.target.value)}
                  className="w-full rounded-lg border border-[#e5d8ca] bg-white px-3 py-3 text-sm text-[#263832] outline-none transition-colors focus:border-[#36534E]"
                >
                  <option value="unknown">잘 모르겠어요</option>
                  <option value="walk_in">직접 방문 (워크인)</option>
                  <option value="planner">플래너 동행·소개</option>
                  <option value="agency_package">대행사 패키지</option>
                </select>
                <span className="mt-1 block text-xs text-[#928980]">
                  계정 저장을 선택한 경우에만 당시 견적 조건을 기억하기 위한 메모로 함께 저장돼요.
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#263832]">진행 단계</span>
                <select
                  value={quoteStage}
                  onChange={(event) => setQuoteStage(event.target.value)}
                  className="w-full rounded-lg border border-[#e5d8ca] bg-white px-3 py-3 text-sm text-[#263832] outline-none transition-colors focus:border-[#36534E]"
                >
                  <option value="quote_only">견적만 받았어요</option>
                  <option value="contracted">계약까지 했어요</option>
                </select>
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

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[#e5d8ca] bg-[#fbf8f2] px-4 py-3">
              <input
                type="checkbox"
                checked={saveToAccount}
                onChange={(event) => setSaveToAccount(event.target.checked)}
                disabled={loading}
                className="mt-1 h-4 w-4 rounded border-[#b9afa6] accent-[#36534E]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[#263832]">
                  <LockKeyhole className="h-4 w-4" />
                  내 계정에 비공개 저장
                </span>
                <span className="mt-1 block text-xs leading-5 text-[#635b51]">
                  기본값은 저장 안 함입니다. 선택하면 견적가·업체명·메모·선택 항목과 결과가 내 계정에 저장됩니다.
                  서비스 운영상 필요한 관리자 접근을 제외하고, 공유 버튼으로 공개 링크를 켜기 전에는 다른 이용자가 볼 수 없습니다.
                  업체명은 업체 발굴이나 영업 리드 생성에 사용하지 않습니다.
                  {result ? " 선택 변경은 다음 결과 보기부터 적용됩니다." : ""}
                </span>
              </span>
            </label>
          </section>

          <section className="mt-5 rounded-xl border border-[#e5d8ca] bg-white p-4 sm:p-5 lg:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#263832]">견적서에 포함된 항목</h2>
                <p className="mt-1 text-sm text-[#928980]">
                  견적서나 업체 답변으로 포함이 확인된 항목만 선택해주세요.
                </p>
              </div>
              <span className="rounded-full bg-[#f6efe5] px-3 py-1 text-xs text-[#635b51]">
                {includedItemIds.size}/{items.length}
              </span>
            </div>

            {Object.entries(groupedItems).map(([itemCategory, categoryItems]) => (
              <ItemGroup
                key={itemCategory}
                title={{
                  studio: "스튜디오",
                  dress: "드레스",
                  makeup: "메이크업",
                  common: "본식·공통",
                }[itemCategory] ?? itemCategory}
                items={categoryItems}
                selected={includedItemIds}
                onToggle={toggleItem}
              />
            ))}

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
            <ResultPanel result={result} savedId={savedId} saveStatus={saveStatus} />
          )}
        </main>

        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <section className="rounded-xl border border-[#e5d8ca] bg-white p-5">
            <h2 className="font-serif-kr text-2xl text-[#263832]">이 체크리스트, 솔직히 말하면</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#635b51]">
              <p>
                견적이 좋다·나쁘다를 평가하는 도구가 아닙니다. 계약 범위로 확인할 수 있는 질문을 한 번에 모은 체크리스트예요.
              </p>
              <p>
                목록에 있다고 해서 반드시 필요한 항목이거나 실제로 추가된다는 뜻은 아니에요. 해당하는 항목만 업체에 확인하세요.
              </p>
              <p>
                업체 답변과 추가 조건을 문자나 계약서로 남겨두면 나중에 다시 확인하기 편해요.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
              <Metric label="확인" value="항목" />
              <Metric label="직접" value="표시" />
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
}: {
  title: string;
  items: ReturnType<typeof getQuoteCheckItems>;
  selected: Set<string>;
  onToggle: (id: string) => void;
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
                <span className="text-sm font-medium text-[#263832]">{item.name}</span>
                <span className="mt-1 block text-xs leading-5 text-[#928980]">
                  {item.checkQuestion}
                </span>
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
  saveStatus,
}: {
  result: AmoraQuoteCheckResult;
  savedId: string | null;
  saveStatus: QuoteSaveStatus | null;
}) {
  const unconfirmedTotal = result.unconfirmedItemCount;
  const intensity = unconfirmedTotal > 0 ? "attention" : "clear";
  const style = INTENSITY_STYLES[intensity];
  const Icon = style.icon;
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareSharing, setShareSharing] = useState(false);
  const [instaCopied, setInstaCopied] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [visibilityChanging, setVisibilityChanging] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const topUnconfirmed = useMemo(
    () => result.unconfirmedItems.slice(0, 8),
    [result.unconfirmedItems]
  );

  // 아모라 채팅에 그대로 던질 수 있는 컨텍스트 메시지
  const chatPrompt = useMemo(() => {
    const lines = [
      `방금 견적 체크를 돌렸어. ${AMORA_QUOTE_CATEGORY_LABELS[result.category]} ${formatManwon(result.quotePriceManwon)} 견적이야.`,
      `결과 요약: ${result.summaryTitle}`,
      result.summaryText,
    ];
    if (topUnconfirmed.length > 0) {
      lines.push("");
      lines.push("아직 포함 여부를 확인하지 않은 항목:");
      topUnconfirmed.forEach((item) => {
        lines.push(`- ${item.name}: ${item.checkQuestion}`);
      });
    }
    lines.push("");
    lines.push("이 중에 계약 전에 꼭 확인해야 할 항목이랑, 업체에 어떻게 물어보면 좋을지 알려줘.");
    return lines.join("\n");
  }, [result, topUnconfirmed]);

  // "업체명 뺀 사례로 공유하기" 게시글 prefill
  const postTitle = useMemo(
    () =>
      `${AMORA_QUOTE_CATEGORY_LABELS[result.category]} ${formatManwon(result.quotePriceManwon)} 견적, 무엇을 더 확인할까요?`,
    [result]
  );
  const postContent = useMemo(() => {
    const lines = [
      `${AMORA_QUOTE_CATEGORY_LABELS[result.category]} ${formatManwon(result.quotePriceManwon)} 견적을 받고, 아직 포함 여부를 확인하지 않은 항목을 정리했어요.`,
      "",
      `📌 ${result.summaryTitle}`,
      result.summaryText,
      "",
    ];
    if (topUnconfirmed.length > 0) {
      lines.push("포함 여부를 더 확인할 항목");
      topUnconfirmed.forEach((item) => {
        lines.push(`- ${item.name}: ${item.checkQuestion}`);
      });
      lines.push("");
    }
    lines.push("계약 전에 더 확인할 질문이 있다면 알려주세요.");
    return lines.join("\n");
  }, [result, topUnconfirmed]);

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

  // 공유 텍스트 — 사용자 확인 상태와 질문만 포함한다.
  const buildShareText = (compact = false) => {
    const head = `${formatManwon(result.quotePriceManwon)} 견적 체크리스트 — ${result.summaryTitle}`;
    const meta = `포함 여부를 더 확인할 항목 ${unconfirmedTotal}개`;
    if (compact || topUnconfirmed.length === 0) return `${head}\n${meta}`;

    const detailLines = topUnconfirmed.slice(0, 5).map((item) => `- ${item.name}`);
    return `${head}\n${meta}\n\n[확인할 항목]\n${detailLines.join("\n")}`;
  };

  const enablePublicLink = async (): Promise<string | null> => {
    if (!savedId) return null;
    setShareError(null);

    if (!isPublic) {
      setVisibilityChanging(true);
      try {
        const response = await fetch(`/api/amora/quote-check/${savedId}/share`, {
          method: "POST",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.isPublic !== true) {
          throw new Error(data.error ?? "공개 링크를 켜지 못했습니다.");
        }
        setIsPublic(true);
      } catch (err) {
        setShareError(err instanceof Error ? err.message : "공개 링크를 켜지 못했습니다.");
        return null;
      } finally {
        setVisibilityChanging(false);
      }
    }

    return `${window.location.origin}/quote/${savedId}`;
  };

  const revokePublicLink = async () => {
    if (!savedId || !isPublic) return;
    setVisibilityChanging(true);
    setShareError(null);
    try {
      const response = await fetch(`/api/amora/quote-check/${savedId}/share`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.isPublic !== false) {
        throw new Error(data.error ?? "공개 링크를 끄지 못했습니다.");
      }
      setIsPublic(false);
      setShareCopied(false);
      setInstaCopied(false);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "공개 링크를 끄지 못했습니다.");
    } finally {
      setVisibilityChanging(false);
    }
  };

  const shareResult = async () => {
    const url = await enablePublicLink();
    if (!url) return;
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
    const url = await enablePublicLink();
    if (!url) return;
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white ${style.text}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className={`text-xl font-semibold ${style.text}`}>{result.summaryTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-[#635b51]">{result.summaryText}</p>
            <p className="mt-2 text-xs leading-5 text-[#928980]">
              사용자가 표시하지 않은 항목의 개수예요. 미포함·필수·발생 가능성을 판정한 결과가 아닙니다.
            </p>
          </div>
        </div>
      </div>

      {saveStatus === "not_requested" && (
        <p className="mt-4 rounded-lg border border-[#e5d8ca] bg-white px-4 py-3 text-xs leading-5 text-[#635b51]">
          이번 결과는 계정에 저장하지 않았습니다. 공개 링크도 만들어지지 않았어요.
        </p>
      )}
      {saveStatus === "authentication_required" && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          로그인되어 있지 않아 계정에 저장하지 않았습니다. 결과는 정상적으로 정리됐지만 공개 링크는 만들 수 없어요.
        </p>
      )}
      {saveStatus === "save_failed" && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
          결과는 정리됐지만 계정 저장에 실패했습니다. 이 상태에서는 공개 링크가 만들어지지 않습니다. 잠시 후 다시 시도해주세요.
        </p>
      )}
      {saveStatus === "saved" && (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">
          내 계정에 비공개로 저장했습니다. 아래 공유 버튼을 누르기 전에는 다른 이용자가 볼 수 없습니다.
        </p>
      )}

      {/* 메트릭 카드 — 사용자가 입력·표시한 사실만 */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <ResultMetric label="입력한 견적가" value={formatManwon(result.quotePriceManwon)} />
        <ResultMetric
          label="포함 여부를 더 확인할 항목"
          value={`${unconfirmedTotal}개`}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-[#928980]">
        항목별 시세나 이용 비율은 제공하지 않아요. 실제 조건과 금액은 업체 답변과 계약서로 확인하세요.
      </p>

      {result.contractQuestions.length > 0 && (
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
      )}

      <div className="mt-4 rounded-lg bg-white px-4 py-3 text-sm font-medium text-[#36534E]">
        {result.recommendedAction}
      </div>

      {/* 리포트 PNG 카드 — 카톡·인스타에서 텍스트보다 훨씬 잘 도는 유통 단위 */}
      <div className="mt-4">
        <ReportCardButton result={result} />
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
          업체명 뺀 사례로 공유하기
        </Link>
      </div>

      {savedId && (
        <div className="mt-3 rounded-lg border border-[#e5d8ca] bg-white p-3">
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-5 text-[#635b51]">
              <strong className="text-[#263832]">
                {isPublic ? "공개 링크가 켜져 있습니다." : "현재 결과는 비공개입니다."}
              </strong>
              <br />
              {isPublic
                ? "링크를 아는 누구나 분야·지역·견적가와 결과 요약을 볼 수 있습니다. 공개 링크를 끄면 더 이상 열리지 않습니다."
                : "공유 버튼을 누르면 공개 링크가 켜지고, 링크를 아는 누구나 분야·지역·견적가와 결과 요약을 볼 수 있습니다."}
              <br />
              업체명·메모·계약 질문·협상 문구는 공개 페이지와 공유 텍스트에서 제외됩니다.
            </p>
            {shareError && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {shareError}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={shareResult}
                disabled={shareSharing || visibilityChanging}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#36534E] bg-white px-3 py-2 text-xs font-medium text-[#36534E] transition-colors hover:bg-[#f6efe5] disabled:opacity-60"
              >
                {visibilityChanging ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    공개 설정 중
                  </>
                ) : shareCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    링크·세부항목 복사됨
                  </>
                ) : (
                  <>
                    <Share2 className="h-3.5 w-3.5" />
                    {isPublic ? "카톡·메시지로 다시 공유" : "공개 링크 켜고 공유"}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={shareToInstagram}
                disabled={visibilityChanging}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#dfc9c1] bg-white px-3 py-2 text-xs font-medium text-[#36534E] transition-colors hover:bg-[#f6efe5] disabled:opacity-60"
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
              {isPublic && (
                <button
                  type="button"
                  onClick={revokePublicLink}
                  disabled={visibilityChanging}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
                >
                  <LockKeyhole className="h-3.5 w-3.5" />
                  공개 링크 끄기
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs leading-5 text-[#928980]">{result.sourceNote}</p>
      <a
        href={result.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex text-xs font-medium text-[#36534E] underline-offset-2 hover:underline"
      >
        공식 조사 원문 보기
      </a>
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
