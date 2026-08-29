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

import { useAmoraPersonalization } from "@/hooks/useAmoraPersonalization";
import {
  DEFAULT_AMORA_PERSONALIZATION,
  isAmoraPersonalizationChanges,
  mergeAmoraPersonalization,
  type AmoraPersonalizationPreferences,
} from "@/lib/amora/personalization";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

type PreferenceKey = keyof AmoraPersonalizationPreferences;

type Choice = {
  value: string;
  label: string;
  description: string;
};

type PreferenceSection = {
  key: PreferenceKey;
  title: string;
  description: string;
  choices: readonly Choice[];
};

const SECTIONS: readonly PreferenceSection[] = [
  {
    key: "toneStyle",
    title: "아모라 말투",
    description: "어떤 느낌으로 답하면 편한지 골라주세요. 모두 존댓말로 답해요.",
    choices: [
      {
        value: "adaptive",
        label: "상황에 맞게",
        description: "편한 대화는 부드럽게, 중요한 내용은 또렷하게 말해요.",
      },
      {
        value: "warm",
        label: "다정하고 편안하게",
        description: "서두르지 않고 마음을 살피며 이야기해요.",
      },
      {
        value: "calm_clear",
        label: "차분하고 또렷하게",
        description: "감정에 휩쓸리지 않고 핵심을 분명히 말해요.",
      },
      {
        value: "friendly_honest",
        label: "친근하고 솔직하게",
        description: "가깝게 말하되 필요한 이야기는 돌리지 않아요.",
      },
    ],
  },
  {
    key: "decisionStart",
    title: "결정을 시작할 때",
    description: "여러 선택지 중 무엇부터 보여드릴지 정해요.",
    choices: [
      {
        value: "recommend_first",
        label: "추천안 먼저",
        description: "현실적인 안 하나를 먼저 보고 조정해요.",
      },
      {
        value: "compare_first",
        label: "비교 먼저",
        description: "2~3개 선택지와 차이를 먼저 확인해요.",
      },
      {
        value: "ask_each_time",
        label: "그때 물어보기",
        description: "상황마다 원하는 방식을 짧게 확인해요.",
      },
    ],
  },
  {
    key: "answerDetail",
    title: "설명 분량",
    description: "아모라 답변의 기본 길이를 정해요.",
    choices: [
      {
        value: "brief",
        label: "핵심만",
        description: "결론과 다음 행동을 짧게 봐요.",
      },
      {
        value: "detailed",
        label: "자세히",
        description: "근거와 주의점까지 충분히 봐요.",
      },
      {
        value: "adaptive",
        label: "상황에 맞게",
        description: "간단한 질문은 짧게, 중요한 결정은 자세히 봐요.",
      },
    ],
  },
  {
    key: "supportOrder",
    title: "힘들다고 말했을 때",
    description: "공감과 실행 중 무엇을 먼저 할지 정해요.",
    choices: [
      {
        value: "listen_first",
        label: "마음 먼저",
        description: "해결책보다 지금 상황을 먼저 들어요.",
      },
      {
        value: "action_first",
        label: "실행 먼저",
        description: "바로 할 수 있는 한 가지부터 정리해요.",
      },
      {
        value: "ask_each_time",
        label: "그때 물어보기",
        description: "들어줄지 해결할지 먼저 확인해요.",
      },
    ],
  },
  {
    key: "workMode",
    title: "둘이 준비하는 방식",
    description: "할 일을 제안할 때의 기본 구조만 바꿔요.",
    choices: [
      {
        value: "together",
        label: "처음부터 함께",
        description: "후보를 찾는 과정도 둘이 같이 확인해요.",
      },
      {
        value: "owner_led",
        label: "담당자가 먼저",
        description: "한 사람이 좁혀오고 둘이 최종 확정해요.",
      },
      {
        value: "hybrid",
        label: "상황에 따라 섞기",
        description: "중요한 결정만 함께 보고 나머지는 나눠요.",
      },
      {
        value: "ask_each_time",
        label: "그때 물어보기",
        description: "업무마다 함께할지 나눌지 확인해요.",
      },
    ],
  },
  {
    key: "familyOrder",
    title: "가족·하객 의견이 있을 때",
    description: "누구의 생각을 먼저 확인할지 정할 뿐, 의무를 만들지 않아요.",
    choices: [
      {
        value: "couple_first",
        label: "우리 둘 기준 먼저",
        description: "두 사람의 기준을 맞춘 뒤 필요한 의견을 들어요.",
      },
      {
        value: "family_input_first",
        label: "의견부터 모으기",
        description: "관련된 가족·하객 조건을 먼저 확인해요.",
      },
      {
        value: "case_by_case",
        label: "상황마다",
        description: "영향받는 사람과 비용에 따라 순서를 정해요.",
      },
      {
        value: "ask_each_time",
        label: "그때 물어보기",
        description: "가족 조율이 필요한지 먼저 확인해요.",
      },
    ],
  },
] as const;

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
  const isDemo = useAuthStore((state) => state.isDemo);
  const personalization = useAmoraPersonalization(!isDemo);
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
          <p className="text-xs font-semibold tracking-[0.16em] text-[var(--color-rose-700)]">
            MY AMORA
          </p>
          <h1 className="text-2xl font-semibold text-[var(--hb-text-strong)] sm:text-3xl">
            아모라 도움 방식
          </h1>
        </div>
      </div>

      <section className="mb-5 rounded-2xl bg-gradient-to-br from-[var(--hb-surface-page)] to-[var(--hb-surface-hover)] p-5 ring-1 ring-[#E2D3C8] sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--hb-primary)] text-white">
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-[var(--hb-text-strong)]">
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
        <section className="rounded-2xl border border-[#E2D3C8] bg-white p-6 text-sm text-[var(--hb-text-strong)]">
          체험에서는 개인 설정을 저장하지 않아요. 가입 후 내 아모라에 맞출 수
          있어요.
        </section>
      ) : personalization.status === "loading" ? (
        <div className="flex min-h-48 items-center justify-center text-[#6D806E]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          도움 방식을 불러오는 중...
        </div>
      ) : personalization.status === "error" ? (
        <section className="rounded-2xl border border-[#E2D3C8] bg-white p-6">
          <p role="alert" className="text-sm text-[#A04A4A]">
            {personalization.error ?? "도움 방식을 불러오지 못했어요."}
          </p>
          <button
            type="button"
            onClick={() => void personalization.load()}
            className="mt-4 min-h-11 rounded-xl bg-[var(--hb-primary)] px-4 text-sm font-semibold text-white"
          >
            다시 불러오기
          </button>
        </section>
      ) : (
        <>
          <div className="space-y-4">
            {SECTIONS.map((section) => (
              <section
                key={section.key}
                className="rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] sm:p-6"
              >
                <h2 className="text-base font-semibold text-[var(--hb-text-strong)]">
                  {section.title}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-[#6D806E]">
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
                        className={`min-h-16 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] disabled:opacity-50 ${
                          selected
                            ? "border-[#6D806E] bg-[#F1F5EF]"
                            : "border-[#E2D3C8] bg-white hover:bg-[var(--hb-surface-page)]"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--hb-text-strong)]">
                          {selected && (
                            <Check className="h-4 w-4 text-[#6D806E]" />
                          )}
                          {choice.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-[#6D806E]">
                          {choice.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <section className="sticky bottom-4 mt-5 rounded-2xl border border-[#E2D3C8] bg-white/95 p-4 shadow-[0_12px_35px_rgba(36,56,50,0.12)] backdrop-blur sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--hb-text-strong)]">
                  <ShieldCheck className="h-4 w-4 text-[#6D806E]" />
                  {personalization.profile
                    ? `내 설정 · ${updatedAt ?? "직접 확인됨"}`
                    : "아직 저장한 도움 방식이 없어요"}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#6D806E]">
                  현재 질문이 저장값과 다르면 방금 한 말이 우선해요.
                </p>
              </div>
              <button
                type="button"
                disabled={!dirty || personalization.saving}
                onClick={() => void save()}
                className="min-h-11 rounded-xl bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--hb-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {personalization.saving ? "저장 중..." : "변경 저장"}
              </button>
            </div>
            {(personalization.error || notice) && (
              <p
                role={personalization.error ? "alert" : "status"}
                className={`mt-3 text-sm ${
                  personalization.error ? "text-[#A04A4A]" : "text-[#6D806E]"
                }`}
              >
                {personalization.error ?? notice}
              </p>
            )}
          </section>

          {personalization.profile && (
            <section className="mt-6 rounded-2xl border border-[#E2D3C8] bg-[var(--hb-surface-page)] p-5">
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
                      className="min-h-11 rounded-xl bg-[#8F6662] px-4 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      모두 지우기
                    </button>
                    <button
                      type="button"
                      disabled={personalization.saving}
                      onClick={() => setConfirmReset(false)}
                      className="min-h-11 rounded-xl border border-[#E2D3C8] bg-white px-4 text-sm font-medium text-[var(--hb-text-strong)]"
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
    </main>
  );
}
