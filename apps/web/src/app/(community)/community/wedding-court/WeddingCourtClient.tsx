"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Gavel,
  LockKeyhole,
  RefreshCw,
  Scale,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { captureEvent } from "@/lib/analytics";
import {
  weddingCourtCasesResponseSchema,
  weddingCourtVoteResponseSchema,
} from "@/lib/weddingCourt/contract";
import type {
  WeddingCourtCaseState,
  WeddingCourtChoice,
  WeddingCourtDistribution,
  WeddingCourtPerspective,
} from "@/lib/weddingCourt/types";

const LOGIN_HREF =
  "/login?redirect=%2Fwedding%2Fcommunity%2Fwedding-court";

interface CourtDraft {
  choice: WeddingCourtChoice | null;
  reasonChip: string | null;
  predictedMajority: WeddingCourtChoice | null;
}

const EMPTY_DRAFT: CourtDraft = {
  choice: null,
  reasonChip: null,
  predictedMajority: null,
};

function apiError(value: unknown, fallback: string) {
  if (
    typeof value === "object"
    && value !== null
    && "error" in value
    && typeof value.error === "string"
  ) {
    return value.error;
  }
  return fallback;
}

function stageLabel(stage: WeddingCourtCaseState["stage"]) {
  if (stage === "first_vote") return "1심 선택";
  if (stage === "appeal_vote") return "새 단서 · 항소심";
  return "두 번의 선택 완료";
}

function perspectiveHeading(perspective: WeddingCourtPerspective) {
  if (perspective.signal === "more_selected") {
    return "더 많이 고른 쪽은 이렇게 봤어요";
  }
  if (perspective.signal === "less_selected") {
    return "다르게 고른 쪽은 이렇게 봤어요";
  }
  return "비슷하게 나뉜 한쪽 관점";
}

