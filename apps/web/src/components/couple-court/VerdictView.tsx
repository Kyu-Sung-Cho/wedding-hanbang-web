"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FilePenLine, FileQuestion, HeartHandshake, History as HistoryIcon, MessagesSquare, RefreshCw, Scale, Sparkles } from "lucide-react";
import { CourtApiError, getCase, getVerdict, getVerdictHistory, getVerdictStatus, requestVerdict } from "./api";
import type { CourtCase, CourtVerdict, CourtVerdictHistoryItem, FactStatus } from "./types";
import { ArchivedCaseNotice, CourtButton, CourtLink, CourtPage, CourtSeal, ErrorState, LoadingState, SafetyNotice, StatusBadge, Surface } from "./CourtPrimitives";
import PublicSharingPanel from "./PublicSharingPanel";
import ShareVerdictCard from "./ShareVerdictCard";
import SoloUpgradeInvite from "./SoloUpgradeInvite";
import { captureCourtEvent } from "./analytics";

const FACT_LABELS: Record<FactStatus, string> = {
  agreed: "양측 일치",
  applicant_claim: "신청인 주장",
  respondent_claim: "상대방 주장",
  disputed: "서로 다르게 기억",
};

const loadingMessages = [
  "서운함과 사실관계를 분리하고 있어요.",
  "둘 다 억울한 부분을 빠짐없이 확인하고 있어요.",
  "판결보다 중요한 화해 처방을 준비하고 있어요.",
];

const TONE_LABELS = {
  gentle: "다정하게",
  practical: "현실적으로",
  spicy: "유쾌하고 솔직하게",
} as const;

const CONFIDENCE_LABELS = {
  low: "추가 진술이 있으면 더 정확해져요",
  medium: "핵심 쟁점을 판단할 정보가 있어요",
  high: "양쪽 설명이 충분히 구체적이에요",
} as const;

function formatHistoryDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

