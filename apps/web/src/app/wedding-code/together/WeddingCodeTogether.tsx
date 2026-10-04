"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Button from "@/components/ui/Button";
import type { V31Draft } from "@/constants/weddingCodeV31";
import { decodeV31, encodeV31 } from "@/lib/weddingCode/v31";
import { createPairSessionKeys, getPairSessionIssuedAt, PAIR_SESSION_CONSENT_VERSION, PAIR_SESSION_RETENTION_DAYS, requestPairSession, type PairSessionRequest, type PairSessionSnapshot } from "@/lib/weddingCode/pairSessionContract";
import { forgetPairSession, pairSessionUrl, parsePairSessionHash, readPairSessionRecovery, readSavedPairSession, savePairSessionLink, savePairSessionRecovery, type PairSessionLink } from "@/lib/weddingCode/pairSessionClient";
import { hasV31ResumableAnswer, readV31LocalProgress } from "@/lib/weddingCode/v31LocalProgress";
import WeddingCodeV31Client from "../WeddingCodeV31Client";
import WeddingCodeV31Results from "../WeddingCodeV31Results";
import { isConfirmedPairRejection, PairSessionConsent, WeddingCodeComparisonResume } from "../WeddingCodeV31Connection";
import { V31_SAVE_PREFERENCE_KEY } from "../useV31LocalProgress";
import { v31Body, v31Surface, v31Title } from "../WeddingCodeV31Inputs";

/**
 * 방 주인·참여자가 이미 그려진 결과를 보는 중에 확인이 연속으로 이만큼 실패하면, 안내 한 줄 대신 오류 화면으로 바꾼다.
 * 초대받은 사람이 답을 쓰는 중이면 쓰던 답이 사라지면 안 되므로 이 상한을 적용하지 않고 안내만 남긴다.
 */
const MAX_QUIET_REFRESH_FAILURES = 5;
/** 이 시간 안에 겹쳐 난 실패(탭 복귀·focus 이벤트가 연달아 만든 확인)는 한 번으로 센다. 15초 확인 주기보다 짧아서 주기마다 난 실패는 모두 센다. */
const FAILURE_COUNT_WINDOW_MS = 10_000;
const TRANSIENT_CODES: readonly string[] = ["NETWORK_ERROR", "TIMEOUT", "UNAVAILABLE"];
/** 연결 끝내기 요청이 처리됐는지 알 수 없는 실패. 방을 그대로 두고 그 자리에서 다시 시도하게 한다. */
const REVOKE_RETRY_CODES: readonly string[] = [...TRANSIENT_CODES, "INVALID_RESPONSE"];
const REVOKE_RETRY_MESSAGE = "연결 끝내기에 실패했어요. 다시 눌러 주세요.";
const RETENTION_MS = PAIR_SESSION_RETENTION_DAYS * 86_400_000;
// 확인이 안 되는 동안에도 보이는 화면이 무엇인지에 따라 말이 달라야 한다. 받은 초대로 답하는 사람은 쓰던 답이, 방 주인과 참여자는 이미 본 결과가 남고,
// 이미 참여한 초대 화면에는 보이는 결과가 없다.
const REFRESH_NOTICE_INVITEE = "연결 상태를 새로 확인하지 못했어요. 작성한 답은 이 화면에 그대로 있고, 잠시 후 다시 확인해요.";
const REFRESH_NOTICE_MEMBER = "연결 상태를 새로 확인하지 못했어요. 지금 보이는 결과는 그대로 두고, 잠시 후 다시 확인해요.";
const REFRESH_NOTICE_PLAIN = "연결 상태를 새로 확인하지 못했어요. 잠시 후 다시 확인해요.";

/** 지금 이 브라우저에 내 답이 저장돼 있는지. 저장이 꺼져 있거나 막힌 브라우저에서는 저장돼 있다고 말하면 안 된다. */
function answersSavedInBrowser(): boolean {
  try {
    if (window.localStorage.getItem(V31_SAVE_PREFERENCE_KEY) === "off") return false;
    const read = readV31LocalProgress(window.localStorage);
    return read.status === "ready" && hasV31ResumableAnswer(read.snapshot);
  } catch { return false; }
}

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener); window.addEventListener("popstate", listener);
  return () => { window.removeEventListener("hashchange", listener); window.removeEventListener("popstate", listener); };
}

