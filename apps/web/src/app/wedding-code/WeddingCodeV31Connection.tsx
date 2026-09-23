"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import type { V31Draft } from "@/constants/weddingCodeV31";
import { encodeV31 } from "@/lib/weddingCode/v31";
import { PAIR_SESSION_CONSENT_VERSION, PAIR_SESSION_RETENTION_DAYS, createPairSessionKeys, requestPairSession, type PairSessionRequest } from "@/lib/weddingCode/pairSessionContract";
import { pairSessionUrl, readPairSessionRecovery, readSavedPairSession, savePairSessionLink, savePairSessionRecovery, subscribePairSession } from "@/lib/weddingCode/pairSessionClient";
import { v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";

export function PairSessionConsent({ consent, ageConfirmed, disabled, onConsent, onAge }: {
  consent: boolean; ageConfirmed: boolean; disabled: boolean;
  onConsent: (value: boolean) => void; onAge: (value: boolean) => void;
}) {
  return <div className="space-y-3">
    <p className={v31Body}>함께 보기를 선택하면 내 답 전체를 서버에 보관해요. 상대도 자기 답 공유에 동의하면 두 사람 모두 결과를 볼 수 있어요.</p>
    <p className={v31Body}>초대 후 7일 동안 볼 수 있고, 만료된 내용은 하루 안에 삭제해요. 어느 쪽이든 ‘연결 끝내기’를 누르면 두 사람의 공유 답을 바로 지워요. 직접 답한 브라우저 기록은 따로 남아요.</p>
    <p className={v31Body}>초대 링크를 먼저 사용한 사람이 상대가 돼요. 이름이나 계정으로 확인하지 않으니 함께 볼 사람에게만 보내 주세요.</p>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-paper-outline p-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)]">
      <input type="checkbox" checked={ageConfirmed} disabled={disabled} onChange={event => onAge(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]" />
      <span className={`text-sm ${v31Title}`}>만 14세 이상이에요.</span>
    </label>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-paper-outline p-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)]">
      <input type="checkbox" checked={consent} disabled={disabled} onChange={event => onConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]" />
      <span className={`text-sm ${v31Title}`}>내 답을 위 기간 동안 보관하고, 초대로 연결된 상대에게 보여주는 데 동의해요.</span>
    </label>
    <p className="text-xs leading-relaxed text-[var(--hb-text-body)]">동의하지 않아도 내 결과는 볼 수 있어요. 가족·돈·도움에 관한 답과 취향·피하고 싶은 것·우선순위도 공유돼요. <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">보관·삭제 안내</Link></p>
  </div>;
}

export function WeddingCodeComparisonResume({ compact = false }: { compact?: boolean }) {
  const url = useSyncExternalStore(subscribePairSession, () => {
    const saved = readSavedPairSession(); return saved ? pairSessionUrl(window.location.origin, saved) : "";
  }, () => "");
  const recoveryUrl = useSyncExternalStore(subscribePairSession, () => {
    const saved = readSavedPairSession(); const recovery = readPairSessionRecovery();
    return recovery && !(saved?.roomId === recovery.roomId && saved.token === recovery.token)
      ? pairSessionUrl(window.location.origin, recovery) : "";
  }, () => "");
  if (!url && !recoveryUrl) return null;
  return <aside className={compact ? "mt-4 border-t border-paper-outline pt-3" : `mx-auto mt-6 mb-4 w-full max-w-[680px] ${v31Surface} p-4`} aria-label="연결한 비교 결과">
    {url ? <div>
    <p className={v31Body}>이 브라우저에서 함께 보기를 시작한 결과가 있어요.</p>
    <Link href={url} className="mt-2 inline-flex min-h-11 items-center font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">연결한 두 사람 결과 보기</Link>
    </div> : null}
    {recoveryUrl ? <div className={url ? "mt-3 border-t border-paper-outline pt-3" : undefined}>
      <p className={v31Body}>이 탭에 함께 보기 요청의 확인 주소가 남아 있어요. 완료 여부는 주소를 열어 확인해 주세요.</p>
      <Link href={recoveryUrl} className="mt-2 inline-flex min-h-11 items-center font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">이 탭에서 요청한 함께 보기 확인</Link>
    </div> : null}
  </aside>;
}

export default function WeddingCodeV31Connection({ draft }: { draft: V31Draft }) {
  const [expanded, setExpanded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryUrl, setRecoveryUrl] = useState("");
  const pending = useRef<Extract<PairSessionRequest, { action: "create" }> | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function create() {
    if (busy) return;
    if (!consent || !ageConfirmed) { setError("공유할 내용과 나이 확인 항목을 먼저 확인해 주세요."); return; }
    setBusy(true); setError("");
    try {
      if (!pending.current) {
        const keys = createPairSessionKeys();
        pending.current = { action: "create", roomId: keys.roomId, ownerToken: keys.ownerToken, inviteToken: keys.inviteToken,
          answerCode: encodeV31(draft), consentVersion: PAIR_SESSION_CONSENT_VERSION, consent: true, ageConfirmed: true, issuedAt: keys.issuedAt };
      }
      const input = pending.current;
      const member = { roomId: input.roomId, token: input.ownerToken, mode: "member" as const, invitation: input.inviteToken };
      savePairSessionRecovery({ ...member, expiresAt: new Date(input.issuedAt + PAIR_SESSION_RETENTION_DAYS * 86400000).toISOString() });
      setRecoveryUrl(pairSessionUrl(window.location.origin, member));
      const result = await requestPairSession(input);
      if (!active.current) return;
      if (!result.ok) { setError(result.error); if (result.code === "CREATE_EXPIRED") pending.current = null; return; }
      savePairSessionLink({ ...member, expiresAt: result.snapshot.expiresAt });
      window.location.assign(pairSessionUrl(window.location.origin, member));
    } catch { if (active.current) setError("초대를 만들지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요."); }
    finally { if (active.current) setBusy(false); }
  }
  return <section className={`${v31Surface} mt-6 p-5 sm:p-7`} aria-label="상대 초대하고 함께 보기">
    <h2 className={`text-lg ${v31Title}`}>상대도 답하면, 함께 볼 수 있어요</h2>
    <p className={`mt-2 ${v31Body}`}>초대받은 사람이 답과 공유를 마치면 이 브라우저에서 두 사람 결과를 다시 열 수 있어요. 상대가 결과 링크를 돌려보내지 않아도 돼요.</p>
    <WeddingCodeComparisonResume compact />
    {!expanded ? <Button variant="primary" fullWidth className="mt-4 whitespace-normal!" onClick={() => setExpanded(true)}>상대 초대하고 함께 보기</Button> : <div className="mt-4">
      <PairSessionConsent consent={consent} ageConfirmed={ageConfirmed} disabled={busy} onConsent={setConsent} onAge={setAgeConfirmed} />
      <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-body)]">자동저장이 켜져 있으면 이 브라우저에 내 결과 확인 주소도 남겨요. 공용 기기에서는 함께 보기를 끝내고 저장 기록을 지워 주세요.</p>
      <Button variant="primary" fullWidth disabled={busy} onClick={() => void create()} className="mt-4 whitespace-normal!">{busy ? "초대를 만들고 있어요…" : error ? "초대 만들기 다시 시도" : "동의하고 초대 만들기"}</Button>
      {error ? <div role="alert" className={`mt-3 ${v31Body}`}><p>{error}</p>{recoveryUrl ? <Link href={recoveryUrl} className="mt-2 inline-flex min-h-11 items-center underline">이미 만들어졌는지 내 초대 확인하기</Link> : null}</div> : null}
    </div>}
  </section>;
}
