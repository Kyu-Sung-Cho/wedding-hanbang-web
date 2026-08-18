"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  Download,
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

type Visibility = "shared" | "bride_private" | "groom_private";

type MemorySetting = {
  visibility: Visibility;
  enabled: boolean;
  consentedByMe: boolean;
  consentedCount: number;
  requiredCount: number;
  enabledAt: string | null;
  memoryResetAt: string | null;
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

export default function AmoraMemorySettingsPage() {
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/amora/memory", { cache: "no-store" });
      const payload = await response.json() as MemoryResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "기억을 불러오지 못했어요.");
      setData(payload);
      const available = payload.settings.map((setting) => setting.visibility);
      setActiveVisibility((current) => available.includes(current) ? current : available[0] ?? "shared");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "기억을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
    const response = await fetch("/api/amora/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "설정을 바꾸지 못했어요.");
  }

  async function toggleMemory() {
    if (!setting || busy) return;
    if (!data?.runtimeEnabled && !setting.consentedByMe) return;
    setBusy(true);
    setError(null);
    try {
      await patch({ action: "toggle", visibility: activeVisibility, enabled: !setting.consentedByMe });
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "설정을 바꾸지 못했어요.");
    } finally {
      setBusy(false);
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
      await patch({
        action: "update_memory",
        visibility: activeVisibility,
        memoryId: memory.id,
        title: editTitle,
        value: editValue,
      });
      setEditingId(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "기억을 고치지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMemory(memory: MemoryItem) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await patch({ action: "delete_memory", visibility: activeVisibility, memoryId: memory.id });
      setDeletingId(null);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "기억을 지우지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function clearScope() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await patch({ action: "clear_scope", visibility: activeVisibility });
      setConfirmClear(false);
      await load();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "기억을 모두 지우지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function exportMemories() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/amora/memory?export=memory", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "기억을 내보내지 못했어요.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `amora-memory-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "기억을 내보내지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
      <div className="mb-7 flex items-center gap-3">
        <Link
          {...weddingLinkProps("/settings")}
          aria-label="설정으로 돌아가기"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#243832] shadow-sm transition-colors hover:bg-[#F7F1E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.16em] text-[#8F6662]">AMORA MEMORY</p>
          <h1 className="text-2xl font-semibold text-[#243832] sm:text-3xl">아모라가 기억하는 것</h1>
        </div>
      </div>

      <section className="mb-5 rounded-2xl bg-gradient-to-br from-[#FBF8F2] to-[#F7F1E8] p-5 ring-1 ring-[#E2D3C8] sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#8F6662] text-white">
            <BrainCircuit className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-[#243832]">기억의 주인은 두 분이에요</h2>
            <p className="mt-1 text-sm font-light leading-relaxed text-[#36534E]">
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
        <div className="mb-4 grid grid-cols-2 rounded-xl bg-[#EDE7E5] p-1" role="tablist" aria-label="기억 범위">
          {data.settings.map((item) => {
            const shared = item.visibility === "shared";
            return (
              <button
                key={item.visibility}
                type="button"
                role="tab"
                aria-selected={activeVisibility === item.visibility}
                onClick={() => {
                  setActiveVisibility(item.visibility);
                  setConfirmClear(false);
                  setDeletingId(null);
                  setEditingId(null);
                }}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-all ${activeVisibility === item.visibility ? "bg-white text-[#1A1A1F] shadow-sm" : "text-[#6F6660]"}`}
              >
                {shared ? <Users className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {shared ? "둘이 함께" : "나만 상담"}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-[#795252]" />
        </div>
      ) : error && !data ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-[#795252]">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#795252] px-4 text-sm font-medium text-white">
            <RefreshCw className="h-4 w-4" /> 다시 불러오기
          </button>
        </div>
      ) : (
        <>
          {data && !data.runtimeEnabled && (
            <p role="status" className="mb-4 rounded-xl border border-[#E2D3C8] bg-[#FBF8F2] px-4 py-3 text-sm leading-relaxed text-[#36534E]">
              기억 엔진을 운영 환경에 안전하게 연결하는 중이에요. 지금은 기존 기억을 확인·수정·내보내기·삭제할 수 있고, 새로 켜기는 최종 점검 후 열려요.
            </p>
          )}
          <section className="mb-5 rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {activeVisibility === "shared" ? <Users className="h-4 w-4 text-[#795252]" /> : <Eye className="h-4 w-4 text-[#795252]" />}
                  <h2 className="font-medium text-[#1A1A1F]">
                    {activeVisibility === "shared" ? "내 공유 기억 동의" : "나만 상담 기억"}
                  </h2>
                </div>
                <p className="mt-1 text-sm font-light leading-relaxed text-[#928980]">
                  {activeVisibility === "shared"
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

          {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          {profileLines.length > 0 && (
            <section className="mb-5 rounded-2xl border border-[#E8DDD3] bg-[#fffdfb] p-5 sm:p-6">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#2E7D5A]" />
                <h2 className="font-medium text-[#1A1A1F]">상담할 때 참고하는 맥락</h2>
              </div>
              <ul className="space-y-2">
                {profileLines.map((line, index) => <li key={`${line}-${index}`} className="text-sm leading-relaxed text-[#504444]">• {line}</li>)}
              </ul>
            </section>
          )}

          <section className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="flex items-center justify-between gap-3 border-b border-[#F0ECE9] px-5 py-4 sm:px-6">
              <div>
                <h2 className="font-medium text-[#1A1A1F]">정리된 기억 {memories.length}개</h2>
                <p className="mt-0.5 text-xs text-[#6D806E]">직접 고친 기억은 아모라가 자동으로 덮어쓰지 않아요</p>
              </div>
              {setting && !confirmClear && (
                <button type="button" onClick={() => setConfirmClear(true)} className="min-h-11 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50">기억 초기화</button>
              )}
            </div>

            {confirmClear && (
              <div className="border-b border-red-100 bg-red-50 px-5 py-4 sm:px-6">
                <p className="text-sm font-medium text-red-800">이 범위의 대화 요약과 맞춤 맥락까지 모두 지울까요?</p>
                <p className="mt-1 text-xs leading-relaxed text-red-700">기억 기능도 꺼지며, 삭제 시점 이전 채팅에서 다시 만들지 않아요. 채팅 원문과 직접 저장한 일정·예산은 그대로예요.</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void clearScope()} className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50">모두 지우기</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmClear(false)} className="min-h-11 rounded-lg bg-white px-4 text-sm font-medium text-[#243832] ring-1 ring-[#E2D3C8]">취소</button>
                </div>
              </div>
            )}

            {memories.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <BrainCircuit className="mx-auto h-8 w-8 text-[#C8BDB6]" />
                <p className="mt-3 text-sm font-medium text-[#504444]">아직 정리된 기억이 없어요</p>
                <p className="mt-1 text-xs leading-relaxed text-[#928980]">기억을 켜고 대화하면, 직접 확정한 내용만 천천히 쌓여요.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#F0ECE9]">
                {memories.map((memory) => {
                  const editing = editingId === memory.id;
                  return (
                    <article key={memory.id} className="px-5 py-5 sm:px-6">
                      {editing ? (
                        <div className="space-y-3">
                          <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={60} aria-label="기억 제목" className="min-h-11 w-full rounded-xl bg-[#F6F3F2] px-4 text-sm text-[#1A1A1F] outline-none focus:ring-2 focus:ring-[#795252]/30" />
                          <textarea value={editValue} onChange={(event) => setEditValue(event.target.value)} maxLength={160} rows={3} aria-label="기억 내용" className="w-full resize-none rounded-xl bg-[#F6F3F2] px-4 py-3 text-sm leading-relaxed text-[#1A1A1F] outline-none focus:ring-2 focus:ring-[#795252]/30" />
                          <div className="flex gap-2">
                            <button type="button" disabled={busy || !editTitle.trim() || !editValue.trim()} onClick={() => void saveMemory(memory)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#795252] px-4 text-sm font-medium text-white disabled:opacity-40"><Check className="h-4 w-4" /> 저장</button>
                            <button type="button" onClick={() => setEditingId(null)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium text-[#504444] hover:bg-[#F6F3F2]"><X className="h-4 w-4" /> 취소</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-[#F7F1E8] px-2.5 py-1 text-xs font-medium text-[#8F6662]">{KIND_LABELS[memory.kind] ?? "대화 기억"}</span>
                              {memory.userCorrected && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-[#6D806E]">
                                  <Check className="h-3 w-3" />
                                  {activeVisibility === "shared" ? "한 사람이 직접 고침 · 공동 확인 아님" : "내가 직접 고침"}
                                </span>
                              )}
                              <span className="text-xs text-[#B89785]">{formatDate(memory.updatedAt)}</span>
                            </div>
                            <h3 className="mt-2 text-sm font-semibold text-[#1A1A1F]">{memory.title ?? "기억"}</h3>
                            <p className="mt-1 break-words text-sm leading-relaxed text-[#504444]">{valueToText(memory.value)}</p>
                            {memory.reasoning && <p className="mt-1 text-xs leading-relaxed text-[#928980]">{memory.reasoning}</p>}
                          </div>
                          <div className="flex flex-shrink-0 gap-1">
                            <button type="button" onClick={() => startEditing(memory)} aria-label="기억 고치기" className="flex h-11 w-11 items-center justify-center rounded-full text-[#795252] hover:bg-[#F6F3F2]"><Pencil className="h-4 w-4" /></button>
                            <button type="button" disabled={busy} onClick={() => setDeletingId(memory.id)} aria-label="기억 삭제" className="flex h-11 w-11 items-center justify-center rounded-full text-red-500 hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                          </div>
                          </div>
                          {deletingId === memory.id && (
                            <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                              <p className="text-sm font-medium text-red-800">이 기억을 지울까요?</p>
                              <p className="mt-1 text-xs leading-relaxed text-red-700">삭제한 항목은 백그라운드 작업이 다시 만들지 않아요.</p>
                              <div className="mt-3 flex gap-2">
                                <button type="button" disabled={busy} onClick={() => void deleteMemory(memory)} className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50">삭제</button>
                                <button type="button" disabled={busy} onClick={() => setDeletingId(null)} className="min-h-11 rounded-lg bg-white px-4 text-sm font-medium text-[#243832] ring-1 ring-[#E2D3C8]">취소</button>
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

          <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-[#E8DDD3] bg-[#fffdfb] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-[#795252]" />
                <h2 className="font-medium text-[#1A1A1F]">아모라 기억 내보내기</h2>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-[#6F6660]">
                현재 계정에서 볼 수 있는 아모라 기억만 JSON으로 내려받아요. 채팅 원문·일정·예산은 포함하지 않아요.
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !data}
              onClick={() => void exportMemories()}
              className="inline-flex min-h-11 flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-[#F7F1E8] px-4 text-sm font-medium text-[#795252] hover:bg-[#EFE3D8] disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              내보내기
            </button>
          </section>
        </>
      )}
    </main>
  );
}
