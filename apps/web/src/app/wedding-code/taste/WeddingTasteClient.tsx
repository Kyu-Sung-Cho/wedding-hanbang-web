"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/ui/Button";
import WeddingTasteForm from "@/components/wedding-code/WeddingTasteForm";
import { useAuthStore } from "@/stores/authStore";
import { useWeddingCodeSession } from "@/hooks/useWeddingCodeSession";
import {
  buildWeddingTasteAmoraText, buildWeddingTasteShareUrl, compareWeddingTastes,
  decodeWeddingTasteShareHash, hasWeddingTasteAnswers, summarizeWeddingTaste,
  type WeddingTasteDraftV1,
} from "@/lib/weddingCode/taste";
import {
  consumeWeddingTasteLoginHandoff, createWeddingTasteLoginHandoff, getWeddingTasteChatIdentity, prepareWeddingTasteChat,
} from "@/lib/weddingCode/tasteHandoff";

const card = "rounded-[6px] border border-[var(--hb-hairline)] bg-white p-5 sm:p-7";
type Received = { first: WeddingTasteDraftV1; second: WeddingTasteDraftV1 | null };

export default function WeddingTasteClient() {
  const session = useWeddingCodeSession();
  const ownerId = useAuthStore(state => state.user?.id ?? "guest");
  const [hasVerifiedSession, setHasVerifiedSession] = useState(false);
  useEffect(() => {
    if (session.status !== "ready") return;
    let active = true;
    queueMicrotask(() => { if (active) setHasVerifiedSession(true); });
    return () => { active = false; };
  }, [session.status]);
  return <>
    {session.status !== "ready" ? <main className="min-h-dvh bg-[var(--hb-surface-page)] px-4 py-6 text-[var(--hb-text-strong)] sm:py-10">
      <section className={`${card} mx-auto w-full max-w-[640px]`} role={session.status === "error" ? "alert" : "status"}>
        <h1 className="text-xl font-semibold">{session.status === "error" ? "로그인 상태를 확인하지 못했어요" : "로그인 상태를 확인하고 있어요"}</h1>
        <p className="mt-3 text-sm leading-relaxed">{hasVerifiedSession ? "이 화면의 선택은 잠시 그대로 두었어요. 같은 계정이 확인되면 이어서 볼 수 있어요." : "계정 확인이 끝나면 내 취향을 고를 수 있어요. 입력 중에 계정이 바뀌어 선택을 잃지 않도록 먼저 확인해요."}</p>
        {session.status === "error" ? <><Button className="mt-4" onClick={session.retry}>다시 확인하기</Button><p className="mt-3 text-sm leading-relaxed">계속 확인되지 않으면 <a className="underline underline-offset-4" href="mailto:contact@hanbang.ai">고객지원에 문의해 주세요</a>.</p></> : null}
      </section>
    </main> : null}
    {hasVerifiedSession ? <div hidden={session.status !== "ready"} data-taste-experience=""><TasteExperience key={ownerId} session={session} /></div> : null}
  </>;
}

