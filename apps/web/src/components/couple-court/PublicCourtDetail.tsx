"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Flag, MessageCircle, MessageCircleHeart, Scale, ShieldCheck, UsersRound } from "lucide-react";
import { captureCourtEvent } from "./analytics";
import { createPublicComment, getPublicCase, listPublicComments, reportPublicCase, votePublicCase } from "./api";
import type { PublicCourtCase, PublicCourtComment, PublicReportReason, PublicVoteChoice } from "./types";
import { categoryLabel, CourtButton, CourtLink, CourtPage, CourtSeal, ErrorState, LoadingState, SafetyNotice, Surface } from "./CourtPrimitives";
import { publicCourtNickname } from "./publicIdentity";

const voteChoices: Array<{ value: PublicVoteChoice; label: string; description: string }> = [
  { value: "both_need_change", label: "둘 다 바꿀 점이 있어요", description: "승패보다 함께 조정할 행동이 보여요." },
  { value: "need_more_info", label: "정보가 더 필요해요", description: "공개된 요약만으로는 판단을 미루고 싶어요." },
  { value: "applicant_more_at_fault", label: "신청인이 더 바꿔야 해요", description: "이번 상황에서는 신청인의 행동 변화가 더 필요해 보여요." },
  { value: "partner_more_at_fault", label: "상대방이 더 바꿔야 해요", description: "이번 상황에서는 상대방의 행동 변화가 더 필요해 보여요." },
];

const reportReasons: Array<{ value: PublicReportReason; label: string }> = [
  { value: "pii", label: "개인정보가 보여요" },
  { value: "harassment", label: "괴롭힘·모욕이 있어요" },
  { value: "threat", label: "위협적인 내용이에요" },
  { value: "hate", label: "혐오 표현이 있어요" },
  { value: "minor_safety", label: "미성년자 안전이 걱정돼요" },
  { value: "spam", label: "광고·도배예요" },
  { value: "other", label: "그 밖의 문제" },
];

const commentTypes: Array<{ value: PublicCourtComment["commentType"]; label: string }> = [
  { value: "empathy", label: "공감" },
  { value: "experience", label: "비슷한 경험" },
  { value: "practical_advice", label: "현실 조언" },
  { value: "question", label: "확인 질문" },
];

