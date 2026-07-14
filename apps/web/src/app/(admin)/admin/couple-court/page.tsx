"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  EyeOff,
  Flag,
  Gavel,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { COURT_CATEGORY_CATALOG } from "@/lib/coupleCourt/catalog";

interface ModerationSnapshot {
  snapshotVersion: string;
  category: string;
  mode: string;
  provisional: boolean;
  safeTitle: string;
  oneLine: string;
  resultLabel: string;
  hashtags: string[];
}

interface ModerationPost {
  id: string;
  snapshot: ModerationSnapshot;
  snapshotVersion: number | null;
  status: string | null;
  moderationStatus: string | null;
  moderationReasonCode: string | null;
  commentsEnabled: boolean;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ModerationComment {
  id: string;
  publicPostId: string;
  commentType: string | null;
  body: string;
  moderationStatus: string | null;
  createdAt: string | null;
}

interface ModerationReport {
  id: string;
  publicPostId: string;
  commentId: string | null;
  targetType: string | null;
  reasonCode: string | null;
  status: string | null;
  createdAt: string | null;
}

interface ProviderReconciliation {
  verdictId: string;
  providerState: string | null;
  startedAt: string | null;
  failedAt: string | null;
  errorCode: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ProviderAuditRecovery {
  providerState: "result_staged" | "failed_invalid";
  errorCode: string | null;
  pendingAt: string;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
}

interface ProviderDeletionHandoff {
  verdictId: string;
  createdAt: string;
  expiresAt: string;
}

interface RevealedProviderRequestKey {
  requestKey: string;
  revealedAt: string;
}

interface ProviderDeletionResolutionDraft {
  auditModel: string;
  inputTokens: string;
  outputTokens: string;
  cachedInputTokens: string;
  cacheWriteInputTokens: string;
  costUsd: string;
}

interface ModerationQueue {
  posts: ModerationPost[];
  comments: ModerationComment[];
  reports: ModerationReport[];
  reportedComments: ModerationComment[];
  providerReconciliations: ProviderReconciliation[];
  providerAuditRecoveries: ProviderAuditRecovery[];
  providerDeletionHandoffs: ProviderDeletionHandoff[];
  truncated: {
    posts: boolean;
    comments: boolean;
    reports: boolean;
    providerReconciliations: boolean;
    providerAuditRecoveries: boolean;
    providerDeletionHandoffs: boolean;
  };
}

const PROVIDER_RETRY_CONFIRMATION = "ALLOW_RETRY_AFTER_PROVIDER_REVIEW";
const PROVIDER_NO_CHARGE_CONFIRMATION = "CONFIRM_PROVIDER_NO_CHARGE";
const PROVIDER_PAID_CONFIRMATION = "CONFIRM_PROVIDER_PAID";
const PROVIDER_REQUEST_KEY_REVEAL_CONFIRMATION = "REVEAL_PROVIDER_REQUEST_KEY";
const PROVIDER_MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const EMPTY_PROVIDER_DELETION_DRAFT: ProviderDeletionResolutionDraft = {
  auditModel: "",
  inputTokens: "",
  outputTokens: "",
  cachedInputTokens: "",
  cacheWriteInputTokens: "",
  costUsd: "",
};
const PROVIDER_REASON_OPTIONS = [
  ["provider_dashboard_not_found", "제공사 대시보드에서 요청 없음"],
  ["provider_dashboard_failed", "제공사 대시보드에서 실패 확정"],
  ["provider_support_approved_retry", "제공사 지원팀이 재시도 승인"],
] as const;

const REASON_OPTIONS = [
  ["policy_violation", "운영 정책 위반"],
  ["pii", "개인정보 노출"],
  ["harassment", "괴롭힘·모욕"],
  ["threat", "위협 표현"],
  ["hate", "혐오 표현"],
  ["spam", "스팸"],
  ["minor_safety", "미성년자 안전"],
  ["unsafe_content", "안전하지 않은 내용"],
  ["consent_issue", "공개 동의 문제"],
  ["abusive_content", "공격적인 내용"],
  ["off_topic", "주제와 무관"],
  ["duplicate", "중복"],
  ["no_violation", "위반 사항 없음"],
  ["other", "기타"],
] as const;

const CATEGORY_LABELS = Object.fromEntries(
  COURT_CATEGORY_CATALOG.map((category) => [category.id, category.label]),
) as Record<string, string>;

const COMMENT_TYPE_LABELS: Record<string, string> = {
  empathy: "공감",
  experience: "경험",
  practical_advice: "현실 조언",
  question: "질문",
};

const REPORT_REASON_LABELS: Record<string, string> = {
  harassment: "괴롭힘·모욕",
  pii: "개인정보 노출",
  threat: "위협 표현",
  hate: "혐오 표현",
  spam: "스팸",
  minor_safety: "미성년자 안전",
  other: "기타",
};

function formatDate(value: string | null): string {
  if (!value) return "시간 정보 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 정보 없음";
  return date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function parseOptionalProviderToken(value: string, label: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label}은(는) 0~10,000,000 범위의 정수로 입력해 주세요.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed > 10_000_000) {
    throw new Error(`${label}은(는) 0~10,000,000 범위의 정수로 입력해 주세요.`);
  }
  return parsed;
}

function parseOptionalProviderCost(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error("비용은 0 이상 9,999.999999 이하, 소수점 아래 최대 6자리로 입력해 주세요.");
  }
  return Number(normalized);
}

