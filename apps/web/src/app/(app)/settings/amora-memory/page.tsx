"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

type Visibility = "shared" | "bride_private" | "groom_private";

type MemorySetting = {
  visibility: Visibility;
  enabled: boolean;
  consentedByMe: boolean;
  consentedCount: number;
  requiredCount: number;
  enabledAt: string | null;
  memoryResetAt: string | null;
  legacyPurgedAt: string | null;
  pendingPurge: { memories: number; summaries: number; profiles: number; total: number };
};

type MemoryItem = {
  id: string;
  visibility: Visibility;
  memoryKey: string | null;
  category: string | null;
  decisionType: string | null;
  kind: string;
  title: string | null;
  value: unknown;
  reasoning: string | null;
  confidence: number | null;
  userConfirmedAt: string | null;
  userCorrected: boolean;
  sourceMessageId: string | null;
  updatedAt: string;
};

type MemoryProfile = {
  visibility: Visibility;
  persona_summary: string | null;
  budget_posture: string | null;
  decision_style: string | null;
  taste_profile: string | null;
  communication_style: string | null;
  conflict_pattern: string | null;
  recommendation_rules: string[];
  open_questions: string[];
  confidence_score: number;
  updated_at: string;
};

/**
 * 기억을 처음 켜는 순간 서버가 무엇을 지우는지 사람 말로 옮긴다.
 *
 * 끝에 조사를 붙이지 않는다. 목록의 마지막이 "…개"(모음)일 때도 "상담 참고
 * 맥락"(자음)일 때도 맞는 조사가 달라진다. 조사 후보를 괄호로 나열하는 기계 한국어는
 * 제품을 미완성으로 보이게 하므로, 여기서 문장을 끊고 다음 문장으로 넘긴다.
 *
 * 숫자는 서버가 SQL 의 DELETE 조건과 같은 조건으로 센 값이다. 여기서 다시 계산하지
 * 않는다 — 화면이 말한 숫자와 실제로 지워지는 양이 어긋나면 경고가 없느니만 못하다.
 */
/**
 * 되돌릴 수 없는 일을 하기 전에 한 번 멈춘다.
 *
 * 이 화면에는 그런 자리가 둘이다 — **기억 초기화**와 **처음 켜기**(켜는 순간 서버가
 * 기존 자동 기억·대화 요약·프로필을 지운다). 둘은 문구만 다르고 생김새가 같았다.
 *
 * 손으로 만든 버튼 태그는 늘리지 않는다(`rawButtonRatchet.test.ts` — 그 래칫은
 * 주석 안의 글자까지 세므로 여기에 태그를 그대로 적지 않는다). 두 패널을
 * 따로 두면 버튼이 넷이 되지만, 같은 것을 하나로 두면 둘이면 된다. `Button`
 * 프리미티브에는 아직 위험(빨강) 변형이 없고 `--hb-danger` 토큰도 없어서, 변형을
 * 새로 만드는 것은 디자인 결정이라 여기서 하지 않는다.
 */
function DangerConfirm({
  className, title, body, confirmLabel, cancelLabel, busy, onConfirm, onCancel,
}: {
  className: string;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={className}>
      <p className="text-sm font-medium text-red-800">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-red-700">{body}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={onConfirm} className="min-h-11 rounded-[6px] bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50">{confirmLabel}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-[6px] bg-white px-4 text-sm font-medium text-[var(--hb-text-strong)] ring-1 ring-[#E2D3C8]">{cancelLabel}</button>
      </div>
    </div>
  );
}

function describePendingPurge(setting: MemorySetting): string {
  const parts: string[] = [];
  if (setting.pendingPurge.memories > 0) parts.push(`정리된 기억 ${setting.pendingPurge.memories}개`);
  if (setting.pendingPurge.summaries > 0) parts.push(`대화 요약 ${setting.pendingPurge.summaries}개`);
  if (setting.pendingPurge.profiles > 0) parts.push("상담 참고 맥락");
  return parts.join(", ");
}

type MemoryResponse = {
  runtimeEnabled: boolean;
  settings: MemorySetting[];
  memories: MemoryItem[];
  profiles: MemoryProfile[];
};

const KIND_LABELS: Record<string, string> = {
  decision: "대화에서 말한 선택",
  preference: "선호",
  constraint: "꼭 지킬 조건",
  relationship: "가족·커플 맥락",
  fact: "준비 정보",
  legacy: "이전 대화 기억",
};

function valueToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "내용을 확인해주세요";
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

