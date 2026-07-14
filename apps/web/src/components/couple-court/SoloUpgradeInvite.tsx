"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Link2, RefreshCw, Send, Share2, UsersRound, XCircle } from "lucide-react";
import { captureCourtEvent } from "./analytics";
import { cancelInvite, createInvite, getCase } from "./api";
import type { CourtInvite } from "./types";
import { CourtButton, Surface } from "./CourtPrimitives";

type InviteOperation = "issuing" | "cancelling";

interface SoloUpgradeInviteProps {
  caseId: string;
  rejectedAt?: string;
  inviteExpiresAt?: string;
}

function validTimestamp(value?: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function activeExpiry(value?: string, now = Date.now()): string | undefined {
  const timestamp = validTimestamp(value);
  return timestamp !== null && timestamp > now ? value : undefined;
}

function isExpired(value?: string, now = Date.now()): boolean {
  const timestamp = validTimestamp(value);
  return timestamp !== null && timestamp <= now;
}

function formatDate(value?: string): string | null {
  const timestamp = validTimestamp(value);
  if (timestamp === null) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export default function SoloUpgradeInvite({
  caseId,
  rejectedAt,
  inviteExpiresAt,
}: SoloUpgradeInviteProps) {
  const [invite, setInvite] = useState<CourtInvite | null>(null);
  const [knownExpiresAt, setKnownExpiresAt] = useState(inviteExpiresAt);
  const [operation, setOperation] = useState<InviteOperation | null>(null);
  const [replaceConfirm, setReplaceConfirm] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [transitioned, setTransitioned] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef<InviteOperation | null>(null);
  const inviteUrlRef = useRef<HTMLTextAreaElement>(null);
  const syncSequenceRef = useRef(0);
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    setKnownExpiresAt(inviteExpiresAt);
    setNow(Date.now());
    if (activeExpiry(inviteExpiresAt)) setCancelled(false);
  }, [inviteExpiresAt]);

  const displayedExpiry = invite?.expiresAt ?? knownExpiresAt;
  const rawInviteAvailable = Boolean(invite && !isExpired(invite.expiresAt, now));
  const restoredActiveExpiry = activeExpiry(knownExpiresAt, now);
  const hasActiveInvite = rawInviteAvailable || Boolean(restoredActiveExpiry);
  const expiredInvite = !hasActiveInvite && isExpired(displayedExpiry, now);
  const busy = operation !== null;

  useEffect(() => {
    const timestamp = validTimestamp(displayedExpiry);
    if (timestamp === null || timestamp <= now) return;
    const delay = Math.min(timestamp - now + 25, 2_147_483_647);
    const timeoutId = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timeoutId);
  }, [displayedExpiry, now]);

  function beginOperation(next: InviteOperation): boolean {
    if (operationRef.current !== null) return false;
    syncSequenceRef.current += 1;
    operationRef.current = next;
    setOperation(next);
    return true;
  }

  function finishOperation(completed: InviteOperation) {
    if (operationRef.current === completed) operationRef.current = null;
    setOperation((current) => current === completed ? null : current);
  }

  const markTransitioned = useCallback(() => {
    setTransitioned(true);
    setInvite(null);
    setKnownExpiresAt(undefined);
    setReplaceConfirm(false);
    setCancelled(false);
    setError(null);
    setMessage("상대방의 초대 수락을 확인했어요. 이제 두 사람의 새 정식 판결을 준비합니다.");
  }, []);

  const refreshAuthoritativeState = useCallback(async () => {
    if (syncInFlightRef.current || operationRef.current !== null) return;
    syncInFlightRef.current = true;
    const sequence = syncSequenceRef.current + 1;
    syncSequenceRef.current = sequence;
    try {
      const latest = await getCase(caseId);
      if (syncSequenceRef.current !== sequence) return;
      setNow(Date.now());
      if (latest.mode === "couple" || latest.partnerJoined) {
        markTransitioned();
        return;
      }
      const expiresAt = activeExpiry(latest.inviteExpiresAt);
      if (expiresAt) {
        setKnownExpiresAt(expiresAt);
        setInvite((current) => current?.expiresAt === expiresAt ? current : null);
        setCancelled(false);
      } else {
        setInvite(null);
        setKnownExpiresAt(undefined);
        setReplaceConfirm(false);
        setMessage("서버에서 활성 초대가 더 이상 없음을 확인했어요. 필요하면 새 링크를 만들어 주세요.");
      }
      setError(null);
    } catch {
      // Background synchronization is best-effort; visible actions keep their
      // current state and mutation paths perform their own authoritative check.
    } finally {
      if (syncSequenceRef.current === sequence) syncInFlightRef.current = false;
    }
  }, [caseId, markTransitioned]);

  useEffect(() => {
    if (!hasActiveInvite || transitioned) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshAuthoritativeState();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 20_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      syncSequenceRef.current += 1;
      syncInFlightRef.current = false;
    };
  }, [hasActiveInvite, refreshAuthoritativeState, transitioned]);

  async function reconcileIssuedInvite(): Promise<boolean> {
    try {
      const latest = await getCase(caseId);
      if (latest.mode === "couple" || latest.partnerJoined) {
        markTransitioned();
        return true;
      }
      const expiresAt = activeExpiry(latest.inviteExpiresAt);
      if (!expiresAt) return false;
      setInvite(null);
      setKnownExpiresAt(expiresAt);
      setReplaceConfirm(false);
      setCancelled(false);
      setError(null);
      setMessage("서버에서 활성 초대를 확인했어요. 보안상 링크 주소는 다시 표시하지 않으니, 이미 보낸 링크를 그대로 사용해 주세요.");
      return true;
    } catch {
      return false;
    }
  }

  async function reconcileCancelledInvite(): Promise<boolean> {
    try {
      const latest = await getCase(caseId);
      if (latest.mode === "couple" || latest.partnerJoined) {
        markTransitioned();
        return true;
      }
      const expiresAt = activeExpiry(latest.inviteExpiresAt);
      if (expiresAt) {
        setKnownExpiresAt(expiresAt);
        return false;
      }
      setInvite(null);
      setKnownExpiresAt(undefined);
      setReplaceConfirm(false);
      setCancelled(true);
      setError(null);
      setMessage("초대가 취소된 상태를 서버에서 확인했어요. 기존 링크로는 참여할 수 없어요.");
      return true;
    } catch {
      return false;
    }
  }

  async function issue() {
    if (!beginOperation("issuing")) return;
    setError(null);
    setMessage("");
    try {
      const result = await createInvite(caseId);
      setInvite(result);
      setKnownExpiresAt(result.expiresAt);
      setReplaceConfirm(false);
      setCancelled(false);
      setMessage("정식 쌍방 판결로 전환할 초대 링크를 만들었어요.");
      captureCourtEvent("couple_court_invite_create", { mode: "solo" });
      try {
        const latest = await getCase(caseId);
        if (latest.mode === "couple" || latest.partnerJoined) {
          markTransitioned();
        } else {
          const authoritativeExpiry = activeExpiry(latest.inviteExpiresAt);
          if (!authoritativeExpiry) {
            setInvite(null);
            setKnownExpiresAt(undefined);
            setMessage("");
            setError("초대 링크를 만든 직후 사건 상태가 바뀌었어요. 최신 상태를 확인한 뒤 다시 시도해 주세요.");
          } else if (authoritativeExpiry !== result.expiresAt) {
            setInvite(null);
            setKnownExpiresAt(authoritativeExpiry);
            setMessage("서버에서 다른 활성 초대를 확인했어요. 보안상 링크 주소는 다시 표시하지 않습니다.");
          }
        }
      } catch {
        // The successful create response is already transactional. Focus and
        // visibility synchronization will retry the authoritative read.
      }
    } catch (issueError) {
      if (!await reconcileIssuedInvite()) {
        setError(issueError instanceof Error ? issueError.message : "초대 링크를 만들지 못했어요.");
      }
    } finally {
      finishOperation("issuing");
    }
  }

  async function cancelCurrentInvite() {
    if (!beginOperation("cancelling")) return;
    setError(null);
    setMessage("");
    try {
      const result = await cancelInvite(caseId);
      if (!await reconcileCancelledInvite()) {
        setError(result.revoked
          ? "취소 응답은 받았지만 최신 사건 상태를 확인하지 못했어요. 새로고침해 확인해 주세요."
          : "취소할 활성 초대가 없었지만 최신 사건 상태를 확인하지 못했어요. 새로고침해 주세요.");
      }
    } catch (cancelError) {
      if (!await reconcileCancelledInvite()) {
        setError(cancelError instanceof Error ? cancelError.message : "초대 링크를 취소하지 못했어요.");
      }
    } finally {
      finishOperation("cancelling");
    }
  }

  function selectInviteUrlForManualCopy() {
    const field = inviteUrlRef.current;
    if (!field) return false;
    field.focus();
    field.select();
    return true;
  }

  function prepareManualCopy() {
    if (!selectInviteUrlForManualCopy()) {
      setError("초대 주소를 선택하지 못했어요. 주소를 직접 길게 눌러 선택해 주세요.");
      return;
    }
    setError(null);
    setMessage("초대 주소를 선택했어요. 길게 누르거나 Ctrl+C(맥은 Command+C)로 복사해 주세요.");
  }

  async function copy() {
    if (!invite || !rawInviteAvailable) return;
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      setMessage("초대 링크를 복사했어요.");
      setError(null);
      captureCourtEvent("couple_court_invite_copy", { mode: "solo", status: "copied" });
    } catch {
      const selected = selectInviteUrlForManualCopy();
      setError(selected
        ? "자동 복사가 차단됐어요. 아래에서 선택된 주소를 길게 누르거나 Ctrl+C(맥은 Command+C)로 직접 복사해 주세요."
        : "링크를 복사하지 못했어요. 브라우저 권한을 확인해 주세요.");
    }
  }

  async function share() {
    if (!invite || !rawInviteAvailable) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "웨딩한방 둘만의 중재실 초대",
          text: "내 임시판결은 보이지 않아요. 각자 진술한 뒤 새 정식 판결을 받아요.",
          url: invite.inviteUrl,
        });
        setMessage("공유 창을 열었어요.");
        setError(null);
        captureCourtEvent("couple_court_invite_copy", { mode: "solo", status: "shared" });
        return;
      }
      await copy();
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      const selected = selectInviteUrlForManualCopy();
      setError(selected
        ? "공유창을 열지 못했어요. 아래에서 선택된 주소를 길게 눌러 직접 복사해 주세요."
        : "초대 링크를 공유하지 못했어요.");
    }
  }

  if (transitioned) {
    return (
      <Surface className="mt-5">
        <CheckCircle2 className="h-6 w-6 text-[#36534E]" aria-hidden="true" />
        <h2 className="mt-3 text-xl font-bold text-[#263832]">상대방이 초대를 수락했어요</h2>
        <p className="mt-2 text-base leading-7 text-[#65716C]">이전 임시판결은 상대방에게 공개되지 않으며, 상대방 진술이 접수되면 두 사람을 위한 새 정식 판결을 준비합니다.</p>
        <div className="mt-4 min-h-7" aria-live="polite">
          {message && <p className="text-sm font-semibold leading-6 text-[#36534E]">{message}</p>}
        </div>
      </Surface>
    );
  }

  return (
    <Surface className="mt-5">
      <UsersRound className="h-6 w-6 text-[#36534E]" aria-hidden="true" />
      <h2 className="mt-3 text-xl font-bold text-[#263832]">상대방을 초대해 정식 판결로 전환</h2>
      <p className="mt-2 text-base leading-7 text-[#65716C]">지금 임시판결을 상대방에게 보내는 기능이 아니에요. 상대방은 내 원문과 임시판결을 보지 않고 먼저 자신의 진술을 작성하고, 두 진술이 모이면 새로운 정식 판결을 받습니다.</p>

      {rejectedAt && !hasActiveInvite && !expiredInvite && !cancelled && (
        <div className="mt-4 rounded-[14px] border border-[#D8CDC1] bg-[#FCFAF6] p-4">
          <p className="font-bold text-[#263832]">상대방이 이번 초대에 참여하지 않았어요</p>
          <p className="mt-1 text-sm leading-6 text-[#65716C]">거절 이유나 계정 정보는 표시하지 않아요. 필요하다면 먼저 대화한 뒤 새 링크를 보내주세요.</p>
        </div>
      )}

      {expiredInvite && (
        <div className="mt-4 rounded-[14px] border border-[#D8CDC1] bg-[#FCFAF6] p-4">
          <p className="font-bold text-[#263832]">기존 초대 링크가 만료됐어요</p>
          <p className="mt-1 text-sm leading-6 text-[#65716C]">만료된 링크로는 참여할 수 없습니다. 필요하면 새 링크를 만들어 다시 보내주세요.</p>
        </div>
      )}

      {cancelled && (
        <div className="mt-4 rounded-[14px] border border-[#BFD0C8] bg-[#EEF4F1] p-4">
          <p className="flex items-center gap-2 font-bold text-[#263832]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />초대 링크가 취소됐어요</p>
          <p className="mt-1 text-sm leading-6 text-[#52645E]">기존 링크는 더 이상 사용할 수 없습니다. 다시 초대하려면 새 링크를 만들어 주세요.</p>
        </div>
      )}

      {hasActiveInvite ? (
        <div className="mt-5 rounded-[16px] border border-[#D8CDC1] bg-[#FCFAF6] p-4">
          <p className="text-sm font-bold text-[#263832]">
            {rawInviteAvailable ? "초대 링크 준비 완료" : "기존 초대 링크가 아직 유효해요"}
          </p>
          <p className="mt-1 text-sm leading-6 text-[#65716C]">
            {rawInviteAvailable
              ? "비밀 링크는 상대방 한 명에게만 보내주세요. 새 링크를 발급하면 지금 링크는 즉시 무효가 됩니다."
              : "보안상 링크 주소는 다시 표시하지 않아요. 이미 보냈다면 만료 전까지 사용할 수 있고, 잃어버렸다면 취소하거나 새 링크를 발급해 주세요."}
          </p>

          {rawInviteAvailable && invite && (
            <div className="mt-4">
              <label htmlFor="solo-upgrade-invite-url" className="text-xs font-bold text-[#65716C]">초대 주소</label>
              <textarea
                ref={inviteUrlRef}
                id="solo-upgrade-invite-url"
                value={invite.inviteUrl}
                readOnly
                rows={3}
                spellCheck={false}
                autoCapitalize="none"
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.currentTarget.select()}
                aria-describedby="solo-upgrade-invite-url-help"
                className="mt-2 w-full resize-none rounded-[12px] border border-[#D8CDC1] bg-white px-3 py-2 text-sm leading-6 text-[#263832] outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/20"
              />
              <p id="solo-upgrade-invite-url-help" className="mt-2 text-xs leading-5 text-[#65716C]">자동 복사가 안 되면 주소를 누르거나 아래 버튼으로 전체 선택한 뒤 직접 복사해 주세요.</p>
            </div>
          )}

          {formatDate(displayedExpiry) && (
            <p className="mt-2 text-xs text-[#65716C]">만료 {formatDate(displayedExpiry)}</p>
          )}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {rawInviteAvailable && (
              <>
                <CourtButton onClick={() => void share()} disabled={busy} className="w-full"><Share2 className="h-4 w-4" aria-hidden="true" />공유하기</CourtButton>
                <CourtButton onClick={() => void copy()} disabled={busy} variant="secondary" className="w-full"><Copy className="h-4 w-4" aria-hidden="true" />링크 복사</CourtButton>
                <CourtButton onClick={prepareManualCopy} disabled={busy} variant="secondary" className="w-full"><Link2 className="h-4 w-4" aria-hidden="true" />주소 직접 선택</CourtButton>
              </>
            )}
            <CourtButton onClick={() => void cancelCurrentInvite()} variant="secondary" disabled={busy} className="w-full">
              <XCircle className="h-4 w-4" aria-hidden="true" />
              {operation === "cancelling"
                ? "취소하는 중…"
                : rawInviteAvailable ? "이 초대 링크 취소" : "기존 링크 취소"}
            </CourtButton>
            <CourtButton
              onClick={() => setReplaceConfirm(true)}
              variant="secondary"
              disabled={busy || replaceConfirm}
              className="w-full"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />새 링크 재발급
            </CourtButton>
          </div>

          {replaceConfirm && (
            <div className="mt-4 rounded-[14px] border border-[#B45353]/25 bg-[#FFF7F5] p-4" role="alert">
              <p className="font-bold text-[#263832]">새 링크를 만들면 기존 링크는 즉시 무효가 돼요</p>
              <p className="mt-1 text-sm leading-6 text-[#65716C]">상대방에게 이미 보냈다면 먼저 새 링크를 다시 보낼 수 있는지 확인해 주세요.</p>
              <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row">
                <CourtButton onClick={() => setReplaceConfirm(false)} variant="secondary" disabled={busy}>기존 링크 유지</CourtButton>
                <CourtButton onClick={() => void issue()} disabled={busy}>
                  {operation === "issuing" ? "재발급하는 중…" : "기존 링크 무효화 후 재발급"}
                </CourtButton>
              </div>
            </div>
          )}
        </div>
      ) : (
        <CourtButton onClick={() => void issue()} disabled={busy} variant="secondary" className="mt-5">
          {operation === "issuing"
            ? "링크 만드는 중…"
            : <><Send className="h-4 w-4" aria-hidden="true" />{rejectedAt || expiredInvite || cancelled ? "새 초대 링크 만들기" : "정식 판결 초대 만들기"}</>}
        </CourtButton>
      )}

      <div className="mt-4 min-h-7" aria-live="polite">
        {message && <p className="text-sm font-semibold leading-6 text-[#36534E]">{message}</p>}
        {error && <p className="text-sm font-semibold leading-6 text-[#9B3F3F]" role="alert">{error}</p>}
      </div>
    </Surface>
  );
}