function paidProviderResolutionFields(draft: ProviderDeletionResolutionDraft) {
  const auditModel = draft.auditModel.trim();
  if (!PROVIDER_MODEL_PATTERN.test(auditModel)) {
    throw new Error("OpenAI 대시보드에 표시된 모델명을 입력해 주세요.");
  }
  const inputTokens = parseOptionalProviderToken(draft.inputTokens, "입력 토큰");
  const outputTokens = parseOptionalProviderToken(draft.outputTokens, "출력 토큰");
  const cachedInputTokens = parseOptionalProviderToken(
    draft.cachedInputTokens,
    "캐시 입력 토큰",
  );
  const cacheWriteInputTokens = parseOptionalProviderToken(
    draft.cacheWriteInputTokens,
    "캐시 쓰기 입력 토큰",
  );
  const costUsd = parseOptionalProviderCost(draft.costUsd);
  if (inputTokens === null || outputTokens === null) {
    throw new Error("유료 호출로 기록하려면 입력 토큰과 출력 토큰을 모두 입력해 주세요.");
  }
  if (
    (cachedInputTokens !== null && cachedInputTokens > inputTokens)
    || (cacheWriteInputTokens !== null && cacheWriteInputTokens > inputTokens)
  ) {
    throw new Error("캐시 토큰은 입력 토큰보다 클 수 없습니다.");
  }
  return {
    auditModel,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    costUsd,
  };
}

function ContextPost({ post }: { post: ModerationPost | undefined }) {
  if (!post) {
    return <p className="mt-3 text-sm text-rose-700">연결된 공개 스냅샷을 불러오지 못했습니다.</p>;
  }
  return (
    <div className="mt-3 rounded-xl bg-ivory-50 p-4">
      <p className="text-xs font-semibold text-taupe-500">
        {CATEGORY_LABELS[post.snapshot.category] ?? post.snapshot.category}
        {post.snapshot.provisional ? " · 1인 임시판결" : " · 커플 판결"}
      </p>
      <p className="mt-1 text-sm font-semibold text-noir-800">{post.snapshot.safeTitle}</p>
      <p className="mt-1 text-sm leading-6 text-taupe-600">{post.snapshot.oneLine}</p>
    </div>
  );
}

function ReasonSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">검토 사유</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="min-h-11 rounded-lg border border-platinum bg-white px-3 text-sm text-charcoal disabled:opacity-50"
      >
        {REASON_OPTIONS.map(([code, label]) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </select>
    </div>
  );
}