function Distribution({
  distribution,
  choices,
  title,
}: {
  distribution: WeddingCourtDistribution;
  choices: WeddingCourtCaseState["choices"];
  title: string;
}) {
  return (
    <section aria-label={title} className="border-t border-[#e8ded2] pt-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.12em] text-[var(--color-rose-700)]">
            {title}
          </p>
          <h3 className="mt-1 text-[var(--hb-text-strong)]">
            현재 {distribution.totalVotes.toLocaleString("ko-KR")}명의 선택 분포
          </h3>
        </div>
        <Users className="h-5 w-5 shrink-0 text-[var(--hb-success)]" aria-hidden />
      </div>

      <div className="mt-5 space-y-4">
        {(["a", "b"] as const).map((choice) => {
          const side = distribution[choice];
          return (
            <div key={choice}>
              <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0 font-semibold text-[var(--hb-text-strong)]">
                  {choices[choice]}
                </span>
                <span className="shrink-0 tabular-nums text-[var(--hb-text-strong)]">
                  {side.percent}% · {side.count}명
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[#efe4d7]">
                <div
                  className={
                    choice === "a"
                      ? "h-full rounded-full bg-[var(--hb-primary)] transition-[width] duration-300"
                      : "h-full rounded-full bg-[#a77b74] transition-[width] duration-300"
                  }
                  style={{ width: `${side.percent}%` }}
                />
              </div>
              {distribution.reasons[choice].length > 0 ? (
                <p className="mt-2 text-[12px] leading-5 text-[#5d6d68]">
                  많이 고른 이유:{" "}
                  {distribution.reasons[choice]
                    .slice(0, 2)
                    .map((reason) => reason.label)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Perspectives({
  perspectives,
}: {
  perspectives: [WeddingCourtPerspective, WeddingCourtPerspective];
}) {
  return (
    <section className="border-t border-[#e8ded2] pt-5">
      <p className="text-[12px] font-semibold text-[var(--color-rose-700)]">
        양쪽에서 보면
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {perspectives.map((perspective) => (
          <div
            key={perspective.choice}
            className="rounded-[6px] bg-[var(--hb-surface-hover)] px-4 py-4"
          >
            <p className="text-[11px] font-semibold text-[var(--color-rose-700)]">
              {perspectiveHeading(perspective)}
            </p>
            <p className="mt-1 text-[14px] font-bold text-[var(--hb-text-strong)]">
              {perspective.label}
            </p>
            <p className="mt-2 text-[13px] leading-6 text-[#52635e]">
              {perspective.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ChoiceGroup({
  weddingCase,
  value,
  onChange,
  label,
}: {
  weddingCase: WeddingCourtCaseState;
  value: WeddingCourtChoice | null;
  onChange: (choice: WeddingCourtChoice) => void;
  label: string;
}) {
  return (
    <div>
      <p className="text-[13px] font-bold text-[var(--hb-text-strong)]">{label}</p>
      <div
        role="group"
        aria-label={label}
        className="mt-3 grid gap-3 sm:grid-cols-2"
      >
        {(["a", "b"] as const).map((choice, index) => {
          const selected = value === choice;
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(choice)}
              className={`min-h-[76px] rounded-[6px] border px-4 py-4 text-left transition ${
                selected
                  ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white shadow-[var(--shadow-raised)]"
                  : "border-[#e2d3c8] bg-white text-[var(--hb-text-strong)] hover:border-[#a77b74]"
              }`}
            >
              <span
                className={`text-[11px] font-bold tracking-[0.12em] ${
                  selected ? "text-white/70" : "text-[var(--color-rose-700)]"
                }`}
              >
                선택 {index + 1}
              </span>
              <span className="mt-1 block text-[15px] font-bold leading-6">
                {weddingCase.choices[choice]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReasonGroup({
  weddingCase,
  value,
  onChange,
}: {
  weddingCase: WeddingCourtCaseState;
  value: string | null;
  onChange: (reasonChip: string) => void;
}) {
  return (
    <div>
      <p className="text-[13px] font-bold text-[var(--hb-text-strong)]">
        가장 중요하게 본 이유는?
      </p>
      <div
        role="group"
        aria-label="선택 이유"
        className="mt-3 flex flex-wrap gap-2"
      >
        {weddingCase.reasonChips.map((chip) => {
          const selected = value === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(chip.id)}
              className={`min-h-11 rounded-[6px] border px-4 text-[13px] font-semibold transition ${
                selected
                  ? "border-[#a77b74] bg-[#a77b74] text-white"
                  : "border-[#e2d3c8] bg-[var(--hb-surface-page)] text-[#52635e] hover:border-[#a77b74]"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-[#71807b]">
        자유 댓글은 받지 않고, 검수된 이유만 집계해요.
      </p>
    </div>
  );
}

function VoteForm({
  weddingCase,
  draft,
  submitting,
  onDraft,
  onSubmit,
}: {
  weddingCase: WeddingCourtCaseState;
  draft: CourtDraft;
  submitting: boolean;
  onDraft: (next: CourtDraft) => void;
  onSubmit: () => void;
}) {
  const isFirstRound = weddingCase.stage === "first_vote";
  const ready = Boolean(
    draft.choice
      && draft.reasonChip
      && (!isFirstRound || draft.predictedMajority),
  );

  return (
    <div className="space-y-6">
      <ChoiceGroup
        weddingCase={weddingCase}
        value={draft.choice}
        onChange={(choice) => onDraft({ ...draft, choice })}
        label={
          isFirstRound
            ? "지금 정보만 보고 고른다면?"
            : "새 단서를 보고 다시 고른다면?"
        }
      />

      <ReasonGroup
        weddingCase={weddingCase}
        value={draft.reasonChip}
        onChange={(reasonChip) => onDraft({ ...draft, reasonChip })}
      />

      {isFirstRound ? (
        <ChoiceGroup
          weddingCase={weddingCase}
          value={draft.predictedMajority}
          onChange={(predictedMajority) =>
            onDraft({ ...draft, predictedMajority })
          }
          label="다른 사람은 어느 쪽을 더 많이 고를까요?"
        />
      ) : null}

      <button
        type="button"
        disabled={!ready || submitting}
        onClick={onSubmit}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 text-[15px] font-bold text-white shadow-[var(--shadow-raised)] transition hover:bg-[var(--hb-primary)] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {submitting
          ? "선택을 남기는 중..."
          : isFirstRound
            ? "1심 제출하고 분포 보기"
            : "항소심 제출하고 결말 보기"}
        {!submitting ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
      </button>
    </div>
  );
}

function WeddingCase({
  weddingCase,
  draft,
  submitting,
  error,
  onDraft,
  onSubmit,
}: {
  weddingCase: WeddingCourtCaseState;
  draft: CourtDraft;
  submitting: boolean;
  error: string | null;
  onDraft: (next: CourtDraft) => void;
  onSubmit: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-[6px] border border-[#e2d3c8] bg-white shadow-[var(--shadow-overlay)]">
      <header className="bg-[var(--hb-primary)] px-5 py-6 text-white sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-[11px] font-bold text-white/85">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {weddingCase.docketLabel}
          </span>
          <span className="rounded-full border border-white/20 px-3 py-1.5 text-[11px] font-semibold text-white/75">
            {stageLabel(weddingCase.stage)}
          </span>
        </div>
        <h2 className="mt-4">
          {weddingCase.title}
        </h2>
        <p className="mt-2 text-[16px] font-semibold leading-7 text-white/92">
          {weddingCase.question}
        </p>
      </header>

      <div className="space-y-6 px-5 py-6 sm:px-8 sm:py-8">
        <section>
          <p className="text-[14px] leading-7 text-[#52635e]">
            {weddingCase.opening}
          </p>
          <ul className="mt-4 space-y-2">
            {weddingCase.initialFacts.map((fact) => (
              <li
                key={fact}
                className="flex gap-3 text-[13px] leading-6 text-[var(--hb-text-strong)]"
              >
                <Check className="mt-1 h-4 w-4 shrink-0 text-[var(--hb-success)]" aria-hidden />
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        </section>

        {weddingCase.firstRound ? (
          <>
            <Distribution
              title="1심 선택 분포"
              distribution={weddingCase.firstRound.distribution}
              choices={weddingCase.choices}
            />
            <div className="rounded-[6px] bg-[var(--hb-surface-hover)] px-4 py-3 text-[13px] font-semibold text-[#52635e]">
              {weddingCase.firstRound.predictionMatchesCurrentLean === null
                ? "현재는 두 선택이 비슷하게 나뉘었어요."
                : weddingCase.firstRound.predictionMatchesCurrentLean
                  ? "내 다수 예상과 현재 분포가 같았어요."
                  : "내 다수 예상과 현재 분포가 달랐어요."}
            </div>
            <Perspectives perspectives={weddingCase.firstRound.perspectives} />
          </>
        ) : (
          <div className="flex gap-3 rounded-[6px] border border-[#e2d3c8] bg-[var(--hb-surface-page)] px-4 py-4">
            <Eye className="mt-0.5 h-5 w-5 shrink-0 text-[#8f6662]" aria-hidden />
            <div>
              <p className="text-[13px] font-bold text-[var(--hb-text-strong)]">
                먼저 고른 사람에게만 분포가 열려요
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[#66756f]">
                다른 사람의 선택에 끌리지 않도록 1심을 제출하기 전에는 결과와 새 단서를 보여주지 않아요.
              </p>
            </div>
          </div>
        )}

        {weddingCase.newEvidence ? (
          <section className="rounded-[6px] border border-[#c7d1c2] bg-[#f2f5ef] px-5 py-5">
            <div className="flex items-center gap-2 text-[var(--hb-text-strong)]">
              <LockKeyhole className="h-4 w-4" aria-hidden />
              <p className="text-[12px] font-bold">
                1심 뒤 공개
              </p>
            </div>
            <h3 className="mt-3 text-[var(--hb-text-strong)]">
              {weddingCase.newEvidence.title}
            </h3>
            <p className="mt-2 text-[14px] leading-7 text-[#52635e]">
              {weddingCase.newEvidence.detail}
            </p>
          </section>
        ) : null}

        {weddingCase.stage !== "complete" ? (
          <VoteForm
            weddingCase={weddingCase}
            draft={draft}
            submitting={submitting}
            onDraft={onDraft}
            onSubmit={onSubmit}
          />
        ) : null}

        {weddingCase.appealRound ? (
          <>
            <Distribution
              title="새 단서 뒤 선택 분포"
              distribution={weddingCase.appealRound.distribution}
              choices={weddingCase.choices}
            />
            <Perspectives perspectives={weddingCase.appealRound.perspectives} />
            <section className="rounded-[6px] bg-[var(--hb-primary)] px-5 py-5 text-white">
              <div className="flex items-center gap-2 text-[#d9e2d6]">
                <Scale className="h-4 w-4" aria-hidden />
                <p className="text-[12px] font-bold">
                  선택 뒤 정리
                </p>
              </div>
              <p className="mt-3 text-[14px] leading-7 text-white/85">
                {weddingCase.ending}
              </p>
              {weddingCase.ownVotes.first && weddingCase.ownVotes.appeal ? (
                <p className="mt-4 border-t border-white/15 pt-4 text-[13px] font-semibold text-white">
                  내 선택:{" "}
                  {weddingCase.choices[weddingCase.ownVotes.first.choice]}
                  {" → "}
                  {weddingCase.choices[weddingCase.ownVotes.appeal.choice]}
                </p>
              ) : null}
            </section>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="text-[13px] font-semibold text-[#b64f4f]">
            {error}
          </p>
        ) : null}

        <p className="border-t border-[#e8ded2] pt-5 text-[11px] leading-5 text-[#71807b]">
          {weddingCase.safetyNotice}
        </p>
      </div>
    </article>
  );
}

export default function WeddingCourtClient() {
  const [cases, setCases] = useState<WeddingCourtCaseState[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, CourtDraft>>({});
  const [loading, setLoading] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittingCaseId, setSubmittingCaseId] = useState<string | null>(null);
  const openCaptured = useRef(false);

  const loadCases = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/community/wedding-court", {
        cache: "no-store",
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        setLoginRequired(true);
        return;
      }
      if (!response.ok) {
        throw new Error(
          apiError(payload, "사건을 불러오지 못했어요."),
        );
      }

      const parsed = weddingCourtCasesResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("사건 응답을 확인할 수 없어요.");
      }
      setCases(parsed.data.cases);
      setLoginRequired(false);
      if (!openCaptured.current) {
        openCaptured.current = true;
        captureEvent("wedding_court_opened", {
          case_count: parsed.data.cases.length,
          completed_count: parsed.data.cases.filter(
            (weddingCase) => weddingCase.stage === "complete",
          ).length,
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError(
        error instanceof Error ? error.message : "사건을 불러오지 못했어요.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCases(controller.signal);
    return () => controller.abort();
  }, [loadCases]);

  const currentCase = cases[selectedIndex];
  const currentDraft = currentCase
    ? (drafts[currentCase.id] ?? EMPTY_DRAFT)
    : EMPTY_DRAFT;

  const completedCount = useMemo(
    () => cases.filter((weddingCase) => weddingCase.stage === "complete").length,
    [cases],
  );

  async function submitVote() {
    if (!currentCase || currentCase.stage === "complete") return;
    const round = currentCase.stage === "first_vote" ? 1 : 2;
    if (
      !currentDraft.choice
      || !currentDraft.reasonChip
      || (round === 1 && !currentDraft.predictedMajority)
    ) {
      return;
    }

    setSubmittingCaseId(currentCase.id);
    setSubmitError(null);
    try {
      const response = await fetch(
        `/api/community/wedding-court/${currentCase.id}/vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            round,
            choice: currentDraft.choice,
            reason_chip: currentDraft.reasonChip,
            ...(round === 1
              ? { predicted_majority: currentDraft.predictedMajority }
              : {}),
          }),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        setLoginRequired(true);
        return;
      }
      if (!response.ok) {
        throw new Error(
          apiError(payload, "선택을 남기지 못했어요."),
        );
      }

      const parsed = weddingCourtVoteResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("선택 결과를 확인할 수 없어요.");
      }

      captureEvent(
        round === 1
          ? "wedding_court_first_vote_completed"
          : "wedding_court_appeal_completed",
        {
          case_slug: currentCase.slug,
          ...(round === 2
            ? {
                changed_after_evidence:
                  currentCase.ownVotes.first?.choice !== currentDraft.choice,
              }
            : {}),
        },
      );
      setCases((current) =>
        current.map((weddingCase) =>
          weddingCase.id === parsed.data.case.id
            ? parsed.data.case
            : weddingCase,
        ),
      );
      setDrafts((current) => ({
        ...current,
        [currentCase.id]: EMPTY_DRAFT,
      }));
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "선택을 남기지 못했어요.",
      );
    } finally {
      setSubmittingCaseId(null);
    }
  }

  function moveCase(direction: -1 | 1) {
    setSubmitError(null);
    if (currentCase) {
      captureEvent("wedding_court_case_navigated", {
        direction: direction === 1 ? "next" : "previous",
        from_stage: currentCase.stage,
      });
    }
    setSelectedIndex((current) => {
      const next = current + direction;
      if (next < 0) return cases.length - 1;
      if (next >= cases.length) return 0;
      return next;
    });
  }

  return (
    <div className="min-h-[calc(100vh-76px)] bg-[var(--hb-surface-page)]">
      <div className="mx-auto w-full max-w-[860px] px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-7">
          <div className="flex items-center gap-2 text-[#8f6662]">
            <Gavel className="h-5 w-5" aria-hidden />
            <p className="text-[12px] font-bold tracking-[0.14em]">
              TODAY&apos;S WEDDING CHOICE
            </p>
          </div>
          <h1 className="mt-3 text-[var(--hb-text-strong)]">
            오늘의 웨딩 선택 법정
          </h1>
          <p className="mt-3 max-w-[650px] text-[14px] leading-7 text-[#52635e] sm:text-[15px]">
            짧은 합성 사건을 먼저 고르고, 다른 참여자의 선택 분포를 확인해보세요.
            새 단서가 열리면 한 번 더 선택할 수 있어요.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-[#52635e]">
            <span className="rounded-full bg-white px-3 py-2">실제 사연 수집 없음</span>
            <span className="rounded-full bg-white px-3 py-2">자유 댓글 없음</span>
            <span className="rounded-full bg-white px-3 py-2">준비 계획 자동 반영 없음</span>
          </div>
        </header>

        {loading ? (
          <div
            role="status"
            className="rounded-[6px] border border-[#e2d3c8] bg-white px-6 py-16 text-center"
          >
            <RefreshCw
              className="mx-auto h-6 w-6 animate-spin text-[var(--hb-success)]"
              aria-hidden
            />
            <p className="mt-4 text-[14px] font-semibold text-[#52635e]">
              오늘의 사건을 준비하고 있어요
            </p>
          </div>
        ) : loginRequired ? (
          <div className="rounded-[6px] border border-[#e2d3c8] bg-white px-6 py-12 text-center shadow-[var(--shadow-overlay)]">
            <LockKeyhole className="mx-auto h-7 w-7 text-[#8f6662]" aria-hidden />
            <h2 className="mt-4 text-[var(--hb-text-strong)]">
              로그인하고 내 선택을 남겨보세요
            </h2>
            <p className="mx-auto mt-2 max-w-[430px] text-[13px] leading-6 text-[#66756f]">
              먼저 선택한 사람에게만 분포와 새 단서가 보여요. 닉네임이나 개인 사연은 받지 않아요.
            </p>
            <Link
              href={LOGIN_HREF}
              className="mt-6 inline-flex min-h-12 items-center justify-center rounded-[6px] bg-[var(--hb-primary)] px-6 text-[14px] font-bold text-white"
            >
              로그인하고 시작하기
            </Link>
          </div>
        ) : loadError ? (
          <div className="rounded-[6px] border border-[#e2d3c8] bg-white px-6 py-12 text-center">
            <p role="alert" className="text-[14px] font-semibold text-[#b64f4f]">
              {loadError}
            </p>
            <button
              type="button"
              onClick={() => void loadCases()}
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[var(--hb-primary)] px-5 text-[13px] font-bold text-[var(--hb-text-strong)]"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              다시 불러오기
            </button>
          </div>
        ) : currentCase ? (
          <>
            <div className="mb-4 flex items-center justify-between gap-4 px-1">
              <p className="text-[12px] font-semibold text-[#66756f]">
                사건 {selectedIndex + 1}/{cases.length}
                <span className="ml-2 text-[#8f6662]">
                  · 완료 {completedCount}/{cases.length}
                </span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => moveCase(-1)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#e2d3c8] bg-white text-[var(--hb-text-strong)]"
                  aria-label="이전 사건"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => moveCase(1)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#e2d3c8] bg-white text-[var(--hb-text-strong)]"
                  aria-label="다음 사건"
                >
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>

            <WeddingCase
              weddingCase={currentCase}
              draft={currentDraft}
              submitting={submittingCaseId === currentCase.id}
              error={submitError}
              onDraft={(draft) =>
                setDrafts((current) => ({
                  ...current,
                  [currentCase.id]: draft,
                }))
              }
              onSubmit={() => void submitVote()}
            />
          </>
        ) : (
          <div className="rounded-[6px] border border-[#e2d3c8] bg-white px-6 py-12 text-center">
            <p className="text-[14px] font-semibold text-[#52635e]">
              지금 열려 있는 합성 사건이 없어요.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
