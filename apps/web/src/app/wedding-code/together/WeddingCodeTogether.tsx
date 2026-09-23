"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Button from "@/components/ui/Button";
import type { V31Draft } from "@/constants/weddingCodeV31";
import { decodeV31, encodeV31 } from "@/lib/weddingCode/v31";
import { createPairSessionKeys, PAIR_SESSION_CONSENT_VERSION, requestPairSession, type PairSessionSnapshot } from "@/lib/weddingCode/pairSessionContract";
import { forgetPairSession, pairSessionUrl, parsePairSessionHash, readPairSessionRecovery, savePairSessionLink, savePairSessionRecovery, type PairSessionLink } from "@/lib/weddingCode/pairSessionClient";
import WeddingCodeV31Client from "../WeddingCodeV31Client";
import WeddingCodeV31Results from "../WeddingCodeV31Results";
import { PairSessionConsent } from "../WeddingCodeV31Connection";
import { v31Body, v31Surface, v31Title } from "../WeddingCodeV31Inputs";

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener); window.addEventListener("popstate", listener);
  return () => { window.removeEventListener("hashchange", listener); window.removeEventListener("popstate", listener); };
}

function CopyAddress({ url, label, privateLink = false }: { url: string; label: string; privateLink?: boolean }) {
  const [notice, setNotice] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(url); setNotice(privateLink ? "나만 보관할 주소를 복사했어요. 상대에게는 초대 링크를 보내 주세요." : "초대 링크를 복사했어요. 함께 볼 사람과의 대화창에 붙여 넣어 주세요."); }
    catch { setNotice("아래 주소를 선택해서 직접 복사해 주세요."); }
  }
  return <div className="mt-4">
    <Button variant={privateLink ? "secondary" : "primary"} fullWidth onClick={() => void copy()} className="whitespace-normal!">{label}</Button>
    <p role="status" className={`mt-2 ${v31Body}`}>{notice}</p>
    <details><summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">{privateLink ? "내 확인 주소 직접 복사" : "초대 주소 직접 복사"}</summary>
      <input readOnly value={url} aria-label={privateLink ? "나만 보관할 결과 확인 주소" : "상대에게 보낼 초대 주소"} onFocus={event => event.currentTarget.select()} className="min-h-12 w-full rounded-lg border border-paper-outline px-3 text-sm" />
    </details>
  </div>;
}

