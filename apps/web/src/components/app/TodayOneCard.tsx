"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  RotateCcw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import {
  TODAY_ONE_CARE_KINDS_PARAM,
  validateTodayOneCareResponse,
  type TodayOneCareAction,
  type TodayOneCareCard as TodayOneCareCardData,
  type TodayOneCareKind,
  type TodayOneCareResponse,
} from "@hanbang/shared";

import { useAuthStore } from "@/stores/authStore";

type ParsedPayload =
  | { available: false }
  | {
      available: true;
      result: TodayOneCareResponse;
      error?: string;
      code?: string;
    };
type FetchResult = { ok: boolean; status: number; payload: unknown };
type ViewState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; result: TodayOneCareResponse & { card: TodayOneCareCardData } }
  | { kind: "empty"; message: string }
  | { kind: "paused"; message: string }
  | { kind: "stale"; message: string }
  | { kind: "error"; message: string };

const REQUEST_CACHE_TTL_MS = 15_000;
const requestCache = new Map<
  string,
  { expiresAt: number; promise: Promise<FetchResult> }
>();

function parsePayload(value: unknown, userId: string): ParsedPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.available === false) return { available: false };
  if (record.available !== true) return null;
  const validation = validateTodayOneCareResponse(record.result, userId);
  if (!validation.ok) return null;
  return {
    available: true,
    result: validation.value,
    ...(typeof record.error === "string" && record.error.length <= 240
      ? { error: record.error }
      : {}),
    ...(typeof record.code === "string" && record.code.length <= 80
      ? { code: record.code }
      : {}),
  };
}

// 이 화면은 25장 2절의 새 종류(할 일 마감, 두 분이 정할 것, 답 없는 문의)를 그릴 수 있다고 서버에 알린다.
const SURFACE_PATH = `/api/amora/today-one?${TODAY_ONE_CARE_KINDS_PARAM.name}=${TODAY_ONE_CARE_KINDS_PARAM.value}`;

/** "현재 저장된 ○○에서 확인됨"과 "현재 ○○ 기록 N"에 쓰는 말. 새 종류의 판 번호는 준비 기록의 판이다. */
const KIND_LABELS: Record<TodayOneCareKind, { record: string; revision: string }> = {
  schedule_moment: { record: "일정", revision: "일정" },
  budget_guardrail: { record: "예산", revision: "예산" },
  task_deadline: { record: "할 일", revision: "준비" },
  couple_decision: { record: "문의 기록", revision: "준비" },
  inquiry_waiting: { record: "문의 기록", revision: "준비" },
  task_done: { record: "맡은 일", revision: "준비" },
};

