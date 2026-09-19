"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  MessageCircleReply,
  RefreshCcw,
  ShieldCheck,
  Tag,
  Users,
} from "lucide-react";

type ContentOrigin =
  | "member"
  | "operator"
  | "ai"
  | "industry_professional"
  | "legacy_unverified";

interface OriginCounts {
  member: number;
  operator: number;
  ai: number;
  industry_professional: number;
  legacy_unverified: number;
}

interface CommunityHealth {
  window_days: number;
  measured_at: string;
  public_non_review_post_count: number;
  window_question_count: number;
  over_24h_without_human_reply_count: number;
  first_human_reply_median_hours: number | null;
  human_reply_within_24h_rate: number | null;
  resolved_question_rate: number | null;
  post_content_origin_counts: OriginCounts;
  comment_content_origin_counts: OriginCounts;
  pending_report_count: number;
  oldest_pending_report_hours: number | null;
  unresolved_appeal_count: number;
  unread_reply_notification_count: number;
}

interface ProvenanceItem {
  target_type: "post" | "comment";
  id: string;
  post_id: string;
  author_id: string;
  content_origin: ContentOrigin;
  title: string;
  preview: string;
  state: string;
  created_at: string;
  author: {
    nickname: string;
    is_suspended: boolean;
  };
}

interface DraftClassification {
  origin: Exclude<ContentOrigin, "legacy_unverified">;
  reason: string;
}

const ORIGIN_OPTIONS: {
  value: DraftClassification["origin"];
  label: string;
}[] = [
  { value: "member", label: "일반 회원" },
  { value: "operator", label: "운영팀" },
  { value: "ai", label: "AI" },
  { value: "industry_professional", label: "업계 종사자" },
];

const EMPTY_DRAFT: DraftClassification = {
  origin: "member",
  reason: "",
};

function formatPercent(value: number | null) {
  return value === null ? "측정 전" : `${Math.round(value * 100)}%`;
}