function CopyAddress({ url, label, privateLink = false }: { url: string; label: string; privateLink?: boolean }) {
  const [notice, setNotice] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(url); setNotice(privateLink ? "나만 보관할 확인 주소를 복사했어요. 상대에게는 초대 링크를 보내 주세요." : "초대 링크를 복사했어요. 함께 볼 사람과의 대화창에 붙여 넣어 주세요."); }
    catch { setNotice("아래 주소를 선택해서 직접 복사해 주세요."); }
  }
  return <div className="mt-4">
    <Button variant={privateLink ? "secondary" : "primary"} fullWidth onClick={() => void copy()} className="whitespace-normal!">{label}</Button>
    <p role="status" className={`mt-2 ${v31Body}`}>{notice}</p>
    <details><summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">{privateLink ? "나만 보관할 확인 주소 직접 복사" : "초대 링크 직접 복사"}</summary>
      <input readOnly value={url} aria-label={privateLink ? "나만 보관할 확인 주소" : "상대에게 보낼 초대 링크"} onFocus={event => event.currentTarget.select()} className="min-h-12 w-full rounded-lg border border-paper-outline px-3 text-sm" />
    </details>
  </div>;
}

type JoinRequest = Extract<PairSessionRequest, { action: "join" }>;

function JoinComparison({ draft, link, expiresAt, previousRequest, onRequestStart, onRejected }: {
  draft: V31Draft; link: PairSessionLink; expiresAt: string; previousRequest: JoinRequest | null;
  onRequestStart: (input: JoinRequest) => void; onRejected: () => void;
}) {
  const [consent, setConsent] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [priorRequest, setPriorRequest] = useState(previousRequest);
  // 서버가 확실히 거절한 뒤의 상태. dead 는 이 초대로는 더 참여할 수 없는 거절이다.
  const [rejection, setRejection] = useState<{ dead: boolean; savedHere: boolean } | null>(null);
  const [recoveryUrl, setRecoveryUrl] = useState(() => previousRequest
    ? pairSessionUrl(window.location.origin, { roomId: previousRequest.roomId, token: previousRequest.participantToken, mode: "member" }) : "");
  const pending = useRef<JoinRequest | null>(previousRequest);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function join() {
    if (busy) return;
    if (!priorRequest && (!consent || !ageConfirmed)) { setError("만 14세 이상 확인과 공유 동의, 두 칸에 먼저 체크해 주세요."); return; }
    setBusy(true); setError("");
    try {
      pending.current ??= { action: "join", roomId: link.roomId, inviteToken: link.token, participantToken: createPairSessionKeys().participantToken,
        answerCode: encodeV31(draft), consentVersion: PAIR_SESSION_CONSENT_VERSION, consent: true, ageConfirmed: true };
      const input = pending.current;
      const member: PairSessionLink = { roomId: input.roomId, token: input.participantToken, mode: "member" };
      setRecoveryUrl(pairSessionUrl(window.location.origin, member));
      savePairSessionRecovery({ ...member, expiresAt });
      onRequestStart(input);
      const result = await requestPairSession(input);
      if (!active.current) return;
      if (!result.ok) {
        if (isConfirmedPairRejection(result.code)) {
          // 처리되지 않은 요청이다. 「이미 처리됐는지 확인하기」 링크와 임시 확인 주소를 치우고 새 초대로 가는 길을 보여준다.
          // 같은 방의 내 방장 주소가 따로 저장돼 있으면(내 초대를 내가 연 경우) 그 방은 지우지 않는다.
          if (readPairSessionRecovery(link.roomId)?.token === input.participantToken && readSavedPairSession()?.roomId !== link.roomId) forgetPairSession(link.roomId);
          pending.current = null; setPriorRequest(null); setRecoveryUrl(""); onRejected();
          setRejection({ dead: result.code !== "INVALID_REQUEST", savedHere: answersSavedInBrowser() });
        }
        setError(result.error); return;
      }
      savePairSessionLink({ ...member, expiresAt: result.snapshot.expiresAt });
      window.location.replace(pairSessionUrl(window.location.origin, member));
    } catch { if (active.current) setError("함께 보기를 연결하지 못했어요. 같은 화면에서 다시 시도해 주세요."); }
    finally { if (active.current) setBusy(false); }
  }
  const rejectedGuide = rejection ? <>
    <p className={`mt-3 ${v31Body}`}>{rejection.savedHere ? "내 답은 이 브라우저에 그대로 있어요." : "내 답은 이 화면에 그대로 있어요. 이 브라우저에는 저장돼 있지 않아서, 화면을 나가면 사라질 수 있어요."} 내 웨딩코드로 가서 새 초대를 만들 수 있어요.</p>
    <Button href="/wedding-code" variant="primary" fullWidth className="mt-3 whitespace-normal!">내 웨딩코드로 가기</Button>
  </> : null;
  if (rejection?.dead) return <section className={`${v31Surface} mt-6 p-5 sm:p-7`} aria-label="함께 보기 참여 결과">
    <h2 className={`mb-3 text-lg ${v31Title}`}>이 초대로는 함께 보기를 시작하지 못했어요</h2>
    <div role="alert" className={v31Body}><p>{error}</p></div>
    {rejectedGuide}
  </section>;
  if (priorRequest) return <section className={`${v31Surface} mt-6 p-5 sm:p-7`} aria-label="이전 요청 확인">
    <h2 className={`mb-3 text-lg ${v31Title}`}>이전에 보낸 요청부터 확인해 주세요</h2>
    <p className={v31Body}>답을 고쳤더라도 이전 요청에는 고친 내용이 들어가지 않아요. 먼저 연결이 됐는지 확인하거나, 처음 동의했던 답 그대로 다시 보낼 수 있어요.</p>
    <Link href={recoveryUrl} className="mt-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">이전에 보낸 요청이 연결됐는지 확인</Link>
    <Button variant="secondary" fullWidth disabled={busy} onClick={() => void join()} className="mt-3 whitespace-normal!">{busy ? "함께 볼 결과를 연결하고 있어요…" : "처음 동의했던 답으로 다시 보내기"}</Button>
    {error ? <p role="alert" className={`mt-3 ${v31Body}`}>{error}</p> : null}
  </section>;
  return <section className={`${v31Surface} mt-6 p-5 sm:p-7`} aria-label="내 답 공유하고 함께 보기">
    <h2 className={`mb-3 text-lg ${v31Title}`}>내 답을 공유하고, 두 사람 결과 보기</h2>
    <p className={`mb-3 ${v31Body}`}>여기서 동의하면 초대한 사람도 내 답 전체를 볼 수 있어요. 결과 링크를 다시 보내지 않아도 돼요.</p>
    <PairSessionConsent consent={consent} ageConfirmed={ageConfirmed} disabled={busy} onConsent={setConsent} onAge={setAgeConfirmed} />
    <Button variant="primary" fullWidth disabled={busy} onClick={() => void join()} className="mt-4 whitespace-normal!">{busy ? "함께 볼 결과를 연결하고 있어요…" : "동의하고 두 사람 결과 보기"}</Button>
    {error ? <div role="alert" className={`mt-3 ${v31Body}`}><p>{error}</p>{recoveryUrl ? <Link className="mt-2 inline-flex min-h-11 items-center underline" href={recoveryUrl}>이미 연결됐는지 내 결과 확인하기</Link> : null}</div> : null}
    {rejectedGuide}
  </section>;
}