async function fetchSurface(): Promise<FetchResult> {
  const response = await fetch(SURFACE_PATH, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  return {
    ok: response.ok,
    status: response.status,
    payload: await response.json().catch(() => null),
  };
}

function loadSurface(userId: string, force = false): Promise<FetchResult> {
  if (force) requestCache.delete(userId);
  const cached = requestCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = fetchSurface().catch((error) => {
    requestCache.delete(userId);
    throw error;
  });
  requestCache.set(userId, {
    expiresAt: Date.now() + REQUEST_CACHE_TTL_MS,
    promise,
  });
  return promise;
}

export function __resetTodayOneCardRequestCacheForTests() {
  requestCache.clear();
}

function formatYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function viewFromPayload(
  raw: FetchResult,
  userId: string,
  successMessage?: string,
): ViewState {
  const parsed = parsePayload(raw.payload, userId);
  if (!parsed) {
    return {
      kind: "error",
      message: "오늘 확인할 내용의 응답을 확인하지 못했어요.",
    };
  }
  if (!parsed.available) return { kind: "unavailable" };
  if (parsed.result.state === "source_stale") {
    return {
      kind: "stale",
      message:
        parsed.error
        ?? "기록이 바뀌었어요. 최신 내용을 다시 불러와 확인해 주세요.",
    };
  }
  if (!raw.ok) {
    return {
      kind: "error",
      message: parsed.error ?? "오늘 확인할 내용을 불러오지 못했어요.",
    };
  }
  if (parsed.result.state === "ready" && parsed.result.card) {
    return {
      kind: "ready",
      result: parsed.result as TodayOneCareResponse & { card: TodayOneCareCardData },
    };
  }
  if (parsed.result.state === "paused") {
    return {
      kind: "paused",
      message: successMessage ?? "오늘의 한 가지는 잠시 쉬고 있어요.",
    };
  }
  if (parsed.result.state === "disabled") return { kind: "unavailable" };
  return {
    kind: "empty",
    message: successMessage
      ?? (parsed.result.state === "daily_limit"
        ? "오늘의 한 가지는 이미 확인했어요."
        : "오늘 새로 확인할 내용은 없어요."),
  };
}

const ACTION_LABELS: Record<Exclude<TodayOneCareAction, "open_source">, string> = {
  snooze: "나중에",
  dismiss: "오늘 숨기기",
  mute_source: "내용이 바뀔 때까지 숨기기",
};

const ACTION_SUCCESS: Record<Exclude<TodayOneCareAction, "open_source">, string> = {
  snooze: "확인했어요. 잠시 후 다시 보여드릴게요.",
  dismiss: "오늘은 숨겼어요.",
  mute_source: "현재 내용은 숨겼어요. 내용이 달라지면 다시 보여드려요.",
};

export default function TodayOneCard() {
  const router = useRouter();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [pendingAction, setPendingAction] = useState<TodayOneCareAction | null>(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async (force = false) => {
    if (!userId) {
      setView({ kind: "unavailable" });
      return;
    }
    setView({ kind: "loading" });
    setActionError("");
    try {
      const raw = await loadSurface(userId, force);
      setView(viewFromPayload(raw, userId));
    } catch {
      setView({
        kind: "error",
        message: "오늘 확인할 내용을 불러오지 못했어요.",
      });
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setView({ kind: "unavailable" });
      return () => { active = false; };
    }
    setView({ kind: "loading" });
    void loadSurface(userId)
      .then((raw) => {
        if (active) setView(viewFromPayload(raw, userId));
      })
      .catch(() => {
        if (active) {
          setView({
            kind: "error",
            message: "오늘 확인할 내용을 불러오지 못했어요.",
          });
        }
      });
    return () => { active = false; };
  }, [userId]);

  async function actOnCard(action: TodayOneCareAction) {
    if (view.kind !== "ready" || !userId || pendingAction) return;
    const card = view.result.card;
    setPendingAction(action);
    setActionError("");
    try {
      const response = await fetch("/api/amora/today-one", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardId: card.id,
          expectedRevision: card.revision,
          expectedSourceRevision: card.sourceRevision,
          action,
        }),
      });
      const payload = await response.json().catch(() => null);
      const raw = { ok: response.ok, status: response.status, payload };
      const next = viewFromPayload(
        raw,
        userId,
        action === "open_source" ? undefined : ACTION_SUCCESS[action],
      );
      if (next.kind === "error") {
        setActionError(next.message);
        return;
      }
      if (next.kind === "stale") {
        requestCache.delete(userId);
        setView(next);
        return;
      }
      requestCache.delete(userId);
      if (action === "open_source") {
        if (next.kind === "empty" || next.kind === "paused") {
          router.push(card.nextAction.href);
          return;
        }
        setActionError("기록 열기 상태를 확인하지 못했어요.");
        return;
      }
      setView(next);
    } catch {
      setActionError("선택을 저장하지 못했어요. 카드에는 아무것도 바뀌지 않았어요.");
    } finally {
      setPendingAction(null);
    }
  }

  if (view.kind === "unavailable") return null;
  if (view.kind === "loading") {
    return (
      <p role="status" className="sr-only" aria-live="polite">
        오늘의 한 가지 확인 중
      </p>
    );
  }
  if (view.kind === "error" || view.kind === "stale") {
    return (
      <section
        className="rounded-[6px] border border-[#E2D3C8] bg-white px-5 py-4 shadow-[var(--shadow-raised)]"
        aria-labelledby="today-one-error-title"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--hb-surface-hover)] text-rose-700">
            <RotateCcw className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="today-one-error-title" className="hb-h-sm text-[var(--hb-text-strong)]">
              오늘의 한 가지를 다시 확인해 주세요
            </h2>
            <p role="alert" className="mt-1 text-sm leading-6 text-[#6D5F58]">
              {view.message}
            </p>
            <button
              type="button"
              onClick={() => void load(true)}
              className="mt-3 inline-flex min-h-10 items-center justify-center rounded-[6px] border border-[#C7D1C2] bg-white px-4 text-sm font-semibold text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)]"
            >
              다시 불러오기
            </button>
          </div>
        </div>
      </section>
    );
  }
  if (view.kind === "empty" || view.kind === "paused") {
    return (
      <section
        className="rounded-[6px] border border-[#E2D3C8] bg-[var(--hb-surface-page)] px-5 py-4"
        aria-label="아모라 오늘의 한 가지 상태"
      >
        <div className="flex items-center gap-3">
          {view.kind === "paused" ? (
            <Clock3 className="h-5 w-5 shrink-0 text-[#8F6662]" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--hb-success)]" aria-hidden="true" />
          )}
          <div>
            <p className="text-sm font-semibold text-[var(--hb-text-strong)]">아모라 오늘의 한 가지</p>
            <p role="status" className="mt-0.5 text-sm text-[#6D5F58]">{view.message}</p>
          </div>
        </div>
      </section>
    );
  }

  const card = view.result.card;
  const recordLabel = KIND_LABELS[card.kind].record;
  const revisionLabel = KIND_LABELS[card.kind].revision;
  const ConfirmedIcon = card.kind === "budget_guardrail"
    ? WalletCards
    : card.kind === "schedule_moment" ? CalendarClock : CheckCircle2;
  const actions = new Set(card.choices.map((choice) => choice.action));
  return (
    <section
      className="overflow-hidden rounded-[6px] border border-[#C7D1C2] bg-white shadow-[var(--shadow-overlay)]"
      aria-labelledby="today-one-title"
    >
      <div className="bg-[var(--hb-primary)] px-5 py-5 text-white md:px-6">
        <div className="flex items-center justify-between gap-4">
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--hb-on-primary)]">
            <AmoraMark className="h-4 w-4" aria-hidden="true" />
            아모라 오늘의 한 가지 · 인앱
          </p>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--hb-on-primary)]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            외부 알림 아님
          </span>
        </div>
        <h2 id="today-one-title" className="mt-3">
          왜 지금 보여드리나요
        </h2>
        <p className="mt-1.5 text-[15px] leading-7 text-[#FBF8F2]">{card.whyNow}</p>
      </div>

      <div className="space-y-5 px-5 py-5 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--hb-success)]">
          <time dateTime={view.result.claimedForDate}>
            {formatYmd(view.result.claimedForDate)} 기준
          </time>
          <span aria-label={`현재 ${revisionLabel} 기록 버전 ${card.sourceRevision}, 확인 전`}>
            현재 {revisionLabel} 기록 {card.sourceRevision} · 확인 전
          </span>
        </div>

        <div>
          <p className="text-xs font-semibold text-[var(--color-rose-700)]">
            현재 저장된 {recordLabel}에서 확인됨
          </p>
          <ul className="mt-2 space-y-1.5">
            {card.confirmed.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm leading-6 text-[var(--hb-text-strong)]">
                <ConfirmedIcon className="mt-1 h-4 w-4 shrink-0 text-[var(--hb-success)]" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {card.unknown.length > 0 && (
          <div className="border-t border-[var(--hb-hairline)] pt-4">
            <p className="text-xs font-semibold text-[var(--color-rose-700)]">아직 확인되지 않은 점</p>
            <ul className="mt-2 space-y-1 text-sm leading-6 text-[#6D5F58]">
              {card.unknown.map((item) => <li key={item}>· {item}</li>)}
            </ul>
          </div>
        )}

        <p className="rounded-[6px] bg-[var(--hb-surface-hover)] px-4 py-3 text-xs leading-5 text-[var(--hb-text-strong)]">
          {card.impact}
        </p>

        {actionError && (
          <p role="alert" className="text-sm leading-6 text-[#A04A4A]">
            {actionError}
          </p>
        )}
        {pendingAction && (
          <p role="status" className="text-xs text-[var(--hb-success)]" aria-live="polite">
            선택을 확인하고 있어요. 응답이 확인되기 전에는 카드를 바꾸지 않아요.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {actions.has("open_source") && (
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => void actOnCard("open_source")}
              className="inline-flex min-h-11 items-center justify-center rounded-[6px] bg-[#8F6662] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#7F5956] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] disabled:cursor-wait disabled:opacity-60"
            >
              {card.nextAction.label}
            </button>
          )}
          {(["snooze", "dismiss", "mute_source"] as const).map((action) =>
            actions.has(action) ? (
              <button
                key={action}
                type="button"
                disabled={pendingAction !== null}
                onClick={() => void actOnCard(action)}
                className="inline-flex min-h-11 items-center justify-center rounded-[6px] border border-[#E2D3C8] bg-white px-4 text-sm font-semibold text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] disabled:cursor-wait disabled:opacity-60"
              >
                {ACTION_LABELS[action]}
              </button>
            ) : null,
          )}
        </div>
      </div>
    </section>
  );
}