function formatHours(value: number | null) {
  if (value === null) return "측정 전";
  if (value < 1) return `${Math.round(value * 60)}분`;
  return `${value.toFixed(value < 10 ? 1 : 0)}시간`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function readJson(response: Response) {
  return (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
}

export default function CommunityOperationsPage() {
  const [authState, setAuthState] = useState<"loading" | "admin" | "denied">(
    "loading"
  );
  const [windowDays, setWindowDays] = useState(30);
  const [health, setHealth] = useState<CommunityHealth | null>(null);
  const [items, setItems] = useState<ProvenanceItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftClassification>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadOperations = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    try {
      const [healthResponse, provenanceResponse] = await Promise.all([
        fetch(`/api/admin/community/health?windowDays=${days}`, {
          cache: "no-store",
        }),
        fetch(
          "/api/admin/community/provenance?origin=legacy_unverified&target=all&limit=100",
          { cache: "no-store" }
        ),
      ]);
      const [healthBody, provenanceBody] = await Promise.all([
        readJson(healthResponse),
        readJson(provenanceResponse),
      ]);

      if (!healthResponse.ok) {
        throw new Error(
          typeof healthBody?.error === "string"
            ? healthBody.error
            : "커뮤니티 운영 지표를 불러오지 못했습니다."
        );
      }
      if (!provenanceResponse.ok) {
        throw new Error(
          typeof provenanceBody?.error === "string"
            ? provenanceBody.error
            : "출처 분류 대기열을 불러오지 못했습니다."
        );
      }

      setHealth(healthBody?.health as unknown as CommunityHealth);
      setItems((provenanceBody?.items as unknown as ProvenanceItem[]) ?? []);
    } catch (loadError) {
      setHealth(null);
      setItems([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "커뮤니티 운영 상태를 확인하지 못했습니다."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const verify = async () => {
      try {
        const response = await fetch("/api/admin/auth", { cache: "no-store" });
        const body = await readJson(response);
        if (!active) return;
        if (!response.ok || body?.isAdmin !== true) {
          setAuthState("denied");
          window.location.replace("/admin/login");
          return;
        }
        setAuthState("admin");
      } catch {
        if (!active) return;
        setAuthState("denied");
        window.location.replace("/admin/login");
      }
    };
    void verify();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authState === "admin") {
      void loadOperations(windowDays);
    }
  }, [authState, loadOperations, windowDays]);

  const legacyCount = useMemo(() => {
    if (!health) return null;
    return (
      health.post_content_origin_counts.legacy_unverified +
      health.comment_content_origin_counts.legacy_unverified
    );
  }, [health]);

  const releaseChecks = useMemo(() => {
    if (!health || legacyCount === null) return [];
    return [
      {
        label: "공개 콘텐츠 출처 분류",
        passed: legacyCount === 0,
        value:
          legacyCount === 0
            ? "미분류 0건"
            : `미분류 ${legacyCount.toLocaleString()}건`,
      },
      {
        label: "24시간 내 사람 답변",
        passed:
          health.human_reply_within_24h_rate !== null &&
          health.human_reply_within_24h_rate >= 0.8,
        value: formatPercent(health.human_reply_within_24h_rate),
      },
      {
        label: "첫 사람 답변 중앙시간",
        passed:
          health.first_human_reply_median_hours !== null &&
          health.first_human_reply_median_hours <= 6,
        value: formatHours(health.first_human_reply_median_hours),
      },
      {
        label: "신고 처리 적체",
        passed:
          health.oldest_pending_report_hours === null ||
          health.oldest_pending_report_hours < 24,
        value:
          health.pending_report_count === 0
            ? "대기 0건"
            : `${health.pending_report_count}건 · 최장 ${formatHours(
                health.oldest_pending_report_hours
              )}`,
      },
      {
        label: "24시간 초과 미답변 질문",
        passed: health.over_24h_without_human_reply_count === 0,
        value: `${health.over_24h_without_human_reply_count}건`,
      },
    ];
  }, [health, legacyCount]);

  const releaseReady =
    releaseChecks.length > 0 && releaseChecks.every((check) => check.passed);

  const updateDraft = (
    itemId: string,
    patch: Partial<DraftClassification>
  ) => {
    setDrafts((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? EMPTY_DRAFT),
        ...patch,
      },
    }));
  };

  const saveClassification = async (item: ProvenanceItem) => {
    const draft = drafts[item.id] ?? EMPTY_DRAFT;
    if (draft.reason.trim().length < 5) {
      setError("출처를 확인한 근거를 5자 이상 입력해 주세요.");
      return;
    }

    setSavingId(item.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/community/provenance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: item.target_type,
          target_id: item.id,
          new_origin: draft.origin,
          reason: draft.reason.trim(),
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "출처 분류를 저장하지 못했습니다."
        );
      }

      setItems((current) =>
        current.filter(
          (candidate) =>
            !(
              candidate.id === item.id &&
              candidate.target_type === item.target_type
            )
        )
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setSuccess(`“${item.title || "콘텐츠"}” 출처를 감사 기록과 함께 저장했습니다.`);
      await loadOperations(windowDays);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "출처 분류를 저장하지 못했습니다."
      );
    } finally {
      setSavingId(null);
    }
  };

  if (authState !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8F5EF] px-4">
        <div className="text-center">
          <Loader2
            className="mx-auto mb-3 h-8 w-8 animate-spin text-[var(--hb-text-strong)]"
            aria-hidden="true"
          />
          <p className="text-sm text-[#6F6A62]">
            {authState === "denied"
              ? "관리자 로그인으로 이동합니다."
              : "관리자 권한을 확인하고 있습니다."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8F5EF] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/admin"
              className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--hb-text-strong)] hover:underline"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              관리자 대시보드
            </Link>
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[#252824] sm:text-3xl">
              커뮤니티 출시 통제실
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6F6A62]">
              사람 답변, 신고 SLA, 해결 상태, 콘텐츠 출처를 같은 기준으로
              확인합니다. 측정되지 않은 값은 성공으로 간주하지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="health-window" className="sr-only">
              운영 지표 기간
            </label>
            <select
              id="health-window"
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
              className="min-h-11 rounded-[6px] border border-[#D8D1C5] bg-white px-3 text-sm text-[#252824]"
            >
              <option value={7}>최근 7일</option>
              <option value={30}>최근 30일</option>
              <option value={90}>최근 90일</option>
            </select>
            <button
              type="button"
              onClick={() => void loadOperations(windowDays)}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[var(--hb-text-strong)] hover:bg-[#F3F7F2] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              새로고침
            </button>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-[6px] border border-[#E9B9AD] bg-[#FFF3F0] px-4 py-3 text-sm leading-6 text-[#8B3326]"
          >
            {error}
          </div>
        )}
        {success && (
          <div
            role="status"
            className="mb-5 rounded-[6px] border border-[#BCD4C4] bg-[#F0F8F2] px-4 py-3 text-sm leading-6 text-[#27583A]"
          >
            {success}
          </div>
        )}

        {loading && !health ? (
          <section className="rounded-[6px] border border-black/5 bg-white p-10 text-center">
            <Loader2
              className="mx-auto mb-3 h-7 w-7 animate-spin text-[var(--hb-text-strong)]"
              aria-hidden="true"
            />
            <p className="text-sm text-[#6F6A62]">운영 상태를 측정 중입니다.</p>
          </section>
        ) : health ? (
          <>
            <section
              className={`mb-6 rounded-[6px] border p-5 sm:p-7 ${
                releaseReady
                  ? "border-[#BCD4C4] bg-[#F0F8F2]"
                  : "border-[#E6C4A7] bg-[#FFF7ED]"
              }`}
              aria-labelledby="release-decision-heading"
            >
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-3">
                  {releaseReady ? (
                    <CheckCircle2
                      className="mt-0.5 h-6 w-6 shrink-0 text-[#2F6E47]"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 h-6 w-6 shrink-0 text-[#A45C1B]"
                      aria-hidden="true"
                    />
                  )}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6F6A62]">
                      현재 운영 판정
                    </p>
                    <h2
                      id="release-decision-heading"
                      className="mt-1 text-xl font-semibold text-[#252824]"
                    >
                      {releaseReady
                        ? "운영 지표 기준 통과"
                        : "확대 출시 보류"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[#615B52]">
                      이 판정은 커뮤니티 운영 지표만 평가합니다. DB 배포 증거,
                      개인정보·약관 법률 검토, 실제 답변자 공급 확인은 별도 출시
                      게이트입니다.
                    </p>
                  </div>
                </div>
                <p className="shrink-0 text-xs text-[var(--hb-text-muted)]">
                  측정 {formatDate(health.measured_at)}
                </p>
              </div>

              <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                {releaseChecks.map((check) => (
                  <div
                    key={check.label}
                    className="rounded-[6px] border border-black/5 bg-white/80 p-4"
                  >
                    <div className="flex items-start gap-2">
                      {check.passed ? (
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-[#2F6E47]"
                          aria-label="통과"
                        />
                      ) : (
                        <AlertTriangle
                          className="mt-0.5 h-4 w-4 shrink-0 text-[#A45C1B]"
                          aria-label="미달"
                        />
                      )}
                      <div>
                        <p className="text-xs leading-5 text-[#6F6A62]">
                          {check.label}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[#252824]">
                          {check.value}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section
              className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="핵심 운영 지표"
            >
              <MetricCard
                icon={MessageCircleReply}
                label={`${health.window_days}일 질문`}
                value={health.window_question_count.toLocaleString()}
                note={`24시간 초과 미답변 ${health.over_24h_without_human_reply_count}건`}
              />
              <MetricCard
                icon={Clock3}
                label="첫 사람 답변 중앙시간"
                value={formatHours(health.first_human_reply_median_hours)}
                note={`24시간 내 ${formatPercent(
                  health.human_reply_within_24h_rate
                )}`}
              />
              <MetricCard
                icon={ShieldCheck}
                label="신고·이의제기"
                value={`${health.pending_report_count} / ${health.unresolved_appeal_count}`}
                note="대기 신고 / 미종결 이의제기"
              />
              <MetricCard
                icon={Users}
                label="공개 게시글"
                value={health.public_non_review_post_count.toLocaleString()}
                note={`질문 해결률 ${formatPercent(
                  health.resolved_question_rate
                )}`}
              />
            </section>

            <section
              className="mb-6 rounded-[6px] border border-black/5 bg-white p-5 sm:p-7"
              aria-labelledby="origin-summary-heading"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7A746B]">
                    Content provenance
                  </p>
                  <h2
                    id="origin-summary-heading"
                    className="mt-1 text-xl font-semibold text-[#252824]"
                  >
                    공개 콘텐츠 출처 현황
                  </h2>
                </div>
                <p className="text-sm text-[#6F6A62]">
                  읽지 않은 답변 알림{" "}
                  <strong className="text-[#252824]">
                    {health.unread_reply_notification_count.toLocaleString()}건
                  </strong>
                </p>
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E8E2D9] text-xs text-[#7A746B]">
                      <th className="px-3 py-3 font-medium">대상</th>
                      <th className="px-3 py-3 font-medium">일반 회원</th>
                      <th className="px-3 py-3 font-medium">운영팀</th>
                      <th className="px-3 py-3 font-medium">AI</th>
                      <th className="px-3 py-3 font-medium">업계 종사자</th>
                      <th className="px-3 py-3 font-medium">미분류</th>
                    </tr>
                  </thead>
                  <tbody>
                    <OriginRow
                      label="게시글"
                      counts={health.post_content_origin_counts}
                    />
                    <OriginRow
                      label="답변"
                      counts={health.comment_content_origin_counts}
                    />
                  </tbody>
                </table>
              </div>
            </section>

            <section
              className="rounded-[6px] border border-black/5 bg-white p-5 sm:p-7"
              aria-labelledby="provenance-queue-heading"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7A746B]">
                    Manual review queue
                  </p>
                  <h2
                    id="provenance-queue-heading"
                    className="mt-1 text-xl font-semibold text-[#252824]"
                  >
                    출처 미분류 대기열
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#6F6A62]">
                    닉네임으로 추정하지 말고 계정·작성 경위 증거를 확인한 뒤
                    분류하세요. 모든 변경은 감사 기록에 남습니다.
                  </p>
                </div>
                <span className="rounded-full bg-[#F2EEE7] px-3 py-1 text-sm font-semibold text-[#4E4A43]">
                  {items.length}건 표시
                </span>
              </div>

              {items.length === 0 ? (
                <div className="mt-6 rounded-[6px] border border-dashed border-[#C9D5C8] bg-[#F7FBF7] p-8 text-center">
                  <CheckCircle2
                    className="mx-auto mb-3 h-7 w-7 text-[#2F6E47]"
                    aria-hidden="true"
                  />
                  <p className="font-semibold text-[#252824]">
                    현재 미분류 콘텐츠가 없습니다.
                  </p>
                  <p className="mt-1 text-sm text-[#6F6A62]">
                    새 콘텐츠의 출처 배지가 공개 화면과 일치하는지 표본
                    점검하세요.
                  </p>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {items.map((item) => {
                    const draft = drafts[item.id] ?? EMPTY_DRAFT;
                    return (
                      <article
                        key={`${item.target_type}-${item.id}`}
                        className="rounded-[6px] border border-[#E7E1D8] p-4 sm:p-5"
                      >
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--hb-text-muted)]">
                              <span className="rounded-full bg-[#F2EEE7] px-2 py-1 font-semibold">
                                {item.target_type === "post"
                                  ? "게시글"
                                  : "답변"}
                              </span>
                              <span>{item.author.nickname}</span>
                              {item.author.is_suspended && (
                                <span className="font-semibold text-[#A63C2C]">
                                  이용 제한
                                </span>
                              )}
                              <span>{formatDate(item.created_at)}</span>
                            </div>
                            <h3 className="mt-3 font-semibold text-[#252824]">
                              {item.title || "제목 없는 콘텐츠"}
                            </h3>
                            <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-6 text-[#615B52]">
                              {item.preview || "본문 미리보기가 없습니다."}
                            </p>
                            <Link
                              href={`/wedding/community/post/${item.post_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--hb-text-strong)] hover:underline"
                            >
                              공개 화면 확인
                              <ExternalLink
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            </Link>
                          </div>

                          <div className="grid w-full gap-3 xl:w-[420px]">
                            <div>
                              <label
                                htmlFor={`origin-${item.id}`}
                                className="mb-1.5 block text-xs font-semibold text-[#4E4A43]"
                              >
                                확인한 출처
                              </label>
                              <select
                                id={`origin-${item.id}`}
                                value={draft.origin}
                                onChange={(event) =>
                                  updateDraft(item.id, {
                                    origin: event.target
                                      .value as DraftClassification["origin"],
                                  })
                                }
                                className="min-h-11 w-full rounded-[6px] border border-[#D8D1C5] bg-white px-3 text-sm text-[#252824]"
                              >
                                {ORIGIN_OPTIONS.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label
                                htmlFor={`reason-${item.id}`}
                                className="mb-1.5 block text-xs font-semibold text-[#4E4A43]"
                              >
                                분류 근거
                              </label>
                              <textarea
                                id={`reason-${item.id}`}
                                value={draft.reason}
                                onChange={(event) =>
                                  updateDraft(item.id, {
                                    reason: event.target.value,
                                  })
                                }
                                rows={3}
                                maxLength={2000}
                                placeholder="예: 운영팀 계정 기록과 원문 작성 이력을 확인함"
                                className="w-full resize-y rounded-[6px] border border-[#D8D1C5] bg-white px-3 py-2.5 text-sm leading-6 text-[#252824] placeholder:text-[#9B958B]"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => void saveClassification(item)}
                              disabled={savingId !== null}
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-semibold text-white hover:bg-[#29423E] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {savingId === item.id ? (
                                <Loader2
                                  className="h-4 w-4 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Tag className="h-4 w-4" aria-hidden="true" />
                              )}
                              감사 기록과 함께 분류
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-[6px] border border-black/5 bg-white p-5">
      <div className="flex items-center gap-2 text-xs font-semibold text-[#6F6A62]">
        <Icon className="h-4 w-4 text-[#607D70]" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-[#252824]">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-[#7A746B]">{note}</p>
    </div>
  );
}

function OriginRow({
  label,
  counts,
}: {
  label: string;
  counts: OriginCounts;
}) {
  return (
    <tr className="border-b border-[#F0ECE6] last:border-0">
      <th className="px-3 py-4 font-semibold text-[#252824]">{label}</th>
      <td className="px-3 py-4 text-[#4E4A43]">{counts.member}</td>
      <td className="px-3 py-4 text-[#4E4A43]">{counts.operator}</td>
      <td className="px-3 py-4 text-[#4E4A43]">{counts.ai}</td>
      <td className="px-3 py-4 text-[#4E4A43]">
        {counts.industry_professional}
      </td>
      <td className="px-3 py-4 font-semibold text-[#A45C1B]">
        {counts.legacy_unverified}
      </td>
    </tr>
  );
}
