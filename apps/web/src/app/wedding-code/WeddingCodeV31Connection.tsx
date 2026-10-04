"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import type { V31Draft } from "@/constants/weddingCodeV31";
import { encodeV31 } from "@/lib/weddingCode/v31";
import { PAIR_SESSION_CLOCK_HINT, PAIR_SESSION_CONSENT_VERSION, PAIR_SESSION_RETENTION_DAYS, createPairSessionKeys, requestPairSession, type PairSessionRequest } from "@/lib/weddingCode/pairSessionContract";
import { forgetPairSession, pairSessionUrl, readPairSessionRecovery, readSavedPairSession, savePairSessionLink, savePairSessionRecovery, subscribePairSession } from "@/lib/weddingCode/pairSessionClient";
import { v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";

/**
 * 서버가 요청을 확실히 거절한 코드. 이 거절은 방이 만들어지거나 참여가 처리되지 않았다는 뜻이라,
 * 「이미 처리됐는지 확인하기」 복구 링크가 쓸모없다. 네트워크 오류, 시간 초과, 응답 해석 실패는 처리됐을 수도 있어서 여기에 넣지 않는다.
 */
const CONFIRMED_REJECTION_CODES: readonly string[] = ["CONFLICT", "CLOSED", "NOT_FOUND", "INVALID_REQUEST"];
export function isConfirmedPairRejection(code: string): boolean { return CONFIRMED_REJECTION_CODES.includes(code); }

export function PairSessionConsent({ consent, ageConfirmed, disabled, onConsent, onAge, participant = false }: {
  consent: boolean; ageConfirmed: boolean; disabled: boolean;
  onConsent: (value: boolean) => void; onAge: (value: boolean) => void;
  /** 초대를 받아 답한 사람의 동의 구역이다. 초대한 사람은 이미 동의했으므로 이 사람이 동의하면 바로 두 사람 모두 결과를 본다. */
  participant?: boolean;
}) {
  return <div className="space-y-3">
    <p className={v31Body}>{participant ? "동의하면 내 답 전체를 서버에 보관하고, 초대한 사람도 바로 두 사람 결과를 볼 수 있어요." : "함께 보기를 선택하면 내 답 전체를 서버에 보관해요. 상대도 자기 답 공유에 동의하면 두 사람 모두 결과를 볼 수 있어요."}</p>
    <p className={v31Body}>초대 후 7일 동안 볼 수 있고, 기간이 끝난 내용은 하루 안에 삭제해요. 어느 쪽이든 ‘연결 끝내기’를 누르면 서버에 있는 두 사람의 공유 답을 바로 지워요. 다만 상대가 이미 읽었거나 따로 저장한 내용은 되돌릴 수 없어요. 각자 브라우저에 직접 저장한 답은 그대로 남아요.</p>
    <p className={v31Body}>{participant ? "초대 링크를 먼저 쓴 사람이 상대가 돼요. 이름이나 계정으로는 확인하지 않으니, 보낸 사람이 맞는지 확인한 뒤에 동의해 주세요." : "초대 링크를 먼저 사용한 사람이 상대가 돼요. 이름이나 계정으로 확인하지 않으니 함께 볼 사람에게만 보내 주세요."}</p>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-paper-outline p-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)]">
      <input type="checkbox" checked={ageConfirmed} disabled={disabled} onChange={event => onAge(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]" />
      <span className={`text-sm ${v31Title}`}>만 14세 이상이에요.</span>
    </label>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-paper-outline p-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)]">
      <input type="checkbox" checked={consent} disabled={disabled} onChange={event => onConsent(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]" />
      <span className={`text-sm ${v31Title}`}>내 답을 위 기간 동안 보관하고, 초대로 연결된 상대에게 보여주는 데 동의해요.</span>
    </label>
    <p className="text-xs leading-relaxed text-[var(--hb-text-body)]">동의하지 않아도 내 결과는 그대로 볼 수 있어요. 동의하면 가족·돈·도움에 관한 답을 비롯해 취향, 피하고 싶은 것, 더 쓰고 싶은 곳, 꼭 지키고 싶은 것까지 내 답 전체가 상대에게 보여요. <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">보관·삭제 안내</Link></p>
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
  // 좁은 폰 폭에서 박스가 화면 양쪽 끝에 붙지 않게 본문과 같은 좌우 여백(16px)을 준다.
  return <aside className={compact ? "mt-4 border-t border-paper-outline pt-3" : `mx-4 mt-6 mb-4 max-w-[680px] sm:mx-auto ${v31Surface} p-4`} aria-label="연결한 비교 결과">
    {url ? <div>
    <p className={v31Body}>이 브라우저에서 함께 보기를 시작한 결과가 있어요.</p>
    <Link href={url} className="mt-2 inline-flex min-h-11 items-center font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">연결한 두 사람 결과 보기</Link>
    </div> : null}
    {recoveryUrl ? <div className={url ? "mt-3 border-t border-paper-outline pt-3" : undefined}>
      <p className={v31Body}>이 탭에 함께 보기 요청을 확인하는 주소가 남아 있어요. 연결이 잘 됐는지 열어서 확인해 주세요.</p>
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
  // 서버에 요청을 보냈다가 실패했는가(체크가 빠져 낸 안내와 구분한다). 이때만 단추가 「초대 다시 만들기」가 되고, 체크를 바꿔도 오류를 지우지 않는다.
  const [serverFailed, setServerFailed] = useState(false);
  const pending = useRef<Extract<PairSessionRequest, { action: "create" }> | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function create() {
    if (busy) return;
    if (!consent || !ageConfirmed) { setError("두 칸에 모두 체크하면 초대를 만들 수 있어요."); return; }
    setBusy(true); setError(""); setServerFailed(false);
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
      if (!result.ok) {
        setServerFailed(true);
        const clockOff = result.code === "CREATE_EXPIRED";
        // 확실히 거절된 요청은 방이 없다. 복구 링크와 임시 확인 주소를 치우고, 다음에는 새 키로 만든다.
        if (clockOff || isConfirmedPairRejection(result.code)) { pending.current = null; setRecoveryUrl(""); forgetPairSession(input.roomId); }
        setError(clockOff && !result.error.includes(PAIR_SESSION_CLOCK_HINT) ? `${result.error} ${PAIR_SESSION_CLOCK_HINT}` : result.error);
        return;
      }
      savePairSessionLink({ ...member, expiresAt: result.snapshot.expiresAt });
      window.location.assign(pairSessionUrl(window.location.origin, member));
    } catch { if (active.current) { setServerFailed(true); setError("초대를 만들지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요."); } }
    finally { if (active.current) setBusy(false); }
  }
  return <section className={`${v31Surface} mt-6 p-5 sm:p-7`} aria-label="상대 초대하고 함께 보기">
    <h2 className={`text-lg ${v31Title}`}>상대도 답하면, 함께 볼 수 있어요</h2>
    <p className={`mt-2 ${v31Body}`}>상대가 초대 링크로 답하고 공유에 동의하면 두 사람 결과를 함께 볼 수 있어요. 이 방법을 고르면 내 답을 서버에 보관하고, 초대 후 {PAIR_SESSION_RETENTION_DAYS}일 동안 볼 수 있어요. 상대가 결과를 따로 보내 줄 필요는 없어요. 자동 저장이 켜져 있으면 이 브라우저에서 다시 열 수 있고, 꺼져 있으면 초대를 만든 뒤 나오는 ‘나만 보관할 확인 주소’(내 결과를 다시 여는 주소)로 열 수 있어요.</p>
    <WeddingCodeComparisonResume compact />
    {!expanded ? <Button variant="primary" fullWidth className="mt-4 whitespace-normal!" onClick={() => setExpanded(true)}>상대 초대하고 함께 보기</Button> : <div className="mt-4">
      {/* 체크가 빠져 낸 오류는 체크를 바꾸면 바로 지운다(서버에 보낸 적이 없는 오류라 두 칸을 채운 뒤에도 남아 있으면 틀린 말이 된다). */}
      <PairSessionConsent consent={consent} ageConfirmed={ageConfirmed} disabled={busy} onConsent={value => { setConsent(value); if (!serverFailed) setError(""); }} onAge={value => { setAgeConfirmed(value); if (!serverFailed) setError(""); }} />
      <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-body)]">자동 저장이 켜져 있으면 이 브라우저에 나만 보관할 확인 주소도 남겨요. 다른 사람과 같이 쓰는 컴퓨터나 휴대폰이라면 함께 보기를 끝낸 뒤 ‘자동 저장 끄기’를 눌러 지워 주세요.</p>
      <Button variant="primary" fullWidth disabled={busy} onClick={() => void create()} className="mt-4 whitespace-normal!">{busy ? "초대를 만들고 있어요…" : serverFailed ? "초대 다시 만들기" : "동의하고 초대 만들기"}</Button>
      {error ? <div role="alert" className={`mt-3 ${v31Body}`}><p>{error}</p>{recoveryUrl ? <Link href={recoveryUrl} className="mt-2 inline-flex min-h-11 items-center underline">이미 만들어졌는지 내 초대 확인하기</Link> : null}</div> : null}
    </div>}
  </section>;
}
