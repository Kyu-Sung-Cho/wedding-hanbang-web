"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { MEASUREMENT_VERSION } from "@/lib/weddingCode/likert/types";
import { INTRO, ITEMS21, VERSIONS, createEmptyAnswers } from "@/lib/weddingCode/preferences21/bank";
import { buildReport } from "@/lib/weddingCode/preferences21/report";
import { clearPreferences21Progress, getPreferences21StorageSnapshot, PREFERENCES21_AUTOSAVE_KEY, PREFERENCES21_STORAGE_KEY, readPreferences21Autosave, readPreferences21Progress, setPreferences21Autosave, writePreferences21Progress, type Preferences21Progress } from "@/lib/weddingCode/preferences21/storage";
import { parsePreferences21ShareFragment, type Preferences21SharePayload } from "@/lib/weddingCode/preferences21/share";
import { comparePreferences21Responses } from "@/lib/weddingCode/preferences21/compare";
import type { Answers, ItemId, Response } from "@/lib/weddingCode/preferences21/types";
import PreferenceQuestion from "./PreferenceQuestion";
import PreferenceReport from "./PreferenceReport";
import PreferenceSharing from "./PreferenceSharing";
import { ACTION, FOCUS, PANEL, TEXT } from "./styles";

type Screen = "intro" | "questions" | "result";