function formatCaseDate(value?: string) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function verdictPollDelayMs(retryAfterSeconds: number, randomValue = Math.random()) {
  const seconds = Math.min(300, Math.max(1, Math.ceil(retryAfterSeconds)));
  const baseDelay = seconds * 1_000;
  const boundedRandom = Math.min(0.999, Math.max(0, randomValue));
  const jitterWindow = Math.min(1_000, Math.max(100, Math.floor(baseDelay * 0.1)));
  return baseDelay + Math.floor(boundedRandom * jitterWindow);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export default function VerdictView({ caseId, publicEnabled }: { caseId: string; publicEnabled: boolean }) {
  const [courtCase, setCourtCase] = useState<CourtCase | null>(null);
  const [verdict, setVerdict] = useState<CourtVerdict | null>(null);
  const [verdictHistory, setVerdictHistory] = useState<CourtVerdictHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [safetyRedirect, setSafetyRedirect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const verdictViewTracked = useRef(false);
  const safetyRedirectTracked = useRef(false);
  const mountedRef = useRef(false);
  const operationRef = useRef(0);
  const inFlightRef = useRef(false);
  const readyLoadStartedRef = useRef(false);
  const readyLoadedRef = useRef(false);
  const recoveryAttemptedRef = useRef(false);
  const pollTimeoutRef = useRef<number | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async function pollStatus() {
    if (
      !mountedRef.current
      || document.visibilityState === "hidden"
      || inFlightRef.current
      || readyLoadStartedRef.current
      || readyLoadedRef.current
    ) return;

    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    const controller = new AbortController();
    const operation = ++operationRef.current;
    activeAbortRef.current = controller;
    inFlightRef.current = true;
    const isCurrent = () => (
      mountedRef.current
      && operationRef.current === operation
      && activeAbortRef.current === controller
      && !controller.signal.aborted
    );
    const scheduleNext = (retryAfterSeconds: number) => {
      if (!isCurrent() || document.visibilityState === "hidden") return;
      pollTimeoutRef.current = window.setTimeout(
        () => void pollStatus(),
        verdictPollDelayMs(retryAfterSeconds),
      );
    };

    setError(null);
    try {
      const status = await getVerdictStatus(caseId, controller.signal);
      if (!isCurrent()) return;

      if (status.status === "safety_redirect") {
        setSafetyRedirect(true);
        setPending(false);
        setLoading(false);
        return;
      }
      setSafetyRedirect(false);
      if (status.status === "not_ready") {
        setPending(false);
        setLoading(false);
        setError("필요한 진술이 모두 제출된 뒤 판결을 요청해 주세요.");
        return;
      }
      if (status.status === "judging") {
        setSafetyRedirect(false);
        setPending(true);
        setLoading(false);
        if (status.recoveryAllowed && !recoveryAttemptedRef.current) {
          recoveryAttemptedRef.current = true;
          try {
            // The server-side claim fence permits recovery only before a paid
            // provider boundary can be crossed a second time.
            await requestVerdict(caseId, controller.signal);
          } catch (recoveryError) {
            if (isAbortError(recoveryError) || !isCurrent()) return;
            setPending(false);
            setError(recoveryError instanceof Error
              ? recoveryError.message
              : "중단된 판결을 다시 시작하지 못했어요.");
            return;
          }
          if (!isCurrent()) return;
          scheduleNext(1);
          return;
        }
        scheduleNext(status.retryAfterSeconds ?? 5);
        return;
      }

      readyLoadStartedRef.current = true;
      const [caseResult, verdictResult, historyResult] = await Promise.all([
        getCase(caseId, controller.signal),
        getVerdict(caseId, controller.signal),
        getVerdictHistory(caseId, controller.signal).catch((historyError) => {
          if (isAbortError(historyError)) throw historyError;
          return [];
        }),
      ]);
      if (!isCurrent()) return;
      setCourtCase(caseResult);
      setVerdict(verdictResult);
      setVerdictHistory(historyResult);
      readyLoadedRef.current = true;
      setSafetyRedirect(false);
      setPending(false);
      setLoading(false);
    } catch (loadError) {
      if (isAbortError(loadError) || !isCurrent()) return;
      readyLoadStartedRef.current = false;
      if (loadError instanceof CourtApiError && (loadError.code === "safety_redirect" || loadError.code === "court_safety_redirect")) {
        setSafetyRedirect(true);
      } else {
        setError(loadError instanceof Error ? loadError.message : "판결을 불러오지 못했어요.");
      }
      setPending(false);
      setLoading(false);
    } finally {
      if (activeAbortRef.current === controller) {
        activeAbortRef.current = null;
        inFlightRef.current = false;
      }
    }
  }, [caseId]);

  useEffect(() => {
    mountedRef.current = true;
    readyLoadStartedRef.current = false;
    readyLoadedRef.current = false;
    recoveryAttemptedRef.current = false;
    void load();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (pollTimeoutRef.current !== null) {
          window.clearTimeout(pollTimeoutRef.current);
          pollTimeoutRef.current = null;
        }
        operationRef.current += 1;
        activeAbortRef.current?.abort();
        activeAbortRef.current = null;
        inFlightRef.current = false;
        if (!readyLoadedRef.current) readyLoadStartedRef.current = false;
        return;
      }
      if (!readyLoadedRef.current) void load();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      if (pollTimeoutRef.current !== null) window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
      activeAbortRef.current?.abort();
      activeAbortRef.current = null;
      inFlightRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [load]);

  useEffect(() => {
    if (!pending) return;
    const messageTimer = window.setTimeout(
      () => setLoadingMessageIndex((current) => (current + 1) % loadingMessages.length),
      4000,
    );
    return () => window.clearTimeout(messageTimer);
  }, [loadingMessageIndex, pending]);

  const refresh = useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    if (!pending) setLoading(true);
    void load();
  }, [load, pending]);

  useEffect(() => {
    if (!verdict || verdictViewTracked.current) return;
    verdictViewTracked.current = true;
    captureCourtEvent("couple_court_verdict_view", {
      mode: courtCase?.mode,
      category: courtCase?.category,
      tone: courtCase?.tone,
      status: verdict.provisional ? "provisional" : "bilateral",
    });
  }, [courtCase, verdict]);

  useEffect(() => {
    if ((!safetyRedirect && verdict?.safetyLevel !== "high_risk") || safetyRedirectTracked.current) return;
    safetyRedirectTracked.current = true;
    captureCourtEvent("couple_court_safety_redirect", {
      mode: courtCase?.mode,
      category: courtCase?.category,
      status: "verdict",
    });
  }, [courtCase, safetyRedirect, verdict]);

  if (loading) return <CourtPage><LoadingState label="한방 판결을 확인하는 중이에요." /></CourtPage>;
  if (pending) return <CourtPage className="max-w-[760px]"><div className="flex min-h-[520px] flex-col items-center justify-center text-center" role="status" aria-live="polite"><div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-[#A77B74]/20 bg-[#FBF5F3]"><Scale className="h-10 w-10 text-[#8F6662]" aria-hidden="true" /><span className="absolute inset-0 animate-ping rounded-full border border-[#A77B74]/15 motion-reduce:animate-none" aria-hidden="true" /></div><p className="mt-7 text-xs font-bold tracking-[0.14em] text-[#8F6662]">한방 판사 아모라</p><h1 className="mt-3 text-[30px] font-bold leading-tight text-[#263832]">판결을 준비하고 있어요</h1><p className="mt-4 min-h-14 max-w-[520px] text-base leading-7 text-[#65716C]">{loadingMessages[loadingMessageIndex]}</p><p className="mt-2 text-sm leading-6 text-[#65716C]">화면을 닫아도 요청은 계속돼요. 결과가 저장되면 이 화면에 자동으로 나타납니다.</p><div className="mt-7 flex flex-col gap-2 sm:flex-row"><CourtButton onClick={refresh} variant="secondary"><RefreshCw className="h-4 w-4" aria-hidden="true" />지금 다시 확인</CourtButton><CourtLink href={`/couple-court/cases/${caseId}`} variant="text">사건 현황으로</CourtLink></div></div></CourtPage>;
  if (safetyRedirect) return <CourtPage className="max-w-[760px]"><div className="pt-8"><SafetyNotice highRisk /><p className="mt-4 rounded-[16px] border border-[#B45353]/20 bg-white p-4 text-base leading-7 text-[#5E6C66]" role="alert">이 사건에는 책임 비율, 농담, 공개재판, 투표를 표시하지 않아요. 서비스가 위험 여부를 확정적으로 진단하는 것은 아닙니다.</p><div className="mt-6 flex justify-center"><CourtLink href={`/couple-court/cases/${caseId}`} variant="secondary">사건 현황으로</CourtLink></div></div></CourtPage>;
  if (error || !verdict) return <CourtPage><ErrorState message={error ?? "아직 확인할 수 있는 판결이 없어요."} onRetry={refresh} /></CourtPage>;

  const highRisk = verdict.safetyLevel === "high_risk";
  const archived = courtCase?.status === "archived";
  const responsibilityTotal = verdict.responsibility ? verdict.responsibility.applicant + verdict.responsibility.respondent + (verdict.responsibility.shared ?? 0) : 0;
  const validResponsibility = !highRisk && verdict.responsibility && responsibilityTotal === 100;

  return (
    <CourtPage className="max-w-[900px]">
      <header className="text-center">
        <CourtSeal />
        <p className="mt-4 text-xs font-bold tracking-[0.16em] text-[#8F6662]">한방 판결</p>
        <h1 className="mx-auto mt-3 max-w-[760px] break-keep text-[30px] font-bold leading-[1.3] text-[#263832] sm:text-[40px]">{courtCase?.title ?? "커플재판소 판결"}</h1>
        <div className="mt-4 flex flex-wrap justify-center gap-2"><StatusBadge status={archived ? "archived" : "verdict_ready"} />{verdict.provisional && <span className="rounded-full bg-[#F7F1E8] px-3 py-1.5 text-xs font-semibold text-[#705E48]">1인 진술에 따른 임시판결</span>}</div>
        <dl className="mx-auto mt-5 grid max-w-[760px] grid-cols-2 gap-2 text-left text-xs sm:grid-cols-4">
          <div className="rounded-xl bg-white px-3 py-2.5"><dt className="font-semibold text-[#65716C]">사건번호</dt><dd className="mt-1 font-bold text-[#263832]">{courtCase?.caseNumber ?? caseId.slice(0, 8).toUpperCase()}</dd></div>
          <div className="rounded-xl bg-white px-3 py-2.5"><dt className="font-semibold text-[#65716C]">판결 말투</dt><dd className="mt-1 font-bold text-[#263832]">{courtCase ? TONE_LABELS[courtCase.tone] : "기록 없음"}</dd></div>
          <div className="rounded-xl bg-white px-3 py-2.5"><dt className="font-semibold text-[#65716C]">사건 접수</dt><dd className="mt-1 font-bold text-[#263832]">{formatCaseDate(courtCase?.createdAt)}</dd></div>
          <div className="rounded-xl bg-white px-3 py-2.5"><dt className="font-semibold text-[#65716C]">정보 충분성</dt><dd className="mt-1 font-bold leading-5 text-[#263832]">{verdict.confidence ? CONFIDENCE_LABELS[verdict.confidence] : "판결문 한계에서 확인"}</dd></div>
        </dl>
      </header>

      {archived && <ArchivedCaseNotice caseId={caseId} className="mt-5" />}

      <Surface className="mt-8 border-[#A77B74]/25 bg-[linear-gradient(135deg,#FFFDF9_0%,#FBF3F0_100%)] text-center">
        <Sparkles className="mx-auto h-6 w-6 text-[#8F6662]" aria-hidden="true" />
        <p className="mt-4 text-xs font-bold tracking-[0.13em] text-[#8F6662]">판결 주문</p>
        <h2 className="mx-auto mt-3 max-w-[700px] break-keep text-[24px] font-bold leading-[1.45] text-[#263832] sm:text-[30px]">{verdict.verdictOneLine}</h2>
        <p className="mx-auto mt-4 max-w-[700px] whitespace-pre-wrap text-base leading-8 text-[#5E6C66]">{verdict.summary}</p>
      </Surface>

      {!highRisk && !archived && verdict.missions.length > 0 && <div className="mt-4 flex justify-center"><CourtLink href={`/couple-court/cases/${caseId}/mission`} className="w-full sm:w-auto"><HeartHandshake className="h-4 w-4" aria-hidden="true" />화해 처방 바로 실행하기</CourtLink></div>}

      {!highRisk && <nav aria-label="판결 내용 바로가기" className="mt-4 flex flex-wrap justify-center gap-2 text-sm font-semibold">{verdict.facts.length > 0 && <a href="#court-facts" className="inline-flex min-h-11 items-center rounded-full border border-[#D8D0C7] bg-white px-4 text-[#36534E] outline-none hover:bg-[#F7F4EF] focus-visible:ring-2 focus-visible:ring-[#36534E]">사실관계</a>}<a href="#court-issues" className="inline-flex min-h-11 items-center rounded-full border border-[#D8D0C7] bg-white px-4 text-[#36534E] outline-none hover:bg-[#F7F4EF] focus-visible:ring-2 focus-visible:ring-[#36534E]">핵심 쟁점</a><a href="#court-conversation" className="inline-flex min-h-11 items-center rounded-full border border-[#D8D0C7] bg-white px-4 text-[#36534E] outline-none hover:bg-[#F7F4EF] focus-visible:ring-2 focus-visible:ring-[#36534E]">대화 문장</a><a href="#court-missions" className="inline-flex min-h-11 items-center rounded-full border border-[#D8D0C7] bg-white px-4 text-[#36534E] outline-none hover:bg-[#F7F4EF] focus-visible:ring-2 focus-visible:ring-[#36534E]">화해 처방</a></nav>}

      {highRisk ? <div className="mt-5"><SafetyNotice highRisk />{verdict.limitations && <p className="mt-3 rounded-[16px] border border-[#B45353]/20 bg-white px-4 py-3 text-sm leading-6 text-[#5E6C66]">{verdict.limitations}</p>}</div> : <>
        {verdict.facts.length > 0 && <Surface id="court-facts" className="mt-5 scroll-mt-5"><h2 className="flex items-center gap-2 text-xl font-bold text-[#263832]"><FileQuestion className="h-5 w-5 text-[#36534E]" aria-hidden="true" />확인된 사실과 다른 기억</h2><ul className="mt-5 space-y-3">{verdict.facts.map((fact, index) => <li key={`${fact.fact}-${index}`} className="rounded-[14px] border border-[#E6DED5] bg-[#FCFAF7] p-4"><span className="rounded-full bg-[#EEF4F1] px-2.5 py-1 text-xs font-bold text-[#36534E]">{FACT_LABELS[fact.status]}</span><p className="mt-2 text-base leading-7 text-[#263832]">{fact.fact}</p></li>)}</ul></Surface>}

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Surface><p className="text-xs font-bold tracking-[0.12em] text-[#8F6662]">신청인 관점</p><p className="mt-3 whitespace-pre-wrap text-base leading-8 text-[#263832]">{verdict.applicantPerspective}</p></Surface>
          <Surface><p className="text-xs font-bold tracking-[0.12em] text-[#36534E]">{verdict.provisional ? "확인하지 못한 관점" : "상대방 관점"}</p><p className="mt-3 whitespace-pre-wrap text-base leading-8 text-[#263832]">{verdict.respondentPerspective ?? "상대방의 진술이 없어 의도나 입장을 단정할 수 없어요."}</p></Surface>
        </div>

        {verdict.coreIssues.length > 0 && <Surface id="court-issues" className="mt-5 scroll-mt-5"><h2 className="text-xl font-bold text-[#263832]">핵심 쟁점</h2><ol className="mt-4 space-y-3">{verdict.coreIssues.map((issue, index) => <li key={`${issue}-${index}`} className="flex gap-3 text-base leading-7 text-[#263832]"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#36534E] text-xs font-bold text-white">{index + 1}</span><span>{issue}</span></li>)}</ol></Surface>}

        {validResponsibility && verdict.responsibility && <Surface className="mt-5"><h2 className="text-xl font-bold text-[#263832]">책임 포인트</h2><p className="mt-2 text-sm leading-6 text-[#65716C]">사람의 가치가 아니라 이번 상황에서 바꿀 수 있는 행동의 몫을 뜻해요.</p><div className="mt-5" role="img" aria-label={`신청인 ${verdict.responsibility.applicant}점, 상대방 ${verdict.responsibility.respondent}점${verdict.responsibility.shared ? `, 공동 ${verdict.responsibility.shared}점` : ""}`}><div className="flex flex-wrap justify-between gap-3 text-sm font-bold"><span className="text-[#8F6662]">신청인 {verdict.responsibility.applicant}</span>{Boolean(verdict.responsibility.shared) && <span className="text-[#705E48]">공동 {verdict.responsibility.shared}</span>}<span className="text-[#36534E]">상대방 {verdict.responsibility.respondent}</span></div><div className="mt-2 flex h-4 overflow-hidden rounded-full bg-[#E9E2DA]"><span className="h-full bg-[#A77B74]" style={{ width: `${verdict.responsibility.applicant}%` }} />{Boolean(verdict.responsibility.shared) && <span className="h-full bg-[#C7A96A]" style={{ width: `${verdict.responsibility.shared}%` }} />}<span className="h-full bg-[#7C9B90]" style={{ width: `${verdict.responsibility.respondent}%` }} /></div></div>{verdict.responsibility.explanation && <p className="mt-4 text-base leading-7 text-[#5E6C66]">{verdict.responsibility.explanation}</p>}</Surface>}

        {(verdict.recommendedConversation || verdict.repairScripts.length > 0) && <Surface id="court-conversation" className="mt-5 scroll-mt-5"><h2 className="flex items-center gap-2 text-xl font-bold text-[#263832]"><MessagesSquare className="h-5 w-5 text-[#36534E]" aria-hidden="true" />다시 말해볼 문장</h2>{verdict.recommendedConversation && <p className="mt-4 rounded-[16px] bg-[#EEF4F1] p-4 text-base font-semibold leading-8 text-[#263832]">“{verdict.recommendedConversation}”</p>}{verdict.repairScripts.length > 0 && <ul className="mt-4 space-y-3">{verdict.repairScripts.map((script, index) => <li key={`${script}-${index}`} className="flex gap-3 text-base leading-7 text-[#5E6C66]"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#36534E]" aria-hidden="true" />{script}</li>)}</ul>}</Surface>}

        {verdict.judgeOneLiner && <blockquote className="mt-5 rounded-[22px] border border-[#D7CCC0] bg-[#F7F1E8] px-5 py-6 text-center text-lg font-bold leading-8 text-[#705E48]">“{verdict.judgeOneLiner}”<footer className="mt-2 text-xs font-semibold text-[#705E48]">— 한방 판사 아모라</footer></blockquote>}
      </>}

      {!highRisk && verdict.missions.length > 0 && <Surface id="court-missions" className="mt-5 scroll-mt-5"><HeartHandshake className="h-7 w-7 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-2xl font-bold text-[#263832]">판결보다 중요한 화해 처방</h2><p className="mt-2 text-base leading-7 text-[#65716C]">{archived ? "보관 당시 생성된 화해 처방 기록이에요. 실행 상태는 변경할 수 없어요." : "두 사람이 오늘 실제로 정할 행동을 확인해 보세요."}</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{verdict.missions.slice(0, 4).map((mission) => <article key={mission.id} className="rounded-[16px] border border-[#E2D8CD] bg-[#FCFAF7] p-4"><h3 className="font-bold text-[#263832]">{mission.title}</h3><p className="mt-2 text-sm leading-6 text-[#65716C]">{mission.description}</p></article>)}</div>{!archived && <CourtLink href={`/couple-court/cases/${caseId}/mission`} className="mt-5 w-full sm:w-auto">화해 처방 실행하기</CourtLink>}</Surface>}

      {!highRisk && !archived && courtCase?.mode === "solo" && (
        <SoloUpgradeInvite
          caseId={caseId}
          rejectedAt={courtCase.inviteRejectedAt}
          inviteExpiresAt={courtCase.inviteExpiresAt}
        />
      )}
      {!highRisk && !archived && verdict.safetyLevel === "normal" && verdict.publicCard && <ShareVerdictCard card={verdict.publicCard} />}
      {!highRisk && !archived && publicEnabled && courtCase && <PublicSharingPanel courtCase={courtCase} />}

      {!highRisk && !archived && courtCase?.verdictReady && <Surface className="mt-5"><FilePenLine className="h-6 w-6 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">빠진 사실이 있다면 내 진술을 보완할 수 있어요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">내 최신 진술만 불러와 새 버전으로 제출합니다. 상대방 원문은 보이지 않으며, 기존 공개 미리보기와 동의는 무효가 되고 최신 진술로 새 판결을 요청해야 해요.</p><CourtLink href={`/couple-court/cases/${caseId}/statement?revision=1`} variant="secondary" className="mt-5">내 진술 보완하고 재심 요청</CourtLink></Surface>}

      {!highRisk && verdictHistory.length > 0 && <Surface className="mt-5"><details><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[12px] font-bold text-[#263832] outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2"><HistoryIcon className="h-5 w-5 text-[#36534E]" aria-hidden="true" />판결 이력 {verdictHistory.length}개</summary><p className="mt-3 text-sm leading-6 text-[#65716C]">재심 전 판결 본문은 개인정보 최소화를 위해 이 화면에서 다시 노출하지 않고, 생성 시점과 교체 여부만 보관합니다.</p><ol className="mt-4 space-y-2">{verdictHistory.map((item) => { const completedDate = formatHistoryDate(item.completedAt); return <li key={`${item.generationVersion}-${item.completedAt ?? "pending"}`} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[#E2D8CD] bg-[#FCFAF7] px-4 py-3 text-sm"><span className="font-bold text-[#263832]">제 {item.generationVersion}차 판결</span><span className="text-[#65716C]">{item.status === "ready" ? "현재 판결" : "새 판결로 교체됨"}{completedDate ? ` · ${completedDate}` : ""}</span></li>; })}</ol></details></Surface>}

      {verdict.limitations && !highRisk && <div className="mt-5 flex gap-3 rounded-[16px] border border-[#D9CFC3] bg-[#FCFAF6] p-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#8F6662]" aria-hidden="true" /><p className="text-sm leading-6 text-[#65716C]">{verdict.limitations}</p></div>}
      <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row"><CourtLink href={`/couple-court/cases/${caseId}`} variant="secondary">사건 현황으로</CourtLink><CourtLink href="/couple-court" variant="text">내 사건 목록</CourtLink></div>
    </CourtPage>
  );
}