export default function PublicCourtDetail({ postId }: { postId: string }) {
  const [post, setPost] = useState<PublicCourtCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [comments, setComments] = useState<PublicCourtComment[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [voting, setVoting] = useState<PublicVoteChoice | null>(null);
  const [selectedVote, setSelectedVote] = useState<PublicVoteChoice | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<PublicReportReason>("pii");
  const [reporting, setReporting] = useState(false);
  const [reportTargetCommentId, setReportTargetCommentId] = useState<string | null>(null);
  const [commentType, setCommentType] = useState<PublicCourtComment["commentType"]>("empathy");
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commenting, setCommenting] = useState(false);
  const commentBodyRef = useRef<HTMLTextAreaElement>(null);
  const reportReasonRef = useRef<HTMLSelectElement>(null);
  const reportReturnTargetRef = useRef("post");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [postResult, commentResult] = await Promise.all([getPublicCase(postId), listPublicComments(postId)]);
      setPost(postResult);
      setComments(commentResult);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "공개 사건을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!reportOpen) return;
    const frame = window.requestAnimationFrame(() => reportReasonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [reportOpen]);

  function openReport(commentId?: string) {
    reportReturnTargetRef.current = commentId ? `comment-${commentId}` : "post";
    setReportTargetCommentId(commentId ?? null);
    setReportOpen(true);
  }

  function closeReport() {
    const returnTarget = reportReturnTargetRef.current;
    setReportOpen(false);
    setReportTargetCommentId(null);
    window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-court-report-trigger]"))
        .find((candidate) => candidate.dataset.courtReportTrigger === returnTarget);
      const trigger = target instanceof HTMLButtonElement ? target : target?.querySelector("button");
      trigger?.focus({ preventScroll: true });
    });
  }

  async function vote(choice: PublicVoteChoice) {
    setVoting(choice);
    setActionError(null);
    setStatusMessage("");
    try {
      await votePublicCase(postId, choice);
      setSelectedVote(choice);
      setStatusMessage("의견을 반영했어요. 승패보다 필요한 변화를 함께 살펴볼게요.");
      captureCourtEvent("couple_court_vote", { status: choice });
      await load();
    } catch (voteError) {
      setActionError(voteError instanceof Error ? voteError.message : "의견을 반영하지 못했어요.");
    } finally {
      setVoting(null);
    }
  }

  async function report() {
    setReporting(true);
    setActionError(null);
    try {
      await reportPublicCase(postId, reportReason, reportTargetCommentId ?? undefined);
      setStatusMessage("신고를 접수했어요. 검토하는 동안 같은 신고를 반복하지 않아도 돼요.");
      closeReport();
    } catch (reportError) {
      setActionError(reportError instanceof Error ? reportError.message : "신고를 접수하지 못했어요.");
    } finally {
      setReporting(false);
    }
  }

  async function comment() {
    if (commentBody.trim().length < 2) {
      setCommentError("댓글을 2자 이상 적어주세요.");
      setActionError(null);
      window.requestAnimationFrame(() => commentBodyRef.current?.focus());
      return;
    }
    setCommenting(true);
    setCommentError(null);
    setActionError(null);
    setStatusMessage("");
    try {
      const result = await createPublicComment(postId, commentType, commentBody.trim());
      setCommentBody("");
      setComments(await listPublicComments(postId));
      setStatusMessage(result.moderationStatus === "approved"
        ? "댓글을 게시했어요."
        : "안전 검토를 요청했어요. 승인된 뒤 공개 댓글 목록에 표시됩니다.");
      captureCourtEvent("couple_court_comment", { status: commentType });
    } catch (commentError) {
      setCommentError(commentError instanceof Error ? commentError.message : "댓글을 남기지 못했어요.");
    } finally {
      setCommenting(false);
    }
  }

  if (loading) return <CourtPage><LoadingState label="익명 판결을 불러오는 중이에요." /></CourtPage>;
  if (error || !post) return <CourtPage><ErrorState message={error ?? "공개 사건을 찾지 못했어요."} onRetry={() => void load()} /></CourtPage>;

  const highRisk = post.safetyLevel === "high_risk";

  return <CourtPage className="max-w-[860px]">
    <CourtLink href="/couple-court/public" variant="text" className="mb-5 px-0"><ArrowLeft className="h-4 w-4" aria-hidden="true" />공개재판 목록</CourtLink>
    <header className="text-center"><CourtSeal /><p className="mt-4 text-xs font-bold tracking-[0.14em] text-[#8F6662]">웨딩한방 공개재판</p><h1 className="mx-auto mt-3 max-w-[720px] break-keep text-[30px] font-bold leading-[1.3] text-[#263832] sm:text-[40px]">{post.title}</h1><div className="mt-4 flex flex-wrap justify-center gap-2"><span className="rounded-full bg-[#F3EEF0] px-3 py-1.5 text-xs font-semibold text-[#875F5B]">{publicCourtNickname(post.id)}</span><span className="rounded-full bg-[#EEF4F1] px-3 py-1.5 text-xs font-bold text-[#36534E]">{categoryLabel(post.category)}</span><span className="rounded-full bg-[#F7F1E8] px-3 py-1.5 text-xs font-semibold text-[#705E48]">{post.mode === "solo" ? "1인 임시판결" : "쌍방 판결"}</span></div></header>

    <Surface className="mt-8 text-center"><Scale className="mx-auto h-6 w-6 text-[#8F6662]" aria-hidden="true" /><p className="mt-3 text-xs font-bold tracking-[0.12em] text-[#8F6662]">익명 사건 요약</p><p className="mx-auto mt-3 max-w-[700px] whitespace-pre-wrap text-lg font-semibold leading-8 text-[#263832]">{post.summary}</p>{post.verdictOneLine && <p className="mx-auto mt-5 max-w-[680px] rounded-[16px] bg-[#FBF3F0] px-5 py-4 text-lg font-bold leading-8 text-[#8F6662]">{post.verdictOneLine}</p>}</Surface>

    {highRisk ? <div className="mt-5"><SafetyNotice highRisk /></div> : <Surface className="mt-5"><h2 className="flex items-center gap-2 text-xl font-bold text-[#263832]"><MessageCircleHeart className="h-5 w-5 text-[#36534E]" aria-hidden="true" />이 사건에서 더 필요한 변화는?</h2><p className="mt-2 text-sm leading-6 text-[#65716C]">공개된 익명 요약만 보고 남기는 가벼운 의견입니다. 두 사람의 실제 관계나 성격을 판단하지 마세요.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{voteChoices.map((choice) => { const selected = selectedVote === choice.value || post.votes?.viewerChoice === choice.value; const count = post.votes?.counts?.[choice.value] ?? 0; return <button key={choice.value} type="button" onClick={() => void vote(choice.value)} disabled={voting !== null} aria-pressed={selected} className={`min-h-[88px] rounded-[16px] border p-4 text-left outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 disabled:opacity-60 ${selected ? "border-[#36534E] bg-[#EEF4F1]" : "border-[#DDD2C6] bg-white hover:border-[#A9BDB5]"}`}><span className="flex items-start justify-between gap-3"><span><span className="block text-sm font-bold text-[#263832]">{choice.label}</span><span className="mt-1 block text-xs leading-5 text-[#65716C]">{choice.description}</span>{post.votes && post.votes.total > 0 && <span className="mt-2 block text-xs font-bold text-[#36534E]">{count}명</span>}</span>{selected && <Check className="h-4 w-4 shrink-0 text-[#36534E]" aria-hidden="true" />}</span></button>; })}</div>{post.votes && post.votes.total > 0 && <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#65716C]"><UsersRound className="h-4 w-4" aria-hidden="true" />지금까지 {post.votes.total}명이 승패보다 필요한 변화에 의견을 남겼어요.</p>}</Surface>}

    {!highRisk && post.commentsEnabled && (
      <Surface className="mt-5">
        <h2 className="flex items-center gap-2 text-xl font-bold text-[#263832]"><MessageCircle className="h-5 w-5 text-[#36534E]" aria-hidden="true" />안전한 경험 나누기</h2>
        <p className="mt-2 text-sm leading-6 text-[#65716C]">당사자를 판단하거나 신상을 추측하지 말고, 공감과 실제 도움이 되는 경험만 남겨주세요.</p>
        <form onSubmit={(event) => { event.preventDefault(); void comment(); }} className="mt-5" noValidate>
          <label htmlFor="comment-type" className="text-sm font-bold text-[#263832]">댓글 종류</label>
          <select id="comment-type" value={commentType} onChange={(event) => setCommentType(event.target.value as PublicCourtComment["commentType"])} className="mt-2 min-h-11 w-full rounded-[12px] border border-[#D8CDC1] bg-white px-3 text-base outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15 sm:max-w-[220px]">{commentTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
          <label htmlFor="court-comment" className="mt-4 block text-sm font-bold text-[#263832]">내용</label>
          <textarea
            ref={commentBodyRef}
            id="court-comment"
            value={commentBody}
            onChange={(event) => { setCommentBody(event.target.value); setCommentError(null); }}
            minLength={2}
            maxLength={500}
            rows={4}
            aria-invalid={Boolean(commentError)}
            aria-describedby={commentError ? "court-comment-error" : undefined}
            className="mt-2 w-full rounded-[14px] border border-[#D8CDC1] px-4 py-3 text-base leading-7 outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15"
            placeholder="개인정보 없이 2자 이상 적어주세요."
          />
          <div className="mt-1 flex min-h-6 items-start justify-between gap-3">
            {commentError && <p id="court-comment-error" className="text-sm font-semibold text-[#9B3F3F]" role="alert">{commentError}</p>}
            <span className="ml-auto shrink-0 text-xs text-[#65716C]">{commentBody.length}/500</span>
          </div>
          <CourtButton type="submit" disabled={commenting} className="mt-3">{commenting ? "댓글 확인 중…" : "댓글 남기기"}</CourtButton>
        </form>
        <div className="mt-6 border-t border-[#E8E0D7] pt-5">
          <h3 className="font-bold text-[#263832]">댓글 {comments.length > 0 ? comments.length : ""}</h3>
          {comments.length === 0 ? <p className="mt-3 text-sm leading-6 text-[#65716C]">아직 댓글이 없어요. 첫 댓글도 개인정보 없이 따뜻하게 남겨주세요.</p> : <ul className="mt-3 space-y-3">{comments.map((commentItem) => <li key={commentItem.id} className="rounded-[14px] border border-[#E4DAD0] bg-[#FCFAF7] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-[#EEF4F1] px-2.5 py-1 text-xs font-bold text-[#36534E]">{commentTypes.find((type) => type.value === commentItem.commentType)?.label}</span><button type="button" data-court-report-trigger={`comment-${commentItem.id}`} onClick={() => openReport(commentItem.id)} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-semibold text-[#65716C] outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[#36534E]" aria-label="이 댓글 신고"><Flag className="h-3.5 w-3.5" aria-hidden="true" />신고</button></div><p className="mt-2 whitespace-pre-wrap break-words text-base leading-7 text-[#263832]">{commentItem.body}</p></li>)}</ul>}
        </div>
      </Surface>
    )}

    <div className="mt-5 min-h-7" aria-live="polite">{statusMessage && <p className="rounded-[14px] bg-[#EEF4F1] px-4 py-3 text-sm font-semibold leading-6 text-[#36534E]">{statusMessage}</p>}{actionError && <p className="rounded-[14px] bg-[#FFF3F1] px-4 py-3 text-sm font-semibold leading-6 text-[#9B3F3F]" role="alert">{actionError}</p>}</div>

    <Surface className="mt-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#36534E]" aria-hidden="true" /><div><h2 className="font-bold text-[#263832]">원문과 분리된 공개용 요약이에요</h2><p className="mt-1 text-sm leading-6 text-[#65716C]">이 화면만으로 당사자의 의도나 실제 책임을 단정할 수 없습니다. 개인정보나 위험한 내용이 보이면 알려주세요.</p></div></div>{reportOpen ? <div className="mt-5 rounded-[16px] border border-[#E1D7CB] bg-[#FCFAF6] p-4" role="region" aria-labelledby="court-report-title"><p id="court-report-title" className="text-sm font-bold text-[#8F6662]">{reportTargetCommentId ? "댓글 신고" : "게시물 신고"}</p><label htmlFor="report-reason" className="mt-2 block text-sm font-bold text-[#263832]">신고 이유</label><select ref={reportReasonRef} id="report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value as PublicReportReason)} className="mt-2 min-h-11 w-full rounded-[12px] border border-[#D8CDC1] bg-white px-3 text-base outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15">{reportReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select><div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><CourtButton onClick={closeReport} variant="secondary">취소</CourtButton><CourtButton onClick={() => void report()} variant="danger" disabled={reporting}>{reporting ? "접수 중…" : "신고 접수"}</CourtButton></div></div> : <span data-court-report-trigger="post"><CourtButton onClick={() => openReport()} variant="secondary" className="mt-4"><Flag className="h-4 w-4" aria-hidden="true" />이 게시물 신고</CourtButton></span>}</Surface>

    <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row"><CourtLink href="/couple-court/new">내 사건 비공개로 시작</CourtLink><CourtLink href="/couple-court/public" variant="secondary">다른 공개재판 보기</CourtLink></div>
  </CourtPage>;
}
