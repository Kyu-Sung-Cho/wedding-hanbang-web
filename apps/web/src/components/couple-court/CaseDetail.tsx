"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, CheckCircle2, Circle, Clock3, Copy, FileText, HeartHandshake, Link2, MailCheck, RefreshCw, Send, Share2, Sparkles, Trash2, XCircle } from "lucide-react";
import { weddingPath } from "@/lib/weddingPaths";
import { captureCourtEvent } from "./analytics";
import { archiveCase, cancelInvite, createInvite, deleteCase, getCase, leaveCase, requestVerdict } from "./api";
import type { CourtCase, CourtInvite } from "./types";
import { categoryLabel, CourtButton, CourtLink, CourtPage, ErrorState, LoadingState, PageIntro, SafetyNotice, StatusBadge, Surface } from "./CourtPrimitives";
import SoloUpgradeInvite from "./SoloUpgradeInvite";

const STATUS_ORDER = [
  "draft",
  "awaiting_applicant_statement",
  "awaiting_partner",
  "awaiting_partner_statement",
  "statements_complete",
  "judging",
  "verdict_ready",
  "mission_active",
  "resolved",
] as const;

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function CaseDetail({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [courtCase, setCourtCase] = useState<CourtCase | null>(null);
  const [invite, setInvite] = useState<CourtInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [inviting, setInviting] = useState(false);
  const [cancellingInvite, setCancellingInvite] = useState(false);
  const [judging, setJudging] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const deleteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (deleteConfirm) deleteInputRef.current?.focus();
  }, [deleteConfirm]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCourtCase(await getCase(caseId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "사건을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const timeline = useMemo(() => {
    if (!courtCase) return [];
    const items = [
      { key: "created", label: "사건 접수 완료", done: true },
      { key: "applicant", label: "신청인 진술 완료", done: courtCase.applicantStatementSubmitted },
    ];
    if (courtCase.mode === "couple") {
      items.push(
        { key: "partner", label: courtCase.partnerJoined ? "상대방 초대 수락" : "상대방 초대", done: courtCase.partnerJoined },
        { key: "partner-statement", label: "상대방 진술 완료", done: courtCase.partnerStatementSubmitted },
      );
    }
    items.push(
      { key: "judge", label: "한방 판결", done: courtCase.verdictReady },
      { key: "mission", label: "화해 처방", done: courtCase.status === "resolved" },
    );
    return items;
  }, [courtCase]);

  async function issueInvite() {
    setInviting(true);
    setActionError(null);
    setStatusMessage("");
    try {
      const created = await createInvite(caseId);
      setInvite(created);
      setCourtCase((current) => current
        ? { ...current, inviteExpiresAt: created.expiresAt, inviteRejectedAt: undefined }
        : current);
      setStatusMessage("새 초대 링크를 만들었어요. 이 링크는 상대방에게만 보내주세요.");
      captureCourtEvent("couple_court_invite_create", { mode: courtCase?.mode, category: courtCase?.category });
    } catch (inviteError) {
      setActionError(inviteError instanceof Error ? inviteError.message : "초대 링크를 만들지 못했어요.");
    } finally {
      setInviting(false);
    }
  }

  async function shareInvite() {
    if (!invite) return;
    setActionError(null);
    try {
      if (navigator.share) {
        await navigator.share({ title: "웨딩한방 둘만의 중재실 초대", text: "내 글은 보이지 않아요. 먼저 당신의 입장을 적어주세요.", url: invite.inviteUrl });
        setStatusMessage("초대 공유창을 열었어요.");
        captureCourtEvent("couple_court_invite_copy", { mode: courtCase?.mode, category: courtCase?.category, status: "shared" });
        return;
      }
      await navigator.clipboard.writeText(invite.inviteUrl);
      setStatusMessage("초대 링크를 복사했어요.");
      captureCourtEvent("couple_court_invite_copy", { mode: courtCase?.mode, category: courtCase?.category, status: "copied" });
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setActionError("공유하지 못했어요. 링크 복사를 다시 시도해 주세요.");
    }
  }

  async function copyInvite() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      setStatusMessage("초대 링크를 복사했어요.");
      setActionError(null);
      captureCourtEvent("couple_court_invite_copy", { mode: courtCase?.mode, category: courtCase?.category, status: "copied" });
    } catch {
      setActionError("클립보드에 복사하지 못했어요. 브라우저 권한을 확인해 주세요.");
    }
  }

  async function cancelCurrentInvite() {
    setCancellingInvite(true);
    setActionError(null);
    try {
      await cancelInvite(caseId);
      setInvite(null);
      setCourtCase((current) => current
        ? { ...current, inviteExpiresAt: undefined }
        : current);
      setStatusMessage("초대 링크를 취소했어요. 기존 링크로는 참여할 수 없어요.");
    } catch (cancelError) {
      setActionError(cancelError instanceof Error ? cancelError.message : "초대 링크를 취소하지 못했어요.");
    } finally {
      setCancellingInvite(false);
    }
  }

  async function judge() {
    setJudging(true);
    setActionError(null);
    setStatusMessage("판결 요청을 안전하게 보내는 중이에요.");
    try {
      await requestVerdict(caseId);
      captureCourtEvent("couple_court_verdict_request", { mode: courtCase?.mode, category: courtCase?.category, tone: courtCase?.tone, status: "requested" });
      router.push(weddingPath(`/couple-court/cases/${caseId}/verdict`));
    } catch (judgeError) {
      setActionError(judgeError instanceof Error ? judgeError.message : "판결을 요청하지 못했어요.");
      setStatusMessage("");
    } finally {
      setJudging(false);
    }
  }

  async function archiveCurrentCase() {
    setArchiving(true);
    setActionError(null);
    try {
      await archiveCase(caseId);
      router.replace(weddingPath("/couple-court"));
      router.refresh();
    } catch (archiveError) {
      setActionError(archiveError instanceof Error ? archiveError.message : "사건을 보관하지 못했어요.");
      setArchiveConfirm(false);
    } finally {
      setArchiving(false);
    }
  }

  async function deleteCurrentCase() {
    if (deleteConfirmationText !== "영구삭제") return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteCase(caseId, deleteConfirmationText);
      router.replace(weddingPath("/couple-court"));
      router.refresh();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "사건을 영구 삭제하지 못했어요.");
    } finally {
      setDeleting(false);
    }
  }

  async function leaveCurrentCase() {
    setLeaving(true);
    setActionError(null);
    try {
      await leaveCase(caseId);
      router.replace(weddingPath("/couple-court"));
      router.refresh();
    } catch (leaveError) {
      setActionError(leaveError instanceof Error ? leaveError.message : "사건 참여를 취소하지 못했어요.");
      setLeaveConfirm(false);
    } finally {
      setLeaving(false);
    }
  }

  if (loading) return <CourtPage><LoadingState label="사건 기록을 확인하는 중이에요." /></CourtPage>;
  if (error || !courtCase) return <CourtPage><ErrorState message={error ?? "사건을 찾지 못했어요."} onRetry={() => void load()} /></CourtPage>;

  const needsMyStatement = courtCase.viewerRole === "partner" ? !courtCase.partnerStatementSubmitted : !courtCase.applicantStatementSubmitted;
  const statusIndex = STATUS_ORDER.indexOf(courtCase.status as typeof STATUS_ORDER[number]);

  return (
    <CourtPage>
      <PageIntro eyebrow="둘만의 중재실" title={courtCase.title} description={courtCase.neutralSummary ?? "두 사람의 진술 원문은 서로 공개하지 않고, 판결에는 중재된 요약만 보여요."}>
        <div className="mt-5 flex flex-wrap items-center gap-2"><StatusBadge status={courtCase.status} /><span className="rounded-full bg-[#F7F1E8] px-3 py-1.5 text-xs font-semibold text-[#705E48]">{categoryLabel(courtCase.category)}</span><span className="rounded-full bg-[#F3EEF0] px-3 py-1.5 text-xs font-semibold text-[#875F5B]">{courtCase.mode === "couple" ? "쌍방 중재" : "1인 임시판결"}</span></div>
      </PageIntro>

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <Surface>
          <h2 className="text-xl font-bold text-[#263832]">진행 현황</h2>
          <ol className="mt-5 space-y-1" aria-label="사건 진행 단계">
            {timeline.map((item, index) => {
              const isCurrent = !item.done && timeline.slice(0, index).every((previous) => previous.done);
              return <li key={item.key} className="relative flex min-h-[54px] gap-3 pb-3"><span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white">{item.done ? <CheckCircle2 className="h-6 w-6 text-[#36534E]" aria-hidden="true" /> : isCurrent ? <Clock3 className="h-6 w-6 text-[#A77B74]" aria-hidden="true" /> : <Circle className="h-6 w-6 text-[#C8CFCB]" aria-hidden="true" />}</span>{index < timeline.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-14px)] w-px bg-[#DCE3DF]" aria-hidden="true" />}<div><p className={`pt-0.5 text-base font-semibold ${item.done ? "text-[#36534E]" : isCurrent ? "text-[#8F6662]" : "text-[#88938E]"}`}>{item.label}</p>{isCurrent && <p className="mt-1 text-sm leading-6 text-[#65716C]" aria-current="step">현재 단계</p>}</div></li>;
            })}
          </ol>
          {courtCase.updatedAt && <p className="mt-2 text-xs text-[#65716C]">마지막 변경 {formatDate(courtCase.updatedAt)}</p>}
        </Surface>

        <div className="space-y-5">
          {needsMyStatement && <Surface><FileText className="h-6 w-6 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">내 진술을 먼저 작성해 주세요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">누가 먼저 접수했는지는 중요하지 않아요. 상대방의 글을 보지 않고 내 기억부터 정리합니다.</p><CourtLink href={`/couple-court/cases/${caseId}/statement`} className="mt-5 w-full sm:w-auto">진술 작성하기</CourtLink></Surface>}

          {courtCase.viewerRole === "partner" && !courtCase.partnerStatementSubmitted && courtCase.status === "awaiting_partner_statement" && <Surface><XCircle className="h-6 w-6 text-[#65716C]" aria-hidden="true" /><h2 className="mt-3 text-lg font-bold text-[#263832]">이번에는 참여하지 않을까요?</h2><p className="mt-2 text-sm leading-6 text-[#65716C]">진술을 제출하기 전까지만 나갈 수 있어요. 나가면 이 사건에 접근할 수 없고, 신청인은 혼자 작성하던 상태로 돌아갑니다.</p>{!leaveConfirm ? <CourtButton onClick={() => setLeaveConfirm(true)} variant="secondary" className="mt-4">이번 사건에 참여하지 않기</CourtButton> : <div className="mt-4 rounded-[14px] border border-[#D8CDC1] bg-[#FCFAF6] p-4" role="alert"><p className="font-bold text-[#263832]">정말 이 사건에서 나갈까요?</p><p className="mt-1 text-sm leading-6 text-[#65716C]">작성한 진술이 없을 때만 처리되며, 다시 참여하려면 새로운 초대가 필요해요.</p><div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row"><CourtButton onClick={() => setLeaveConfirm(false)} variant="secondary" disabled={leaving}>계속 참여</CourtButton><CourtButton onClick={() => void leaveCurrentCase()} variant="danger" disabled={leaving}>{leaving ? "나가는 중…" : "확인하고 나가기"}</CourtButton></div></div>}</Surface>}

          {courtCase.mode === "couple" && courtCase.safetyLevel !== "high_risk" && courtCase.applicantStatementSubmitted && !courtCase.partnerStatementSubmitted && courtCase.viewerRole !== "partner" && <Surface><MailCheck className="h-6 w-6 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">상대방 답변서를 기다리고 있어요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">상대방은 내 진술을 볼 수 없고, 자신의 입장을 먼저 제출해요. 링크를 다시 만들면 이전 링크는 무효가 됩니다.</p>{courtCase.inviteRejectedAt ? <div className="mt-5 rounded-[16px] border border-[#D8CDC1] bg-[#FCFAF6] p-4"><p className="font-bold text-[#263832]">상대방이 이번 초대에 참여하지 않았어요</p><p className="mt-1 text-sm leading-6 text-[#65716C]">거절 이유나 계정 정보는 표시하지 않습니다. 필요하다면 대화한 뒤 새 링크를 만들 수 있어요.</p><CourtButton onClick={() => void issueInvite()} disabled={inviting} variant="secondary" className="mt-4">{inviting ? "새 링크 만드는 중…" : "새 초대 링크 만들기"}</CourtButton></div> : invite ? <div className="mt-5 rounded-[16px] border border-[#D8CDC1] bg-[#FCFAF6] p-4"><p className="flex items-center gap-2 text-sm font-bold text-[#263832]"><Link2 className="h-4 w-4" aria-hidden="true" />초대 링크 준비 완료</p><p className="mt-2 break-all text-sm leading-6 text-[#65716C]">보안을 위해 링크는 이 화면에서만 복사해 주세요.</p>{invite.expiresAt && <p className="mt-1 text-xs text-[#65716C]">만료 {formatDate(invite.expiresAt)}</p>}<div className="mt-4 grid gap-2 sm:grid-cols-2"><CourtButton onClick={() => void shareInvite()} className="w-full"><Share2 className="h-4 w-4" aria-hidden="true" />공유하기</CourtButton><CourtButton onClick={() => void copyInvite()} variant="secondary" className="w-full"><Copy className="h-4 w-4" aria-hidden="true" />링크 복사</CourtButton><CourtButton onClick={() => void cancelCurrentInvite()} variant="secondary" disabled={cancellingInvite} className="w-full sm:col-span-2"><XCircle className="h-4 w-4" aria-hidden="true" />{cancellingInvite ? "취소하는 중…" : "이 초대 링크 취소"}</CourtButton></div></div> : courtCase.inviteExpiresAt ? <div className="mt-5 rounded-[16px] border border-[#D8CDC1] bg-[#FCFAF6] p-4"><p className="font-bold text-[#263832]">기존 초대 링크가 아직 유효해요</p><p className="mt-1 text-sm leading-6 text-[#65716C]">보안상 링크 원문은 다시 표시하지 않아요. 분실했다면 새 링크를 만들 수 있습니다.</p><p className="mt-1 text-xs text-[#65716C]">만료 {formatDate(courtCase.inviteExpiresAt)}</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><CourtButton onClick={() => void issueInvite()} disabled={inviting} className="w-full">{inviting ? "새 링크 만드는 중…" : "새 링크 발급"}</CourtButton><CourtButton onClick={() => void cancelCurrentInvite()} variant="secondary" disabled={cancellingInvite} className="w-full">{cancellingInvite ? "취소하는 중…" : "기존 링크 취소"}</CourtButton></div></div> : <CourtButton onClick={() => void issueInvite()} disabled={inviting} className="mt-5 w-full sm:w-auto">{inviting ? <><Sparkles className="h-4 w-4 animate-pulse motion-reduce:animate-none" aria-hidden="true" />링크 만드는 중…</> : <><Send className="h-4 w-4" aria-hidden="true" />초대 링크 만들기</>}</CourtButton>}</Surface>}

          {courtCase.status === "judging" && <Surface><Sparkles className="h-7 w-7 animate-pulse text-[#A77B74] motion-reduce:animate-none" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">판결보다 중요한 화해 처방을 준비 중이에요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">화면을 나가도 요청은 취소되지 않아요. 잠시 뒤 결과 화면에서 다시 확인할 수 있어요.</p><CourtLink href={`/couple-court/cases/${caseId}/verdict`} variant="secondary" className="mt-5">판결 상태 확인</CourtLink></Surface>}

          {courtCase.canJudge && !courtCase.verdictReady && courtCase.status !== "judging" && <Surface><Sparkles className="h-7 w-7 text-[#A77B74]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">{courtCase.mode === "solo" ? "임시판결을 요청할 준비가 됐어요" : "두 사람의 진술이 모두 모였어요"}</h2><p className="mt-2 text-base leading-7 text-[#65716C]">사실, 감정, 기대를 나눠 보고 오늘 정할 행동까지 준비할게요. 같은 요청은 중복 실행되지 않아요.</p><CourtButton onClick={() => void judge()} disabled={judging} className="mt-5 w-full sm:w-auto">{judging ? "판결 요청 중…" : "한방 판결 요청하기"}</CourtButton></Surface>}

          {courtCase.verdictReady && <Surface><Check className="h-7 w-7 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">한방 판결이 도착했어요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">누가 이겼는지보다 오늘 둘이 무엇을 정할지 확인해 보세요.</p><div className="mt-5 flex flex-col gap-2 sm:flex-row"><CourtLink href={`/couple-court/cases/${caseId}/verdict`} className="flex-1">판결 확인하기</CourtLink><CourtLink href={`/couple-court/cases/${caseId}/mission`} variant="secondary" className="flex-1"><HeartHandshake className="h-4 w-4" aria-hidden="true" />화해 처방 보기</CourtLink></div></Surface>}

          {courtCase.mode === "solo" && courtCase.verdictReady && courtCase.safetyLevel !== "high_risk" && <SoloUpgradeInvite caseId={caseId} rejectedAt={courtCase.inviteRejectedAt} />}

          {!needsMyStatement && !courtCase.canJudge && !courtCase.verdictReady && courtCase.mode === "solo" && statusIndex < 0 && <Surface><RefreshCw className="h-6 w-6 text-[#65716C]" aria-hidden="true" /><p className="mt-3 text-base leading-7 text-[#65716C]">서버에서 다음 단계를 확인하고 있어요. 잠시 후 다시 불러와 주세요.</p><CourtButton onClick={() => void load()} variant="secondary" className="mt-4">새로고침</CourtButton></Surface>}
        </div>
      </div>

      <div className="mt-5 min-h-7" aria-live="polite">{statusMessage && <p className="rounded-[14px] bg-[#EEF4F1] px-4 py-3 text-sm font-semibold text-[#36534E]">{statusMessage}</p>}{actionError && <p className="rounded-[14px] bg-[#FFF3F1] px-4 py-3 text-sm font-semibold text-[#9B3F3F]" role="alert">{actionError}</p>}</div>
      {courtCase.viewerRole === "applicant" && courtCase.status !== "archived" && <>
        <Surface className="mt-5"><Archive className="h-6 w-6 text-[#65716C]" aria-hidden="true" /><h2 className="mt-3 text-lg font-bold text-[#263832]">이 사건을 더 이상 진행하지 않나요?</h2><p className="mt-2 text-sm leading-6 text-[#65716C]">보관하면 내 사건 목록에서 숨기고, 사용하지 않은 초대 링크와 공개 후보를 철회합니다. 비공개 진술과 판결 기록을 즉시 삭제하는 기능은 아니에요.</p>{!archiveConfirm ? <CourtButton onClick={() => setArchiveConfirm(true)} variant="secondary" className="mt-4">사건 보관</CourtButton> : <div className="mt-4 rounded-[14px] border border-[#B45353]/20 bg-[#FFF7F5] p-4" role="alert"><p className="font-bold text-[#263832]">정말 사건을 보관할까요?</p><p className="mt-1 text-sm leading-6 text-[#65716C]">이 작업 뒤에는 이 화면에서 다시 진행할 수 없어요.</p><div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row"><CourtButton onClick={() => setArchiveConfirm(false)} variant="secondary" disabled={archiving}>취소</CourtButton><CourtButton onClick={() => void archiveCurrentCase()} variant="danger" disabled={archiving}>{archiving ? "보관하는 중…" : "확인하고 보관"}</CourtButton></div></div>}</Surface>
        {(courtCase.mode === "solo" || !courtCase.partnerStatementSubmitted) ? <Surface className="mt-5 border-[#B45353]/20"><Trash2 className="h-6 w-6 text-[#9B3F3F]" aria-hidden="true" /><h2 className="mt-3 text-lg font-bold text-[#263832]">사건과 비공개 기록을 영구 삭제</h2><p className="mt-2 text-sm leading-6 text-[#65716C]">진술, 판결, 처방, 공개 후보와 이 사건에서 만든 할 일이 함께 삭제되며 되돌릴 수 없어요. 상대방 진술이 접수된 공동 사건은 한 사람이 단독 삭제할 수 없습니다.</p><p className="mt-2 text-xs leading-5 text-[#65716C]">판결 원문과 사건 식별자는 삭제되지만, 원문이 없는 AI 모델·토큰·비용 감사 기록은 운영 정책에 따라 식별자를 제거한 뒤 최대 1년 보관될 수 있어요. 판결 생성이나 감사 기록이 마무리 중이면 안전하게 끝난 뒤 삭제할 수 있습니다.</p>{!deleteConfirm ? <CourtButton onClick={() => setDeleteConfirm(true)} variant="danger" className="mt-4" disabled={courtCase.status === "judging"}>{courtCase.status === "judging" ? "판결 마무리 후 삭제 가능" : "영구 삭제 시작"}</CourtButton> : <div className="mt-4 rounded-[14px] border border-[#B45353]/25 bg-[#FFF7F5] p-4" role="alert"><label htmlFor="court-delete-confirmation" className="font-bold text-[#263832]">계속하려면 ‘영구삭제’를 입력해 주세요</label><input ref={deleteInputRef} id="court-delete-confirmation" value={deleteConfirmationText} onChange={(event) => setDeleteConfirmationText(event.target.value)} autoComplete="off" className="mt-3 min-h-11 w-full rounded-[12px] border border-[#D8CDC1] bg-white px-3 text-base outline-none focus:border-[#9B3F3F] focus:ring-2 focus:ring-[#9B3F3F]/20" /><div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row"><CourtButton onClick={() => { setDeleteConfirm(false); setDeleteConfirmationText(""); }} variant="secondary" disabled={deleting}>취소</CourtButton><CourtButton onClick={() => void deleteCurrentCase()} variant="danger" disabled={deleting || deleteConfirmationText !== "영구삭제"}>{deleting ? "삭제하는 중…" : "확인하고 영구 삭제"}</CourtButton></div></div>}</Surface> : <p className="mt-5 rounded-[16px] border border-[#D8CDC1] bg-[#FCFAF6] p-4 text-sm leading-6 text-[#65716C]">상대방 진술이 포함된 공동 기록은 현재 한 사람이 단독으로 영구 삭제할 수 없어요. 진행을 중단하려면 사건 보관을 이용해 주세요.</p>}
      </>}
      <div className="mt-5"><SafetyNotice highRisk={courtCase.safetyLevel === "high_risk"} /></div>
      <div className="mt-6 flex justify-center"><CourtLink href="/couple-court" variant="text">내 사건 목록으로</CourtLink></div>
    </CourtPage>
  );
}
