"use client";

import { useState } from "react";
import { Copy, RefreshCw, Send, Share2, UsersRound } from "lucide-react";
import { captureCourtEvent } from "./analytics";
import { createInvite } from "./api";
import type { CourtInvite } from "./types";
import { CourtButton, Surface } from "./CourtPrimitives";

export default function SoloUpgradeInvite({ caseId, rejectedAt }: { caseId: string; rejectedAt?: string }) {
  const [invite, setInvite] = useState<CourtInvite | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setLoading(true);
    setError(null);
    try {
      const result = await createInvite(caseId);
      setInvite(result);
      setMessage("정식 쌍방 판결로 전환할 초대 링크를 만들었어요.");
      captureCourtEvent("couple_court_invite_create", { mode: "solo" });
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "초대 링크를 만들지 못했어요.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      setMessage("초대 링크를 복사했어요.");
      captureCourtEvent("couple_court_invite_copy", { mode: "solo", status: "copied" });
    } catch {
      setError("링크를 복사하지 못했어요. 브라우저 권한을 확인해 주세요.");
    }
  }

  async function share() {
    if (!invite) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "웨딩한방 둘만의 중재실 초대", text: "내 임시판결은 보이지 않아요. 각자 진술한 뒤 새 정식 판결을 받아요.", url: invite.inviteUrl });
        setMessage("공유 창을 열었어요.");
        captureCourtEvent("couple_court_invite_copy", { mode: "solo", status: "shared" });
        return;
      }
      await copy();
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError("초대 링크를 공유하지 못했어요.");
    }
  }

  return <Surface className="mt-5"><UsersRound className="h-6 w-6 text-[#36534E]" aria-hidden="true" /><h2 className="mt-3 text-xl font-bold text-[#263832]">상대방을 초대해 정식 판결로 전환</h2><p className="mt-2 text-base leading-7 text-[#65716C]">지금 임시판결을 상대방에게 보내는 기능이 아니에요. 상대방은 내 원문과 임시판결을 보지 않고 먼저 자신의 진술을 작성하고, 두 진술이 모이면 새로운 정식 판결을 받습니다.</p>{rejectedAt && !invite && <div className="mt-4 rounded-[14px] border border-[#D8CDC1] bg-[#FCFAF6] p-4"><p className="font-bold text-[#263832]">상대방이 이번 초대에 참여하지 않았어요</p><p className="mt-1 text-sm leading-6 text-[#65716C]">거절 이유나 계정 정보는 표시하지 않아요. 필요하다면 먼저 대화한 뒤 새 링크를 보내주세요.</p></div>}{invite ? <div className="mt-5 rounded-[16px] border border-[#D8CDC1] bg-[#FCFAF6] p-4"><p className="text-sm font-bold text-[#263832]">초대 링크 준비 완료</p><p className="mt-1 text-sm leading-6 text-[#65716C]">비밀 링크는 상대방 한 명에게만 보내주세요. 새 링크를 만들면 이전 링크가 무효가 될 수 있어요.</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><CourtButton onClick={() => void share()} className="flex-1"><Share2 className="h-4 w-4" aria-hidden="true" />공유하기</CourtButton><CourtButton onClick={() => void copy()} variant="secondary" className="flex-1"><Copy className="h-4 w-4" aria-hidden="true" />링크 복사</CourtButton><CourtButton onClick={() => void issue()} variant="secondary" disabled={loading} ariaLabel="새 초대 링크 만들기"><RefreshCw className="h-4 w-4" aria-hidden="true" />새 링크</CourtButton></div></div> : <CourtButton onClick={() => void issue()} disabled={loading} variant="secondary" className="mt-5">{loading ? "링크 만드는 중…" : <><Send className="h-4 w-4" aria-hidden="true" />{rejectedAt ? "새 초대 링크 만들기" : "정식 판결 초대 만들기"}</>}</CourtButton>}<div className="mt-4 min-h-7" aria-live="polite">{message && <p className="text-sm font-semibold leading-6 text-[#36534E]">{message}</p>}{error && <p className="text-sm font-semibold leading-6 text-[#9B3F3F]" role="alert">{error}</p>}</div></Surface>;
}
