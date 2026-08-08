"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseDecisionOutcomeReviewQueue,
  parseDecisionOutcomeReviewReceipt,
} from "@/lib/community/decisionOutcomeReviewApi";

const REVIEW_POLICY_VERSION = "p0-human-v1";
const REVIEW_REASON_MIN_LENGTH = 3;
const REVIEW_REASON_MAX_LENGTH = 500;

type ReviewDecision = "publish" | "reject";

interface SelectedEvidence {
  content: string | null;
  contentOrigin: "member" | "industry_professional";
  applicability: string;
  commercialRelationship: string;
  sponsorshipDetail: string | null;
}

interface DecisionOutcomeReviewItem {
  outcomeId: string;
  threadId: string;
  revision: number;
  publicationState: "pending_review" | "published" | "rejected" | "withdrawn";
  sourceAvailable: boolean;
  authorNickname: string;
  title: string;
  sourceContent: string;
  desiredAnswer: string;
  actionTaken: string;
  resultSummary: string;
  applicableConditions: string;
  commercialRelationship: string;
  sponsorshipDetail: string | null;
  selectedEvidence: SelectedEvidence[];
  createdAt: string;
}

interface QueueCursor {
  at: string;
  id: string;
}

interface PendingConfirmation {
  outcomeId: string;
  decision: ReviewDecision;
  reason: string;
}

const COMMERCIAL_RELATIONSHIP_LABELS: Record<string, string> = {
  none: "상업적 관계 없음",
  gift: "제품·서비스 제공",
  discount: "할인 제공",
  refund: "환급",
  affiliate: "제휴 관계",
  paid: "유료 관계",
  employee: "해당 업체 재직",
  owner_or_family: "소유주 또는 가족",
  platform_research_compensation: "플랫폼 조사 보상",
};

const CONTENT_ORIGIN_LABELS: Record<SelectedEvidence["contentOrigin"], string> = {
  member: "일반 회원 경험",
  industry_professional: "업계 종사자 답변",
};

const APPLICABILITY_LABELS: Record<string, string> = {
  applies: "조건이 맞음",
  conditions_differ: "조건이 다름",
  need_more_info: "추가 확인 필요",
  taken_as_next_action: "다음 행동으로 채택",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시각 확인 불가";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function readErrorMessage(value: unknown, fallback: string) {
  if (
    typeof value === "object"
    && value !== null
    && "error" in value
    && typeof value.error === "string"
  ) {
    return value.error;
  }
  return fallback;
}

function newOperationKey() {
  if (typeof globalThis.crypto?.randomUUID !== "function") return null;
  return globalThis.crypto.randomUUID();
}

function relationshipLabel(value: string) {
  return COMMERCIAL_RELATIONSHIP_LABELS[value] ?? "관계 유형 확인 필요";
}

function FieldBlock({
  label,
  children,
  tone = "default",
}: {
  label: string;
  children: React.ReactNode;
  tone?: "default" | "result";
}) {
  return (
    <div
      className={
        tone === "result"
          ? "border-l-4 border-[#6D806E] bg-[#F4F8F3] px-4 py-3"
          : "border-l-4 border-[#E2D3C8] px-4 py-1"
      }
    >
      <dt className="text-xs font-semibold text-[#6F6A62]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#243832]">
        {children}
      </dd>
    </div>
  );
}

function EvidenceCard({
  evidence,
  index,
}: {
  evidence: SelectedEvidence;
  index: number;
}) {
  return (
    <li className="border-t border-[#EFE4D7] py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6F6A62]">
        <span className="font-semibold text-[#36534E]">근거 {index + 1}</span>
        <span>{CONTENT_ORIGIN_LABELS[evidence.contentOrigin]}</span>
        <span>{APPLICABILITY_LABELS[evidence.applicability] ?? "적용 상태 확인 필요"}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#243832]">
        {evidence.content ?? "공개할 수 있는 근거 본문이 없습니다."}
      </p>
      <p className="mt-2 text-xs leading-5 text-[#6F6A62]">
        상업관계: {relationshipLabel(evidence.commercialRelationship)}
        {evidence.sponsorshipDetail ? ` · ${evidence.sponsorshipDetail}` : ""}
      </p>
    </li>
  );
}

