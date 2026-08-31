"use client";

import {
  parseCommunityDecisionFeed,
  parseCommunityDecisionInbox,
  type CommunityDecisionFeed,
  type CommunityDecisionFeedItem,
  type CommunityDecisionFeedMode,
  type CommunityDecisionInbox,
} from "@hanbang/shared/community-decision-feed";
import { ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { communityPostLinkProps } from "@/lib/community/routes";

const shell = "mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8";
const DECISION_REQUEST_TIMEOUT_MS = 8_000;

const MODE_OPTIONS: ReadonlyArray<{
  mode: CommunityDecisionFeedMode;
  label: string;
}> = [
  { mode: "for_you", label: "둘러보기" },
  { mode: "needs_help", label: "내 경험 필요" },
  { mode: "outcomes", label: "결과" },
];

const EXPERIENCE_LABELS: Record<CommunityDecisionFeedItem["experienceScope"], string> = {
  contract_terms: "계약 조건",
  extra_charge: "추가금",
  vendor_response: "업체 대응",
  cancellation_refund: "취소·환불",
};

const STAGE_LABELS: Record<CommunityDecisionFeedItem["preparationStage"], string> = {
  vendor_search: "업체를 찾는 중",
  contract_review: "계약을 검토하는 중",
  contracted: "계약한 뒤",
  dispute_or_cancellation: "분쟁·취소를 알아보는 중",
};

const CONTRACT_PHASE_LABELS: Record<CommunityDecisionFeedItem["contractPhase"], string> = {
  before_contract: "계약 전",
  after_contract: "계약 후",
  cancellation_or_refund: "취소·환불 단계",
};

const STATE_LABELS: Record<CommunityDecisionFeedItem["state"], string> = {
  open: "답변 기다리는 중",
  answered: "사람 답변 도착",
  resolved: "결정 정리됨",
  followup_scheduled: "결과를 기다리는 중",
  completed: "결과가 돌아옴",
  closed: "종료됨",
};

const RELATIONSHIP_LABELS: Record<
  Exclude<CommunityDecisionFeedItem["commercialRelationship"], "none">,
  string
> = {
  gift: "제품·서비스 제공",
  discount: "할인 제공",
  refund: "환불 관계",
  affiliate: "제휴 관계",
  paid: "유료 협업",
  employee: "업체 직원",
  owner_or_family: "업체 소유·가족 관계",
  platform_research_compensation: "플랫폼 조사 보상",
};

type FeedViewState =
  | { ownerKey: string; mode: CommunityDecisionFeedMode; status: "loading"; feed: null }
  | { ownerKey: string; mode: CommunityDecisionFeedMode; status: "ready"; feed: CommunityDecisionFeed }
  | { ownerKey: string; mode: CommunityDecisionFeedMode; status: "error"; feed: null };

type InboxViewState = {
  ownerKey: string;
  inbox: CommunityDecisionInbox | null;
};

function inboxSummary(inbox: CommunityDecisionInbox): string | null {
  const parts: string[] = [];
  if (inbox.waitingReplies.count > 0) {
    parts.push(`답변을 기다리는 내 질문 ${inbox.waitingReplies.count}개`);
  }
  if (inbox.experienceNeeded.count > 0) {
    parts.push(`내 경험이 필요한 질문 ${inbox.experienceNeeded.count}개`);
  }
  if (inbox.returnedOutcomes.count > 0) {
    parts.push(`돌아온 결과 ${inbox.returnedOutcomes.count}개`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function emptyMessage(mode: CommunityDecisionFeedMode): string {
  if (mode === "needs_help") {
    return "지금 내 경험을 기다리는 공개 질문이 없어요.";
  }
  if (mode === "outcomes") {
    return "아직 공개할 수 있는 검토된 결과가 없어요.";
  }
  return "아직 공개된 결정 질문이 없어요. 아래 최신 글은 계속 볼 수 있어요.";
}

function DecisionItem({ item }: { item: CommunityDecisionFeedItem }) {
  const relationship = item.commercialRelationship === "none"
    ? null
    : RELATIONSHIP_LABELS[item.commercialRelationship];
  const outcomeRelationship = item.outcome?.commercialRelationship === "none"
    || !item.outcome
    ? null
    : RELATIONSHIP_LABELS[item.outcome.commercialRelationship];

  return (
    <li className="border-t border-[var(--hb-hairline)] first:border-t-0">
      <Link
        {...communityPostLinkProps(item.postId)}
        aria-label={`${item.title} 결정 질문 보기`}
        className="group block px-4 py-4 transition-colors hover:bg-[var(--hb-surface-page)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--hb-primary)] sm:px-5"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold">
          <span className="text-[var(--hb-text-strong)]">회원이 직접 작성</span>
          <span aria-hidden className="text-[var(--hb-text-muted)]">·</span>
          <span className="text-[var(--hb-text-body)]">{item.author.nickname}</span>
          {item.author.badge && (
            <span className="rounded-full bg-[var(--hb-surface-hover)] px-2 py-0.5 text-[var(--hb-text-body)]">
              {item.author.badge}
            </span>
          )}
          {item.viewer.isAuthor && (
            <span className="rounded-full bg-rose-pale px-2 py-0.5 text-[var(--hb-accent-hover)]">
              내 질문
            </span>
          )}
          <span className="ml-auto rounded-full bg-sage-pale/55 px-2.5 py-1 text-[var(--hb-text-strong)]">
            {STATE_LABELS[item.state]}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="질문의 조건">
          <span className="rounded-full border border-[var(--hb-hairline)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--hb-text-body)]">
            {EXPERIENCE_LABELS[item.experienceScope]}
          </span>
          <span className="rounded-full border border-[var(--hb-hairline)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--hb-text-body)]">
            {STAGE_LABELS[item.preparationStage]}
          </span>
          <span className="rounded-full border border-[var(--hb-hairline)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--hb-text-body)]">
            {CONTRACT_PHASE_LABELS[item.contractPhase]}
          </span>
          {item.coarseRegion && (
            <span className="rounded-full border border-[var(--hb-hairline)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--hb-text-body)]">
              {item.coarseRegion}
            </span>
          )}
          {relationship && (
            <span className="rounded-full border border-gold-light bg-[var(--hb-surface-hover)] px-2.5 py-1 text-[11px] font-semibold text-[var(--hb-accent-hover)]">
              관계 공개 · {relationship}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[var(--hb-text-strong)]">
              {item.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-[1.65] text-[var(--hb-text-body)]">
              {item.content}
            </p>
            <p className="mt-2 text-[12px] font-semibold leading-[1.55] text-[var(--hb-text-strong)]">
              궁금한 점 · {item.desiredAnswer}
            </p>
            {relationship && item.sponsorshipDetail && (
              <p className="mt-1 line-clamp-1 text-[11px] leading-[1.55] text-[var(--hb-accent-hover)]">
                관계 설명 · {item.sponsorshipDetail}
              </p>
            )}
          </div>
          <ChevronRight
            aria-hidden
            className="mt-1 h-4 w-4 shrink-0 text-[var(--hb-text-muted)] transition-transform group-hover:translate-x-0.5"
          />
        </div>

        {item.outcome && (
          <div className="mt-3 border-l-2 border-sage-500 bg-[var(--hb-surface-page)] px-3 py-2.5">
            <p className="text-[11px] font-semibold text-[var(--hb-success)]">
              작성자가 돌아와 남긴 결과
            </p>
            {outcomeRelationship && (
              <p className="mt-1 text-[11px] font-semibold leading-[1.55] text-[var(--hb-accent-hover)]">
                결과 관계 공개 · {outcomeRelationship}
              </p>
            )}
            <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-[1.55] text-[var(--hb-text-strong)]">
              {item.outcome.resultSummary}
            </p>
            <p className="mt-1 line-clamp-1 text-[11px] text-[var(--hb-text-body)]">
              적용 조건 · {item.outcome.applicableConditions}
            </p>
            {outcomeRelationship && item.outcome.sponsorshipDetail && (
              <p className="mt-1 line-clamp-2 text-[11px] leading-[1.55] text-[var(--hb-accent-hover)]">
                결과 관계 설명 · {item.outcome.sponsorshipDetail}
              </p>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ivory-100 pt-2.5 text-[11px] font-medium text-[var(--hb-text-body)]">
          <span>경험 답변 {item.qualifiedPeerAnswerCount}개</span>
          <span>전문 답변 {item.qualifiedProfessionalAnswerCount}개</span>
          {item.viewer.canAnswer && (
            <span className="font-semibold text-[var(--hb-accent-hover)]">내 경험을 나눌 수 있어요</span>
          )}
        </div>
      </Link>
    </li>
  );
}

export default function CommunityDecisionDiscovery({
  viewerId,
}: {
  viewerId: string | null;
}) {
  const viewerKey = viewerId ?? "guest";
  const currentViewerRef = useRef(viewerKey);
  currentViewerRef.current = viewerKey;
  const feedCacheRef = useRef(new Map<CommunityDecisionFeedMode, CommunityDecisionFeed>());
  const requestSequenceRef = useRef(0);
  const [activeMode, setActiveMode] = useState<CommunityDecisionFeedMode>("for_you");
  const [retryVersion, setRetryVersion] = useState(0);
  const [viewState, setViewState] = useState<FeedViewState>({
    ownerKey: viewerKey,
    mode: "for_you",
    status: "loading",
    feed: null,
  });
  const [inboxState, setInboxState] = useState<InboxViewState>({
    ownerKey: viewerKey,
    inbox: null,
  });

  useEffect(() => {
    requestSequenceRef.current += 1;
    feedCacheRef.current.clear();
    setActiveMode("for_you");
    setViewState({
      ownerKey: viewerKey,
      mode: "for_you",
      status: "loading",
      feed: null,
    });
    setInboxState({ ownerKey: viewerKey, inbox: null });
  }, [viewerKey]);

  useEffect(() => {
    const cached = feedCacheRef.current.get(activeMode);
    if (cached) {
      setViewState({
        ownerKey: viewerKey,
        mode: activeMode,
        status: "ready",
        feed: cached,
      });
      return;
    }

    const expectedViewer = viewerKey;
    const sequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DECISION_REQUEST_TIMEOUT_MS);
    setViewState({
      ownerKey: viewerKey,
      mode: activeMode,
      status: "loading",
      feed: null,
    });

    void (async () => {
      try {
        const response = await fetch(
          `/api/community/decision-threads?mode=${activeMode}&limit=5`,
          {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        const payload = await response.json().catch(() => null) as unknown;
        const parsed = parseCommunityDecisionFeed(payload, activeMode);
        if (!response.ok || !parsed) throw new Error("decision feed unavailable");
        if (
          !controller.signal.aborted
          && sequence === requestSequenceRef.current
          && currentViewerRef.current === expectedViewer
        ) {
          feedCacheRef.current.set(activeMode, parsed);
          setViewState({
            ownerKey: expectedViewer,
            mode: activeMode,
            status: "ready",
            feed: parsed,
          });
        }
      } catch (error) {
        const wasAborted = error instanceof DOMException && error.name === "AbortError";
        if (
          (!wasAborted || timedOut)
          && (!controller.signal.aborted || timedOut)
          && sequence === requestSequenceRef.current
          && currentViewerRef.current === expectedViewer
        ) {
          setViewState({
            ownerKey: expectedViewer,
            mode: activeMode,
            status: "error",
            feed: null,
          });
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeMode, retryVersion, viewerKey]);

  useEffect(() => {
    setInboxState({ ownerKey: viewerKey, inbox: null });
    if (!viewerId) return;

    const expectedViewer = viewerKey;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      DECISION_REQUEST_TIMEOUT_MS,
    );
    void (async () => {
      try {
        const response = await fetch("/api/community/decision-threads/inbox", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as unknown;
        const parsed = parseCommunityDecisionInbox(payload);
        if (
          response.ok
          && parsed
          && !controller.signal.aborted
          && currentViewerRef.current === expectedViewer
        ) {
          setInboxState({ ownerKey: expectedViewer, inbox: parsed });
        }
      } catch {
        // 알림함 실패가 공개 피드와 기존 커뮤니티 글을 가리지 않게 조용히 복구한다.
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [viewerId, viewerKey]);

  const currentViewState = viewState.ownerKey === viewerKey
    ? viewState
    : {
        ownerKey: viewerKey,
        mode: activeMode,
        status: "loading" as const,
        feed: null,
      };
  const hasEarlierFeed = feedCacheRef.current.size > 0;
  if (currentViewState.status === "error" && !hasEarlierFeed) return null;

  const inbox = inboxState.ownerKey === viewerKey ? inboxState.inbox : null;
  const summary = inbox ? inboxSummary(inbox) : null;
  const items = currentViewState.status === "ready" ? currentViewState.feed.items : [];

  return (
    <section
      className={`${shell} mt-2`}
      aria-labelledby="community-decision-discovery-title"
      data-community-decision-discovery
    >
      <div className="overflow-hidden rounded-[6px] border border-[var(--hb-hairline)] bg-white/90 shadow-[var(--shadow-raised)]">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.04em] text-[var(--hb-accent-hover)]">
              사람의 실제 경험
            </p>
            <h2
              id="community-decision-discovery-title"
              className="mt-0.5 text-[var(--hb-text-strong)]"
            >
              계약·추가금 결정 질문
            </h2>
            <p className="mt-1 hidden text-[12px] font-medium text-[var(--hb-text-body)] sm:block">
              상황과 조건, 답변 상태를 먼저 보고 필요한 경험을 확인하세요.
            </p>
          </div>

          <div
            role="group"
            aria-label="결정 질문 보기"
            className="flex w-full rounded-full bg-[var(--hb-surface-hover)] p-1 sm:w-auto"
          >
            {MODE_OPTIONS.map((option) => {
              const selected = activeMode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveMode(option.mode)}
                  className={`min-h-9 flex-1 rounded-[6px] px-3 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] focus-visible:ring-offset-1 sm:flex-none ${
                    selected
                      ? "bg-[var(--hb-primary)] text-white shadow-sm"
                      : "text-[var(--hb-text-body)] hover:bg-white hover:text-[var(--hb-text-strong)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {summary && (
          <p
            role="status"
            className="overflow-x-auto whitespace-nowrap border-t border-ivory-100 bg-[var(--hb-surface-page)] px-4 py-2 text-[11px] font-semibold text-[var(--hb-text-strong)] sm:px-5"
          >
            내 결정함 · {summary}
          </p>
        )}

        <div
          aria-live="polite"
          aria-busy={currentViewState.status === "loading"}
          data-decision-feed-state={currentViewState.status}
        >
          {currentViewState.status === "loading" ? (
            <div className="flex items-center gap-3 border-t border-ivory-100 px-4 py-3 sm:px-5">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sage-pale" aria-hidden />
              <span className="text-[12px] font-medium text-[var(--hb-text-body)]">
                결정 질문을 불러오는 중이에요.
              </span>
            </div>
          ) : currentViewState.status === "error" ? (
            <div className="flex min-h-12 items-center justify-between gap-3 border-t border-ivory-100 px-4 py-2 sm:px-5">
              <p className="text-[12px] font-medium text-[var(--hb-text-body)]">
                이 목록을 불러오지 못했어요. 아래 최신 글은 계속 볼 수 있어요.
              </p>
              <button
                type="button"
                onClick={() => setRetryVersion((current) => current + 1)}
                className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[6px] px-3 text-[12px] font-semibold text-[var(--hb-text-strong)] hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)]"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                다시 불러오기
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="border-t border-ivory-100 px-4 py-3 text-[12px] font-medium text-[var(--hb-text-body)] sm:px-5">
              {emptyMessage(activeMode)}
            </p>
          ) : (
            <ul aria-label={`${MODE_OPTIONS.find((option) => option.mode === activeMode)?.label} 결정 질문`}>
              {items.map((item) => (
                <DecisionItem key={item.threadId} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
