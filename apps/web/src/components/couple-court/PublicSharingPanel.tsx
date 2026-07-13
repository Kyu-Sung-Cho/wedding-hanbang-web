"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, LockKeyhole, Send, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { createPublicPreview, requestPublicReview, setPublicConsent, withdrawPublicPost } from "./api";
import type { CourtCase, PublicSnapshotPreview } from "./types";
import { CourtButton, CourtLink, Surface } from "./CourtPrimitives";
import { captureCourtEvent } from "./analytics";

const publicStatusLabels: Record<string, string> = {
  awaiting_consents: "양측 공개 동의 대기",
  pending_review: "운영 검수 대기",
  published: "공개됨",
  hidden: "공개 철회됨",
  rejected: "공개 검수 반려",
};

export default function PublicSharingPanel({ courtCase }: { courtCase: CourtCase }) {
  const [preview, setPreview] = useState<PublicSnapshotPreview | null>(courtCase.publicPreview ?? null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [ownConsented, setOwnConsented] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [withdrawConfirm, setWithdrawConfirm] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [status, setStatus] = useState(courtCase.publicStatus);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const activePostId = preview?.publicPostId ?? courtCase.publicPostId;

  async function makePreview() {
    setLoadingPreview(true);
    setError(null);
    setMessage("");
    try {
      const result = await createPublicPreview(courtCase.id);
      setPreview(result);
      setStatus("awaiting_consents");
      setConsentChecked(false);
      setOwnConsented(false);
      setMessage("익명화된 공개 전용 미리보기를 만들었어요. 원문과 비교해 빠진 개인정보가 없는지 직접 확인해 주세요.");
      captureCourtEvent("couple_court_public_preview", { mode: courtCase.mode, category: courtCase.category, tone: courtCase.tone, status: "awaiting_consents" });
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "공개 미리보기를 만들지 못했어요.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function consent() {
    if (!preview || !consentChecked) return;
    setConsenting(true);
    setError(null);
    try {
      const nextStatus = await setPublicConsent(courtCase.id, preview, true);
      setOwnConsented(true);
      if (nextStatus) setStatus(nextStatus);
      setMessage(nextStatus === "pending_review"
        ? "필요한 공개 동의가 모두 모였어요. 운영 검수 승인 뒤 게시할 수 있어요."
        : courtCase.mode === "couple"
          ? "내 동의를 저장했어요. 상대방도 같은 익명 미리보기에 동의해야 검수 단계로 넘어가요."
          : "공개 동의를 저장했어요. 운영 검수 단계로 넘어갑니다.");
    } catch (consentError) {
      setError(consentError instanceof Error ? consentError.message : "공개 동의를 저장하지 못했어요.");
    } finally {
      setConsenting(false);
    }
  }

  async function publish() {
    const postId = activePostId;
    if (!postId) return;
    setPublishing(true);
    setError(null);
    try {
      const nextStatus = await requestPublicReview(courtCase.id, postId);
      setStatus(nextStatus ?? "pending_review");
      setMessage(nextStatus === "published" ? "익명 판결이 공개됐어요." : "운영 검수를 요청했어요. 게시 전 개인정보와 안전 기준을 한 번 더 확인합니다.");
      captureCourtEvent("couple_court_public_publish", { mode: courtCase.mode, category: courtCase.category, tone: courtCase.tone, status: nextStatus ?? "pending_review" });
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "공개 검수를 요청하지 못했어요.");
    } finally {
      setPublishing(false);
    }
  }

  async function withdraw() {
    const postId = activePostId;
    if (!postId) return;
    setWithdrawing(true);
    setError(null);
    try {
      await withdrawPublicPost(courtCase.id, postId);
      setStatus("hidden");
      setWithdrawConfirm(false);
      setMessage("공개를 철회했어요. 공개 피드에서 더 이상 보이지 않습니다.");
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : "공개를 철회하지 못했어요.");
    } finally {
      setWithdrawing(false);
    }
  }

  if (courtCase.safetyLevel !== "normal") {
    return <Surface className="mt-5"><EyeOff className="h-6 w-6 text-[#8F6662]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">이 사건은 공개재판을 사용하지 않아요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">민감하거나 안전 확인이 필요한 사건은 익명화 여부와 관계없이 공개, 투표, 댓글을 비활성화합니다.</p></Surface>;
  }

  if (status === "pending_review" || status === "rejected") {
    return <Surface className="mt-5"><ShieldCheck className="h-6 w-6 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">{publicStatusLabels[status]}</h2><p className="mt-2 text-base leading-7 text-[#65716C]">{status === "pending_review" ? "게시 전 개인정보와 안전 기준을 확인하고 있어요. 원본 진술은 검수 화면에도 공개하지 않습니다. 운영 승인이 끝난 뒤 아래 버튼으로 게시 상태를 확인할 수 있어요." : "현재 미리보기는 공개 기준을 통과하지 못했어요. 비공개 사건과 판결은 그대로 유지됩니다. 내용을 다시 익명화해 새 검수를 시작할 수 있어요."}</p>{status === "rejected" && <CourtButton onClick={() => void makePreview()} variant="secondary" disabled={loadingPreview} className="mt-5">{loadingPreview ? "새 미리보기 만드는 중…" : "새 익명 미리보기 만들기"}</CourtButton>}{status === "pending_review" && activePostId && <div className="mt-5"><div className="flex flex-col gap-2 sm:flex-row"><CourtButton onClick={() => void publish()} disabled={publishing}>{publishing ? "승인 상태 확인 중…" : "승인 상태 확인하고 게시"}</CourtButton><CourtButton onClick={() => setWithdrawConfirm(true)} variant="secondary">공개 후보 철회</CourtButton></div>{withdrawConfirm && <div className="mt-3 rounded-[14px] border border-[#B45353]/20 bg-[#FFF7F5] p-4" role="alert"><p className="font-bold text-[#263832]">검수 요청을 철회할까요?</p><p className="mt-1 text-sm leading-6 text-[#65716C]">공개 후보만 숨기며 비공개 판결은 유지됩니다.</p><div className="mt-3 flex gap-2"><CourtButton onClick={() => setWithdrawConfirm(false)} variant="secondary">취소</CourtButton><CourtButton onClick={() => void withdraw()} variant="danger" disabled={withdrawing}>{withdrawing ? "철회 중…" : "철회 확인"}</CourtButton></div></div>}</div>}<div className="mt-4 min-h-7" aria-live="polite">{message && <p className="text-sm font-semibold leading-6 text-[#36534E]">{message}</p>}{error && <p className="text-sm font-semibold leading-6 text-[#9B3F3F]" role="alert">{error}</p>}</div></Surface>;
  }

  if (status === "published" && activePostId) {
    return <Surface className="mt-5"><Eye className="h-6 w-6 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">익명 판결이 공개되어 있어요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">진술 원문이 아닌 공개 전용 요약만 보입니다. 언제든 공개를 철회할 수 있어요.</p><div className="mt-5 flex flex-col gap-2 sm:flex-row"><CourtLink href={`/couple-court/public/${activePostId}`}>공개 화면 보기</CourtLink><CourtButton onClick={() => setWithdrawConfirm(true)} variant="secondary">공개 철회</CourtButton></div>{withdrawConfirm && <div className="mt-4 rounded-[16px] border border-[#B45353]/20 bg-[#FFF7F5] p-4" role="alert"><p className="font-bold text-[#263832]">공개 피드에서 바로 숨길까요?</p><p className="mt-1 text-sm leading-6 text-[#65716C]">비공개 사건과 판결은 삭제되지 않습니다.</p><div className="mt-3 flex gap-2"><CourtButton onClick={() => setWithdrawConfirm(false)} variant="secondary">취소</CourtButton><CourtButton onClick={() => void withdraw()} variant="danger" disabled={withdrawing}>{withdrawing ? "철회 중…" : "공개 철회 확인"}</CourtButton></div></div>}</Surface>;
  }

  if (status === "hidden") {
    return <Surface className="mt-5"><EyeOff className="h-6 w-6 text-[#65716C]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">공개를 철회한 사건이에요</h2><p className="mt-2 text-base leading-7 text-[#65716C]">비공개 판결과 화해 처방은 계속 이용할 수 있어요. 다시 공개하려면 새로운 익명 미리보기와 동의가 필요합니다.</p><CourtButton onClick={() => void makePreview()} variant="secondary" disabled={loadingPreview} className="mt-5">새 미리보기 만들기</CourtButton></Surface>;
  }

  return <Surface className="mt-5"><Eye className="h-6 w-6 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">선택적으로 익명 공개하기</h2><p className="mt-2 text-base leading-7 text-[#65716C]">비공개가 기본입니다. 공개를 원할 때만 원문과 분리된 미리보기를 만들고 정확히 확인한 뒤 동의하세요.</p>
    {!preview ? <CourtButton onClick={() => void makePreview()} disabled={loadingPreview} variant="secondary" className="mt-5">{loadingPreview ? <><Sparkles className="h-4 w-4 animate-pulse motion-reduce:animate-none" aria-hidden="true" />익명화 확인 중…</> : "공개 전용 미리보기 만들기"}</CourtButton> : <div className="mt-5"><div className="rounded-[18px] border border-[#D8CDC1] bg-[#FCFAF6] p-4 sm:p-5" aria-label={`공개 미리보기 버전 ${preview.snapshotVersion}`}><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#EEF4F1] px-2.5 py-1 text-xs font-bold text-[#36534E]">공개 전용 미리보기</span>{preview.snapshot.provisional && <span className="rounded-full bg-[#F7F1E8] px-2.5 py-1 text-xs font-bold text-[#705E48]">1인 임시판결</span>}</div><h3 className="mt-4 text-xl font-bold leading-8 text-[#263832]">{preview.snapshot.safeTitle}</h3><p className="mt-3 text-base leading-7 text-[#5E6C66]">{preview.snapshot.oneLine}</p><p className="mt-4 rounded-[12px] bg-[#FBF3F0] px-3 py-2 text-sm font-bold text-[#8F6662]">{preview.snapshot.resultLabel}</p>{preview.snapshot.hashtags.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{preview.snapshot.hashtags.map((tag) => <span key={tag} className="text-xs font-semibold text-[#65716C]">#{tag.replace(/^#/, "")}</span>)}</div>}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-[14px] border border-[#C8D8D1] bg-[#F2F7F4] p-4"><p className="flex items-center gap-2 text-sm font-bold text-[#36534E]"><Check className="h-4 w-4" aria-hidden="true" />공개되는 것</p><p className="mt-2 text-sm leading-6 text-[#65716C]">위 제목, 한 줄 요약, 결과 라벨, 해시태그</p></div><div className="rounded-[14px] border border-[#E3D6CE] bg-[#FBF7F4] p-4"><p className="flex items-center gap-2 text-sm font-bold text-[#8F6662]"><LockKeyhole className="h-4 w-4" aria-hidden="true" />공개되지 않는 것</p><p className="mt-2 text-sm leading-6 text-[#65716C]">진술 원문, 각자 관점, 이름, 사건 번호, 대화 문장, 화해 처방</p></div></div><label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-[14px] border border-[#D8CDC1] p-4"><input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} disabled={ownConsented} className="mt-1 h-5 w-5 shrink-0 accent-[#36534E]" /><span className="text-sm font-semibold leading-6 text-[#263832]">이 미리보기 버전 {preview.snapshotVersion}의 공개 내용을 직접 확인했고, 익명 공개에 동의해요.</span></label><div className="mt-4 flex flex-col gap-2 sm:flex-row">{!ownConsented ? <CourtButton onClick={() => void consent()} disabled={!consentChecked || consenting} className="flex-1">{consenting ? "동의 저장 중…" : <><UsersRound className="h-4 w-4" aria-hidden="true" />내 공개 동의 저장</>}</CourtButton> : status === "awaiting_consents" && courtCase.mode === "couple" ? <CourtButton disabled variant="secondary" className="flex-1">상대방 동의 기다리는 중</CourtButton> : <CourtButton onClick={() => void publish()} disabled={publishing} className="flex-1">{publishing ? "승인 상태 확인 중…" : <><Send className="h-4 w-4" aria-hidden="true" />운영 승인 상태 확인하고 게시</>}</CourtButton>}</div>{courtCase.mode === "couple" && <p className="mt-3 text-sm leading-6 text-[#65716C]">두 사람 모두 같은 익명 미리보기에 동의해야 합니다. 한쪽이라도 철회하면 게시되지 않아요. 내용을 바꾸려면 먼저 아래에서 공개 후보를 철회한 뒤 새 미리보기를 만드세요.</p>}</div>}
    {status === "awaiting_consents" && activePostId && <div className="mt-4"><CourtButton onClick={() => setWithdrawConfirm(true)} variant="secondary">공개 후보 철회</CourtButton>{withdrawConfirm && <div className="mt-3 rounded-[14px] border border-[#B45353]/20 bg-[#FFF7F5] p-4" role="alert"><p className="font-bold text-[#263832]">공개 동의 절차를 철회할까요?</p><p className="mt-1 text-sm leading-6 text-[#65716C]">두 사람의 기존 동의도 무효가 되고 공개 후보가 숨겨집니다.</p><div className="mt-3 flex gap-2"><CourtButton onClick={() => setWithdrawConfirm(false)} variant="secondary">취소</CourtButton><CourtButton onClick={() => void withdraw()} variant="danger" disabled={withdrawing}>{withdrawing ? "철회 중…" : "철회 확인"}</CourtButton></div></div>}</div>}
    <div className="mt-4 min-h-7" aria-live="polite">{message && <p className="rounded-[12px] bg-[#EEF4F1] px-3 py-2 text-sm font-semibold leading-6 text-[#36534E]">{message}</p>}{error && <p className="rounded-[12px] bg-[#FFF3F1] px-3 py-2 text-sm font-semibold leading-6 text-[#9B3F3F]" role="alert">{error}</p>}</div>
  </Surface>;
}
