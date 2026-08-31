"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { communityPostPath } from "@/lib/community/routes";

type Appeal = {
  id: string;
  status: "pending" | "reviewed" | "upheld" | "overturned";
  reason: string;
  resolution_reason: string | null;
  created_at: string;
  resolved_at: string | null;
};

type ModerationNotice = {
  id: string;
  event_id: string;
  target_type: "post" | "comment";
  target_id: string;
  action: "hide" | "restore" | "soft_delete";
  reason: string;
  appeal_available: boolean;
  read_at: string | null;
  created_at: string;
  appeal: Appeal | null;
};

const ACTION_LABEL: Record<ModerationNotice["action"], string> = {
  hide: "임시 숨김",
  restore: "공개 복원",
  soft_delete: "이용 제한",
};

const APPEAL_STATUS_LABEL: Record<Appeal["status"], string> = {
  pending: "접수됨",
  reviewed: "검토 중",
  upheld: "기존 조치 유지",
  overturned: "조치 변경·복원",
};

export default function CommunityModerationPage() {
  const [notices, setNotices] = useState<ModerationNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submittingEventId, setSubmittingEventId] = useState<string | null>(
    null
  );
  const [submitError, setSubmitError] = useState<Record<string, string>>({});

  const loadNotices = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/community/moderation/notices", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        notices?: ModerationNotice[];
        error?: string;
      };
      if (!response.ok) {
        setLoadError(body.error ?? "운영 알림을 불러오지 못했어요.");
        return;
      }
      setNotices(body.notices ?? []);
    } catch {
      setLoadError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotices();
  }, [loadNotices]);

  async function markRead(notice: ModerationNotice) {
    if (notice.read_at) return;
    const response = await fetch(
      `/api/community/moderation/notices/${notice.id}`,
      { method: "PATCH" }
    );
    if (response.ok) {
      setNotices((current) =>
        current.map((item) =>
          item.id === notice.id
            ? { ...item, read_at: new Date().toISOString() }
            : item
        )
      );
    }
  }

  async function submitAppeal(notice: ModerationNotice) {
    const reason = drafts[notice.event_id]?.trim() ?? "";
    if (reason.length < 10) {
      setSubmitError((current) => ({
        ...current,
        [notice.event_id]: "왜 다시 검토해야 하는지 10자 이상 적어 주세요.",
      }));
      return;
    }

    setSubmittingEventId(notice.event_id);
    setSubmitError((current) => ({ ...current, [notice.event_id]: "" }));
    try {
      const response = await fetch("/api/community/moderation/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: notice.event_id,
          reason,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        appeal?: Appeal;
        error?: string;
      };
      if (!response.ok || !body.appeal) {
        setSubmitError((current) => ({
          ...current,
          [notice.event_id]:
            body.error ?? "이의제기를 접수하지 못했어요.",
        }));
        return;
      }

      setNotices((current) =>
        current.map((item) =>
          item.event_id === notice.event_id
            ? { ...item, appeal: body.appeal ?? null }
            : item
        )
      );
      void markRead(notice);
    } catch {
      setSubmitError((current) => ({
        ...current,
        [notice.event_id]: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
      }));
    } finally {
      setSubmittingEventId(null);
    }
  }

  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[6px] bg-rose-50 text-[var(--hb-accent-hover)]">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="text-[var(--hb-text-strong)]">
          운영 알림과 이의제기
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-taupe-600">
          게시글이나 답변에 운영 조치가 있으면 사유를 그대로 알려드려요.
          다시 검토가 필요한 조치는 이 화면에서 이의를 제기할 수 있어요.
        </p>
      </header>

      {loading ? (
        <div
          className="flex min-h-48 items-center justify-center rounded-[6px] border border-black/[0.06] bg-white"
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin text-[var(--hb-accent-hover)]" />
          <span className="ml-2 text-sm text-taupe-600">불러오는 중</span>
        </div>
      ) : loadError ? (
        <div
          className="rounded-[6px] border border-red-200 bg-red-50 p-5"
          role="alert"
        >
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-medium text-red-800">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadNotices()}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-red-300 px-4 text-sm font-medium text-red-700"
              >
                <RotateCcw className="h-4 w-4" />
                다시 시도
              </button>
            </div>
          </div>
        </div>
      ) : notices.length === 0 ? (
        <div className="rounded-[6px] border border-black/[0.06] bg-white px-5 py-12 text-center">
          <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
          <p className="mt-3 text-sm font-medium text-[var(--hb-text-strong)]">
            확인할 운영 알림이 없어요.
          </p>
          <p className="mt-1 text-sm text-[var(--hb-text-body)]">
            커뮤니티로 돌아가 다른 예비부부의 고민을 살펴보세요.
          </p>
          <Link
            href="/community?feed=all"
            className="mt-5 inline-flex min-h-11 items-center rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-medium text-white"
          >
            커뮤니티 보기
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {notices.map((notice) => {
            const appeal = notice.appeal;
            return (
              <article
                key={notice.id}
                className={`rounded-[6px] border bg-white p-5 shadow-sm ${
                  notice.read_at
                    ? "border-black/[0.06]"
                    : "border-rose-200 ring-1 ring-rose-100"
                }`}
                onFocus={() => void markRead(notice)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {!notice.read_at && (
                        <span className="rounded-full bg-[var(--hb-primary)] px-2 py-0.5 text-[11px] font-semibold text-white">
                          새 알림
                        </span>
                      )}
                      <span className="text-sm font-semibold text-[var(--hb-text-strong)]">
                        {ACTION_LABEL[notice.action]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--hb-text-body)]">
                      {new Date(notice.created_at).toLocaleString("ko-KR")}
                    </p>
                  </div>
                  {notice.target_type === "post" && (
                    <Link
                      href={communityPostPath(notice.target_id)}
                      onClick={() => void markRead(notice)}
                      className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-rose-700"
                    >
                      게시글 확인
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>

                <div className="mt-4 rounded-[6px] bg-stone-50 p-4">
                  <p className="text-xs font-medium text-[var(--hb-text-body)]">조치 사유</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--hb-text-strong)]">
                    {notice.reason}
                  </p>
                </div>

                {appeal ? (
                  <div className="mt-4 rounded-[6px] border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-semibold text-emerald-900">
                      이의제기 {APPEAL_STATUS_LABEL[appeal.status]}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-900/80">
                      {appeal.reason}
                    </p>
                    {appeal.resolution_reason && (
                      <div className="mt-3 border-t border-emerald-200 pt-3">
                        <p className="text-xs font-medium text-emerald-800">
                          검토 결과
                        </p>
                        <p className="mt-1 text-sm leading-6 text-emerald-900">
                          {appeal.resolution_reason}
                        </p>
                      </div>
                    )}
                  </div>
                ) : notice.appeal_available ? (
                  <div className="mt-4">
                    <label
                      htmlFor={`appeal-${notice.event_id}`}
                      className="text-sm font-medium text-[var(--hb-text-strong)]"
                    >
                      다시 검토가 필요한 이유
                    </label>
                    <textarea
                      id={`appeal-${notice.event_id}`}
                      value={drafts[notice.event_id] ?? ""}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [notice.event_id]: event.target.value.slice(0, 2_000),
                        }))
                      }
                      rows={4}
                      maxLength={2_000}
                      placeholder="사실관계, 빠진 맥락, 수정한 내용을 구체적으로 적어 주세요."
                      className="mt-2 w-full rounded-[6px] border border-black/10 px-3 py-3 text-sm leading-6 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                    />
                    {submitError[notice.event_id] && (
                      <p className="mt-2 text-sm text-red-600" role="alert">
                        {submitError[notice.event_id]}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void submitAppeal(notice)}
                      disabled={submittingEventId === notice.event_id}
                      className="mt-3 inline-flex min-h-11 items-center justify-center rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {submittingEventId === notice.event_id
                        ? "접수 중"
                        : "이의제기 접수"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-[var(--hb-text-body)]">
                    이 조치는 별도 이의제기 대상이 아닙니다. 문의가 필요하면
                    고객지원으로 알려 주세요.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