function JoinComparison({ draft, link, expiresAt }: { draft: V31Draft; link: PairSessionLink; expiresAt: string }) {
  const [consent, setConsent] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryUrl, setRecoveryUrl] = useState("");
  const token = useRef<string | null>(null);
  async function join() {
    if (busy) return;
    if (!consent || !ageConfirmed) { setError("공유할 내용과 나이 확인 항목을 먼저 확인해 주세요."); return; }
    setBusy(true); setError("");
    try {
      token.current ??= createPairSessionKeys().participantToken;
      const member: PairSessionLink = { roomId: link.roomId, token: token.current, mode: "member" };
      setRecoveryUrl(pairSessionUrl(window.location.origin, member));
      savePairSessionRecovery({ ...member, expiresAt });
      const result = await requestPairSession({ action: "join", roomId: link.roomId, inviteToken: link.token, participantToken: token.current,
        answerCode: encodeV31(draft), consentVersion: PAIR_SESSION_CONSENT_VERSION, consent: true, ageConfirmed: true });
      if (!result.ok) { setError(result.error); return; }
      savePairSessionLink({ ...member, expiresAt: result.snapshot.expiresAt });
      window.location.replace(pairSessionUrl(window.location.origin, member));
    } catch { setError("함께 보기를 연결하지 못했어요. 같은 화면에서 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  return <section className={`${v31Surface} mt-6 p-5 sm:p-7`} aria-label="내 답 공유하고 함께 보기">
    <h2 className={`mb-3 text-lg ${v31Title}`}>내 답을 공유하고, 두 사람 결과 보기</h2>
    <p className={`mb-3 ${v31Body}`}>여기서 동의하면 초대한 사람도 내 결과를 볼 수 있어요. 결과 링크를 다시 보내지 않아도 돼요.</p>
    <PairSessionConsent consent={consent} ageConfirmed={ageConfirmed} disabled={busy} onConsent={setConsent} onAge={setAgeConfirmed} />
    <Button variant="primary" fullWidth disabled={busy} onClick={() => void join()} className="mt-4 whitespace-normal!">{busy ? "함께 볼 결과를 연결하고 있어요…" : "동의하고 두 사람 결과 보기"}</Button>
    {error ? <div role="alert" className={`mt-3 ${v31Body}`}><p>{error}</p>{recoveryUrl ? <Link className="mt-2 inline-flex min-h-11 items-center underline" href={recoveryUrl}>이미 처리됐는지 내 결과 확인하기</Link> : null}</div> : null}
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
  const [refreshNotice, setRefreshNotice] = useState("");
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedLocally, setSavedLocally] = useState<boolean | null>(null);
  const [expired, setExpired] = useState(false);
  const requestVersion = useRef(0);
  const [member, setMember] = useState<PairSessionLink | null>(null);
  const mutating = useRef(false);
  const closed = useRef(false);
  const knownInvite = useRef(false);
  const { roomId, token, mode, invitation } = link;
  const expiresAt = snapshot?.expiresAt;

  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (!roomId || !token || !mode) return;
    let active = true; let inFlight = false;
    const current: PairSessionLink = { roomId, token, mode, ...(invitation ? { invitation } : {}) };
    async function refresh() {
      if (!active || inFlight || mutating.current || closed.current || document.visibilityState === "hidden") return;
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
        if (knownInvite.current && ["NETWORK_ERROR", "TIMEOUT", "UNAVAILABLE"].includes(result.code)) {
          setRefreshNotice("연결 상태를 새로 확인하지 못했어요. 작성한 답은 이 화면에 그대로 있고, 잠시 후 다시 확인해요.");
        } else setError(result.error);
        return;
      }
      if ((used.mode === "invite") !== (result.snapshot.role === "invite")) { setError("이 링크의 접근 권한을 확인하지 못했어요."); return; }
      setError(""); setRefreshNotice(""); setSnapshot(result.snapshot); setMember(used);
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
  }, [roomId, token, mode, invitation, retry]);

  const reload = useCallback(() => setRetry(value => value + 1), []);
  async function revoke() {
    if (!member || member.mode !== "member" || busy) return;
    mutating.current = true; setBusy(true); const version = ++requestVersion.current;
    const result = await requestPairSession({ action: "revoke", roomId: member.roomId, token: member.token });
    if (version === requestVersion.current) {
      if (result.ok) { closed.current = true; setSnapshot(result.snapshot); setError(""); forgetPairSession(member.roomId); setRevokeOpen(false); }
      else setError(result.error);
    }
    mutating.current = false; setBusy(false);
  }

  const activeSnapshot = snapshot?.roomId === roomId ? snapshot : null;
  const own = activeSnapshot?.ownAnswerCode ? decodeV31(activeSnapshot.ownAnswerCode) : null;
  const partner = activeSnapshot?.partnerAnswerCode ? decodeV31(activeSnapshot.partnerAnswerCode) : null;
  const manage = activeSnapshot && member?.mode === "member" ? <section className={`${v31Surface} my-5 p-5`} aria-label="두 사람 연결 관리">
    <h2 className={`text-lg ${v31Title}`}>{activeSnapshot.state === "ready" ? "두 사람의 답이 연결됐어요" : "상대의 답을 기다리고 있어요"}</h2>
    <p className={`mt-2 ${v31Body}`}>각자 공유한 시점의 답이에요. {new Date(activeSnapshot.expiresAt).toLocaleString("ko-KR")}까지 볼 수 있어요. 답을 바꿔 다시 비교하려면 이 연결을 끝내고 새로 초대해 주세요.</p>
    {activeSnapshot.state === "waiting" && activeSnapshot.role === "owner" && member.invitation ? <>
      <p className={`mt-3 ${v31Body}`}>아래 초대 링크를 상대에게 보내 주세요. 상대가 답과 공유를 마치면 이 화면에 결과가 나타나요. 화면을 닫았다면 나중에 다시 들어와 확인해 주세요.</p>
      <CopyAddress url={pairSessionUrl(window.location.origin, { roomId: member.roomId, token: member.invitation, mode: "invite" })} label="상대에게 보낼 초대 링크 복사" />
    </> : null}
    {savedLocally === false ? <p className={`mt-3 ${v31Body}`}>이 브라우저에 확인 주소를 저장하지 못했어요. 아래 ‘나만 보관할 확인 주소’를 따로 보관해 주세요.</p> : <p className={`mt-3 ${v31Body}`}>자동저장이 켜진 이 브라우저에서는 웨딩코드의 ‘연결한 두 사람 결과 보기’로 다시 들어올 수 있어요.</p>}
    <details className="mt-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">나만 보관할 확인 주소</summary><p className={`mt-2 ${v31Body}`}>이 주소를 가진 사람은 내 접근 권한으로 두 사람 결과를 보고 연결을 끝낼 수 있어요. 상대에게 보내는 초대 주소와 달라요.</p><CopyAddress url={pairSessionUrl(window.location.origin, member)} label="내 확인 주소 복사" privateLink /></details>
    <Button variant="secondary" disabled={busy} onClick={reload} className="mt-3">현재 상태 다시 확인</Button>
    {!revokeOpen ? <Button variant="ghost" onClick={() => setRevokeOpen(true)} className="mt-3">연결 끝내기</Button> : <div className="mt-4 border-t border-[var(--hb-hairline)] pt-4">
      <p className={v31Body}>두 사람이 함께 보는 답을 서버에서 지우고 이 연결을 끝낼까요? 다시 함께 보려면 새로 초대해야 해요. 각자 브라우저에 직접 저장한 답은 남아요.</p>
      <div className="mt-3 flex flex-wrap gap-3"><Button variant="secondary" disabled={busy} onClick={() => setRevokeOpen(false)}>계속 함께 보기</Button><Button variant="primary" disabled={busy} onClick={() => void revoke()}>{busy ? "연결을 끝내고 있어요…" : "공유 답 지우고 연결 끝내기"}</Button></div>
    </div>}
  </section> : null;

  return <main className="mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6 sm:py-10">
    <nav aria-label="두 사람 웨딩코드 탐색" className="mb-6"><Link href="/wedding-code" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">웨딩코드로 돌아가기</Link></nav>
    {refreshNotice ? <p role="status" className={`mb-4 ${v31Body}`}>{refreshNotice}</p> : null}
    {error ? <section role="alert"><h1 className={`text-2xl ${v31Title}`}>비교 결과를 확인하지 못했어요</h1><p className={`mt-3 ${v31Body}`}>{error}</p><Button variant="primary" className="mt-4" onClick={reload}>다시 확인하기</Button></section>
        : !activeSnapshot ? <p role="status" className={v31Body}>두 사람 연결을 확인하고 있어요…</p>
          : activeSnapshot.state === "closed" || expired ? <section><h1 className={`text-2xl ${v31Title}`}>이 비교는 끝났어요</h1><p className={`mt-3 ${v31Body}`}>한 사람이 연결을 끝냈거나 볼 수 있는 기간이 지났어요. 다시 함께 보려면 새로 초대해 주세요.</p><Link href="/wedding-code" className="mt-4 inline-flex min-h-11 items-center underline">내 웨딩코드로 돌아가기</Link></section>
            : activeSnapshot.role === "invite" ? activeSnapshot.state === "ready" ? <section><h1 className={`text-2xl ${v31Title}`}>이미 참여한 초대예요</h1><p className={`mt-3 ${v31Body}`}>직접 답한 브라우저의 ‘연결한 두 사람 결과 보기’에서 확인해 주세요. 다른 사람이 참여했다면 초대한 사람에게 새 초대를 요청해 주세요.</p></section> : <>
              <section className={`${v31Surface} mb-5 p-5`} aria-label="받은 초대 안내"><h2 className={`text-lg ${v31Title}`}>결혼 준비에 대해 서로 알아보자는 초대가 왔어요</h2><p className={`mt-2 ${v31Body}`}>먼저 내 생각대로 답해 보세요. 내 결과를 확인한 뒤 공유에 동의하면 상대도 내 결과를 보고, 나도 상대 결과를 볼 수 있어요. 아직 상대 답은 보여주지 않아요.</p></section>
              <WeddingCodeV31Client embedded shareOrigin={window.location.origin}
                onRestart={() => window.history.replaceState(null, "", pairSessionUrl(window.location.origin, link))}
                renderResultActions={draft => <JoinComparison draft={draft} link={link} expiresAt={activeSnapshot.expiresAt} />} />
            </> : own ? <>
              {manage}
              <WeddingCodeV31Results draft={own} first={partner} received={false} readOnly shareOrigin={window.location.origin} onEdit={() => {}} onRestart={() => router.push("/wedding-code")} sharingContent={<p className={`mt-5 ${v31Body}`}>이 비교 결과는 두 참여자의 확인 주소에서 볼 수 있어요. 다른 사람에게 답이 담긴 링크를 만드는 기능은 제공하지 않아요.</p>} />
            </> : <p role="alert" className={v31Body}>답을 읽지 못했어요. 현재 상태를 다시 확인해 주세요.</p>}
  </main>;
}