function memorySettingsOwnerKey(state: ReturnType<typeof useAuthStore.getState>): string | null {
  if (state.isDemo || !state.user) return null;
  const profileCoupleId = state.profile?.couple_id ?? "";
  const coupleId = state.couple?.id ?? "";
  // 준비 공간을 갱신하는 중 두 정본이 다르면 이전 공간의 확인을 사용할 수 없다.
  if (profileCoupleId && coupleId && profileCoupleId !== coupleId) return null;
  return [
    state.user.id, profileCoupleId, coupleId, state.profile?.role ?? "",
    state.couple?.bride_id ?? "", state.couple?.groom_id ?? "",
  ].join(":");
}

export default function AmoraMemorySettingsPage() {
  const ownerKey = useAuthStore(memorySettingsOwnerKey);
  // 계정·준비 공간이 바뀌면 이전 기억과 동의 확인을 같은 화면에 남기지 않는다.
  return <MemorySettingsContent key={ownerKey ?? "unavailable"} ownerKey={ownerKey} />;
}

function MemorySettingsContent({ ownerKey }: { ownerKey: string | null }) {
  const [data, setData] = useState<MemoryResponse | null>(null);
  const [activeVisibility, setActiveVisibility] = useState<Visibility>("shared");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editValue, setEditValue] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const mounted = useRef(false);
  const loadSequence = useRef(0);
  const isCurrentOwner = useCallback(() => mounted.current && ownerKey !== null
    && memorySettingsOwnerKey(useAuthStore.getState()) === ownerKey, [ownerKey]);

  const load = useCallback(async () => {
    if (!ownerKey) {
      setLoading(false);
      setError("로그인과 준비 공간 정보를 확인한 뒤 다시 열어주세요.");
      return;
    }
    if (!isCurrentOwner()) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/amora/memory", { cache: "no-store" });
      const payload = await response.json() as MemoryResponse & { error?: string };
      if (!isCurrentOwner() || sequence !== loadSequence.current) return;
      if (!response.ok) throw new Error(payload.error ?? "기억을 불러오지 못했어요.");
      setData(payload);
      const available = payload.settings.map((setting) => setting.visibility);
      setActiveVisibility((current) => available.includes(current) ? current : available[0] ?? "shared");
    } catch (loadError) {
      if (isCurrentOwner() && sequence === loadSequence.current) {
        setError(loadError instanceof Error ? loadError.message : "기억을 불러오지 못했어요.");
      }
    } finally {
      if (isCurrentOwner() && sequence === loadSequence.current) setLoading(false);
    }
  }, [isCurrentOwner, ownerKey]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; loadSequence.current += 1; };
  }, [load]);

  const setting = data?.settings.find((item) => item.visibility === activeVisibility);
  const memories = useMemo(
    () => (data?.memories ?? []).filter((item) => item.visibility === activeVisibility),
    [activeVisibility, data?.memories],
  );
  const profile = data?.profiles.find((item) => item.visibility === activeVisibility);
  const profileLines = profile
    ? [
        profile.persona_summary,
        profile.budget_posture,
        profile.decision_style,
        profile.taste_profile,
        profile.communication_style,
        ...(profile.recommendation_rules ?? []),
      ].filter((line): line is string => typeof line === "string" && line.trim().length > 0).slice(0, 6)
    : [];

  async function patch(body: Record<string, unknown>) {
    if (!isCurrentOwner()) return false;
    const response = await fetch("/api/amora/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { error?: string };
    if (!isCurrentOwner()) return false;
    if (!response.ok) throw new Error(payload.error ?? "설정을 바꾸지 못했어요.");
    return true;
  }

  async function toggleMemory() {
    if (!setting || busy) return;
    if (!data?.runtimeEnabled && !setting.consentedByMe) return;
    // 처음 켜는 순간 서버가 기존 자동 기억·대화 요약·맞춤 맥락을 지운다. 되돌릴 수
    // 없으므로 무엇이 사라지는지 먼저 보여주고, 사람이 한 번 더 누르게 한다.
    const willPurge = !setting.consentedByMe
      && setting.legacyPurgedAt === null
      && setting.pendingPurge.total > 0;
    if (willPurge && !confirmEnable) {
      setConfirmEnable(true);
      return;
    }
    await applyMemoryToggle();
  }

  async function applyMemoryToggle() {
    if (!setting || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!await patch({ action: "toggle", visibility: activeVisibility, enabled: !setting.consentedByMe })) return;
      setConfirmEnable(false);
      await load();
    } catch (toggleError) {
      if (isCurrentOwner()) setError(toggleError instanceof Error ? toggleError.message : "설정을 바꾸지 못했어요.");
    } finally {
      if (isCurrentOwner()) setBusy(false);
    }
  }

  function startEditing(memory: MemoryItem) {
    setDeletingId(null);
    setEditingId(memory.id);
    setEditTitle(memory.title ?? "");
    setEditValue(valueToText(memory.value));
  }

  async function saveMemory(memory: MemoryItem) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!await patch({
        action: "update_memory",
        visibility: activeVisibility,
        memoryId: memory.id,
        title: editTitle,
        value: editValue,
      })) return;
      setEditingId(null);
      await load();
    } catch (saveError) {
      if (isCurrentOwner()) setError(saveError instanceof Error ? saveError.message : "기억을 고치지 못했어요.");
    } finally {
      if (isCurrentOwner()) setBusy(false);
    }
  }

  async function deleteMemory(memory: MemoryItem) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!await patch({ action: "delete_memory", visibility: activeVisibility, memoryId: memory.id })) return;
      setDeletingId(null);
      await load();
    } catch (deleteError) {
      if (isCurrentOwner()) setError(deleteError instanceof Error ? deleteError.message : "기억을 지우지 못했어요.");
    } finally {
      if (isCurrentOwner()) setBusy(false);
    }
  }

  async function clearScope() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!await patch({ action: "clear_scope", visibility: activeVisibility })) return;
      setConfirmClear(false);
      await load();
    } catch (clearError) {
      if (isCurrentOwner()) setError(clearError instanceof Error ? clearError.message : "기억을 모두 지우지 못했어요.");
    } finally {
      if (isCurrentOwner()) setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
      <div className="mb-7 flex items-center gap-3">
        <Link
          {...weddingLinkProps("/settings")}
          aria-label="설정으로 돌아가기"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[var(--hb-text-strong)] shadow-sm transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.16em] text-[var(--color-rose-700)]">AMORA MEMORY</p>
          <h1 className="text-[var(--hb-text-strong)]">아모라가 기억하는 것</h1>
        </div>
      </div>

      <section className="mb-5 rounded-[6px] bg-gradient-to-br from-[var(--hb-surface-page)] to-[var(--hb-surface-hover)] p-5 ring-1 ring-[#E2D3C8] sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[6px] bg-[#8F6662] text-white">
            <BrainCircuit className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[var(--hb-text-strong)]">기억의 주인은 두 분이에요</h2>
            <p className="mt-1 text-sm font-light leading-relaxed text-[var(--hb-text-strong)]">
              켜 두면 대화에서 직접 확정한 선택과 취향을 정리해 다음 상담에 활용해요. 틀린 내용은 고치고, 원치 않는 기억은 언제든 지울 수 있어요.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[#725F55]">
              건강·임신·난임·성생활처럼 민감한 내용은 장기 기억에 저장하지
              않아요. 주민번호·계좌번호·정확한 주소·계약·예약번호는 입력하지
              마세요.
            </p>
          </div>
        </div>
      </section>

      {data && data.settings.length > 1 && (
        <div className="mb-4 grid grid-cols-2 rounded-[6px] bg-[#EDE7E5] p-1" role="tablist" aria-label="기억 범위">
          {data.settings.map((item) => {
            const shared = item.visibility === "shared";
            return (
              <button
                key={item.visibility}
                type="button"
                role="tab"
                disabled={busy || loading}
                aria-selected={activeVisibility === item.visibility}
                onClick={() => {
                  setActiveVisibility(item.visibility);
                  setConfirmClear(false);
                  setConfirmEnable(false);
                  setDeletingId(null);
                  setEditingId(null);
                }}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-[6px] px-3 text-sm font-medium transition-all ${activeVisibility === item.visibility ? "bg-white text-[var(--hb-text-strong)] shadow-sm" : "text-[#6F6660]"}`}
              >
                {shared ? <Users className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {shared ? "둘이 함께" : "나만 상담"}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-[6px] bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--hb-accent-hover)]" />
        </div>
      ) : error && !data ? (
        <div className="rounded-[6px] bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-[var(--hb-accent-hover)]">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-medium text-white">
            <RefreshCw className="h-4 w-4" /> 다시 불러오기
          </button>
        </div>
      ) : (
        <>
          {data && !data.runtimeEnabled && (
            <p role="status" className="mb-4 rounded-[6px] border border-[#E2D3C8] bg-[var(--hb-surface-page)] px-4 py-3 text-sm leading-relaxed text-[var(--hb-text-strong)]">
              새 기억 저장은 아직 준비 중이에요. 기존 기억은 확인·수정·삭제할 수 있고, 기억 사용 동의는 철회할 수 있어요.
            </p>
          )}
          <section className="mb-5 rounded-[6px] bg-white p-5 shadow-[var(--shadow-raised)] sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {activeVisibility === "shared" ? <Users className="h-4 w-4 text-[var(--hb-accent-hover)]" /> : <Eye className="h-4 w-4 text-[var(--hb-accent-hover)]" />}
                  <h2 className="text-[var(--hb-text-strong)]">
                    {activeVisibility === "shared" ? "내 공유 기억 동의" : "나만 상담 기억"}
                  </h2>
                </div>
                <p className="mt-1 text-sm font-light leading-relaxed text-[var(--hb-text-muted)]">
                  {!data?.runtimeEnabled
                    ? "새 기억 저장은 아직 준비 중이에요. 동의 설정과 기존 기억을 확인할 수 있어요."
                    : activeVisibility === "shared"
                    ? setting?.enabled
                      ? "공유 기억 상태 · 켜짐. 두 분이 각각 동의했고 함께 보고 활용해요."
                      : setting?.consentedByMe
                        ? `공유 기억 상태 · 동의 대기 (${setting.consentedCount}/${setting.requiredCount}). 파트너 구성 변경 시 두 분의 동의를 새로 받아요.`
                        : "공유 기억 상태 · 꺼짐. 파트너 연결 후 두 분이 각각 동의해야 시작돼요."
                    : `나만 상담 기억 상태 · ${setting?.enabled ? "켜짐" : "꺼짐"}. 파트너에게 보이지 않아요.`}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={setting?.consentedByMe === true}
                aria-label={activeVisibility === "shared" ? "내 공유 기억 동의" : "나만 상담 기억"}
                disabled={busy || !setting || (!data?.runtimeEnabled && !setting.consentedByMe)}
                onClick={() => void toggleMemory()}
                className="relative h-11 w-14 flex-shrink-0 rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <span className={`absolute inset-x-1 top-2 h-7 rounded-full transition-colors ${setting?.consentedByMe ? "bg-[#2E7D5A]" : "bg-[#D8D1CC]"}`} />
                <span className={`absolute left-0 top-2.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${setting?.consentedByMe ? "translate-x-7" : "translate-x-1.5"}`} />
              </button>
            </div>
          </section>

          {confirmEnable && setting && (
            <DangerConfirm
              className="mb-4 rounded-[6px] border border-red-200 bg-red-50 px-5 py-4 sm:px-6"
              title={activeVisibility === "shared"
                ? "두 분이 모두 켜는 순간, 지금 쌓여 있는 기록이 지워져요"
                : "켜는 순간, 지금 쌓여 있는 기록이 지워져요"}
              body={`${describePendingPurge(setting)}. 되돌릴 수 없어요. 동의하기 전에 아모라가 혼자 정리해 둔 것이라, 켤 때는 지금부터 새로 쌓아요. 직접 고친 기억과 채팅 원문, 저장한 일정·예산은 그대로예요.`}
              confirmLabel="지우고 켜기"
              cancelLabel="그대로 두기"
              busy={busy}
              onConfirm={() => void applyMemoryToggle()}
              onCancel={() => setConfirmEnable(false)}
            />
          )}

          {error && <p role="alert" className="mb-4 rounded-[6px] bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          {profileLines.length > 0 && (
            <section className="mb-5 rounded-[6px] border border-[#E8DDD3] bg-[#fffdfb] p-5 sm:p-6">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#2E7D5A]" />
                <h2 className="text-[var(--hb-text-strong)]">상담할 때 참고하는 맥락</h2>
              </div>
              <ul className="space-y-2">
                {profileLines.map((line, index) => <li key={`${line}-${index}`} className="text-sm leading-relaxed text-[var(--hb-text-body)]">• {line}</li>)}
              </ul>
            </section>
          )}

          <section className="overflow-hidden rounded-[6px] bg-white shadow-[var(--shadow-raised)]">
            <div className="flex items-center justify-between gap-3 border-b border-[#F0ECE9] px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-[var(--hb-text-strong)]">정리된 기억 {memories.length}개</h2>
                <p className="mt-0.5 text-xs text-[var(--hb-success)]">직접 고친 기억은 아모라가 자동으로 덮어쓰지 않아요</p>
              </div>
              {setting && !confirmClear && (
                <button type="button" onClick={() => setConfirmClear(true)} className="min-h-11 rounded-[6px] px-3 text-sm font-medium text-red-600 hover:bg-red-50">기억 초기화</button>
              )}
            </div>

            {confirmClear && (
              <DangerConfirm
                className="border-b border-red-100 bg-red-50 px-5 py-4 sm:px-6"
                title="이 범위의 대화 요약과 맞춤 맥락까지 모두 지울까요?"
                body="기억 기능도 꺼지며, 삭제 시점 이전 채팅에서 다시 만들지 않아요. 채팅 원문과 직접 저장한 일정·예산은 그대로예요."
                confirmLabel="모두 지우기"
                cancelLabel="취소"
                busy={busy}
                onConfirm={() => void clearScope()}
                onCancel={() => setConfirmClear(false)}
              />
            )}

            {memories.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <BrainCircuit className="mx-auto h-8 w-8 text-[var(--hb-text-muted)]" />
                <p className="mt-3 text-sm font-medium text-[var(--hb-text-body)]">아직 정리된 기억이 없어요</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--hb-text-muted)]">{!data?.runtimeEnabled ? "대화와 직접 저장한 일정·예산은 그대로 사용할 수 있어요. 새 기억 저장은 아직 준비 중이에요." : "기억을 켜고 대화하면, 직접 확정한 내용만 천천히 쌓여요."}</p>
              </div>
            ) : (
              <div className="divide-y divide-[#F0ECE9]">
                {memories.map((memory) => {
                  const editing = editingId === memory.id;
                  return (
                    <article key={memory.id} className="px-5 py-5 sm:px-6">
                      {editing ? (
                        <div className="space-y-3">
                          <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={60} aria-label="기억 제목" className="min-h-11 w-full rounded-[6px] bg-[var(--hb-surface-hover)] px-4 text-sm text-[var(--hb-text-strong)] outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)]" />
                          <textarea value={editValue} onChange={(event) => setEditValue(event.target.value)} maxLength={160} rows={3} aria-label="기억 내용" className="w-full resize-none rounded-[6px] bg-[var(--hb-surface-hover)] px-4 py-3 text-sm leading-relaxed text-[var(--hb-text-strong)] outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)]" />
                          <div className="flex gap-2">
                            <button type="button" disabled={busy || !editTitle.trim() || !editValue.trim()} onClick={() => void saveMemory(memory)} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-medium text-white disabled:opacity-40"><Check className="h-4 w-4" /> 저장</button>
                            <button type="button" onClick={() => setEditingId(null)} className="inline-flex min-h-11 items-center gap-2 rounded-[6px] px-4 text-sm font-medium text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)]"><X className="h-4 w-4" /> 취소</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-[var(--hb-surface-hover)] px-2.5 py-1 text-xs font-medium text-[var(--color-rose-700)]">{KIND_LABELS[memory.kind] ?? "대화 기억"}</span>
                              {memory.userCorrected && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--hb-success)]">
                                  <Check className="h-3 w-3" />
                                  {activeVisibility === "shared" ? "한 사람이 직접 고침 · 공동 확인 아님" : "내가 직접 고침"}
                                </span>
                              )}
                              <span className="text-xs text-[var(--hb-text-muted)]">{formatDate(memory.updatedAt)}</span>
                            </div>
                            <h3 className="hb-h-sm mt-2 text-[var(--hb-text-strong)]">{memory.title ?? "기억"}</h3>
                            <p className="mt-1 break-words text-sm leading-relaxed text-[var(--hb-text-body)]">{valueToText(memory.value)}</p>
                            {memory.reasoning && <p className="mt-1 text-xs leading-relaxed text-[var(--hb-text-muted)]">{memory.reasoning}</p>}
                          </div>
                          <div className="flex flex-shrink-0 gap-1">
                            <button type="button" onClick={() => startEditing(memory)} aria-label="기억 고치기" className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--hb-accent-hover)] hover:bg-[var(--hb-surface-hover)]"><Pencil className="h-4 w-4" /></button>
                            <button type="button" disabled={busy} onClick={() => setDeletingId(memory.id)} aria-label="기억 삭제" className="flex h-11 w-11 items-center justify-center rounded-full text-danger-700 hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                          </div>
                          </div>
                          {deletingId === memory.id && (
                            <div className="mt-3 rounded-[6px] border border-red-100 bg-red-50 px-4 py-3">
                              <p className="text-sm font-medium text-red-800">이 기억을 지울까요?</p>
                              <p className="mt-1 text-xs leading-relaxed text-red-700">삭제한 항목은 백그라운드 작업이 다시 만들지 않아요.</p>
                              <div className="mt-3 flex gap-2">
                                <button type="button" disabled={busy} onClick={() => void deleteMemory(memory)} className="min-h-11 rounded-[6px] bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50">삭제</button>
                                <button type="button" disabled={busy} onClick={() => setDeletingId(null)} className="min-h-11 rounded-[6px] bg-white px-4 text-sm font-medium text-[var(--hb-text-strong)] ring-1 ring-[#E2D3C8]">취소</button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