export default function Preferences21Client() {
  const [answers, setAnswers] = useState<Answers>(createEmptyAnswers);
  const [position, setPosition] = useState(0);
  const [screen, setScreen] = useState<Screen>("intro");
  const [ready, setReady] = useState(false);
  const [autosave, setAutosave] = useState(false);
  const [saved, setSaved] = useState<Preferences21Progress | null>(null);
  const [blockedSave, setBlockedSave] = useState(false);
  const [notice, setNotice] = useState("");
  const [shared, setShared] = useState<Preferences21SharePayload | null>(null);
  const [linkNotice, setLinkNotice] = useState("");
  const [replaceRequested, setReplaceRequested] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  const storageSnapshot = useRef<string | null | undefined>(undefined);
  const report = useMemo(() => buildReport(answers), [answers]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stored = readPreferences21Progress();
      storageSnapshot.current = getPreferences21StorageSnapshot();
      if (stored.status === "ready") { setSaved(stored.progress); setAutosave(readPreferences21Autosave()); }
      else { setAutosave(false); setBlockedSave(stored.status === "invalid" || stored.status === "expired" || storageSnapshot.current === undefined); }
      setNotice(stored.notice);
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!shared) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = shared.expiresAt - Date.now();
      if (remaining <= 0) { setShared(null); setLinkNotice("이 공유 링크가 만료돼 내용을 닫았어요. 보낸 사람에게 새 링크를 부탁해 주세요."); setRevision((value) => value + 1); }
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    return () => clearTimeout(timer);
  }, [shared]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PREFERENCES21_STORAGE_KEY && event.key !== PREFERENCES21_AUTOSAVE_KEY) return;
      if (getPreferences21StorageSnapshot() !== storageSnapshot.current || !readPreferences21Autosave()) {
        setAutosave(false); setBlockedSave(true); setSaved(null);
        setNotice("다른 탭에서 저장을 바꿨어요. 지금 탭의 답은 그대로 두고 자동 저장을 멈췄어요. 새로고침하면 현재 브라우저 저장을 다시 확인할 수 있어요. 이 탭의 답을 이어보거나, 저장 지우기를 직접 선택해 주세요.");
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  useEffect(() => {
    const readLink = () => {
      const result = parsePreferences21ShareFragment(window.location.hash);
      setShared(result.status === "ready" ? result.payload : null);
      setLinkNotice(result.status === "absent" ? "" : result.notice);
      if (result.status === "absent" && /(?:wc-likert|wc-profile|[&#]v=|[&#]a=)/u.test(window.location.hash)) setLinkNotice("이 주소에는 다른 판의 답이 담겨 있어요. 21문항으로 해석하지 않았어요. 기존 결과는 ‘기존 30문항·캐릭터 결과’에서 원래 링크로 열어 주세요.");
      setRevision((value) => value + 1);
    };
    const frame = requestAnimationFrame(readLink);
    window.addEventListener("hashchange", readLink);
    window.addEventListener("popstate", readLink);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", readLink); window.removeEventListener("popstate", readLink); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (screen !== "questions") (document.getElementById(screen === "result" ? "p21-report-heading" : "p21-intro-heading") ?? anchor.current)?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [screen, ready]);

  const persist = (next: Answers, nextPosition: number, enabled = autosave) => {
    if (!enabled || blockedSave) return;
    if (storageSnapshot.current === undefined) { setAutosave(false); setBlockedSave(true); setNotice("브라우저 저장 상태를 확인하지 못해 덮어쓰지 않았어요. 지금 탭의 답은 계속 볼 수 있어요."); return; }
    const result = writePreferences21Progress({ answers: next, position: nextPosition }, { enabled, expectedRaw: storageSnapshot.current });
    setNotice(result.notice);
    if (result.status === "saved" && result.answerWrittenAt !== undefined) { storageSnapshot.current = getPreferences21StorageSnapshot(); setSaved({ answers: next, position: nextPosition, answerWrittenAt: result.answerWrittenAt }); }
    if (result.status === "conflict") { setAutosave(false); setBlockedSave(true); setSaved(null); }
  };
  const toggleSave = (enabled: boolean) => {
    if (blockedSave && enabled) return;
    if (enabled && getPreferences21StorageSnapshot() !== storageSnapshot.current) { setAutosave(false); setBlockedSave(true); setNotice("다른 탭의 새 저장을 발견해 저장 허용을 켜지 않았어요. 지금 답은 이 탭에 남아요."); return; }
    const result = setPreferences21Autosave(enabled);
    setAutosave(result.status === "saved" && result.enabled);
    setNotice(result.notice);
    if (!enabled) { setSaved(null); storageSnapshot.current = getPreferences21StorageSnapshot(); }
    if (!enabled && result.status === "unavailable") setBlockedSave(true);
    if (result.status === "saved" && enabled && screen !== "intro") persist(answers, position, true);
  };
  const begin = () => {
    if ((saved || report.counts.responded > 0) && !replaceRequested) { setReplaceRequested(true); return; }
    const next = createEmptyAnswers();
    setAnswers(next); setPosition(0); setScreen("questions"); setEditing(false); setReplaceRequested(false); setRevision((value) => value + 1);
    persist(next, 0);
  };
  const resume = () => {
    if (!saved) return;
    setAnswers({ ...saved.answers }); setPosition(saved.position); setEditing(false); setRevision((value) => value + 1);
    setScreen(ITEMS21.every((item) => saved.answers[item.id] !== null) ? "result" : "questions");
  };
  const answer = (value: Response) => {
    const next = { ...answers, [ITEMS21[position].id]: value };
    setAnswers(next); setRevision((current) => current + 1); persist(next, position);
  };
  const move = (nextPosition: number) => { setPosition(nextPosition); persist(answers, nextPosition); };
  const edit = (id: ItemId) => { setPosition(ITEMS21.findIndex((item) => item.id === id)); setEditing(true); setScreen("questions"); };
  const removeSaved = () => {
    const result = clearPreferences21Progress(); setNotice(result.notice);
    if (result.status === "cleared") { setSaved(null); setBlockedSave(false); setAutosave(false); setPreferences21Autosave(false); storageSnapshot.current = getPreferences21StorageSnapshot(); }
  };
  const clearReceived = () => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setShared(null); setLinkNotice(""); setRevision((value) => value + 1);
  };
  const invitation = shared?.kind === "partner-invitation" ? shared : null;
  // 비교 함수에는 정확한 버전 세 필드만 전달한다. 링크 헤더를 버전 객체로 취급하지 않는다.
  const comparisonVersions = (value: typeof VERSIONS) => ({ questionnaireVersion: value.questionnaireVersion, interpretationVersion: value.interpretationVersion, displayVersion: value.displayVersion });
  const safeComparison = shared?.kind === "partner-return"
    ? comparePreferences21Responses({ versions: comparisonVersions(shared.first), answers: shared.first.answers }, { versions: comparisonVersions(shared.second), answers: shared.second.answers })
    : screen === "result" && invitation
      ? comparePreferences21Responses({ versions: VERSIONS, answers }, { versions: comparisonVersions(invitation), answers: invitation.answers }) : null;

  return <main className="min-h-screen bg-[var(--ivory-50)] font-[family-name:var(--font-pretendard)] text-[var(--hb-text-strong)]" data-wedding-code-version={VERSIONS.questionnaireVersion}>
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <div ref={anchor} tabIndex={-1} className="outline-none">
        <nav aria-label="웨딩코드" className="mb-8 flex flex-wrap items-center justify-between gap-3 text-sm">
          <Button href="/" variant="ghost" className={ACTION}>웨딩한방</Button>
          <a href={`/wedding-code?v=${MEASUREMENT_VERSION}`} className={`inline-flex items-center justify-center font-semibold text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)] ${ACTION} ${FOCUS}`}>기존 30문항 · 캐릭터 결과</a>
        </nav>
      </div>
      {linkNotice && <section className={`mb-6 ${PANEL}`} aria-label="받은 링크 안내"><p className={TEXT}>{linkNotice}</p>{shared && <p className={`mt-2 ${TEXT}`}>링크에 적힌 답을 읽는 자료예요. 이 링크를 만든 사람의 신원이나 각 답의 작성자·동의 여부를 앱이 인증한 것은 아니에요. 두 사람이 직접 확인해 주세요.</p>}<Button className={`mt-3 ${ACTION}`} onClick={clearReceived}>받은 링크 닫기</Button></section>}
      {shared?.kind === "summary" && <section className={`mb-6 ${PANEL}`}>
        <p className="text-xs font-semibold tracking-widest">SHARED PREPARATION NOTES</p>
        <h1 className="mt-3 text-2xl font-semibold">{shared.card.headline}</h1><p className={`mt-3 ${TEXT}`}>{shared.card.summary}</p>
        <ul className={`mt-3 list-disc space-y-2 pl-5 ${TEXT}`}>{shared.card.lines.map((line) => <li key={line.itemId}>{line.text}</li>)}</ul>
        <p className={`mt-4 ${TEXT}`}>공유한 사람의 선호 요약이에요. 아래에서는 나의 답으로 따로 시작할 수 있어요.</p>
      </section>}
      {screen === "intro" && <section className={PANEL}>
        <p className="text-xs font-semibold tracking-[0.18em]">WEDDING CODE · 21 QUESTIONS</p>
        <h1 id="p21-intro-heading" tabIndex={-1} className="mt-4 text-4xl font-semibold leading-tight tracking-tight outline-none sm:text-5xl">준비를 함께할 때,<br />나에게 편한 방식은?</h1>
        <div className={`mt-6 space-y-2 ${TEXT}`}>{INTRO.map((line) => <p key={line}>{line}</p>)}</div>
        <p className={`mt-4 ${TEXT}`}>돈을 쓰는 기준, 결정하는 방식, 가족 의견, 준비 후 받고 싶은 도움. 네 장면에서 내 답의 이유와 함께 이야기할 말을 살펴봐요.</p>
        <p className={`mt-3 ${TEXT}`}>로그인 없이 21문항에 답해요. 이번 판은 문항별 선호를 읽는 초기 버전이에요. 네 레터·16캐릭터 연결은 아직 확정하지 않았으며, 기존 30문항 결과와 점수를 섞지 않아요.</p>
        {invitation && <p className={`mt-4 font-semibold ${TEXT}`}>파트너가 같은 문항에 초대했어요. 받은 답은 내 답으로 저장하지 않아요. 먼저 내 기준으로 답한 뒤 둘의 원답을 비교해요.</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {report.counts.responded > 0 && <Button disabled={!ready} variant="primary" className={ACTION} onClick={() => setScreen(report.counts.responded === 21 ? "result" : "questions")}>지금 탭의 내 답 계속 보기 · {report.counts.responded}/21</Button>}
          {saved && <Button disabled={!ready} variant="primary" className={ACTION} onClick={resume}>저장한 내 답 이어보기 · {ITEMS21.filter((item) => saved.answers[item.id] !== null).length}/21</Button>}
          <Button disabled={!ready} variant={saved || report.counts.responded > 0 ? "secondary" : "primary"} className={ACTION} onClick={begin}>{saved || report.counts.responded > 0 ? "새 답 시작" : "21문항 시작하기"}</Button>
        </div>
        {replaceRequested && <div className="mt-4 rounded-xl border border-[var(--hb-hairline)] p-4" role="alert"><p className={TEXT}>지금 탭의 답을 새로 시작해요. 저장을 켜 둔 경우 이 브라우저의 이전 21문항 답도 새 답으로 바꿔요. 이미 보낸 링크는 바뀌지 않아요.</p><div className="mt-3 flex flex-wrap gap-2"><Button className={ACTION} onClick={begin}>이전 답을 새 답으로 바꾸고 시작</Button><Button className={ACTION} onClick={() => setReplaceRequested(false)}>취소</Button></div></div>}
      </section>}
      {screen === "questions" && <>
        {editing && <Button className={`mb-4 ${ACTION}`} onClick={() => { setScreen("result"); setEditing(false); }}>수정 중인 답으로 결과 돌아가기</Button>}
        <PreferenceQuestion key={ITEMS21[position].id} editing={editing} position={position} value={answers[ITEMS21[position].id]} responded={report.counts.responded} onAnswer={answer} onBack={() => move(Math.max(0, position - 1))} onNext={() => { if (answers[ITEMS21[position].id] === null) return; if (editing || position === 20) { setScreen("result"); setEditing(false); } else move(position + 1); }} onPause={() => setScreen("intro")} />
      </>}
      {screen === "result" && <div className="space-y-6"><PreferenceReport report={report} onEdit={edit} /><PreferenceSharing key={revision} answers={answers} invitation={invitation} /></div>}
      {safeComparison && <section className={`mt-6 ${PANEL}`} data-testid="p21-comparison">
        <h2 className="text-2xl font-semibold">같은 문항에 고른 두 사람의 답</h2><p className={`mt-3 ${TEXT}`}>{safeComparison.notice}</p>
        {safeComparison.status === "ready" && <>
          <p className={`mt-3 ${TEXT}`}>{shared?.kind === "partner-return" ? "왼쪽은 최초 초대의 답, 오른쪽은 돌아온 답이에요. 이 링크가 누구의 기기에서 열렸는지는 알 수 없으며, 내 개인 답으로 저장하지 않아요." : "왼쪽은 이번에 내가 고른 답, 오른쪽은 초대 링크의 답이에요."}</p>
          <p className={`mt-2 ${TEXT}`}>같은 1–5 답 {safeComparison.sameNumeric}문항 · 다른 1–5 답 {safeComparison.differentNumeric}문항. 모름·해당 없음·답하지 않음·미응답은 숫자로 비교하지 않아요. 궁합이나 우열 점수가 아니에요.</p>
          <div className="mt-4 divide-y divide-[var(--hb-hairline)]">{safeComparison.rows.map((row) => <details key={row.itemId} className="py-3"><summary className={`min-h-12 cursor-pointer py-2 text-sm leading-6 ${FOCUS}`}><strong>{Number(row.itemId.slice(1))}. {row.statement}</strong><br />{row.ownLabel} / {row.partnerLabel}</summary><div className={`mt-3 space-y-3 ${TEXT}`}><p>{row.context}</p><p><strong>함께 확인</strong><br />{row.question}</p><p><strong>다음에 해볼 일</strong><br />{row.action}</p></div></details>)}</div>
        </>}
      </section>}
      <section className={`mt-6 ${PANEL}`} aria-label="내 답 저장 설정">
        <label className={`flex min-h-12 items-start gap-3 ${TEXT}`}><input type="checkbox" disabled={!ready || blockedSave} checked={autosave} onChange={(event) => toggleSave(event.target.checked)} className={`mt-2 size-5 shrink-0 ${FOCUS}`} /><span>이 브라우저에 본인 답을 저장해 이어보기<br />마지막 답 저장부터 30일. 공용 기기라면 꺼 두세요. 로그인한 계정에 동기화하지 않아요.</span></label>
        <p role="status" className={`mt-2 ${TEXT}`}>{notice}</p>
        {(saved || blockedSave) && <Button className={`mt-3 ${ACTION}`} onClick={removeSaved}>이 브라우저의 21문항 저장 지우기</Button>}
      </section>
      <footer className={`mt-8 ${TEXT}`}><p>내 답을 읽는 초기 버전 · 문항 {VERSIONS.questionnaireVersion}</p><details><summary className={`min-h-12 cursor-pointer py-3 ${FOCUS}`}>이 결과의 판 정보</summary><p>해석 {VERSIONS.interpretationVersion}<br />표현 {VERSIONS.displayVersion}</p></details></footer>
    </div>
  </main>;
}