function TasteExperience({ session }: { session: ReturnType<typeof useWeddingCodeSession> }) {
  const router = useRouter();
  const { user, profile, isInitialized, isLoading, isDemo } = useAuthStore();
  const [own, setOwn] = useState<WeddingTasteDraftV1 | null>(null);
  const [received, setReceived] = useState<Received | null>(null);
  const [mode, setMode] = useState<"intro" | "form" | "result">("intro");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reviewAmora, setReviewAmora] = useState(false);
  const [includePartner, setIncludePartner] = useState(false);
  const [shareApproved, setShareApproved] = useState(false);

  useEffect(() => {
    let active = true;
    const apply = () => {
      const hash = window.location.hash;
      const parsed = hash ? decodeWeddingTasteShareHash(hash) : null;
      setReceived(parsed); setOwn(null); setCopied(false); setReviewAmora(false);
      setShareApproved(false); setIncludePartner(false);
      setLinkError(hash && !parsed ? "이 취향 링크를 확인하지 못했어요. 보낸 사람에게 다시 받아주세요." : null);
      setMode(parsed?.second ? "result" : "intro");
    };
    queueMicrotask(() => { if (active) apply(); });
    window.addEventListener("hashchange", apply);
    return () => { active = false; window.removeEventListener("hashchange", apply); };
  }, []);

  useEffect(() => {
    if (session.status !== "ready" || !isInitialized || isLoading || !user || isDemo) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const url = new URL(window.location.href);
      const nonces = url.searchParams.getAll("wcTasteReview");
      if (nonces.length === 0) return;
      const draft = nonces.length === 1 && !url.hash ? consumeWeddingTasteLoginHandoff(nonces[0]) : null;
      url.searchParams.delete("wcTasteReview");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      if (!draft) { setNotice("이어 온 선택이 만료됐거나 이 탭에 없어요. 다시 고르거나 보관한 내 요약을 확인해 주세요."); return; }
      setReceived(null); setOwn(draft); setMode("result"); setReviewAmora(true);
      setNotice("로그인 전 선택을 가져왔어요. 아래의 현재 계정과 전달할 내용을 확인해 주세요. 아직 대화로 보내지 않았어요.");
    });
    return () => { active = false; };
  }, [isInitialized, isLoading, user, isDemo, session.status]);

  function startFresh() {
    setOwn(null); setReceived(null); setMode("form"); setLinkError(null); setNotice(null);
    setShareApproved(false); setIncludePartner(false); setReviewAmora(false); setCopied(false);
    window.history.replaceState(window.history.state, "", "/wedding-code/taste");
  }

  const canUseOwn = own !== null && hasWeddingTasteAnswers(own);
  const first = received?.first ?? own;
  const second = received ? own ?? received.second : null;
  const visibleRows = own ? summarizeWeddingTaste(own).filter(row => row.state !== "skipped") : [];
  const comparison = first && second ? compareWeddingTastes(first, second) : null;
  const nonemptyComparisonKeys = first && second ? new Set([
    ...summarizeWeddingTaste(first), ...summarizeWeddingTaste(second),
  ].filter(row => row.state !== "skipped").map(row => row.key)) : new Set<string>();
  const canChat = session.status === "ready" && Boolean(getWeddingTasteChatIdentity());
  const needsAccountReview = Boolean(user && !isDemo && profile?.onboarding_completed && !canChat && session.status === "ready");
  const shareUrl = canUseOwn && own && shareApproved
    ? buildWeddingTasteShareUrl({ origin: window.location.origin, first: includePartner && received ? received.first : own, second: includePartner && received ? own : null })
    : null;

  return (
    <main className="min-h-dvh bg-[var(--hb-surface-page)] px-4 py-6 text-[var(--hb-text-strong)] sm:py-10">
      <div className="mx-auto w-full max-w-[640px] space-y-4 [&_button]:whitespace-normal [&_button]:leading-relaxed">
        <Link href="/wedding-code" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">웨딩코드로 돌아가기</Link>
        {isDemo ? <p role="status" className={`${card} text-sm leading-relaxed`}>체험 모드에서는 취향을 고르고 링크로 공유할 수 있어요. 개인 상담은 실제 계정으로 로그인한 뒤 이용해 주세요.</p> : null}
        {notice ? <p role="status" className={`${card} text-sm leading-relaxed`}>{notice}</p> : null}
        {linkError ? <section className={card} role="alert"><h1 className="text-xl font-semibold">링크를 다시 확인해 주세요</h1><p className="mt-3 text-sm leading-relaxed">{linkError}</p><Button className="mt-5" onClick={startFresh}>내 선택 새로 시작하기</Button></section> : mode === "intro" ? (
          <section className={card}>
            <p className="text-xs font-semibold text-[var(--hb-text-muted)]">웨딩코드 · 직접 고르는 취향</p>
            <h1 className="mt-3 text-3xl font-semibold leading-snug">내가 원하는 결혼식</h1>
            <p className="mt-4 text-base leading-relaxed">좋아하는 모습, 피하고 싶은 것, 함께 맞춰볼 범위를 정리해요. 중요하게 이야기할 두 주제부터 골라보세요.</p>
            {received ? <p className="mt-4 rounded-[6px] bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed">먼저 답한 사람이 취향 링크를 보냈어요. 내 선택을 직접 고른 뒤 두 사람의 답을 나란히 볼 수 있어요.</p> : null}
            <p className="mt-4 text-sm leading-relaxed text-[var(--hb-text-muted)]">선택한 주제에 따라 최대 6개 질문이에요. 아직 모르거나 계획에 없는 것은 그대로 남겨도 괜찮아요. 이번에 고르지 않은 분야가 덜 중요하다는 뜻은 아니에요.</p>
            <Button variant="primary" fullWidth className="mt-6" onClick={() => setMode("form")}>{received ? "내 취향도 직접 고르기" : "내 취향 고르기"}</Button>
            <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">선택은 이 화면에만 있어요. 새로고침하면 사라져요. 공유하거나 로그인·상담으로 이어갈 때 포함할 내용과 보관 범위를 확인해요.</p>
          </section>
        ) : mode === "form" ? (
          <WeddingTasteForm initialDraft={own ?? undefined} onComplete={draft => {
            setOwn(draft); setMode("result"); setCopied(false); setShareApproved(false); setReviewAmora(false);
          }} />
        ) : (
          <>
            {own ? <section className={card} data-taste-own="">
              <p className="text-xs text-[var(--hb-text-muted)]">지금 내가 직접 고른 것</p>
              <h1 className="mt-2 text-2xl font-semibold">내가 원하는 결혼식</h1>
              {visibleRows.length ? <dl className="mt-5 divide-y divide-[var(--hb-hairline)]">{visibleRows.map(row => <div key={row.key} className="py-3"><dt className="text-xs text-[var(--hb-text-muted)]">{row.label}</dt><dd className="mt-1 text-base font-medium leading-relaxed">{row.value}</dd></div>)}</dl> : <p className="mt-4 text-sm leading-relaxed">이번에는 선택을 비워뒀어요. 원하는 방향이 생기면 다시 고를 수 있어요.</p>}
              <p className="mt-4 text-sm leading-relaxed text-[var(--hb-text-muted)]">이번에 확인하지 않은 취향은 추측하지 않았어요. 한 사람의 희망이며 두 사람의 공동 합의는 아니에요.</p>
              <Button variant="secondary" className="mt-5" onClick={() => { setMode("form"); setReviewAmora(false); }}>내 선택 다시 보기</Button>
            </section> : null}
            {comparison ? <section className={card} data-taste-comparison="">
              <h2 className="text-xl font-semibold">두 사람이 고른 것, 나란히</h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--hb-text-muted)]">링크를 만들 당시의 선택일 수 있어요. 먼저·나중은 응답 순서이며 계정이나 신원을 확인한 결과가 아니에요. 같은 선택이어도 이유는 직접 확인해 주세요.</p>
              <div className="mt-4 divide-y divide-[var(--hb-hairline)]">{comparison.filter(row => nonemptyComparisonKeys.has(row.key)).map(row => <article key={row.key} data-taste-pair={row.key} className="py-4">
                <h3 className="text-sm font-semibold">{row.label}</h3><p className="mt-1 text-xs text-[var(--hb-text-muted)]">{row.status === "same_selection" ? "같은 선택" : row.status === "different_selection" ? "서로 다른 선택" : "직접 확인할 부분"}</p>
                <p className="mt-3 text-sm leading-relaxed">먼저 답한 사람: {row.first}</p><p className="mt-2 text-sm leading-relaxed">나중에 답한 사람: {row.second}</p>
              </article>)}</div>
            </section> : null}
            {canUseOwn && own ? <section className={card}>
              <h2 className="text-xl font-semibold">함께 볼 사람에게 보내기</h2>
              <p className="mt-3 text-sm leading-relaxed">위의 직접 선택한 내용이 링크에 포함돼요. 링크를 받은 사람은 누구나 읽을 수 있고 전달한 링크는 회수할 수 없어요.</p>
              {received ? <label className="mt-3 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={includePartner} onChange={event => { setIncludePartner(event.target.checked); setShareApproved(false); setCopied(false); }} />먼저 답한 사람의 선택도 함께 담기</label> : null}
              <label className="mt-3 flex min-h-11 items-center gap-3 text-sm leading-relaxed"><input type="checkbox" checked={shareApproved} onChange={event => { setShareApproved(event.target.checked); setCopied(false); }} />{includePartner ? "나란히 본 두 사람의 선택을" : "위의 내 선택을"} 링크로 보낼게요</label>
              <Button fullWidth className="mt-4" disabled={!shareApproved} onClick={async () => {
                try {
                  if (!shareUrl) return;
                  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
                  await navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                } catch {
                  setNotice("링크를 복사하지 못했어요. 브라우저의 클립보드 권한을 확인하고 다시 눌러주세요.");
                }
              }}>{copied ? "링크를 복사했어요" : "선택 링크 복사하기"}</Button>
              {shareUrl ? <details className="mt-3">
                <summary className="cursor-pointer py-3 text-sm underline underline-offset-4">링크 주소 직접 복사하기</summary>
                <input aria-label="공유 링크 주소" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} className="min-h-11 w-full min-w-0 rounded-[6px] border border-[var(--hb-hairline)] px-3 text-base" />
              </details> : null}
            </section> : null}
            {canUseOwn && own ? <section className={card} data-taste-amora="">
              <h2 className="text-xl font-semibold">내 선택으로 아모라와 이야기하기</h2>
              <p className="mt-3 text-sm leading-relaxed">내가 직접 고른 내용만 나만 상담으로 옮겨요. 상대가 보낸 답은 포함하지 않아요.</p>
              {!reviewAmora ? <Button className="mt-5" fullWidth onClick={() => setReviewAmora(true)}>전달할 내용 확인하기</Button> : <>
                <p className="mt-4 whitespace-pre-wrap rounded-[6px] bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed" data-taste-amora-text="">{buildWeddingTasteAmoraText(own)}</p>
                <p className="mt-4 break-all text-sm leading-relaxed">{user && !isDemo ? `현재 계정: ${user.email ?? profile?.name ?? "로그인한 내 계정"}` : "로그인 후 현재 계정과 이 내용을 한 번 더 확인해요."}</p>
                <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">계속하면 선택값을 이 탭에 최대 15분간 임시 보관해요. 상담에는 초안으로 열리고, 보내기를 눌러야 개인 대화에 저장돼요. 예산·일정·공동 결정을 지금 바꾸지 않아요.</p>
                {needsAccountReview ? <div className="mt-4 rounded-[6px] border border-[var(--hb-hairline)] p-4 text-sm leading-relaxed" role="alert">
                  <p>계정 준비는 완료됐지만 개인 상담에 필요한 연결 정보를 확인하지 못했어요. 계정 정보를 다시 불러와 주세요. 같은 문제가 계속되면 고객지원에서 확인을 도와드릴게요.</p>
                  <Button className="mt-3" onClick={session.retry}>계정 정보 다시 확인</Button>
                  <a className="ml-3 inline-flex min-h-11 items-center underline underline-offset-4" href="mailto:contact@hanbang.ai">고객지원 문의</a>
                </div> : <Button variant="primary" className="mt-5" fullWidth disabled={session.status !== "ready" || !isInitialized || isLoading} onClick={() => {
                  if (session.status !== "ready" || needsAccountReview) return;
                  const handoff = canChat ? prepareWeddingTasteChat(own) : createWeddingTasteLoginHandoff(own);
                  if (!handoff) { setNotice("선택을 이어갈 수 없어요. 로그인 상태와 이 탭의 저장소 허용을 확인하고 다시 눌러주세요."); return; }
                  router.push(handoff.href);
                }}>{canChat ? "이 계정의 나만 상담에 초안 열기" : user && !isDemo ? "계정 준비하고 내 선택 이어가기" : "로그인하고 내 선택 이어가기"}</Button>}
                {user && !isDemo && !canChat && !needsAccountReview ? <p className="mt-3 text-sm leading-relaxed">계정 준비를 완료하면 이 선택을 다시 확인할 수 있어요.</p> : null}
              </>}
            </section> : null}
            {!own ? <section className={card}><p className="text-sm leading-relaxed">전달받은 선택은 내 계정에 반영하지 않아요. 내 취향은 직접 새로 고를 수 있어요.</p><Button className="mt-4" fullWidth onClick={startFresh}>내 선택 새로 시작하기</Button></section> : null}
          </>
        )}
      </div>
    </main>
  );
}
