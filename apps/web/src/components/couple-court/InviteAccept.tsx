"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Link2Off, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { weddingPath } from "@/lib/weddingPaths";
import {
  acceptInvite,
  CourtApiError,
  prepareInviteAccountSwitch,
  rejectInvite,
} from "./api";
import { captureCourtEvent } from "./analytics";
import { clearLegacyCourtDrafts } from "./draftStorage";
import {
  CourtButton,
  CourtLink,
  CourtPage,
  CourtSeal,
  Surface,
} from "./CourtPrimitives";

type AcceptState = "reading" | "confirm" | "reject_confirm" | "accepting" | "accepted" | "rejected" | "error";

export default function InviteAccept({ publicEnabled }: { publicEnabled: boolean }) {
  const initialized = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<AcceptState>("reading");
  const [caseId, setCaseId] = useState<string | null>(null);
  const [accountLabel, setAccountLabel] = useState("현재 로그인 계정");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const fragment = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    tokenRef.current = new URLSearchParams(fragment).get("token")?.trim() || null;
    // Remove the secret before telemetry, rendering, or later navigation.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    void (async () => {
      try {
        const { data: { user } } = await createClient().auth.getUser();
        if (user) {
          // Seal the fragment token into the short-lived HttpOnly handoff even
          // for an already-authenticated viewer. The fragment is removed above,
          // so a refresh or mobile tab restore must not lose the pending invite.
          if (tokenRef.current) {
            await prepareInviteAccountSwitch(tokenRef.current);
            tokenRef.current = null;
          }
          setAccountLabel(user.email ?? "현재 로그인 계정");
          setMessage("아래 계정이 초대받은 당사자의 계정인지 확인한 뒤 참여해 주세요. 확인 전에는 초대가 사용되지 않아요.");
          setState("confirm");
          return;
        }

        // An unauthenticated request only seals a short-lived HttpOnly handoff;
        // the single-use invite is not consumed until after login and consent.
        const result = await acceptInvite(tokenRef.current ?? undefined);
        tokenRef.current = null;
        if (!result.requiresAuth || !result.actionUrl) {
          throw new Error("로그인 연결 상태를 확인하지 못했어요.");
        }
        const action = new URL(result.actionUrl, window.location.origin);
        if (action.origin !== window.location.origin) {
          throw new Error("로그인 주소를 안전하게 확인하지 못했어요.");
        }
        setMessage(result.message ?? "로그인하면 초대를 안전하게 이어서 확인할게요.");
        window.location.assign(`${action.pathname}${action.search}`);
      } catch (error: unknown) {
        setState("error");
        setMessage(error instanceof Error
          ? error.message
          : "초대를 확인하지 못했어요. 원래 링크를 다시 열어주세요.");
      }
    })();
  }, []);

  async function confirmParticipation() {
    setState("accepting");
    setMessage("현재 계정으로 참여를 등록하고 있어요.");
    try {
      const result = await acceptInvite(tokenRef.current ?? undefined);
      tokenRef.current = null;
      if (!result.caseId) {
        throw new Error("초대를 수락했지만 사건 번호를 확인하지 못했어요.");
      }
      setCaseId(result.caseId);
      setMessage("둘만의 중재실에 참여했어요. 상대방의 글을 보지 않고 내 입장부터 작성합니다.");
      setState("accepted");
      captureCourtEvent("couple_court_partner_join", { status: "accepted" });
    } catch (error: unknown) {
      setState("error");
      if (error instanceof CourtApiError && error.status === 401) {
        setMessage("로그인 시간이 끝났어요. 상대방이 보낸 원래 초대 링크를 다시 열어주세요.");
        return;
      }
      setMessage(error instanceof Error
        ? error.message
        : "초대를 수락하지 못했어요. 원래 초대 링크를 다시 확인해 주세요.");
    }
  }

  async function switchAccount() {
    setState("accepting");
    setMessage("초대는 사용하지 않고 다른 계정으로 전환하고 있어요.");
    try {
      await prepareInviteAccountSwitch(tokenRef.current ?? undefined);
      tokenRef.current = null;
      // Pre-v2 drafts were not account scoped and must not survive a deliberate
      // account switch into the invited partner's session.
      clearLegacyCourtDrafts(window.sessionStorage);
      await createClient().auth.signOut();
      window.location.assign(
        `/login?next=${encodeURIComponent(weddingPath("/couple-court/invite"))}`,
      );
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "계정을 전환하지 못했어요.");
    }
  }

  async function rejectParticipation() {
    setState("accepting");
    setMessage("초대를 안전하게 거절하고 링크를 무효화하고 있어요.");
    try {
      await rejectInvite(tokenRef.current ?? undefined);
      tokenRef.current = null;
      setState("rejected");
      setMessage("이번 초대에는 참여하지 않기로 했어요. 같은 링크로는 다시 참여할 수 없습니다.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "초대를 거절하지 못했어요.");
    }
  }

  return <CourtPage className="max-w-[680px]">
    <Surface className="mt-4 text-center sm:mt-10">
      {state === "accepted"
        ? <CheckCircle2 className="mx-auto h-14 w-14 text-[#36534E]" aria-hidden="true" />
        : state === "error" || state === "rejected"
          ? <Link2Off className="mx-auto h-14 w-14 text-[#9B3F3F]" aria-hidden="true" />
          : <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#FBF3F0]"><CourtSeal compact />{(state === "reading" || state === "accepting") && <Sparkles className="absolute h-5 w-5 animate-pulse text-[#8F6662] motion-reduce:animate-none" aria-hidden="true" />}</div>}
      <p className="mt-5 text-xs font-bold tracking-[0.14em] text-[#8F6662]">둘만의 중재실 초대</p>
      <h1 className="mt-3 text-[28px] font-bold leading-tight text-[#263832]">{state === "accepted" ? "초대에 참여했어요" : state === "rejected" ? "이번 초대를 거절했어요" : state === "error" ? "초대를 이어갈 수 없어요" : state === "reject_confirm" ? "참여하지 않을까요?" : state === "confirm" ? "참여할 계정을 확인해 주세요" : "안전하게 초대를 확인하고 있어요"}</h1>
      <div className="mt-4 min-h-16" role={state === "error" ? "alert" : "status"} aria-live="polite"><p className="text-base leading-7 text-[#5E6C66]">{message || "초대 주소의 비밀 정보를 브라우저 기록에서 먼저 지웠어요."}</p></div>

      {state === "confirm" && <div className="mt-5 rounded-[16px] border border-[#D8CDC1] bg-[#FCFAF6] p-4 text-left"><p className="text-xs font-bold text-[#65716C]">참여할 계정</p><p className="mt-1 break-all font-bold text-[#263832]">{accountLabel}</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><CourtButton onClick={() => void confirmParticipation()} className="w-full">이 계정으로 참여</CourtButton><CourtButton onClick={() => void switchAccount()} variant="secondary" className="w-full">다른 계정으로 전환</CourtButton><CourtButton onClick={() => setState("reject_confirm")} variant="secondary" className="w-full sm:col-span-2">이번에는 참여하지 않기</CourtButton></div><p className="mt-3 text-xs leading-5 text-[#65716C]">참여 또는 거절을 확정하기 전에는 일회용 초대 링크가 소비되지 않습니다.</p></div>}
      {state === "reject_confirm" && <div className="mt-5 rounded-[16px] border border-[#B45353]/20 bg-[#FFF7F5] p-4 text-left" role="alert"><p className="font-bold text-[#263832]">거절하면 이 링크는 바로 무효가 돼요</p><p className="mt-2 text-sm leading-6 text-[#65716C]">신청인에게는 초대를 거절했다는 상태만 표시되며, 이유나 계정 정보는 전달하지 않습니다.</p><div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row"><CourtButton onClick={() => setState("confirm")} variant="secondary" className="flex-1">다시 확인</CourtButton><CourtButton onClick={() => void rejectParticipation()} variant="danger" className="flex-1">확인하고 거절</CourtButton></div></div>}
      {state === "accepted" && caseId && <CourtLink href={`/couple-court/cases/${caseId}/statement`} className="mt-5 w-full sm:w-auto">내 입장 작성하기</CourtLink>}
      {state === "rejected" && <CourtLink href="/couple-court" variant="secondary" className="mt-5 w-full sm:w-auto">커플재판소 홈</CourtLink>}
      {state === "error" && <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center"><CourtLink href="/couple-court" variant="secondary">커플재판소 홈</CourtLink>{publicEnabled && <CourtLink href="/couple-court/public" variant="text">공개재판 보기</CourtLink>}</div>}

      <div className="mt-7 border-t border-[#E7DED5] pt-5 text-left"><p className="flex items-center gap-2 font-bold text-[#263832]"><LockKeyhole className="h-5 w-5 text-[#36534E]" aria-hidden="true" />신청인의 진술 원문은 보이지 않아요</p><p className="mt-2 text-sm leading-6 text-[#65716C]">내 입장을 독립적으로 제출하고, 판결에서는 아모라가 정리한 공동 사실과 서로 다른 관점만 확인해요. 서로의 원문과 초대 토큰은 화면이나 브라우저 저장소에 공개하지 않습니다.</p><p className="mt-3 flex gap-2 text-sm leading-6 text-[#65716C]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#36534E]" aria-hidden="true" />위협이나 강요처럼 안전이 걱정된다면 진술 화면에서 안전 확인을 먼저 요청할 수 있어요.</p></div>
    </Surface>
  </CourtPage>;
}