export function DecisionOutcomeReviewQueue() {
  const [items, setItems] = useState<DecisionOutcomeReviewItem[]>([]);
  const [nextCursor, setNextCursor] = useState<QueueCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyOutcomeId, setBusyOutcomeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const mutationBusy = useRef(false);

  const loadQueue = useCallback(async ({
    append = false,
    cursor = null,
  }: {
    append?: boolean;
    cursor?: QueueCursor | null;
  } = {}) => {
    const requestId = ++requestSequence.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      state: "pending_review",
      limit: "20",
    });
    if (cursor) {
      params.set("cursorAt", cursor.at);
      params.set("cursorId", cursor.id);
    }

    try {
      const response = await fetch(
        `/api/admin/community/decision-outcomes?${params.toString()}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const body = await readJson(response);
      if (response.status === 401 || response.status === 403) {
        window.location.replace("/admin/login");
        return false;
      }
      if (!response.ok) {
        throw new Error(readErrorMessage(
          body,
          "결과 검수 대기열을 불러오지 못했습니다.",
        ));
      }

      const queue = parseDecisionOutcomeReviewQueue(body, "pending_review");
      if (!queue) {
        throw new Error("대기열 응답을 안전하게 확인하지 못했습니다. 다시 불러와 주세요.");
      }
      if (requestId !== requestSequence.current) return false;

      const incoming = queue.items as DecisionOutcomeReviewItem[];
      setItems((current) => {
        if (!append) return incoming;
        const seen = new Set(current.map((item) => item.outcomeId));
        return [...current, ...incoming.filter((item) => !seen.has(item.outcomeId))];
      });
      setNextCursor(queue.nextCursor);
      setHasMore(queue.hasMore);
      return true;
    } catch (caught) {
      if (requestId !== requestSequence.current) return false;
      setError(
        caught instanceof Error
          ? caught.message
          : "결과 검수 대기열을 불러오지 못했습니다.",
      );
      return false;
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadQueue();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadQueue]);

  function updateReason(outcomeId: string, value: string) {
    setReasons((current) => ({ ...current, [outcomeId]: value }));
    setError(null);
    setNotice(null);
    setConfirmation((current) => (
      current?.outcomeId === outcomeId ? null : current
    ));
  }

  function stageReview(item: DecisionOutcomeReviewItem, decision: ReviewDecision) {
    const reason = (reasons[item.outcomeId] ?? "").trim();
    setError(null);
    setNotice(null);

    if (
      decision === "publish"
      && (!item.sourceAvailable || item.selectedEvidence.length === 0)
    ) {
      setError(
        item.sourceAvailable
          ? "선택 근거가 없어 공개 승인할 수 없습니다."
          : "원문 또는 선택 근거가 공개 가능한 상태가 아니어서 승인할 수 없습니다.",
      );
      return;
    }
    if (reason.length < REVIEW_REASON_MIN_LENGTH) {
      setError(`검수자가 직접 확인한 사유를 ${REVIEW_REASON_MIN_LENGTH}자 이상 입력해 주세요.`);
      return;
    }

    setConfirmation({ outcomeId: item.outcomeId, decision, reason });
  }

  async function submitReview(item: DecisionOutcomeReviewItem) {
    if (
      !confirmation
      || confirmation.outcomeId !== item.outcomeId
      || mutationBusy.current
    ) return;
    if (
      confirmation.decision === "publish"
      && (!item.sourceAvailable || item.selectedEvidence.length === 0)
    ) {
      setConfirmation(null);
      setError(
        item.sourceAvailable
          ? "선택 근거가 없어 공개 승인할 수 없습니다."
          : "원문 또는 선택 근거가 공개 가능한 상태가 아니어서 승인할 수 없습니다.",
      );
      return;
    }

    const operationKey = newOperationKey();
    if (!operationKey) {
      setError("안전한 요청 식별자를 만들지 못했습니다. 브라우저를 새로고침해 주세요.");
      return;
    }

    mutationBusy.current = true;
    setBusyOutcomeId(item.outcomeId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/admin/community/decision-outcomes/${encodeURIComponent(item.outcomeId)}/review`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": operationKey,
          },
          body: JSON.stringify({
            decision: confirmation.decision,
            reason: confirmation.reason,
            policyVersion: REVIEW_POLICY_VERSION,
          }),
        },
      );
      const body = await readJson(response);
      if (response.status === 401 || response.status === 403) {
        window.location.replace("/admin/login");
        return;
      }
      if (!response.ok) {
        throw new Error(readErrorMessage(
          body,
          "검수 결과를 기록하지 못했습니다. 목록을 새로고침한 뒤 다시 확인해 주세요.",
        ));
      }

      const expectedPublicationState = confirmation.decision === "publish"
        ? "published"
        : "rejected";
      const receipt = parseDecisionOutcomeReviewReceipt(body, {
        operationKey,
        outcomeId: item.outcomeId,
        publicationState: expectedPublicationState,
      });
      if (!receipt) {
        throw new Error("검수 결과가 정확히 기록됐는지 확인하지 못했습니다. 대기열을 새로고침해 주세요.");
      }

      const completedDecision = confirmation.decision;
      setConfirmation(null);
      setReasons((current) => {
        const next = { ...current };
        delete next[item.outcomeId];
        return next;
      });
      setItems((current) => current.filter(
        (candidate) => candidate.outcomeId !== item.outcomeId,
      ));
      const refreshed = await loadQueue();
      if (refreshed) {
        setNotice(
          completedDecision === "publish"
            ? "사람 검수 승인과 공개 상태를 기록하고 대기열을 갱신했습니다."
            : "반려 사유를 기록하고 대기열을 갱신했습니다.",
        );
      } else {
        setNotice(
          completedDecision === "publish"
            ? "사람 검수 승인은 기록됐습니다. 대기열은 새로고침해 다시 확인해 주세요."
            : "반려 사유는 기록됐습니다. 대기열은 새로고침해 다시 확인해 주세요.",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "검수 결과를 기록하지 못했습니다.",
      );
    } finally {
      mutationBusy.current = false;
      setBusyOutcomeId(null);
    }
  }

  const initialFailure = !loading && items.length === 0 && error !== null;

  return (
    <main className="min-h-screen bg-[#FBF8F2] px-4 py-6 text-[#243832] sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7 flex flex-col gap-4 border-b border-[#E2D3C8] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/admin/community"
              className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#36534E] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#36534E]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              커뮤니티 운영
            </Link>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8F6662]">
              Human publication review
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
              결정 결과 공개 검수
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6F6A62]">
              공개를 요청한 결과만 사람 검수자가 원문·선택 근거·상업관계를 직접
              확인합니다. 이 화면은 자동 승인이나 정확성 보장을 주장하지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              void loadQueue();
            }}
            disabled={loading || loadingMore || busyOutcomeId !== null}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[#36534E] hover:bg-[#F3F7F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534E] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCcw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            대기열 새로고침
          </button>
        </header>

        <section
          aria-labelledby="review-policy-heading"
          className="mb-6 border-l-4 border-[#36534E] bg-[#F3F7F2] px-5 py-4"
        >
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#36534E]" aria-hidden="true" />
            <div>
              <h2 id="review-policy-heading" className="text-sm font-semibold">
                검수 기준 {REVIEW_POLICY_VERSION}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#5D6963]">
                원문이나 선택 근거가 비공개·삭제 상태이면 공개 승인을 막습니다.
                승인과 반려 모두 검수자가 직접 작성한 사유가 감사 기록에 남습니다.
              </p>
            </div>
          </div>
        </section>

        {error && !initialFailure && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-3 border border-[#E9B9AD] bg-[#FFF3F0] px-4 py-3 text-sm leading-6 text-[#8B3326]"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="mb-5 flex items-start gap-3 border border-[#BCD4C4] bg-[#F0F8F2] px-4 py-3 text-sm leading-6 text-[#27583A]"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        {loading && items.length === 0 ? (
          <section
            className="border border-[#E2D3C8] bg-white px-6 py-16 text-center"
            aria-live="polite"
          >
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-[#36534E]" aria-hidden="true" />
            <p className="mt-3 text-sm text-[#6F6A62]">검수할 결과를 불러오고 있습니다.</p>
          </section>
        ) : initialFailure ? (
          <section className="border border-[#E9B9AD] bg-white px-6 py-14 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-[#A63C2C]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold">대기열을 확인하지 못했습니다.</h2>
            <p role="alert" className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#6F6A62]">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="mt-5 min-h-11 rounded-xl bg-[#36534E] px-5 text-sm font-semibold text-white hover:bg-[#29423E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534E]"
            >
              다시 불러오기
            </button>
          </section>
        ) : items.length === 0 ? (
          <section className="border border-dashed border-[#C7D1C2] bg-white px-6 py-16 text-center">
            <FileCheck2 className="mx-auto h-8 w-8 text-[#6D806E]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold">현재 공개 검수 대기 결과가 없습니다.</h2>
            <p className="mt-2 text-sm leading-6 text-[#6F6A62]">
              새 공개 요청이 들어오면 원문과 근거를 확인한 뒤 이곳에서 처리할 수 있습니다.
            </p>
          </section>
        ) : (
          <section aria-label="공개 검수 대기 결과" className="space-y-5">
            {items.map((item) => {
              const reason = reasons[item.outcomeId] ?? "";
              const isBusy = busyOutcomeId === item.outcomeId;
              const isConfirming = confirmation?.outcomeId === item.outcomeId;
              const canPublish = item.sourceAvailable && item.selectedEvidence.length > 0;
              const publishBlockId = `publish-block-${item.outcomeId}`;
              const reasonHelpId = `reason-help-${item.outcomeId}`;

              return (
                <article
                  key={item.outcomeId}
                  className="border border-[#E2D3C8] bg-white"
                  aria-labelledby={`outcome-title-${item.outcomeId}`}
                >
                  <div className="flex flex-col gap-4 border-b border-[#EFE4D7] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6F6A62]">
                        <span>{item.authorNickname}</span>
                        <span>수정본 {item.revision}</span>
                        <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                      </div>
                      <h2
                        id={`outcome-title-${item.outcomeId}`}
                        className="mt-2 break-words text-lg font-semibold leading-7"
                      >
                        {item.title}
                      </h2>
                    </div>
                    <div
                      className={
                        item.sourceAvailable
                          ? "inline-flex shrink-0 items-center gap-2 bg-[#EEF5EE] px-3 py-2 text-xs font-semibold text-[#36534E]"
                          : "inline-flex shrink-0 items-center gap-2 bg-[#FFF2EE] px-3 py-2 text-xs font-semibold text-[#A63C2C]"
                      }
                    >
                      {item.sourceAvailable ? (
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                      )}
                      {item.sourceAvailable ? "출처 공개 가능" : "출처 공개 불가"}
                    </div>
                  </div>

                  <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                    <div className="space-y-5 border-b border-[#EFE4D7] px-5 py-6 xl:border-b-0 xl:border-r sm:px-6">
                      <section aria-labelledby={`source-heading-${item.outcomeId}`}>
                        <h3
                          id={`source-heading-${item.outcomeId}`}
                          className="text-sm font-semibold text-[#36534E]"
                        >
                          질문과 요청
                        </h3>
                        <dl className="mt-4 space-y-4">
                          <FieldBlock label="원문">{item.sourceContent}</FieldBlock>
                          <FieldBlock label="원하는 답">{item.desiredAnswer}</FieldBlock>
                        </dl>
                      </section>

                      <section aria-labelledby={`evidence-heading-${item.outcomeId}`}>
                        <h3
                          id={`evidence-heading-${item.outcomeId}`}
                          className="text-sm font-semibold text-[#36534E]"
                        >
                          선택 근거
                        </h3>
                        {item.selectedEvidence.length > 0 ? (
                          <ul className="mt-4">
                            {item.selectedEvidence.map((evidence, index) => (
                              <EvidenceCard
                                key={`${item.outcomeId}-evidence-${index}`}
                                evidence={evidence}
                                index={index}
                              />
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-3 text-sm text-[#A63C2C]">
                            선택 근거가 없어 공개 승인할 수 없습니다.
                          </p>
                        )}
                      </section>
                    </div>

                    <div className="space-y-5 px-5 py-6 sm:px-6">
                      <section aria-labelledby={`result-heading-${item.outcomeId}`}>
                        <h3
                          id={`result-heading-${item.outcomeId}`}
                          className="text-sm font-semibold text-[#36534E]"
                        >
                          결정과 결과
                        </h3>
                        <dl className="mt-4 space-y-4">
                          <FieldBlock label="실행한 선택">{item.actionTaken}</FieldBlock>
                          <FieldBlock label="결과" tone="result">
                            {item.resultSummary}
                          </FieldBlock>
                          <FieldBlock label="이 결과가 적용되는 조건">
                            {item.applicableConditions}
                          </FieldBlock>
                        </dl>
                      </section>

                      <section
                        className="border-t border-[#EFE4D7] pt-5"
                        aria-labelledby={`relationship-heading-${item.outcomeId}`}
                      >
                        <h3
                          id={`relationship-heading-${item.outcomeId}`}
                          className="text-sm font-semibold text-[#36534E]"
                        >
                          상업관계 공개
                        </h3>
                        <p className="mt-2 text-sm leading-6">
                          {relationshipLabel(item.commercialRelationship)}
                          {item.sponsorshipDetail ? ` · ${item.sponsorshipDetail}` : ""}
                        </p>
                      </section>

                      {!canPublish && (
                        <div
                          id={publishBlockId}
                          role="status"
                          className="flex items-start gap-3 border border-[#E9B9AD] bg-[#FFF3F0] px-4 py-3 text-sm leading-6 text-[#8B3326]"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>
                            {item.sourceAvailable
                              ? "선택 근거가 없어 공개 승인할 수 없습니다. 반려 사유를 기록해 주세요."
                              : "원문 또는 선택 근거가 현재 공개 가능한 상태가 아닙니다. 공개 승인은 막혀 있으며 반려만 기록할 수 있습니다."}
                          </span>
                        </div>
                      )}

                      <div className="border-t border-[#EFE4D7] pt-5">
                        <label
                          htmlFor={`review-reason-${item.outcomeId}`}
                          className="text-sm font-semibold text-[#36534E]"
                        >
                          사람이 확인한 검수 사유
                        </label>
                        <textarea
                          id={`review-reason-${item.outcomeId}`}
                          value={reason}
                          onChange={(event) => updateReason(item.outcomeId, event.target.value)}
                          rows={4}
                          minLength={REVIEW_REASON_MIN_LENGTH}
                          maxLength={REVIEW_REASON_MAX_LENGTH}
                          disabled={busyOutcomeId !== null}
                          aria-describedby={reasonHelpId}
                          placeholder="예: 원문과 선택 근거, 상업관계 공개 범위를 직접 확인했습니다."
                          className="mt-2 w-full resize-y rounded-xl border border-[#C7D1C2] bg-white px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-[#9B958B] focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15 disabled:bg-[#F5F2ED]"
                        />
                        <div
                          id={reasonHelpId}
                          className="mt-1 flex items-center justify-between gap-3 text-xs text-[#6F6A62]"
                        >
                          <span>자동 문구 없이 직접 확인한 내용을 3자 이상 작성하세요.</span>
                          <span aria-label={`${reason.length}자 입력됨`}>
                            {reason.length}/{REVIEW_REASON_MAX_LENGTH}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => stageReview(item, "reject")}
                            disabled={busyOutcomeId !== null}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#D8A8A0] bg-white px-4 text-sm font-semibold text-[#9A3F35] hover:bg-[#FFF3F0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A63C2C] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <XCircle className="h-4 w-4" aria-hidden="true" />
                            반려 검토
                          </button>
                          <button
                            type="button"
                            onClick={() => stageReview(item, "publish")}
                            disabled={!canPublish || busyOutcomeId !== null}
                            aria-describedby={!canPublish ? publishBlockId : undefined}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#36534E] px-4 text-sm font-semibold text-white hover:bg-[#29423E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534E] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            공개 승인 검토
                          </button>
                        </div>
                      </div>

                      {isConfirming && confirmation && (
                        <section
                          role="region"
                          aria-labelledby={`confirm-heading-${item.outcomeId}`}
                          className={
                            confirmation.decision === "publish"
                              ? "border-2 border-[#6D806E] bg-[#F4F8F3] p-4"
                              : "border-2 border-[#D8A8A0] bg-[#FFF7F5] p-4"
                          }
                        >
                          <h3
                            id={`confirm-heading-${item.outcomeId}`}
                            className="font-semibold"
                          >
                            {confirmation.decision === "publish"
                              ? "공개 승인 최종 확인"
                              : "반려 최종 확인"}
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-[#5D6963]">
                            {confirmation.decision === "publish"
                              ? "이 결과의 검수된 공개본이 커뮤니티에 표시될 수 있습니다. 원문·근거·상업관계를 다시 확인하세요."
                              : "이 결과는 공개되지 않으며 아래 사유가 감사 기록에 남습니다."}
                          </p>
                          <blockquote className="mt-3 border-l-2 border-current/25 pl-3 text-sm leading-6">
                            {confirmation.reason}
                          </blockquote>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmation(null)}
                              disabled={isBusy}
                              className="min-h-11 rounded-xl border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[#36534E] disabled:opacity-50"
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              onClick={() => void submitReview(item)}
                              disabled={busyOutcomeId !== null}
                              aria-busy={isBusy}
                              className={
                                confirmation.decision === "publish"
                                  ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#36534E] px-4 text-sm font-semibold text-white disabled:opacity-50"
                                  : "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#9A3F35] px-4 text-sm font-semibold text-white disabled:opacity-50"
                              }
                            >
                              {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                              {isBusy
                                ? "기록 중"
                                : confirmation.decision === "publish"
                                  ? "공개 승인 확정"
                                  : "반려 확정"}
                            </button>
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            {hasMore && nextCursor && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => void loadQueue({ append: true, cursor: nextCursor })}
                  disabled={loadingMore || busyOutcomeId !== null}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#C7D1C2] bg-white px-5 text-sm font-semibold text-[#36534E] hover:bg-[#F3F7F2] disabled:opacity-50"
                >
                  {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {loadingMore ? "불러오는 중" : "대기 결과 더 불러오기"}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
