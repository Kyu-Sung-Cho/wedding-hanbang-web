"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { AMORA_PERSONALIZATION_SECTIONS } from "@hanbang/shared/amora-personalization";

import { useAmoraPersonalization } from "@/hooks/useAmoraPersonalization";
import {
  DEFAULT_AMORA_PERSONALIZATION,
  isAmoraPersonalizationChanges,
  mergeAmoraPersonalization,
  type AmoraPersonalizationPreferences,
} from "@/lib/amora/personalization";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

function formatUpdatedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export default function AmoraStyleSettingsPage() {
  const user = useAuthStore((state) => state.user);
  return <AmoraStyleSettingsContent key={user?.id ?? "guest"} ownerId={user?.id ?? null} />;
}

/*
 * 2026-11-22: 웨딩코드에서 고른 도움 방식을 이어 받던 길(`?wcAmoraHandoff=`, 확인 칸
 * "웨딩코드에서 직접 고른 도움 방식")을 끊었다. 웨딩코드를 내렸다(2026-11-21 파운더 결정).
 * 이 설정 화면과 이미 저장된 값(`amora_personalization_preferences`)은 그대로 쓴다.
 */
function AmoraStyleSettingsContent({ ownerId }: { ownerId: string | null }) {
  const isDemo = useAuthStore((state) => state.isDemo);
  const personalization = useAmoraPersonalization(!isDemo && Boolean(ownerId));
  const baseline =
    personalization.profile?.preferences ?? DEFAULT_AMORA_PERSONALIZATION;
  const baselineRevision = personalization.profile?.revision ?? null;
  const [draftState, setDraftState] = useState<{
    revision: number | null;
    preferences: AmoraPersonalizationPreferences;
  }>(() => ({
    revision: baselineRevision,
    preferences: baseline,
  }));
  const draft =
    draftState.revision === baselineRevision
      ? draftState.preferences
      : baseline;
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [baseline, draft],
  );
  const updatedAt = formatUpdatedAt(
    personalization.profile?.updatedAt ?? null,
  );

  async function save() {
    setNotice(null);
    const saved = await personalization.save(draft);
    if (saved) {
      setDraftState({
        revision: saved.revision,
        preferences: saved.preferences,
      });
      setNotice("내 도움 방식으로 저장했어요.");
    }
  }

  async function reset() {
    setNotice(null);
    const didReset = await personalization.reset();
    if (didReset) {
      setDraftState({
        revision: null,
        preferences: DEFAULT_AMORA_PERSONALIZATION,
      });
      setConfirmReset(false);
      setNotice("저장한 도움 방식을 모두 지웠어요.");
    }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
      <div className="mb-7 flex items-center gap-3">
        <Link
          {...weddingLinkProps("/settings")}
          aria-label="설정으로 돌아가기"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[var(--hb-text-strong)] shadow-sm transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.16em] text-[var(--color-rose-700)]">
            MY AMORA
          </p>
          <h1 className="text-[var(--hb-text-strong)]">
            아모라 도움 방식
          </h1>
        </div>
      </div>

      <section className="mb-5 rounded-[6px] bg-gradient-to-br from-[var(--hb-surface-page)] to-[var(--hb-surface-hover)] p-5 ring-1 ring-[#E2D3C8] sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[6px] bg-[var(--hb-primary)] text-white">
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[var(--hb-text-strong)]">
              편한 말투와 도움 순서를 직접 골라요
            </h2>
            <p className="mt-1 text-sm font-light leading-relaxed text-[var(--hb-text-strong)]">
              설정은 나에게만 보관됩니다. 답변 표현과 제안 순서에만 사용하며
              예산·일정·담당자는 확인 없이 바꾸지 않아요.
            </p>
          </div>
        </div>
      </section>

      {isDemo ? (
        <section className="rounded-[6px] border border-[#E2D3C8] bg-white p-6 text-sm text-[var(--hb-text-strong)]">
          체험에서는 개인 설정을 저장하지 않아요. 가입 후 내 아모라에 맞출 수
          있어요.
        </section>
      ) : personalization.status === "loading" ? (
        <div className="flex min-h-48 items-center justify-center text-[var(--hb-success)]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          도움 방식을 불러오는 중...
        </div>
      ) : personalization.status === "error" ? (
        <section className="rounded-[6px] border border-[#E2D3C8] bg-white p-6">
          <p role="alert" className="text-sm text-[#A04A4A]">
            {personalization.error ?? "도움 방식을 불러오지 못했어요."}
          </p>
          <button
            type="button"
            onClick={() => void personalization.load()}
            className="mt-4 min-h-11 rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-semibold text-white"
          >
            다시 불러오기
          </button>
        </section>
      ) : (
        <>
          <div className="space-y-4">
            {AMORA_PERSONALIZATION_SECTIONS.map((section) => (
              <section
                key={section.key}
                className="rounded-[6px] bg-white p-5 shadow-[var(--shadow-raised)] sm:p-6"
              >
                <h2 className="text-[var(--hb-text-strong)]">
                  {section.title}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--hb-text-muted)]">
                  {section.description}
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {section.choices.map((choice) => {
                    const selected = draft[section.key] === choice.value;
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={personalization.saving}
                        onClick={() => {
                          setNotice(null);
                          const change: unknown = {
                            [section.key]: choice.value,
                          };
                          if (!isAmoraPersonalizationChanges(change)) return;
                          setDraftState({
                            revision: baselineRevision,
                            preferences: mergeAmoraPersonalization(
                              draft,
                              change,
                            ),
                          });
                        }}
                        className={`min-h-16 rounded-[6px] border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] disabled:opacity-50 ${
                          selected
                            ? "border-[#6D806E] bg-[#F1F5EF]"
                            : "border-[#E2D3C8] bg-white hover:bg-[var(--hb-surface-page)]"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--hb-text-strong)]">
                          {selected && (
                            <Check className="h-4 w-4 text-[var(--hb-success)]" />
                          )}
                          {choice.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--hb-text-muted)]">
                          {choice.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <section className="sticky bottom-4 mt-5 rounded-[6px] border border-[#E2D3C8] bg-white/95 p-4 shadow-[var(--shadow-raised)] backdrop-blur sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--hb-text-strong)]">
                  <ShieldCheck className="h-4 w-4 text-[var(--hb-success)]" />
                  {personalization.profile
                    ? `내 설정 · ${updatedAt ?? "직접 확인됨"}`
                    : "아직 저장한 도움 방식이 없어요"}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--hb-text-muted)]">
                  현재 질문이 저장값과 다르면 방금 한 말이 우선해요.
                </p>
              </div>
              <button
                type="button"
                disabled={!dirty || personalization.saving}
                onClick={() => void save()}
                className="min-h-11 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--hb-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {personalization.saving ? "저장 중..." : "변경 저장"}
              </button>
            </div>
            {(personalization.error || notice) && (
              <p
                role={personalization.error ? "alert" : "status"}
                className={`mt-3 text-sm ${
                  personalization.error ? "text-[#A04A4A]" : "text-[var(--hb-success)]"
                }`}
              >
                {personalization.error ?? notice}
              </p>
            )}
          </section>

          {personalization.profile && (
            <section className="mt-6 rounded-[6px] border border-[#E2D3C8] bg-[var(--hb-surface-page)] p-5">
              {!confirmReset ? (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[#8F6662] underline decoration-dotted underline-offset-4"
                >
                  <RotateCcw className="h-4 w-4" />
                  저장한 도움 방식 모두 지우기
                </button>
              ) : (
                <div>
                  <p className="text-sm leading-relaxed text-[var(--hb-text-strong)]">
                    저장한 값만 삭제하고 대화·예산·일정은 그대로 유지해요.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={personalization.saving}
                      onClick={() => void reset()}
                      className="min-h-11 rounded-[6px] bg-[#8F6662] px-4 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      모두 지우기
                    </button>
                    <button
                      type="button"
                      disabled={personalization.saving}
                      onClick={() => setConfirmReset(false)}
                      className="min-h-11 rounded-[6px] border border-[#E2D3C8] bg-white px-4 text-sm font-medium text-[var(--hb-text-strong)]"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
