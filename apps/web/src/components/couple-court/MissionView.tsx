"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, Check, CheckCircle2, HeartHandshake, LockKeyhole, Save, UserRound, X } from "lucide-react";
import { useAccessibleDialog } from "@/hooks/useAccessibleDialog";
import { captureCourtEvent } from "./analytics";
import { getCase, getVerdict, saveMissionAction, submitFollowup, updateMissionStatus } from "./api";
import type { CourtCase, CourtVerdict, VerdictMission } from "./types";
import { CourtButton, CourtLink, CourtPage, ErrorState, LoadingState, PageIntro, SafetyNotice, Surface } from "./CourtPrimitives";

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(minutes?: number) {
  if (!minutes || !Number.isFinite(minutes) || minutes < 1) return null;
  if (minutes < 60) return `${Math.round(minutes)}분`;
  if (minutes % 1440 === 0) return `${minutes / 1440}일`;
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

export default function MissionView({ caseId }: { caseId: string }) {
  const [courtCase, setCourtCase] = useState<CourtCase | null>(null);
  const [verdict, setVerdict] = useState<CourtVerdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [missionStates, setMissionStates] = useState<Record<string, "idle" | "accepted" | "completed">>({});
  const [changingMissionId, setChangingMissionId] = useState<string | null>(null);
  const [pendingSoloMission, setPendingSoloMission] = useState<VerdictMission | null>(null);
  const [sharedConfirmed, setSharedConfirmed] = useState(false);
  const [followupOutcome, setFollowupOutcome] = useState<"resolved" | "improved" | "unchanged" | "needs_more_talk" | null>(null);
  const [remainingIssue, setRemainingIssue] = useState("");
  const [mostHelpfulMission, setMostHelpfulMission] = useState("");
  const [followupSubmitting, setFollowupSubmitting] = useState(false);
  const [followupFieldError, setFollowupFieldError] = useState<"outcome" | "remaining" | null>(null);
  const [followupSubmitted, setFollowupSubmitted] = useState(false);
  const [followupSafety, setFollowupSafety] = useState<"normal" | "sensitive" | "high_risk">("normal");
  const { dialogRef } = useAccessibleDialog({
    isOpen: pendingSoloMission !== null,
    onClose: () => { setPendingSoloMission(null); setSharedConfirmed(false); },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [caseResult, verdictResult] = await Promise.all([getCase(caseId), getVerdict(caseId)]);
      setCourtCase(caseResult);
      setVerdict(verdictResult);
      setFollowupSubmitted(caseResult.followupSubmitted === true);
      setSavedIds(new Set(verdictResult.missions.filter((mission) => mission.saved).map((mission) => mission.id)));
      setMissionStates(Object.fromEntries(
        verdictResult.missions
          .filter((mission) => Boolean(mission.id))
          .map((mission) => [mission.id, mission.viewerStatus ?? "idle"]),
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "화해 처방을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(mission: VerdictMission, confirmShared: boolean) {
    if (!mission.id) {
      setActionError("이 처방은 아직 저장 가능한 할 일로 연결되지 않았어요.");
      return;
    }
    setSavingId(mission.id);
    setActionError(null);
    setStatusMessage("");
    try {
      await saveMissionAction(caseId, mission.id, confirmShared);
      setSavedIds((current) => new Set(current).add(mission.id));
      setStatusMessage(`‘${mission.title}’을 커플 공용 할 일에 저장했어요.`);
      captureCourtEvent("couple_court_task_create", { mode: courtCase?.mode, status: "saved" });
      setPendingSoloMission(null);
      setSharedConfirmed(false);
    } catch (saveError) {
      setActionError(saveError instanceof Error ? saveError.message : "화해 처방을 저장하지 못했어요.");
    } finally {
      setSavingId(null);
    }
  }

  function requestSave(mission: VerdictMission) {
    if (courtCase?.mode === "solo") {
      setSharedConfirmed(false);
      setPendingSoloMission(mission);
      return;
    }
    void save(mission, false);
  }

  async function changeMission(mission: VerdictMission) {
    if (!mission.id) return;
    const current = missionStates[mission.id] ?? "idle";
    const next = current === "idle" ? "accepted" : "completed";
    setChangingMissionId(mission.id);
    setActionError(null);
    try {
      await updateMissionStatus(mission.id, next);
      setMissionStates((states) => ({ ...states, [mission.id]: next }));
      setStatusMessage(next === "accepted" ? `‘${mission.title}’ 처방을 수락했어요.` : `‘${mission.title}’ 처방을 완료했어요.`);
      captureCourtEvent(next === "accepted" ? "couple_court_mission_accept" : "couple_court_mission_complete", { mode: courtCase?.mode, status: next });
    } catch (missionError) {
      setActionError(missionError instanceof Error ? missionError.message : "화해 처방 상태를 바꾸지 못했어요.");
    } finally {
      setChangingMissionId(null);
    }
  }

  async function sendFollowup() {
    if (followupOutcome === null) {
      setFollowupFieldError("outcome");
      setActionError(null);
      window.requestAnimationFrame(() => document.getElementById("followup-outcome-resolved")?.focus());
      return;
    }
    if (remainingIssue.trim().length < 2) {
      setFollowupFieldError("remaining");
      setActionError(null);
      window.requestAnimationFrame(() => document.getElementById("remaining-issue")?.focus());
      return;
    }
    setFollowupSubmitting(true);
    setFollowupFieldError(null);
    setActionError(null);
    try {
      const result = await submitFollowup(caseId, {
        outcome: followupOutcome,
        remainingIssue: remainingIssue.trim(),
        mostHelpfulMission: mostHelpfulMission.trim() || undefined,
      });
      setFollowupSafety(result.safetyLevel);
      setFollowupSubmitted(true);
      setStatusMessage(result.safetyLevel === "high_risk"
        ? "지금은 체크인 저장보다 안전 확인을 먼저 안내할게요."
        : "체크인을 저장했어요. 남은 문제가 있으면 다음 대화에 반영할 수 있어요.");
      captureCourtEvent("couple_court_followup_submit", { mode: courtCase?.mode, status: result.safetyLevel });
      if (result.safetyLevel === "high_risk") captureCourtEvent("couple_court_safety_redirect", { mode: courtCase?.mode, status: "followup" });
    } catch (followupError) {
      setActionError(followupError instanceof Error ? followupError.message : "체크인을 저장하지 못했어요.");
    } finally {
      setFollowupSubmitting(false);
    }
  }

  if (loading) return <CourtPage><LoadingState label="화해 처방을 준비하는 중이에요." /></CourtPage>;
  if (error || !courtCase || !verdict) return <CourtPage><ErrorState message={error ?? "화해 처방을 찾지 못했어요."} onRetry={() => void load()} /></CourtPage>;
  if (followupSafety === "high_risk") {
    return <CourtPage className="max-w-[760px]"><div className="pt-8"><SafetyNotice highRisk /><p className="mt-4 rounded-[16px] border border-[#B45353]/20 bg-white p-4 text-base leading-7 text-[#5E6C66]" role="alert">기존 판결과 처방은 더 이상 표시하거나 실행하지 않아요. 지금은 합의보다 안전 확인을 먼저 해주세요.</p><div className="mt-6 flex justify-center"><CourtLink href={`/couple-court/cases/${caseId}`} variant="secondary">안전 안내와 사건 상태 확인</CourtLink></div></div></CourtPage>;
  }

  const verdictCompletedAt = verdict.createdAt ? Date.parse(verdict.createdAt) : Number.NaN;
  const followupAvailableAt = Number.isFinite(verdictCompletedAt)
    ? verdictCompletedAt + (72 * 60 * 60 * 1_000)
    : null;
  const followupLocked = followupAvailableAt === null || Date.now() < followupAvailableAt;

  return (
    <CourtPage className="max-w-[900px]">
      <PageIntro eyebrow="화해 처방" title="판결을 오늘의 결정으로 바꿔볼게요" description="작고 확인 가능한 행동부터 시작하세요. 저장한 처방은 웨딩한방 공용 할 일에서 이어갈 수 있어요." />

      {verdict.missions.length === 0 ? <Surface className="text-center"><HeartHandshake className="mx-auto h-9 w-9 text-[#36534E]" aria-hidden="true" /><h2 className="mt-4 text-xl font-bold text-[#263832]">저장할 수 있는 화해 처방이 없어요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">현재 판결에는 실행 항목이 포함되지 않았습니다. 사실을 지어내지 않고 판결 화면으로 돌아갈게요.</p><CourtLink href={`/couple-court/cases/${caseId}/verdict`} variant="secondary" className="mt-5">판결 다시 보기</CourtLink></Surface> : <ol className="grid gap-4 md:grid-cols-2" aria-label="화해 처방 목록">{verdict.missions.map((mission, index) => {
        const saved = savedIds.has(mission.id);
        const saving = savingId === mission.id;
        const missionState = missionStates[mission.id] ?? "idle";
        const changing = changingMissionId === mission.id;
        const ownerLabel = mission.ownerRole === "applicant" ? "신청인" : mission.ownerRole === "partner" ? "상대방" : mission.ownerRole === "both" ? "두 사람" : mission.ownerRole;
        const canAct = mission.ownerRole === "both"
          || mission.ownerRole === courtCase.viewerRole;
        return <li key={mission.id || `${mission.title}-${index}`}><Surface as="article" className="flex h-full flex-col"><div className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEF4F1] text-sm font-bold text-[#36534E]">{index + 1}</span>{missionState !== "idle" && <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF4F1] px-2.5 py-1 text-xs font-bold text-[#36534E]"><Check className="h-3.5 w-3.5" aria-hidden="true" />{missionState === "completed" ? "완료" : "수락함"}</span>}</div><h2 className="mt-4 text-xl font-bold leading-7 text-[#263832]">{mission.title}</h2><p className="mt-2 whitespace-pre-wrap text-base leading-7 text-[#5E6C66]">{mission.description}</p><dl className="mt-5 space-y-2 border-t border-[#E8E0D7] pt-4 text-sm text-[#65716C]">{ownerLabel && <div className="flex gap-2"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[#36534E]" aria-hidden="true" /><dt className="sr-only">담당</dt><dd>담당: {ownerLabel}</dd></div>}{(mission.dueAt || mission.dueInMinutes) && <div className="flex gap-2"><CalendarCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-[#36534E]" aria-hidden="true" /><dt className="sr-only">기한</dt><dd>{mission.dueAt ? `기한: ${formatDate(mission.dueAt)}` : `권장 기한: 판결 후 ${formatDuration(mission.dueInMinutes)} 이내`}</dd></div>}{mission.completionCheck && <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#36534E]" aria-hidden="true" /><dt className="sr-only">완료 기준</dt><dd>완료 기준: {mission.completionCheck}</dd></div>}</dl>{canAct ? <div className="mt-auto grid gap-2 pt-5"><CourtButton onClick={() => void changeMission(mission)} disabled={missionState === "completed" || changing || !mission.id} variant={missionState === "idle" ? "primary" : "secondary"} className="w-full">{changing ? "상태 저장 중…" : missionState === "completed" ? "처방 완료" : missionState === "accepted" ? "완료 표시" : "이 처방 수락"}</CourtButton><CourtButton onClick={() => requestSave(mission)} disabled={saved || saving || !mission.id} variant="secondary" className="w-full"><Save className="h-4 w-4" aria-hidden="true" />{saved ? "공용 일정·할 일에 저장됨" : saving ? "저장하는 중…" : mission.id ? "공용 일정·할 일로 저장" : "저장 연결 없음"}</CourtButton></div> : <p className="mt-auto pt-5 text-sm font-semibold leading-6 text-[#65716C]">상대방 담당 처방이에요. 내용은 함께 볼 수 있지만 상태 변경과 할 일 저장은 담당자만 할 수 있어요.</p>}</Surface></li>;
      })}</ol>}

      <Surface className="mt-6">
        <p className="text-xs font-bold tracking-[0.14em] text-[#8F6662]">3일 후 체크인</p>
        <h2 className="mt-2 text-xl font-bold text-[#263832]">{verdict.followupQuestion ?? "이 판결과 화해 처방이 실제 결정에 도움이 됐나요?"}</h2>
        <p className="mt-2 text-sm leading-6 text-[#65716C]">처방을 실행한 뒤 남은 문제를 솔직하게 알려주세요. 진술 원문은 분석 이벤트에 보내지 않습니다.</p>
        {followupSubmitted ? (
          <div className="mt-5 rounded-[16px] bg-[#EEF4F1] p-4">
            <p className="font-bold text-[#36534E]">체크인을 저장했어요</p>
            <p className="mt-1 text-sm leading-6 text-[#65716C]">체크인은 한 번만 제출할 수 있어요. 남은 문제가 달라지면 새로운 사건으로 다시 정리할 수 있어요.</p>
            <CourtLink href="/couple-court/new" variant="secondary" className="mt-4">새 사건으로 이어서 정리</CourtLink>
          </div>
        ) : followupLocked ? (
          <div className="mt-5 flex gap-3 rounded-[16px] border border-[#E1D7CB] bg-[#F8F5F0] p-4" role="status">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-[#8F6662]" aria-hidden="true" />
            <div>
              <p className="font-bold text-[#263832]">처방을 실행해 본 뒤 열려요</p>
              <p className="mt-1 text-sm leading-6 text-[#65716C]">
                {followupAvailableAt === null
                  ? "판결 완료 시간을 확인한 뒤 체크인할 수 있어요. 새로고침해 주세요."
                  : `${formatDateTime(followupAvailableAt)}부터 한 번 제출할 수 있어요.`}
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void sendFollowup(); }} className="mt-5">
            <fieldset aria-describedby={followupFieldError === "outcome" ? "followup-outcome-error" : undefined}>
              <legend className="text-sm font-bold text-[#263832]">지금은 어떻게 달라졌나요?</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {([
                  ["resolved", "해결됐다"],
                  ["improved", "조금 나아졌다"],
                  ["unchanged", "아직 그대로다"],
                  ["needs_more_talk", "오히려 더 이야기해야 한다"],
                ] as const).map(([value, label]) => <button id={`followup-outcome-${value}`} key={value} type="button" onClick={() => { setFollowupOutcome(value); setFollowupFieldError(null); }} aria-pressed={followupOutcome === value} className={`min-h-11 rounded-[12px] border px-3 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 ${followupOutcome === value ? "border-[#36534E] bg-[#EEF4F1] text-[#36534E]" : "border-[#D8CDC1] bg-white text-[#65716C]"}`}>{label}</button>)}
              </div>
              {followupFieldError === "outcome" && <p id="followup-outcome-error" className="mt-2 text-sm font-semibold text-[#9B3F3F]" role="alert">현재 결과를 하나 골라주세요.</p>}
            </fieldset>
            <label htmlFor="remaining-issue" className="mt-5 block text-sm font-bold text-[#263832]">아직 남은 문제</label>
            <textarea id="remaining-issue" value={remainingIssue} onChange={(event) => { setRemainingIssue(event.target.value); setFollowupFieldError(null); }} minLength={2} maxLength={1000} rows={4} aria-invalid={followupFieldError === "remaining"} aria-describedby={followupFieldError === "remaining" ? "remaining-issue-error" : undefined} className="mt-2 w-full rounded-[14px] border border-[#D8CDC1] px-4 py-3 text-base leading-7 outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15" placeholder="아직 정하지 못했거나 다시 이야기할 부분을 적어주세요." />
            {followupFieldError === "remaining" && <p id="remaining-issue-error" className="mt-2 text-sm font-semibold text-[#9B3F3F]" role="alert">아직 남은 문제를 2자 이상 적어주세요.</p>}
            <label htmlFor="followup-helpful-mission" className="mt-4 block text-sm font-bold text-[#263832]">어떤 처방이 가장 도움 됐나요? (선택)</label>
            <textarea id="followup-helpful-mission" value={mostHelpfulMission} onChange={(event) => setMostHelpfulMission(event.target.value)} maxLength={2000} rows={3} className="mt-2 w-full rounded-[14px] border border-[#D8CDC1] px-4 py-3 text-base leading-7 outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15" placeholder="도움이 된 행동이나 대화를 적어주세요." />
            <CourtButton type="submit" disabled={followupSubmitting} className="mt-4 w-full sm:w-auto">{followupSubmitting ? "체크인 저장 중…" : "체크인 저장"}</CourtButton>
          </form>
        )}
      </Surface>

      <div className="mt-5 min-h-7" aria-live="polite">{statusMessage && <p className="rounded-[14px] bg-[#EEF4F1] px-4 py-3 text-sm font-semibold text-[#36534E]">{statusMessage}</p>}{actionError && <p className="rounded-[14px] bg-[#FFF3F1] px-4 py-3 text-sm font-semibold text-[#9B3F3F]" role="alert">{actionError}</p>}</div>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row"><CourtLink href={`/couple-court/cases/${caseId}/verdict`} variant="secondary">판결 다시 보기</CourtLink><CourtLink href={`/couple-court/cases/${caseId}`} variant="text">사건 현황으로</CourtLink></div>

      {pendingSoloMission && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#17241F]/45 p-3 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPendingSoloMission(null); setSharedConfirmed(false); } }}><div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="solo-share-title" aria-describedby="solo-share-description" tabIndex={-1} className="w-full max-w-[520px] rounded-[24px] border border-[#E1D7CB] bg-[#FFFDF8] p-5 shadow-[0_24px_80px_rgba(23,36,31,0.28)] outline-none sm:p-7"><div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FBF0EC] text-[#8F6662]"><LockKeyhole className="h-5 w-5" aria-hidden="true" /></span><button type="button" onClick={() => { setPendingSoloMission(null); setSharedConfirmed(false); }} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#65716C] outline-none hover:bg-[#F2EEE8] focus-visible:ring-2 focus-visible:ring-[#36534E]" aria-label="확인창 닫기"><X className="h-5 w-5" aria-hidden="true" /></button></div><h2 id="solo-share-title" className="mt-4 text-2xl font-bold text-[#263832]">커플 공용 할 일에 저장할까요?</h2><p id="solo-share-description" className="mt-3 text-base leading-7 text-[#5E6C66]">혼자 임시판결에서 만든 처방도 저장하면 현재 연결된 상대방에게 보입니다. 진술 원문이나 판결 전체는 공유되지 않고, 아래 할 일의 제목과 내용만 보여요.</p><div className="mt-4 rounded-[14px] border border-[#E1D7CB] bg-white p-4"><p className="font-bold text-[#263832]">{pendingSoloMission.title}</p><p className="mt-1 text-sm leading-6 text-[#65716C]">{pendingSoloMission.description}</p></div><label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3"><input type="checkbox" checked={sharedConfirmed} onChange={(event) => setSharedConfirmed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#36534E]" /><span className="text-sm font-semibold leading-6 text-[#263832]">이 할 일이 커플 공용 공간에서 상대방에게 보이는 것을 확인했어요.</span></label><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><CourtButton onClick={() => { setPendingSoloMission(null); setSharedConfirmed(false); }} variant="secondary">취소</CourtButton><button type="button" onClick={() => void save(pendingSoloMission, true)} disabled={!sharedConfirmed || savingId === pendingSoloMission.id} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 py-2.5 text-sm font-semibold text-white outline-none hover:bg-[#2D4642] focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55">{savingId === pendingSoloMission.id ? "저장하는 중…" : "확인하고 저장"}</button></div></div></div>}
    </CourtPage>
  );
}