export default function CoupleCourtModerationPage() {
  const [queue, setQueue] = useState<ModerationQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [deletionDrafts, setDeletionDrafts] = useState<
    Record<string, ProviderDeletionResolutionDraft>
  >({});
  const [revealedRequestKeys, setRevealedRequestKeys] = useState<
    Record<string, RevealedProviderRequestKey>
  >({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadQueue = useCallback(async () => {
    // Provider request keys are intentionally ephemeral. Any queue refresh or
    // successful action drops every revealed key from React memory.
    setRevealedRequestKeys({});
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/couple-court", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const payload = await response.json() as Partial<ModerationQueue> & { error?: string };
      if (!response.ok || !Array.isArray(payload.posts)
        || !Array.isArray(payload.comments) || !Array.isArray(payload.reports)
        || !Array.isArray(payload.providerReconciliations)
        || !Array.isArray(payload.providerAuditRecoveries)
        || !Array.isArray(payload.providerDeletionHandoffs)) {
        throw new Error(payload.error ?? "검토 대기열을 불러오지 못했습니다.");
      }
      setQueue({
        posts: payload.posts,
        comments: payload.comments,
        reports: payload.reports,
        providerReconciliations: payload.providerReconciliations,
        providerAuditRecoveries: payload.providerAuditRecoveries,
        providerDeletionHandoffs: payload.providerDeletionHandoffs,
        reportedComments: Array.isArray(payload.reportedComments)
          ? payload.reportedComments
          : [],
        truncated: payload.truncated ?? {
          posts: false,
          comments: false,
          reports: false,
          providerReconciliations: false,
          providerAuditRecoveries: false,
          providerDeletionHandoffs: false,
        },
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "검토 대기열을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const postById = useMemo(
    () => new Map((queue?.posts ?? []).map((post) => [post.id, post])),
    [queue?.posts],
  );
  const reportedCommentById = useMemo(
    () => new Map((queue?.reportedComments ?? []).map((comment) => [comment.id, comment])),
    [queue?.reportedComments],
  );

  const reasonFor = (key: string, fallback = "policy_violation") => reasons[key] ?? fallback;
  const updateReason = (key: string, value: string) => {
    setReasons((current) => ({ ...current, [key]: value }));
  };
  const deletionDraftFor = (verdictId: string) => (
    deletionDrafts[verdictId] ?? EMPTY_PROVIDER_DELETION_DRAFT
  );
  const updateDeletionDraft = (
    verdictId: string,
    field: keyof ProviderDeletionResolutionDraft,
    value: string,
  ) => {
    setDeletionDrafts((current) => ({
      ...current,
      [verdictId]: {
        ...(current[verdictId] ?? EMPTY_PROVIDER_DELETION_DRAFT),
        [field]: value,
      },
    }));
  };

  const runAction = async (
    key: string,
    body: Record<string, unknown>,
    successMessage: string,
    confirmation?: string,
  ) => {
    if (confirmation && !window.confirm(confirmation)) return;
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/couple-court", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "검토 조치를 완료하지 못했습니다.");
      setNotice(successMessage);
      await loadQueue();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "검토 조치를 완료하지 못했습니다.");
    } finally {
      setBusyKey(null);
    }
  };

  const resolveProviderDeletionHandoff = (
    item: ProviderDeletionHandoff,
    decision: "confirm_no_charge" | "record_paid",
  ) => {
    let providerFields: ReturnType<typeof paidProviderResolutionFields> | undefined;
    if (decision === "record_paid") {
      try {
        providerFields = paidProviderResolutionFields(deletionDraftFor(item.verdictId));
      } catch (validationError) {
        setNotice("");
        setError(validationError instanceof Error
          ? validationError.message
          : "제공사 사용량 입력을 확인해 주세요.");
        return;
      }
    }

    const isNoCharge = decision === "confirm_no_charge";
    const firstConfirmed = window.confirm(isNoCharge
      ? "OpenAI 대시보드에서 이 요청이 없거나 청구되지 않았음을 직접 확인했나요? 이 정산은 되돌릴 수 없습니다."
      : "OpenAI 대시보드에서 유료 호출이 발생했음을 직접 확인하고 모델·사용량·비용을 대조했나요?");
    if (!firstConfirmed) return;

    const requiredConfirmation = isNoCharge
      ? PROVIDER_NO_CHARGE_CONFIRMATION
      : PROVIDER_PAID_CONFIRMATION;
    const confirmation = window.prompt(
      `마지막 확인입니다. 아래 문구를 정확히 입력하세요.\n\n${requiredConfirmation}`,
    );
    if (confirmation !== requiredConfirmation) {
      setNotice("");
      setError("고정 확인 문구가 일치하지 않아 삭제 사건의 제공사 정산을 기록하지 않았습니다.");
      return;
    }

    void runAction(
      `provider-deletion:${item.verdictId}:${decision}`,
      {
        target: "provider_deletion_handoff",
        id: item.verdictId,
        decision,
        confirmation,
        ...(providerFields ?? {}),
      },
      isNoCharge
        ? "OpenAI 청구 없음 확인을 기록했습니다."
        : "OpenAI 유료 호출을 기록하고 감사 장부 복구 대기열로 넘겼습니다.",
    );
  };

  const revealProviderRequestKey = async ({
    verdictId,
    target,
    stateKey,
    operationKey,
  }: {
    verdictId: string;
    target: "provider_deletion_handoff_reveal" | "provider_reconciliation_reveal";
    stateKey: string;
    operationKey: string;
  }) => {
    const firstConfirmed = window.confirm(
      "이 요청 키는 OpenAI 제공사 조회에만 사용해야 하는 내부 운영 식별자입니다. 지금 이 한 건의 키를 화면에 공개할까요?",
    );
    if (!firstConfirmed) return;
    const confirmation = window.prompt(
      `공개 사실이 감사 기록에 남습니다. 아래 문구를 정확히 입력하세요.\n\n${PROVIDER_REQUEST_KEY_REVEAL_CONFIRMATION}`,
    );
    if (confirmation !== PROVIDER_REQUEST_KEY_REVEAL_CONFIRMATION) {
      setNotice("");
      setError("고정 확인 문구가 일치하지 않아 OpenAI 요청 키를 공개하지 않았습니다.");
      return;
    }

    setBusyKey(operationKey);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/couple-court", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          id: verdictId,
          decision: "reveal_request_key",
          confirmation,
        }),
      });
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      const payload = await response.json() as {
        error?: string;
        requestKey?: string;
        revealedAt?: string;
      };
      if (
        !response.ok
        || typeof payload.requestKey !== "string"
        || !/^[a-f0-9]{64}$/.test(payload.requestKey)
        || typeof payload.revealedAt !== "string"
        || !Number.isFinite(Date.parse(payload.revealedAt))
      ) {
        throw new Error(payload.error ?? "감사 기록을 확인할 수 없어 요청 키를 공개하지 않았습니다.");
      }
      setRevealedRequestKeys((current) => ({
        ...current,
        [stateKey]: {
          requestKey: payload.requestKey as string,
          revealedAt: payload.revealedAt as string,
        },
      }));
      setNotice("감사 기록을 남긴 뒤 이 한 건의 OpenAI 요청 키만 공개했습니다.");
    } catch (revealError) {
      setError(revealError instanceof Error
        ? revealError.message
        : "OpenAI 요청 키를 공개하지 못했습니다.");
    } finally {
      setBusyKey(null);
    }
  };

  const pendingPosts = (queue?.posts ?? []).filter(
    (post) => post.status === "pending_review" && post.moderationStatus === "pending",
  );

  return (
    <main className="min-h-screen bg-ivory-50 px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-[1120px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-taupe-600 hover:text-noir-800">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 관리자 대시보드
            </Link>
            <h1 className="mt-2 flex items-center gap-2 font-serif-kr text-2xl font-light text-noir-800 sm:text-3xl">
              <Gavel className="h-6 w-6 text-rose-500" aria-hidden="true" /> 한방 커플재판소 검토
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-taupe-500">
              익명화된 공개 스냅샷, 공개 대기 댓글, 신고 사유만 확인합니다. 진술 원문과 사용자 정보는 이 화면에 제공되지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadQueue()}
            disabled={loading || busyKey !== null}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-platinum bg-white px-4 text-sm font-medium text-charcoal hover:border-noir-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" /> 새로고침
          </button>
        </header>

        <div className="mt-5 min-h-7" aria-live="polite">
          {notice && <p className="text-sm font-semibold text-emerald-700">{notice}</p>}
          {error && <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p>}
        </div>

        {loading && !queue ? (
          <div className="mt-10 flex min-h-56 items-center justify-center rounded-2xl border border-black/[0.04] bg-white">
            <p className="flex items-center gap-2 text-sm text-taupe-500">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> 검토 대기열을 불러오는 중입니다.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-8">
            <section aria-labelledby="court-post-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 id="court-post-heading" className="text-lg font-semibold text-noir-800">공개 스냅샷 승인</h2>
                  <p className="mt-1 text-sm text-taupe-500">두 사람의 동의와 자동 익명화가 끝난 공개 후보입니다.</p>
                </div>
                <span className="rounded-full bg-noir-800 px-2.5 py-1 text-xs font-semibold text-white">{pendingPosts.length}</span>
              </div>
              <div className="mt-4 grid gap-4">
                {pendingPosts.length === 0 && <div className="rounded-2xl border border-black/[0.04] bg-white p-6 text-sm text-taupe-500">검토할 공개 스냅샷이 없습니다.</div>}
                {pendingPosts.map((post) => {
                  const key = `post:${post.id}`;
                  const busy = busyKey?.startsWith(key) === true;
                  return (
                    <article key={post.id} className="rounded-2xl border border-black/[0.04] bg-white p-5 sm:p-6">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-taupe-500">
                        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">{CATEGORY_LABELS[post.snapshot.category] ?? post.snapshot.category}</span>
                        <span>{post.snapshot.mode === "solo" ? "1인 판결" : "커플 판결"}</span>
                        <span>미리보기 v{post.snapshotVersion ?? "-"}</span>
                        <span>{formatDate(post.createdAt)}</span>
                      </div>
                      <h3 className="mt-4 text-xl font-semibold leading-8 text-noir-800">{post.snapshot.safeTitle}</h3>
                      <p className="mt-2 text-sm leading-6 text-taupe-600">{post.snapshot.oneLine}</p>
                      <p className="mt-3 rounded-xl bg-ivory-50 px-3 py-2 text-sm font-semibold text-rose-700">{post.snapshot.resultLabel}</p>
                      {post.snapshot.hashtags.length > 0 && <p className="mt-3 text-xs text-taupe-500">{post.snapshot.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}</p>}
                      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <ReasonSelect id={`reason-${post.id}`} value={reasonFor(key)} onChange={(value) => updateReason(key, value)} disabled={busy} />
                        <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:approve`, { target: "post", id: post.id, decision: "approve" }, "공개 스냅샷을 승인했습니다.")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" /> 승인</button>
                        <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:reject`, { target: "post", id: post.id, decision: "reject", reasonCode: reasonFor(key) }, "공개 스냅샷을 반려했습니다.", "이 공개 후보를 반려하고 참여자 동의를 철회할까요?")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-700 disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /> 반려</button>
                        <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:hidden`, { target: "post", id: post.id, decision: "hidden", reasonCode: reasonFor(key) }, "공개 스냅샷을 숨겼습니다.", "이 공개 후보를 즉시 숨기고 참여자 동의를 철회할까요?")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-platinum px-4 text-sm font-semibold text-charcoal disabled:opacity-50"><EyeOff className="h-4 w-4" aria-hidden="true" /> 숨김</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="court-comment-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 id="court-comment-heading" className="flex items-center gap-2 text-lg font-semibold text-noir-800"><MessageCircle className="h-5 w-5" aria-hidden="true" /> 댓글 승인</h2>
                  <p className="mt-1 text-sm text-taupe-500">작성자 정보 없이 댓글 본문만 검토합니다.</p>
                </div>
                <span className="rounded-full bg-noir-800 px-2.5 py-1 text-xs font-semibold text-white">{queue?.comments.length ?? 0}</span>
              </div>
              <div className="mt-4 grid gap-4">
                {(queue?.comments.length ?? 0) === 0 && <div className="rounded-2xl border border-black/[0.04] bg-white p-6 text-sm text-taupe-500">검토할 댓글이 없습니다.</div>}
                {queue?.comments.map((comment) => {
                  const key = `comment:${comment.id}`;
                  const busy = busyKey?.startsWith(key) === true;
                  const post = postById.get(comment.publicPostId);
                  return (
                    <article key={comment.id} className="rounded-2xl border border-black/[0.04] bg-white p-5 sm:p-6">
                      <p className="text-xs font-semibold text-taupe-500">{COMMENT_TYPE_LABELS[comment.commentType ?? ""] ?? "댓글"} · {formatDate(comment.createdAt)}</p>
                      <blockquote className="mt-3 border-l-2 border-rose-300 pl-4 text-sm leading-7 text-noir-800">{comment.body}</blockquote>
                      <ContextPost post={post} />
                      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <ReasonSelect id={`reason-${comment.id}`} value={reasonFor(key)} onChange={(value) => updateReason(key, value)} disabled={busy} />
                        <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:approve`, { target: "comment", id: comment.id, decision: "approve" }, "댓글을 승인했습니다.")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" /> 승인</button>
                        <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:reject`, { target: "comment", id: comment.id, decision: "reject", reasonCode: reasonFor(key) }, "댓글을 반려했습니다.", "이 댓글을 반려할까요?")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-700 disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /> 반려</button>
                        <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:hide`, { target: "comment", id: comment.id, decision: "hide", reasonCode: reasonFor(key) }, "댓글을 숨겼습니다.", "이 댓글을 숨길까요?")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-platinum px-4 text-sm font-semibold text-charcoal disabled:opacity-50"><EyeOff className="h-4 w-4" aria-hidden="true" /> 숨김</button>
                        {post && <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:toggle`, { target: "comments", id: post.id, enabled: !post.commentsEnabled, reasonCode: post.commentsEnabled ? reasonFor(key) : undefined }, post.commentsEnabled ? "이 사건의 새 댓글 작성을 껐습니다." : "이 사건의 새 댓글 작성을 켰습니다.", post.commentsEnabled ? "이 사건의 새 댓글 작성을 중단할까요?" : undefined)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-platinum px-4 text-sm font-semibold text-charcoal disabled:opacity-50">댓글 작성 {post.commentsEnabled ? "끄기" : "켜기"}</button>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="court-report-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 id="court-report-heading" className="flex items-center gap-2 text-lg font-semibold text-noir-800"><Flag className="h-5 w-5" aria-hidden="true" /> 신고 검토</h2>
                  <p className="mt-1 text-sm text-taupe-500">신고자 정보 없이 대상 종류와 신고 사유만 확인합니다.</p>
                </div>
                <span className="rounded-full bg-noir-800 px-2.5 py-1 text-xs font-semibold text-white">{queue?.reports.length ?? 0}</span>
              </div>
              <div className="mt-4 grid gap-4">
                {(queue?.reports.length ?? 0) === 0 && <div className="rounded-2xl border border-black/[0.04] bg-white p-6 text-sm text-taupe-500">처리할 신고가 없습니다.</div>}
                {queue?.reports.map((report) => {
                  const key = `report:${report.id}`;
                  const busy = busyKey?.startsWith(key) === true;
                  const reportedComment = report.commentId
                    ? reportedCommentById.get(report.commentId)
                    : undefined;
                  return (
                    <article key={report.id} className="rounded-2xl border border-black/[0.04] bg-white p-5 sm:p-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{report.status === "reviewing" ? "검토 중" : "신규 신고"}</span>
                        <span className="text-xs font-semibold text-taupe-500">{report.targetType === "comment" ? "댓글 대상" : "게시물 대상"}</span>
                        <span className="text-xs text-taupe-500">{formatDate(report.createdAt)}</span>
                      </div>
                      <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-noir-800"><ShieldAlert className="h-4 w-4 text-amber-700" aria-hidden="true" /> {REPORT_REASON_LABELS[report.reasonCode ?? ""] ?? "기타 신고"}</p>
                      {report.targetType === "comment" && (reportedComment
                        ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4"><p className="text-xs font-semibold text-amber-900">신고된 댓글 · {COMMENT_TYPE_LABELS[reportedComment.commentType ?? ""] ?? "댓글"}</p><blockquote className="mt-2 border-l-2 border-amber-400 pl-3 text-sm leading-7 text-noir-800">{reportedComment.body}</blockquote></div>
                        : <p className="mt-3 text-sm font-semibold text-rose-700">신고된 댓글 본문을 불러오지 못했습니다. 내용 확인 전에는 기각하지 마세요.</p>)}
                      <ContextPost post={postById.get(report.publicPostId)} />
                      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <ReasonSelect id={`reason-${report.id}`} value={reasonFor(key, "policy_violation")} onChange={(value) => updateReason(key, value)} disabled={busy} />
                        {report.status === "open" && <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:start`, { target: "report", id: report.id, decision: "start_review" }, "신고 검토를 시작했습니다.")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-noir-800 px-4 text-sm font-semibold text-white disabled:opacity-50">검토 시작</button>}
                        <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:dismiss`, { target: "report", id: report.id, decision: "dismiss", reasonCode: reasonFor(key, "no_violation") }, "신고를 기각했습니다.", "위반 사항이 없다고 판단하고 신고를 종료할까요?")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-platinum px-4 text-sm font-semibold text-charcoal disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /> 기각</button>
                        <button type="button" disabled={busyKey !== null} onClick={() => void runAction(`${key}:hide`, { target: "report", id: report.id, decision: "hide_content", reasonCode: reasonFor(key) }, "신고 대상 콘텐츠를 숨겼습니다.", "신고 대상 콘텐츠를 즉시 숨기고 신고를 종료할까요?")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-rose-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><EyeOff className="h-4 w-4" aria-hidden="true" /> 대상 숨김</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="court-provider-audit-heading">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="court-provider-audit-heading" className="flex items-center gap-2 text-lg font-semibold text-noir-800">
                    <RefreshCw className="h-5 w-5 text-emerald-700" aria-hidden="true" /> 감사 장부 복구
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-taupe-500">
                    OpenAI 응답 사용량은 안전하게 보관됐지만 필수 감사 기록 마무리가 지연된 요청입니다. 한 건씩 복구하며 OpenAI를 다시 호출하지 않습니다. 진술·판결 원문과 사용자 정보는 이 화면에 표시하지 않습니다.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white">
                    {queue?.providerAuditRecoveries.length ?? 0}
                  </span>
                  <button
                    type="button"
                    disabled={busyKey !== null || (queue?.providerAuditRecoveries.length ?? 0) === 0}
                    onClick={() => void runAction(
                      "provider-audit:recover",
                      { target: "provider_audit_recovery", decision: "recover_one" },
                      "필수 감사 기록 복구 대기열을 안전하게 처리했습니다.",
                    )}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${busyKey === "provider-audit:recover" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
                    가장 오래된 1건 복구
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                {(queue?.providerAuditRecoveries.length ?? 0) === 0 && (
                  <div className="rounded-2xl border border-black/[0.04] bg-white p-6 text-sm text-taupe-500">
                    복구를 기다리는 필수 감사 기록이 없습니다.
                  </div>
                )}
                {queue?.providerAuditRecoveries.map((item, index) => (
                  <article
                    key={`${item.pendingAt}:${index}`}
                    className="rounded-2xl border border-emerald-200 bg-white p-5 sm:p-6"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-taupe-500">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">
                        {item.providerState === "result_staged" ? "판결 결과 보관 완료" : "안전 종료 기록"}
                      </span>
                      <span>대기 시작 {formatDate(item.pendingAt)}</span>
                      <span>복구 시도 {item.attemptCount.toLocaleString("ko-KR")}회</span>
                    </div>
                    {item.errorCode && <p className="mt-3 text-xs text-taupe-500">종료 상태: {item.errorCode}</p>}
                    {item.lastErrorCode && (
                      <p className="mt-2 text-xs font-semibold text-amber-800">
                        최근 복구 실패: {item.lastErrorCode} · {formatDate(item.lastErrorAt)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <section aria-labelledby="court-provider-deletion-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 id="court-provider-deletion-heading" className="flex items-center gap-2 text-lg font-semibold text-noir-800">
                    <ShieldAlert className="h-5 w-5 text-rose-700" aria-hidden="true" /> 삭제 사건 제공사 비용 정산
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-taupe-500">
                    사용자와 사건은 이미 영구 삭제됐지만, 삭제 직전에 시작된 OpenAI 호출의 청구 여부가 확정되지 않은 항목입니다. 아래 요청 키로 OpenAI 대시보드나 지원팀 기록을 직접 대조하세요. 사건·사용자·진술·판결 원문은 이 화면과 정산 기록에 남기지 않습니다.
                  </p>
                </div>
                <span className="rounded-full bg-rose-700 px-2.5 py-1 text-xs font-semibold text-white">
                  {queue?.providerDeletionHandoffs.length ?? 0}
                </span>
              </div>
              <div className="mt-4 grid gap-4">
                {(queue?.providerDeletionHandoffs.length ?? 0) === 0 && (
                  <div className="rounded-2xl border border-black/[0.04] bg-white p-6 text-sm text-taupe-500">
                    삭제 사건에서 수동으로 정산할 OpenAI 요청이 없습니다.
                  </div>
                )}
                {queue?.providerDeletionHandoffs.map((item) => {
                  const key = `provider-deletion:${item.verdictId}`;
                  const noChargeBusy = busyKey === `${key}:confirm_no_charge`;
                  const paidBusy = busyKey === `${key}:record_paid`;
                  const revealBusy = busyKey === `${key}:reveal`;
                  const revealStateKey = `deleted:${item.verdictId}`;
                  const revealedRequestKey = revealedRequestKeys[revealStateKey];
                  const draft = deletionDraftFor(item.verdictId);
                  return (
                    <article key={item.verdictId} className="rounded-2xl border border-rose-200 bg-white p-5 sm:p-6">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-taupe-500">
                        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-800">자동 정산 중단</span>
                        <span>인계 생성 {formatDate(item.createdAt)}</span>
                        <span>확인 기한 {formatDate(item.expiresAt)}</span>
                      </div>
                      <div className="mt-4 rounded-xl border border-platinum bg-ivory-50 p-4">
                        <p className="text-sm font-semibold text-noir-800">OpenAI 요청 키 · 제한 공개</p>
                        {!revealedRequestKey ? (
                          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs leading-5 text-taupe-600">
                              목록 응답에는 요청 키가 포함되지 않습니다. 제공사 대조를 시작할 때 이 한 건만 감사 기록 후 공개하세요.
                            </p>
                            <button
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => void revealProviderRequestKey({
                                verdictId: item.verdictId,
                                target: "provider_deletion_handoff_reveal",
                                stateKey: revealStateKey,
                                operationKey: `${key}:reveal`,
                              })}
                              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-noir-800 bg-white px-4 text-sm font-semibold text-noir-800 disabled:opacity-50"
                            >
                              {revealBusy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                              {revealBusy ? "감사 기록 중" : "요청 키 1건 공개"}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2">
                            <code className="block break-all rounded-lg bg-white p-3 text-xs leading-6 text-charcoal">
                              {revealedRequestKey.requestKey}
                            </code>
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-xs text-taupe-500">
                                공개 감사 시각 {formatDate(revealedRequestKey.revealedAt)} · 새로고침하면 다시 숨겨집니다.
                              </p>
                              <button
                                type="button"
                                disabled={busyKey !== null}
                                onClick={() => setRevealedRequestKeys((current) => {
                                  const next = { ...current };
                                  delete next[revealStateKey];
                                  return next;
                                })}
                                className="min-h-11 rounded-lg px-3 text-sm font-semibold text-taupe-600 hover:text-noir-800 disabled:opacity-50"
                              >
                                다시 숨기기
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-platinum bg-ivory-50/60 p-4">
                          <h3 className="text-sm font-semibold text-noir-800">요청 없음·청구 없음 확인</h3>
                          <p className="mt-1 text-xs leading-5 text-taupe-600">
                            대시보드와 지원팀 기록에서 호출·청구가 없다고 확인한 경우에만 선택하세요.
                          </p>
                          <button
                            type="button"
                            disabled={busyKey !== null || !revealedRequestKey}
                            onClick={() => resolveProviderDeletionHandoff(item, "confirm_no_charge")}
                            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-noir-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            {noChargeBusy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                            {noChargeBusy ? "정산 기록 중" : "청구 없음으로 정산"}
                          </button>
                        </div>

                        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                          <h3 className="text-sm font-semibold text-amber-950">유료 호출 확인</h3>
                          <p className="mt-1 text-xs leading-5 text-amber-900/80">
                            OpenAI 기록과 정확히 일치하는 값만 입력하세요. 모델과 입력·출력 토큰은 필수이며, 캐시 사용량과 비용은 확인 가능한 경우에만 입력합니다.
                          </p>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <label className="text-xs font-semibold text-charcoal sm:col-span-2" htmlFor={`deleted-provider-model-${item.verdictId}`}>
                              OpenAI 모델명 <span className="text-rose-700">필수</span>
                              <input
                                id={`deleted-provider-model-${item.verdictId}`}
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                maxLength={128}
                                required
                                value={draft.auditModel}
                                onChange={(event) => updateDeletionDraft(item.verdictId, "auditModel", event.target.value)}
                                disabled={busyKey !== null || !revealedRequestKey}
                                placeholder="예: gpt-5.6-terra"
                                className="mt-1 min-h-11 w-full rounded-lg border border-amber-200 bg-white px-3 text-sm font-normal text-charcoal disabled:opacity-50"
                              />
                            </label>
                            {([
                              ["inputTokens", "입력 토큰", true],
                              ["outputTokens", "출력 토큰", true],
                              ["cachedInputTokens", "캐시 입력 토큰", false],
                              ["cacheWriteInputTokens", "캐시 쓰기 입력 토큰", false],
                            ] as const).map(([field, label, required]) => (
                              <label key={field} className="text-xs font-semibold text-charcoal" htmlFor={`deleted-provider-${field}-${item.verdictId}`}>
                                {label} {required
                                  ? <span className="text-rose-700">필수</span>
                                  : <span className="font-normal text-taupe-500">선택</span>}
                                <input
                                  id={`deleted-provider-${field}-${item.verdictId}`}
                                  type="text"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  required={required}
                                  value={draft[field]}
                                  onChange={(event) => updateDeletionDraft(item.verdictId, field, event.target.value)}
                                  disabled={busyKey !== null || !revealedRequestKey}
                                  placeholder="0~10,000,000"
                                  className="mt-1 min-h-11 w-full rounded-lg border border-amber-200 bg-white px-3 text-sm font-normal text-charcoal disabled:opacity-50"
                                />
                              </label>
                            ))}
                            <label className="text-xs font-semibold text-charcoal sm:col-span-2" htmlFor={`deleted-provider-cost-${item.verdictId}`}>
                              비용(USD) <span className="font-normal text-taupe-500">선택 · 소수점 6자리까지</span>
                              <input
                                id={`deleted-provider-cost-${item.verdictId}`}
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                value={draft.costUsd}
                                onChange={(event) => updateDeletionDraft(item.verdictId, "costUsd", event.target.value)}
                                disabled={busyKey !== null || !revealedRequestKey}
                                placeholder="예: 0.004200"
                                className="mt-1 min-h-11 w-full rounded-lg border border-amber-200 bg-white px-3 text-sm font-normal text-charcoal disabled:opacity-50"
                              />
                            </label>
                          </div>
                          <button
                            type="button"
                            disabled={busyKey !== null || !revealedRequestKey}
                            onClick={() => resolveProviderDeletionHandoff(item, "record_paid")}
                            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            {paidBusy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                            {paidBusy ? "유료 호출 기록 중" : "유료 호출로 기록"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="court-provider-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 id="court-provider-heading" className="flex items-center gap-2 text-lg font-semibold text-noir-800">
                    <ShieldAlert className="h-5 w-5 text-amber-700" aria-hidden="true" /> 제공사 결과 확인
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-taupe-500">
                    응답 도착 여부를 알 수 없어 자동 재시도가 차단된 요청입니다. 요청 키는 목록에 포함되지 않으며, 한 건씩 감사 기록 후 공개됩니다. OpenAI 대시보드나 지원팀에서 결과가 없거나 실패했다고 직접 확인한 경우에만 재시도를 허용하세요.
                  </p>
                </div>
                <span className="rounded-full bg-amber-800 px-2.5 py-1 text-xs font-semibold text-white">
                  {queue?.providerReconciliations.length ?? 0}
                </span>
              </div>
              <div className="mt-4 grid gap-4">
                {(queue?.providerReconciliations.length ?? 0) === 0 && (
                  <div className="rounded-2xl border border-black/[0.04] bg-white p-6 text-sm text-taupe-500">
                    수동으로 확인할 제공사 요청이 없습니다.
                  </div>
                )}
                {queue?.providerReconciliations.map((item) => {
                  const key = `provider:${item.verdictId}`;
                  const busy = busyKey?.startsWith(key) === true;
                  const revealBusy = busyKey === `${key}:reveal`;
                  const revealStateKey = `live:${item.verdictId}`;
                  const revealedRequestKey = revealedRequestKeys[revealStateKey];
                  const reason = reasons[key] ?? PROVIDER_REASON_OPTIONS[0][0];
                  return (
                    <article key={item.verdictId} className="rounded-2xl border border-amber-200 bg-white p-5 sm:p-6">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-taupe-500">
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-900">자동 재시도 차단</span>
                        <span>시작 {formatDate(item.startedAt)}</span>
                        <span>실패 기록 {formatDate(item.failedAt)}</span>
                      </div>
                      <div className="mt-4 rounded-xl border border-platinum bg-ivory-50 p-4">
                        <p className="text-sm font-semibold text-noir-800">OpenAI 요청 키 · 제한 공개</p>
                        {!revealedRequestKey ? (
                          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs leading-5 text-taupe-600">
                              제공사 대조를 시작할 때 이 한 건만 감사 기록 후 공개하세요.
                            </p>
                            <button
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => void revealProviderRequestKey({
                                verdictId: item.verdictId,
                                target: "provider_reconciliation_reveal",
                                stateKey: revealStateKey,
                                operationKey: `${key}:reveal`,
                              })}
                              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-noir-800 bg-white px-4 text-sm font-semibold text-noir-800 disabled:opacity-50"
                            >
                              {revealBusy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                              {revealBusy ? "감사 기록 중" : "요청 키 1건 공개"}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2">
                            <code className="block break-all rounded-lg bg-white p-3 text-xs leading-6 text-charcoal">
                              {revealedRequestKey.requestKey}
                            </code>
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-xs text-taupe-500">
                                공개 감사 시각 {formatDate(revealedRequestKey.revealedAt)} · 새로고침하면 다시 숨겨집니다.
                              </p>
                              <button
                                type="button"
                                disabled={busyKey !== null}
                                onClick={() => setRevealedRequestKeys((current) => {
                                  const next = { ...current };
                                  delete next[revealStateKey];
                                  return next;
                                })}
                                className="min-h-11 rounded-lg px-3 text-sm font-semibold text-taupe-600 hover:text-noir-800 disabled:opacity-50"
                              >
                                다시 숨기기
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="mt-3 text-xs text-taupe-500">내부 오류 코드: {item.errorCode ?? "없음"}</p>
                      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <label htmlFor={`provider-reason-${item.verdictId}`} className="sr-only">제공사 확인 결과</label>
                        <select
                          id={`provider-reason-${item.verdictId}`}
                          value={reason}
                          onChange={(event) => updateReason(key, event.target.value)}
                          disabled={busy || !revealedRequestKey}
                          className="min-h-11 rounded-lg border border-platinum bg-white px-3 text-sm text-charcoal disabled:opacity-50"
                        >
                          {PROVIDER_REASON_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <button
                          type="button"
                          disabled={busyKey !== null || !revealedRequestKey}
                          onClick={() => {
                            const confirmation = window.prompt(
                              `제공사 기록 확인을 마쳤다면 아래 문구를 정확히 입력하세요.\n\n${PROVIDER_RETRY_CONFIRMATION}`,
                            );
                            if (confirmation !== PROVIDER_RETRY_CONFIRMATION) {
                              setNotice("");
                              setError("고정 확인 문구가 일치하지 않아 재시도를 허용하지 않았습니다.");
                              return;
                            }
                            void runAction(key, {
                              target: "provider_reconciliation",
                              id: item.verdictId,
                              decision: "allow_retry",
                              reasonCode: reason,
                              confirmation,
                            }, "제공사 확인 근거를 기록하고 한 번의 재시도를 허용했습니다.");
                          }}
                          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          확인 기록 후 재시도 허용
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {queue && Object.values(queue.truncated).some(Boolean) && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                대기열이 많아 각 종류의 오래된 항목 50개만 표시했습니다. 처리 후 새로고침하면 다음 항목이 나타납니다.
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
