"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { ITEMS } from "@/lib/weddingCode/likert/bank";
import { buildComparison, buildResult } from "@/lib/weddingCode/likert/model";
import {
  answeredCount, buildShareUrl, createDraft, createSnapshot, isComplete,
  clearLikertDraft, loadDraft, readLikertAutosave, readShareFragment, saveDraft, setLikertAutosave, type SharedState,
} from "@/lib/weddingCode/likert/io";
import { EXPRESSION_VERSION, MEASUREMENT_VERSION, type Answer, type Draft, type Snapshot } from "@/lib/weddingCode/likert/types";
import IntroPanel from "./IntroPanel";
import QuestionPanel from "./QuestionPanel";
import PersonalReport from "./PersonalReport";
import CoupleReport from "./CoupleReport";

type Pair = { first: Snapshot; second: Snapshot };

export default function WeddingCodeLikertClient() {
  const [draft, setDraft] = useState<Draft>(() => createDraft());
  const [saved, setSaved] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(false);
  const [canStore, setCanStore] = useState(true);
  const [protectedDraft, setProtectedDraft] = useState(false);
  const [autosave, setAutosave] = useState(false);
  const [storageStatus, setStorageStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [expressionNotice, setExpressionNotice] = useState("");
  const [shared, setShared] = useState<SharedState>({ kind: "none" });
  const [pair, setPair] = useState<Pair | null>(null);
  const [pairOrigin, setPairOrigin] = useState<"link" | "session" | null>(null);
  const [comparisonNotice, setComparisonNotice] = useState("");
  const [sharing, setSharing] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const comparisonRef = useRef<HTMLElement>(null);
  const draftChanged = useRef(false);

  useEffect(() => {
    // Restore browser-owned data after the first client paint, with cancellation on unmount.
    const frame = window.requestAnimationFrame(() => {
    try {
      const enabled = readLikertAutosave(window.localStorage);
      setAutosave(enabled);
      const restored = loadDraft(window.localStorage);
      setSaved(enabled ? restored.draft : null);
      setNotice(restored.notice);
      setExpressionNotice(restored.expressionNotice ?? "");
      if (!restored.draft && restored.notice) setProtectedDraft(true);
    } catch {
      setCanStore(false);
      setProtectedDraft(true);
      setNotice("이 브라우저에서는 답을 저장하기 어려워요. 지금 탭에서는 계속 풀 수 있어요.");
    }
    const link = readShareFragment(window.location.hash);
    setShared(link);
    if (link.kind === "couple") {
      setPair({ first: link.first, second: link.second });
      setPairOrigin("link");
      setDraft(previous => ({ ...previous, screen: "compare" }));
    }
    setLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!loaded || !active) return;
    if (!canStore || !autosave || protectedDraft) return;
    if (!draftChanged.current) return;
    let failureFrame: number | undefined;
    const reportFailure = (message: string) => {
      failureFrame = window.requestAnimationFrame(() => { setCanStore(false); setNotice(message); });
    };
    try {
      const receipt = saveDraft(window.localStorage, draft);
      if (!receipt.saved) reportFailure(receipt.notice);
      else draftChanged.current = false;
    } catch {
      reportFailure("브라우저에 저장하지 못했어요. 지금 탭에서는 계속 풀 수 있어요.");
    }
    return () => { if (failureFrame !== undefined) window.cancelAnimationFrame(failureFrame); };
  }, [active, autosave, canStore, draft, loaded, protectedDraft]);

  useEffect(() => {
    if (!sharing) return;
    shareRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [sharing]);

  useEffect(() => {
    if (!loaded || (draft.screen !== "result" && draft.screen !== "compare")) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const section = draft.screen === "result" ? resultRef.current : comparisonRef.current;
    const heading = section?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [draft.screen, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const receiveLink = () => {
      const incoming = readShareFragment(window.location.hash);
      // A new fragment can arrive in an existing tab. Keep this tab's own draft
      // separate from the incoming snapshots, including when storage is unavailable.
      if (active) setSaved(draft);
      setActive(false);
      setSharing(false);
      setComparisonNotice("");
      setShared(incoming);
      if (incoming.kind === "couple") {
        setPair({ first: incoming.first, second: incoming.second });
        setPairOrigin("link");
      } else {
        setPair(null);
        setPairOrigin(null);
      }
      setDraft(previous => ({ ...previous, screen: incoming.kind === "couple" ? "compare" : "intro" }));
    };
    window.addEventListener("hashchange", receiveLink);
    return () => window.removeEventListener("hashchange", receiveLink);
  }, [active, draft, loaded]);

  const result = useMemo(() => buildResult(draft.answers), [draft.answers]);
  const couple = useMemo(() => pair ? buildComparison(pair.first.answers, pair.second.answers) : null, [pair]);
  const count = answeredCount(draft.answers);
  const inviter = shared.kind === "invite" ? shared.first : undefined;
  const resumable = active ? draft : saved;
  const linkNotice = "notice" in shared ? shared.notice ?? "" : "";

  function update(change: Partial<Draft>) {
    draftChanged.current = true;
    setDraft(previous => ({ ...previous, ...change, updatedAt: new Date().toISOString() }));
  }
  function start() {
    draftChanged.current = true;
    setSharing(false);
    setPair(null);
    setPairOrigin(null);
    setComparisonNotice("");
    setExpressionNotice("");
    setDraft({ ...createDraft(), screen: "questions" });
    setActive(true);
  }
  function resume() {
    if (!resumable) return;
    draftChanged.current = false;
    setDraft({ ...resumable, screen: isComplete(resumable.answers) ? "result" : "questions" });
    setActive(true);
    setSharing(false);
  }
  function answer(value: Answer) {
    const item = ITEMS[draft.cursor];
    if (!item) return;
    draftChanged.current = true;
    const previous = draft.answers[item.id];
    const changed = previous?.status !== value.status
      || (previous?.status === "rated" && value.status === "rated" && previous.value !== value.value);
    if (changed && pairOrigin === "session") {
      setPair(null);
      setPairOrigin(null);
      setComparisonNotice("내 답이 바뀌었어요. 결과 공유하기에서 두 사람 링크를 다시 만들면 고친 답으로 함께 볼 수 있어요.");
    }
    setDraft(previous => ({ ...previous,
      answers: { ...previous.answers, [item.id]: value }, updatedAt: new Date().toISOString() }));
  }
  function next() {
    if (!draft.answers[ITEMS[draft.cursor]?.id]) return;
    if (draft.cursor < ITEMS.length - 1) update({ cursor: draft.cursor + 1 });
    else if (isComplete(draft.answers)) update({ screen: "result" });
  }
  function back() {
    if (draft.cursor > 0) update({ cursor: draft.cursor - 1 });
    else update({ screen: "intro" });
  }

  function toggleAutosave(enabled: boolean) {
    setAutosave(enabled);
    if (enabled) draftChanged.current = true;
    if (!enabled) setSaved(null);
    let success = false;
    try { success = setLikertAutosave(window.localStorage, enabled); } catch { /* 저장소 접근 자체가 막힐 수 있다. */ }
    setCanStore(success);
    // 설정 켜기는 원본 보호를 해제하지 않는다. 실제 삭제가 확인된 때만 새 답을 저장한다.
    if (success && !enabled) { setProtectedDraft(false); setNotice(""); }
    setStorageStatus(success ? enabled ? protectedDraft
      ? "자동 저장 설정은 켰지만, 확인하지 못한 기존 기록은 덮어쓰지 않아요. 아래에서 이 개편본의 저장과 현재 답을 지운 뒤 새 답을 저장할 수 있어요."
      : "이 개편본의 자동 저장을 켰어요." : "이 개편본의 저장된 답을 지우고 자동 저장을 껐어요. 현재 화면의 답은 남아 있어요."
      : "브라우저 저장 설정을 확인하지 못했어요. 자동 저장을 멈췄어요. 공용 기기라면 브라우저의 사이트 데이터도 확인해 주세요.");
  }

  function clearOwnDraft() {
    let success = false;
    try { success = clearLikertDraft(window.localStorage); } catch { /* 저장소 접근 자체가 막힐 수 있다. */ }
    if (!success) {
      setCanStore(false);
      setStorageStatus("저장된 답을 지우지 못했어요. 자동 저장을 멈췄어요. 브라우저의 사이트 데이터 설정에서 확인해 주세요.");
      return;
    }
    setSaved(null);
    draftChanged.current = false;
    setActive(false);
    setDraft(createDraft());
    setSharing(false);
    if (pairOrigin !== "link") { setPair(null); setPairOrigin(null); }
    setCanStore(true);
    setProtectedDraft(false);
    setNotice("");
    setExpressionNotice("");
    setStorageStatus("이 개편본의 저장과 현재 답을 지웠어요. 받은 링크에 담긴 답과 이미 전달한 링크는 그대로예요.");
  }

  return <main className="min-h-screen bg-[var(--ivory-50)] text-[var(--noir-900)]"
    data-wedding-code-version={MEASUREMENT_VERSION} data-expression-version={EXPRESSION_VERSION}>
    <header className="border-b border-[var(--ivory-200)] bg-[var(--ivory-50)]">
      <div className="mx-auto flex min-h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Button variant="ghost" type="button" className="min-h-11 flex-col items-start! gap-0! whitespace-normal! rounded-xl px-0! text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hb-primary)]"
          onClick={() => update({ screen: "intro" })} aria-label="웨딩코드 시작 화면으로">
          <span className="block text-lg font-bold tracking-tight">WeddingCode<span className="ml-1 text-[var(--hb-primary)]">.</span></span>
          <span className="block text-[11px] tracking-[0.14em] text-[var(--taupe-500)]">나와 우리의 준비</span>
        </Button>
        {draft.screen === "questions" ? <Button variant="ghost" type="button" onClick={() => update({ screen: "intro" })}
          className="min-h-11 whitespace-normal! rounded-xl px-3 text-sm text-[var(--taupe-500)] hover:bg-[var(--ivory-100)] focus-visible:outline-2 focus-visible:outline-[var(--hb-primary)]">잠깐 쉬기</Button>
          : <span className="text-xs text-[var(--taupe-500)]">웨딩한방</span>}
      </div>
    </header>

    {!loaded ? <div className="mx-auto max-w-3xl px-5 py-24 text-center" role="status">내 준비 이야기를 열고 있어요.</div> : <>
      {draft.screen === "intro" ? <div data-testid="wc-intro">
        <IntroPanel onStart={start} onResume={resumable ? resume : undefined}
          savedAnswered={resumable ? answeredCount(resumable.answers) : undefined} total={ITEMS.length}
          invite={Boolean(inviter)} storageNotice={[notice, expressionNotice, linkNotice].filter(Boolean).join(" ")} />
        {pair ? <div className="mx-auto max-w-3xl px-5 pb-12"><Button variant="ghost" type="button" onClick={() => update({ screen: "compare" })}
          className="min-h-12 w-full whitespace-normal! rounded-2xl border border-[var(--hb-primary)] px-5 py-3 text-sm font-semibold text-[var(--hb-primary)]">링크에 담긴 두 사람 결과 다시 보기</Button></div> : null}
      </div> : null}

      {draft.screen === "questions" && ITEMS[draft.cursor] ? <section data-testid="wc-question">
        <QuestionPanel item={ITEMS[draft.cursor]} answer={draft.answers[ITEMS[draft.cursor].id]}
          index={draft.cursor} total={ITEMS.length} answered={count} onAnswer={answer}
          onBack={back} onNext={next} onPause={() => update({ screen: "intro" })}
          canNext={Boolean(draft.answers[ITEMS[draft.cursor].id])} />
        {isComplete(draft.answers) ? <div className="mx-auto max-w-3xl px-5 pb-8 text-center"><Button variant="ghost" type="button"
          onClick={() => update({ screen: "result" })} className="min-h-11 whitespace-normal! rounded-xl px-4 text-sm font-medium text-[var(--hb-primary)] underline underline-offset-4">고친 답으로 결과 돌아가기</Button></div> : null}
        {notice && (!canStore || protectedDraft) ? <p className="mx-auto max-w-3xl px-5 pb-6 text-sm text-[var(--taupe-500)]" role="status">{notice}</p> : null}
      </section> : null}

      {draft.screen === "result" ? <section ref={resultRef} data-testid="wc-result">
        {expressionNotice ? <p className="mx-auto max-w-4xl px-5 pt-6 text-sm leading-7 text-[var(--hb-text-body)] sm:px-8" role="status" data-testid="wc-expression-correction">{expressionNotice}</p> : null}
        {comparisonNotice ? <p className="mx-auto max-w-4xl px-5 pt-6 text-sm leading-7 text-[var(--hb-text-body)] sm:px-8" role="status">{comparisonNotice}</p> : null}
        <PersonalReport result={result} onEdit={() => { setSharing(false); update({ screen: "questions", cursor: 0 }); }}
          onShare={() => setSharing(true)} onCompare={pair ? () => update({ screen: "compare" }) : undefined} />
        {sharing ? <div ref={shareRef} className="mx-auto max-w-4xl scroll-mt-6 px-5 pb-16 sm:px-8" data-testid="wc-sharing">
          <SharingPanel answers={draft.answers} inviter={inviter}
            onReady={value => { setPair(value); setPairOrigin("session"); setComparisonNotice(""); }} onCompare={() => update({ screen: "compare" })} />
        </div> : null}
      </section> : null}

      {draft.screen === "compare" && couple ? <section ref={comparisonRef} data-testid="wc-comparison">
        {linkNotice ? <p className="mx-auto max-w-6xl px-5 pt-6 text-sm leading-7 text-[var(--hb-text-body)] sm:px-8" role="status" data-testid="wc-expression-correction">{linkNotice}</p> : null}
        <CoupleReport result={couple} onBack={() => update({ screen: isComplete(draft.answers) ? "result" : "intro" })} />
      </section> : null}
    </>}
    {loaded ? <section className="mx-auto max-w-4xl border-t border-[var(--hb-summary-line)] px-5 py-7 text-sm text-[var(--hb-text-body)] sm:px-8" aria-label="이 브라우저의 답 저장">
      <label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" checked={autosave}
        onChange={event => toggleAutosave(event.target.checked)} className="size-5 accent-[var(--hb-primary)]" />이 브라우저에 내 답 자동 저장</label>
      <p className="mt-2 text-xs leading-6">본인 답과 진행 위치를 마지막 저장부터 30일 동안 이어서 볼 수 있어요. 재방문이나 이어서 보기만 해서는 기간을 늘리지 않아요. 서버·계정에 저장하지 않으며, 상대 답은 저장하지 않아요. 끄면 이 개편본의 저장된 답을 지우고 현재 화면의 답은 유지해요.</p>
      <Button variant="ghost" onClick={clearOwnDraft} className="mt-2 whitespace-normal! text-left underline underline-offset-4">이 개편본의 저장과 현재 답 지우기</Button>
      {storageStatus ? <p className="mt-2 text-xs leading-6" role="status">{storageStatus}</p> : null}
      <a href="/privacy" className="mt-2 inline-flex min-h-11 items-center text-xs underline underline-offset-4">개인정보 처리 안내</a>
    </section> : null}
    <footer className="mx-auto max-w-6xl px-5 py-8 text-center text-xs leading-6 text-[var(--taupe-500)]">
      내 답에서 시작하는 결혼 준비 대화 · 웨딩한방
    </footer>
  </main>;
}

function SharingPanel({ answers, inviter, onReady, onCompare }: {
  answers: Draft["answers"]; inviter?: Snapshot; onReady: (pair: Pair) => void; onCompare: () => void;
}) {
  const [answerConsent, setAnswerConsent] = useState(false);
  const [linkConsent, setLinkConsent] = useState(false);
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const complete = isComplete(answers);

  function generate() {
    if (!answerConsent || !linkConsent || !complete) return;
    try {
      const own = createSnapshot(answers);
      const generated = buildShareUrl(window.location.origin, inviter ?? own, inviter ? own : undefined);
      if (!generated) throw new Error("Share unavailable");
      setUrl(generated);
      if (inviter) onReady({ first: inviter, second: own });
      setNotice("링크를 만들었어요. 아직 누구에게도 보내지 않았어요.");
    } catch { setNotice("이번 답으로 링크를 만들지 못했어요. 질문의 응답 상태를 확인해 주세요."); }
  }
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setNotice("복사했어요. 함께 볼 사람에게 직접 전달해 주세요.");
    } catch { setNotice("자동 복사가 어려워요. 아래 주소를 선택해 직접 복사할 수 있어요."); }
  }

  return <section className="rounded-3xl border border-[var(--hb-summary-line)] bg-[var(--hb-summary-surface)] p-6 sm:p-8" aria-labelledby="likert-share-title">
    <p className="text-xs font-semibold tracking-widest text-[var(--hb-summary-label)]">함께 보기</p>
    <h2 id="likert-share-title" className="mt-3 text-2xl font-bold tracking-tight">{inviter ? "내 답도 담아 두 사람 함께 보기" : "각자의 답으로 더 가까운 대화"}</h2>
    <p className="mt-3 text-sm leading-7 text-[var(--hb-summary-ink)]">{inviter
      ? "받은 답과 내 답을 나란히 볼 링크를 만들어요. 먼저 답한 사람에게 직접 돌려줄 수 있어요."
      : "내 답이 담긴 초대 링크를 만들어요. 상대가 자신의 답을 풀고 두 사람 링크를 돌려주면 함께 볼 수 있어요."}</p>
    <ol className="mt-4 space-y-2 text-sm leading-7 text-[var(--hb-summary-ink)]">
      {(inviter ? ["1. 내 답까지 마치고 두 사람 링크를 만들어요.", "2. 여기서 두 사람의 답을 바로 나란히 볼 수 있어요.", "3. 먼저 답한 사람에게 링크를 직접 돌려줘요."]
        : ["1. 내 답이 담긴 초대 링크를 만들어 직접 보내요.", "2. 상대가 링크를 열고 자기 답을 남겨요.", "3. 상대가 두 사람 결과 링크를 돌려주면 함께 읽어요."]).map(step => <li key={step}>{step}</li>)}
    </ol>
    <p className="mt-2 text-xs leading-6 text-[var(--hb-summary-label)]">로그인이나 초대 코드 입력은 필요 없어요. 답이나 결과가 상대에게 자동으로 도착하지는 않아요.</p>
    <p className="mt-4 text-sm leading-7 text-[var(--hb-summary-ink)]">링크를 받은 사람은 고른 답과 모름·해당 없음·건너뛴 상태를 볼 수 있어요. 답은 서버에 보내지 않으며, 전달한 링크는 회수할 수 없어요.</p>
    <div className="mt-5 space-y-2">
      <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl p-2 text-sm leading-6"><input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--hb-primary)]"
        checked={answerConsent} onChange={event => { setAnswerConsent(event.target.checked); setUrl(""); }} />내가 남긴 답을 링크를 받은 사람에게 보여주는 데 동의해요.</label>
      <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl p-2 text-sm leading-6"><input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--hb-primary)]"
        checked={linkConsent} onChange={event => { setLinkConsent(event.target.checked); setUrl(""); }} />{inviter ? "두 사람의 답을 담은 링크이며 전달 후 회수할 수 없다는 것을 확인했어요." : "상대가 자기 답을 마친 뒤 두 사람 링크를 돌려줘야 함께 볼 수 있다는 것을 확인했어요."}</label>
    </div>
    {!complete ? <p className="mt-3 text-sm" role="status">남은 질문은 모름·해당 없음으로도 답할 수 있어요. 응답 상태를 모두 확인하면 링크를 만들 수 있어요.</p> : null}
    <Button variant="primary" type="button" onClick={generate} disabled={!answerConsent || !linkConsent || !complete}
      className="mt-5 min-h-12 w-full whitespace-normal! rounded-2xl bg-[var(--hb-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--hb-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hb-primary)] disabled:cursor-not-allowed disabled:opacity-40">
      {inviter ? "두 사람 링크 만들기" : "내 답 담은 초대 링크 만들기"}
    </Button>
    {url ? <div className="mt-5 space-y-3">
      <label htmlFor="likert-share-url" className="block text-sm font-semibold">직접 전달할 링크</label>
      <textarea id="likert-share-url" readOnly value={url} onFocus={event => event.currentTarget.select()}
        className="min-h-24 w-full resize-y rounded-xl border border-[var(--hb-summary-line)] bg-[var(--ivory-50)] p-3 text-xs leading-6 focus:outline-2 focus:outline-[var(--hb-primary)]" />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="ghost" type="button" onClick={copy} className="min-h-12 flex-1 whitespace-normal! rounded-xl border border-[var(--hb-primary)] px-4 py-3 text-sm font-semibold text-[var(--hb-primary)]">링크 복사</Button>
        {inviter ? <Button variant="primary" type="button" onClick={onCompare} className="min-h-12 flex-1 whitespace-normal! rounded-xl bg-[var(--hb-primary)] px-4 py-3 text-sm font-semibold text-white">지금 두 사람 답 함께 보기</Button> : null}
      </div>
    </div> : null}
    <p className="mt-4 min-h-6 text-sm leading-6 text-[var(--hb-summary-ink)]" role="status" aria-live="polite">{notice}</p>
  </section>;
}