export default function WeddingCodeTogether() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  const link = hash === null ? null : parsePairSessionHash(hash);
  if (hash === null) return <p role="status" className={`p-6 ${v31Body}`}>두 사람 연결을 확인하고 있어요…</p>;
  if (!link) return <main className="mx-auto max-w-[680px] p-6"><h1 className={`text-2xl ${v31Title}`}>비교 링크를 확인해 주세요</h1><p className={`mt-3 ${v31Body}`}>주소가 중간에 잘렸거나 잘못된 링크예요. 초대한 사람에게 새 링크를 받아 주세요.</p><Link href="/wedding-code" className="mt-4 inline-flex min-h-11 items-center underline">웨딩코드로 돌아가기</Link></main>;
  // 같은 방이어도 주소의 접근 키가 바뀌면 이전 답과 요청 상태를 모두 버린다.
  return <TogetherSession key={hash} link={link} />;
}

function TogetherSession({ link }: { link: PairSessionLink }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<PairSessionSnapshot | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [refreshFailing, setRefreshFailing] = useState(false);
  const [revokeError, setRevokeError] = useState("");
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedLocally, setSavedLocally] = useState<boolean | null>(null);
  const [expired, setExpired] = useState(false);
  const requestVersion = useRef(0);
  const [member, setMember] = useState<PairSessionLink | null>(null);
  const mutating = useRef(false);
  const closed = useRef(false);
  // 방이 한 번이라도 그려졌는지, 그때 어떤 화면이었는지. 클로저 안의 refresh 가 읽어야 해서 state 가 아니라 ref 다.
  // 방이 바뀌면 key 로 이 컴포넌트가 새로 만들어져서 함께 초기화된다.
  const hasSnapshot = useRef(false);
  const knownInvite = useRef(false);
  const quietFailures = useRef(0);
  const lastFailureAt = useRef(Number.NEGATIVE_INFINITY);
  const joinStarted = useRef(false);
  const [joinRequest, setJoinRequest] = useState<JoinRequest | null>(null);
  const { roomId, token, mode, invitation } = link;
  const expiresAt = snapshot?.expiresAt;
  // 방 주소 앞 12자리가 만든 시각(ms)이다. 보관 기간(7일)이 지난 주소는 서버에 묻기 전에 알려 줄 수 있다.
  const [addressExpired] = useState(() => Date.now() - getPairSessionIssuedAt(roomId) > RETENTION_MS);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (!roomId || !token || !mode || addressExpired) return;
    let active = true; let inFlight = false;
    const current: PairSessionLink = { roomId, token, mode, ...(invitation ? { invitation } : {}) };
    async function refresh() {
      if (!active || inFlight || mutating.current || closed.current || joinStarted.current || document.visibilityState === "hidden") return;
      inFlight = true;
      const version = ++requestVersion.current;
      const recovery = current.mode === "invite" ? readPairSessionRecovery(current.roomId) : null;
      let used: PairSessionLink = recovery ?? current;
      let result = await requestPairSession({ action: "read", roomId: used.roomId, token: used.token });
      if (recovery && !result.ok && result.code === "NOT_FOUND") {
        used = current; result = await requestPairSession({ action: "read", roomId: current.roomId, token: current.token });
      }
      inFlight = false;
      if (!active || version !== requestVersion.current) return;
      if (!result.ok) {
        // 이미 그려진 방이 있으면 일시적인 실패(연결 끊김, 시간 초과, 서버 불안정) 한 번으로 방을 지우지 않고 안내 한 줄만 보인다.
        // 없는 방, 끝난 방 같은 확정 오류는 기존처럼 오류 화면으로 바꾼다. 연속 실패가 쌓였을 때도 오류 화면으로 바꾸되,
        // 초대받은 사람이 답을 쓰는 중이면 쓰던 답을 지우지 않으려고 상한 없이 안내만 남긴다.
        if (hasSnapshot.current && TRANSIENT_CODES.includes(result.code)) {
          // 탭 복귀·focus 이벤트가 짧은 시간에 겹쳐 만든 실패는 한 번으로 센다.
          const now = Date.now();
          if (now - lastFailureAt.current >= FAILURE_COUNT_WINDOW_MS) { quietFailures.current += 1; lastFailureAt.current = now; }
          if (knownInvite.current || quietFailures.current < MAX_QUIET_REFRESH_FAILURES) { setRefreshFailing(true); return; }
        }
        setRefreshFailing(false); setError(result.error);
        return;
      }
      quietFailures.current = 0; lastFailureAt.current = Number.NEGATIVE_INFINITY;
      if ((used.mode === "invite") !== (result.snapshot.role === "invite")) { setError("이 링크로는 이 비교를 열 수 없어요. 받은 링크가 맞는지 확인해 주세요."); return; }
      setError(""); setRefreshFailing(false); setSnapshot(result.snapshot); setMember(used);
      hasSnapshot.current = true;
      knownInvite.current = result.snapshot.role === "invite" && result.snapshot.state === "waiting";
      if (result.snapshot.state === "closed") { closed.current = true; forgetPairSession(roomId); return; }
      if (used.mode === "member") {
        setSavedLocally(savePairSessionLink({ ...used, expiresAt: result.snapshot.expiresAt }));
        if (current.mode === "invite") {
          window.history.replaceState(null, "", pairSessionUrl(window.location.origin, used)); window.dispatchEvent(new Event("hashchange"));
        }
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onVisibility); document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", onVisibility); document.removeEventListener("visibilitychange", onVisibility); };
  }, [roomId, token, mode, invitation, retry, addressExpired]);

  const reload = useCallback(() => setRetry(value => value + 1), []);
  const beginJoin = useCallback((input: JoinRequest) => {
    // 참여를 요청한 뒤에는 이전 조회나 자동 복구가 작성·수정 화면을 바꾸지 않는다.
    joinStarted.current = true; requestVersion.current += 1; setJoinRequest(input);
  }, []);
  async function revoke() {
    if (!member || member.mode !== "member" || busy) return;
    mutating.current = true; setBusy(true); setRevokeError(""); const version = ++requestVersion.current;
    const result = await requestPairSession({ action: "revoke", roomId: member.roomId, token: member.token });
    if (version === requestVersion.current) {
      if (result.ok) { closed.current = true; setSnapshot(result.snapshot); setError(""); forgetPairSession(member.roomId); setRevokeOpen(false); }
      // 끊김·시간 초과·서버 불안정은 방 본문을 그대로 두고 그 자리에서 다시 누르게 한다. 이미 닫혔거나 열 수 없는 방 같은 확정 오류만 오류 화면이다.
      else if (REVOKE_RETRY_CODES.includes(result.code)) setRevokeError(REVOKE_RETRY_MESSAGE);
      else setError(result.error);
    }
    mutating.current = false; setBusy(false);
  }

  const activeSnapshot = snapshot?.roomId === roomId ? snapshot : null;
  const own = activeSnapshot?.ownAnswerCode ? decodeV31(activeSnapshot.ownAnswerCode) : null;
  const partner = activeSnapshot?.partnerAnswerCode ? decodeV31(activeSnapshot.partnerAnswerCode) : null;
  // 안내 문구는 지금 화면에 무엇이 보이는지로 고른다. 끝난 화면과 만료 화면에는 새로 확인할 것이 없어서 안내를 두지 않는다.
  const refreshNotice = !refreshFailing || addressExpired || error || !activeSnapshot || activeSnapshot.state === "closed" || expired ? ""
    : activeSnapshot.role !== "invite" ? REFRESH_NOTICE_MEMBER
      : activeSnapshot.state === "waiting" ? REFRESH_NOTICE_INVITEE : REFRESH_NOTICE_PLAIN;
  // 안내가 화면 위에 붙어 있는 동안, 문항을 넘길 때의 scrollIntoView 와 키보드 포커스 이동이 새 문항의 맨 위(제목, 「이전 질문」 단추)를 안내 밑에 두지 않게
  // 안내 높이만큼 스크롤 여백을 둔다. 안내가 사라지면 원래 값으로 돌린다.
  const noticeFrame = useRef<HTMLDivElement>(null);
  const noticeShown = refreshNotice !== "";
  useEffect(() => {
    const frame = noticeFrame.current;
    if (!noticeShown || !frame) return;
    const root = document.documentElement;
    const previous = root.style.scrollPaddingTop;
    const sync = () => { root.style.scrollPaddingTop = `${frame.offsetHeight}px`; };
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(frame);
    return () => { observer?.disconnect(); root.style.scrollPaddingTop = previous; };
  }, [noticeShown]);
  const manage = activeSnapshot && member?.mode === "member" ? <section className={`${v31Surface} my-5 p-5`} aria-label="두 사람 연결 관리">
    <h2 className={`text-lg ${v31Title}`}>{activeSnapshot.state === "ready" ? "두 사람의 답이 연결됐어요" : "상대의 답을 기다리고 있어요"}</h2>
    <p className={`mt-2 ${v31Body}`}>공유한 시점의 답이에요. {new Date(activeSnapshot.expiresAt).toLocaleString("ko-KR")}까지 볼 수 있어요. 답을 바꿔 다시 비교하려면 이 연결을 끝내고 새로 초대해 주세요.</p>
    {activeSnapshot.state === "waiting" && activeSnapshot.role === "owner" && member.invitation ? <>
      <p className={`mt-3 ${v31Body}`}>아래 초대 링크를 상대에게 보내 주세요. 상대가 답과 공유를 마치면 이 화면에 결과가 나타나요. 화면을 닫았다면 나중에 다시 들어와 확인해 주세요.</p>
      <CopyAddress url={pairSessionUrl(window.location.origin, { roomId: member.roomId, token: member.invitation, mode: "invite" })} label="상대에게 보낼 초대 링크 복사" />
    </> : null}
    {savedLocally === false ? <p className={`mt-3 ${v31Body}`}>이 브라우저에 확인 주소를 저장하지 못했어요. 아래 ‘나만 보관할 확인 주소’를 따로 보관해 주세요.</p> : <p className={`mt-3 ${v31Body}`}>자동 저장이 켜진 이 브라우저에서는 웨딩코드의 ‘연결한 두 사람 결과 보기’로 다시 들어올 수 있어요.</p>}
    <details className="mt-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">나만 보관할 확인 주소</summary><p className={`mt-2 ${v31Body}`}>이 주소를 아는 사람은 누구든 두 사람 결과를 보고 연결도 끝낼 수 있어요. 나만 보관하고, 상대에게는 초대 링크를 따로 보내 주세요.</p><CopyAddress url={pairSessionUrl(window.location.origin, member)} label="나만 보관할 확인 주소 복사" privateLink /></details>
    <Button variant="secondary" disabled={busy} onClick={reload} className="mt-3">현재 상태 다시 확인</Button>
    {!revokeOpen ? <Button variant="ghost" onClick={() => { setRevokeError(""); setRevokeOpen(true); }} className="mt-3">연결 끝내기</Button> : <div className="mt-4 border-t border-[var(--hb-hairline)] pt-4">
      <p className={v31Body}>서버에 있는 두 사람의 공유 답을 지우고 이 연결을 끝낼까요? 상대가 이미 읽었거나 따로 저장한 내용은 되돌릴 수 없어요. 다시 함께 보려면 새로 초대해야 해요. 각자 브라우저에 저장한 답은 남아요.</p>
      {revokeError ? <p role="alert" className={`mt-3 font-semibold ${v31Body}`}>{revokeError}</p> : null}
      <div className="mt-3 flex flex-wrap gap-3"><Button variant="secondary" disabled={busy} onClick={() => { setRevokeError(""); setRevokeOpen(false); }}>계속 함께 보기</Button><Button variant="primary" disabled={busy} onClick={() => void revoke()}>{busy ? "연결을 끝내고 있어요…" : revokeError ? "연결 끝내기 다시 시도" : "공유 답 지우고 연결 끝내기"}</Button></div>
    </div>}
  </section> : null;

  // 안내가 떠 있는 동안에는 스크롤 고정(scroll anchoring)을 끈다. 켜 두면 스크롤한 채로 안내가 위에 끼어들 때 브라우저가 스크롤을 안내 높이만큼 내려서,
  // 보던 내용이 그대로 안내 밑에 깔린다(「이전 질문」 단추가 반쯤 가려짐). 끄면 보던 내용이 안내 높이만큼 밀려 내려가 안내 밑에 깔리지 않는다.
  return <main className={`mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6 sm:py-10${noticeShown ? " [overflow-anchor:none]" : ""}`}>
    {/* 만료 화면에는 본문에 입구로 가는 링크가 있어서 맨 위 링크를 두지 않는다. */}
    {addressExpired ? null : <nav aria-label="두 사람 웨딩코드 탐색" className="mb-6"><Link href="/wedding-code" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">웨딩코드로 돌아가기</Link></nav>}
    {joinRequest ? <WeddingCodeComparisonResume compact /> : null}
    {/* 접근성 live 영역은 늘 그려 둔다. 안내가 있을 때만 이 영역이 배경이 있는 일반 높이의 sticky 줄이 된다. 내용 위에 겹쳐 그리지 않으므로 첫 제목과 「이전 질문」 같은 단추를 가리지 않고,
        결과를 내려 읽는 중에도 화면 위에 남는다. 안내가 나타나면 아래 내용이 안내 높이만큼 밀린다. */}
    <div ref={noticeFrame} role="status" aria-live="polite" className={refreshNotice ? "sticky top-0 z-20 bg-[var(--color-ivory-50)] py-2" : undefined}>
      {refreshNotice ? <p className={`rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-4 py-2 shadow-sm ${v31Body}`}>{refreshNotice}</p> : null}
    </div>
    {addressExpired ? <section role="alert"><h1 className={`text-2xl ${v31Title}`}>만든 지 7일이 지난 주소예요</h1><p className={`mt-3 ${v31Body}`}>{mode === "invite" ? "만든 지 7일이 지나 끝났을 수 있어요. 초대한 분께 새 초대를 부탁해 주세요." : "만든 지 7일이 지나 끝났을 수 있어요. 새로 초대해 주세요."}</p><Link href="/wedding-code" className="mt-4 inline-flex min-h-11 items-center underline">내 웨딩코드로 돌아가기</Link></section>
      : error ? <section role="alert"><h1 className={`text-2xl ${v31Title}`}>비교 결과를 확인하지 못했어요</h1><p className={`mt-3 ${v31Body}`}>{error}</p><Button variant="primary" className="mt-4" onClick={reload}>다시 확인하기</Button></section>
        : !activeSnapshot ? <p role="status" className={v31Body}>두 사람 연결을 확인하고 있어요…</p>
          : activeSnapshot.state === "closed" || expired ? <section><h1 className={`text-2xl ${v31Title}`}>이 비교는 끝났어요</h1><p className={`mt-3 ${v31Body}`}>한 사람이 연결을 끝냈거나 볼 수 있는 기간이 지났어요. 다시 함께 보려면 새로 초대해 주세요.</p><Link href="/wedding-code" className="mt-4 inline-flex min-h-11 items-center underline">내 웨딩코드로 돌아가기</Link></section>
            : activeSnapshot.role === "invite" ? activeSnapshot.state === "ready" ? <section><h1 className={`text-2xl ${v31Title}`}>이미 참여한 초대예요</h1><p className={`mt-3 ${v31Body}`}>내가 이미 답했다면, 그때 쓴 브라우저의 ‘연결한 두 사람 결과 보기’에서 확인해 주세요. 다른 사람이 먼저 참여했다면, 초대한 사람에게 새 초대를 요청해 주세요.</p></section> : <>
              <section className={`${v31Surface} mb-5 p-5`} aria-label="받은 초대 안내"><h2 className={`text-lg ${v31Title}`}>결혼 준비에 대한 각자의 생각을 나란히 보자는 초대가 왔어요</h2><p className={`mt-2 ${v31Body}`}>먼저 내 생각대로 답해 보세요. 내 결과를 확인한 뒤 공유에 동의하면 상대도 내 답 전체를 보고, 나도 상대 답을 볼 수 있어요. 아직 상대 답은 보여주지 않아요. 답하지 않거나 공유하지 않아도 괜찮아요.</p></section>
              {/* 상대 답은 동의 전까지 넘기지 않지만, 상대가 보낸 초대로 답하는 사람이라는 사실은 통계 값에 그대로 싣는다. */}
              <WeddingCodeV31Client embedded pairInvite shareOrigin={window.location.origin}
                onRestart={() => window.history.replaceState(null, "", pairSessionUrl(window.location.origin, link))}
                renderResultActions={draft => <JoinComparison draft={draft} link={link} expiresAt={activeSnapshot.expiresAt} previousRequest={joinRequest} onRequestStart={beginJoin} onRejected={() => setJoinRequest(null)} />} />
            </> : own ? <>
              {manage}
              <WeddingCodeV31Results draft={own} first={partner} received={false} readOnly shareOrigin={window.location.origin} onEdit={() => {}} onRestart={() => router.push("/wedding-code")} sharingContent={<p className={`mt-5 ${v31Body}`}>이 비교 결과는 두 사람의 확인 주소에서만 볼 수 있어요. 이 화면에서는 답이 담긴 링크를 만들 수 없어요.</p>} />
            </> : <p role="alert" className={v31Body}>답을 읽지 못했어요. 현재 상태를 다시 확인해 주세요.</p>}
  </main>;
}
