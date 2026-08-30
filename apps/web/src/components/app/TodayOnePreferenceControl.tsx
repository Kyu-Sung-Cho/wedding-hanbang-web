"use client";

import { useCallback, useEffect, useState } from "react";
import { BellOff, Clock3, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";

import { useAuthStore } from "@/stores/authStore";

type Preference = {
  enabled: boolean;
  optedInAt: string | null;
  pausedUntil: string | null;
  dailyLimit: 1;
};
type Payload =
  | { available: false }
  | { available: true; preference: Preference };
type FetchResult = { ok: boolean; payload: unknown };
type View =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; preference: Preference }
  | { kind: "error"; message: string };
type PreferenceMode = "enable" | "disable" | "pause_24h";

const CACHE_TTL_MS = 15_000;
const preferenceCache = new Map<
  string,
  { expiresAt: number; promise: Promise<FetchResult> }
>();

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function parsePayload(value: unknown): Payload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.available === false) return { available: false };
  if (
    record.available !== true
    || !record.preference
    || typeof record.preference !== "object"
    || Array.isArray(record.preference)
  ) {
    return null;
  }
  const raw = record.preference as Record<string, unknown>;
  if (
    typeof raw.enabled !== "boolean"
    || !(raw.optedInAt === null || isIsoTimestamp(raw.optedInAt))
    || !(raw.pausedUntil === null || isIsoTimestamp(raw.pausedUntil))
    || raw.dailyLimit !== 1
    || raw.enabled !== (raw.optedInAt !== null)
    || (!raw.enabled && raw.pausedUntil !== null)
  ) {
    return null;
  }
  return {
    available: true,
    preference: {
      enabled: raw.enabled,
      optedInAt: raw.optedInAt,
      pausedUntil: raw.pausedUntil,
      dailyLimit: 1,
    },
  };
}

async function fetchPreference(): Promise<FetchResult> {
  const response = await fetch("/api/amora/today-one/preferences", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  return {
    ok: response.ok,
    payload: await response.json().catch(() => null),
  };
}

function loadPreference(userId: string, force = false) {
  if (force) preferenceCache.delete(userId);
  const cached = preferenceCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = fetchPreference().catch((error) => {
    preferenceCache.delete(userId);
    throw error;
  });
  preferenceCache.set(userId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    promise,
  });
  return promise;
}

export function __resetTodayOnePreferenceCacheForTests() {
  preferenceCache.clear();
}

function viewFromResult(result: FetchResult): View {
  const payload = parsePayload(result.payload);
  if (!payload) {
    return { kind: "error", message: "설정 응답을 확인하지 못했어요." };
  }
  if (!payload.available) return { kind: "unavailable" };
  if (!result.ok) {
    return { kind: "error", message: "설정을 불러오지 못했어요." };
  }
  return { kind: "ready", preference: payload.preference };
}

function formatPause(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function TodayOnePreferenceControl() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [saving, setSaving] = useState<PreferenceMode | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (force = false) => {
    if (!userId) {
      setView({ kind: "unavailable" });
      return;
    }
    setView({ kind: "loading" });
    setError("");
    try {
      setView(viewFromResult(await loadPreference(userId, force)));
    } catch {
      setView({ kind: "error", message: "설정을 불러오지 못했어요." });
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setView({ kind: "unavailable" });
      return () => { active = false; };
    }
    void loadPreference(userId)
      .then((result) => {
        if (active) setView(viewFromResult(result));
      })
      .catch(() => {
        if (active) setView({ kind: "error", message: "설정을 불러오지 못했어요." });
      });
    return () => { active = false; };
  }, [userId]);

  async function update(mode: PreferenceMode) {
    if (!userId || view.kind !== "ready" || saving) return;
    setSaving(mode);
    setError("");
    try {
      const response = await fetch("/api/amora/today-one/preferences", {
        method: "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode }),
      });
      const payload = parsePayload(await response.json().catch(() => null));
      if (!response.ok || !payload?.available) {
        setError("설정을 저장하지 못했어요. 기존 설정은 그대로예요.");
        return;
      }
      preferenceCache.delete(userId);
      setView({ kind: "ready", preference: payload.preference });
    } catch {
      setError("설정을 저장하지 못했어요. 기존 설정은 그대로예요.");
    } finally {
      setSaving(null);
    }
  }

  if (view.kind === "unavailable") return null;
  if (view.kind === "loading") {
    return <p role="status" className="sr-only">오늘의 한 가지 설정 확인 중</p>;
  }
  if (view.kind === "error") {
    return (
      <div className="border-t border-[#E8E0D8] px-5 pt-5">
        <p role="alert" className="text-sm text-[#A04A4A]">{view.message}</p>
        <button
          type="button"
          onClick={() => void load(true)}
          className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-[6px] border border-[#E2D3C8] px-4 text-sm font-semibold text-[var(--hb-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)]"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          다시 불러오기
        </button>
      </div>
    );
  }

  const { preference } = view;
  const paused = Boolean(
    preference.enabled
    && preference.pausedUntil
    && new Date(preference.pausedUntil).getTime() > Date.now(),
  );
  return (
    <div className="mt-5 border-t border-[#E8E0D8] px-5 pt-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--hb-surface-hover)] text-[var(--hb-text-strong)]">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[17px] font-medium text-[var(--hb-text-strong)]">
                아모라 오늘의 한 가지(인앱)
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--hb-surface-hover)] px-2 py-1 text-[11px] font-semibold text-[var(--hb-text-strong)]">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {preference.enabled ? (paused ? "일시정지 중" : "사용 중") : "기본 꺼짐"}
              </span>
            </div>
            <p className="mt-1 text-sm font-light leading-6 text-[#6D806E]">
              일정·예산에서 지금 확인할 한 가지를 대시보드 안에서만 보여줘요. 푸시·문자·이메일을 보내지 않아요.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="아모라 오늘의 한 가지(인앱)"
          aria-checked={preference.enabled}
          disabled={saving !== null}
          onClick={() => void update(preference.enabled ? "disable" : "enable")}
          className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] disabled:cursor-wait disabled:opacity-60 ${
            preference.enabled ? "bg-[var(--hb-primary)]" : "bg-[#B5ADA3]/30"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
              preference.enabled ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {preference.enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-[52px]">
          {paused ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-rose-700)]">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                {formatPause(preference.pausedUntil!)}까지 쉬어요
              </span>
              <button
                type="button"
                disabled={saving !== null}
                onClick={() => void update("enable")}
                className="min-h-9 rounded-[6px] border border-[#C7D1C2] px-3 text-xs font-semibold text-[var(--hb-text-strong)] disabled:cursor-wait disabled:opacity-60"
              >
                다시 시작
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => void update("pause_24h")}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[6px] border border-[#E2D3C8] px-3 text-xs font-semibold text-[var(--color-rose-700)] disabled:cursor-wait disabled:opacity-60"
            >
              <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
              24시간 쉬기
            </button>
          )}
        </div>
      )}

      {saving && (
        <p role="status" className="mt-2 pl-[52px] text-xs text-[#6D806E]">
          서버에서 설정을 확인하고 있어요. 확인 전에는 표시를 바꾸지 않아요.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 pl-[52px] text-sm text-[#A04A4A]">{error}</p>
      )}
    </div>
  );
}
