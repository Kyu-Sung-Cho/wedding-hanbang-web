"use client";

// 웨딩코드 wc64(64문항) 화면 흐름: 시작 → 식 질문 → 묶음 안내·문장 → 결과.
// 답은 이 브라우저 안에서만 계산하고, 저장은 wc64/io 함수로만 한다.
// 주소(해시 포함)와 방문 기록은 바꾸지 않는다. 판 라우터가 해시를 보고 다른 판으로 바꾸기 때문이다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { WC64_BANK, isWc64CeremonyOff, wc64ItemById, wc64SectionById } from "@/lib/weddingCode/wc64/bank";
import {
  clearWc64Draft, createWc64Draft, readWc64Autosave, readWc64Draft, setWc64Autosave, writeWc64Draft,
} from "@/lib/weddingCode/wc64/io";
import { buildWc64Report, wc64ConsideredAnswers } from "@/lib/weddingCode/wc64/model";
import type { Wc64Draft, Wc64Plan, Wc64Rating, Wc64Section } from "@/lib/weddingCode/wc64/types";
import Compare64 from "./Compare64";
import Intro64, { Plan64 } from "./Intro64";
import Question64, { Section64 } from "./Question64";
import Report64 from "./Report64";
import { wc64Column, wc64Meta, wc64Page, wc64Quiet, wc64Secondary } from "./styles";

type Step = { type: "section"; sid: string } | { type: "item"; sid: string; id: string };

/** 묶음 순서대로 [묶음 안내, 문장…]을 늘어놓은 흐름. draft.cursor 는 이 배열의 자리다. */
const STEPS: readonly Step[] = WC64_BANK.order.flatMap((sid): Step[] => {
  const sec = wc64SectionById(sid);
  if (!sec) return [];
  return [{ type: "section", sid }, ...sec.items.map((it): Step => ({ type: "item", sid, id: it.id }))];
});

/** 고른 칸이 눌린 것을 보여 주는 시간 */
const PICK_DELAY_MS = 160;

type Flow = Pick<Wc64Draft, "plan" | "skipped">;

function sectionOf(sid: string): Wc64Section {
  return wc64SectionById(sid) as Wc64Section;
}

/** 식을 안 올리는 사람에게 예식 문장을 뺀 이 묶음의 문장 수 */
function nonCeremonyCount(sec: Wc64Section, plan: Wc64Plan | null): number {
  return sec.items.filter((it) => !(plan === "none" && it.skip_tag === "예식")).length;
}

function isVisible(step: Step, flow: Flow): boolean {
  const skipped = flow.skipped ?? {};
  if (step.type === "item") return skipped[step.sid] !== true && !isWc64CeremonyOff(step.id, flow.plan, skipped);
  const sec = sectionOf(step.sid);
  return nonCeremonyCount(sec, flow.plan) > 0 || Boolean(sec.noceremony_alt);
}

/** 지금 보이는 문장 수와 그중 답한(해당 없음 포함) 수 */
function countVisible(draft: Wc64Draft): { done: number; total: number } {
  let done = 0, total = 0;
  for (const step of STEPS) {
    if (step.type !== "item" || !isVisible(step, draft)) continue;
    total++;
    if (draft.answers[step.id] !== undefined) done++;
  }
  return { done, total };
}

/** 보이지 않는 단계를 건너뛰며 앞뒤로 옮긴다. 맨 앞을 넘으면 식 질문, 맨 뒤를 넘으면 결과. */
function moveDraft(draft: Wc64Draft, from: number, delta: 1 | -1): Wc64Draft {
  let j = from + delta;
  while (j >= 0 && j < STEPS.length && !isVisible(STEPS[j], draft)) j += delta;
  if (j < 0) return { ...draft, screen: "plan", cursor: 0 };
  if (j >= STEPS.length) return { ...draft, screen: "result", cursor: STEPS.length - 1 };
  return { ...draft, screen: "questions", cursor: j };
}

/** 이어 할 기록을 지금 흐름에 맞게 고친다(식 답이 없으면 식 질문부터, 안 보이는 자리면 다음 자리로). */
function normalize(draft: Wc64Draft): Wc64Draft {
  const d: Wc64Draft = { ...draft, skipped: draft.skipped ?? {} };
  if (d.plan === null) return { ...d, screen: "plan", cursor: 0 };
  if (d.screen === "intro" || d.screen === "questions") {
    const at = Math.min(Math.max(d.cursor, 0), STEPS.length - 1);
    return isVisible(STEPS[at], d) ? { ...d, cursor: at } : moveDraft(d, at, 1);
  }
  return d;
}

function nowIso(): string {
  return new Date().toISOString();
}

type StorageLike = Storage;

/** localStorage 를 꺼낼 때 예외가 나는 브라우저(사이트 데이터 차단 등)도 있다. */
function storageOrNull(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function focusScreen() {
  try {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    window.scrollTo({ top: 0, left: 0, behavior: reduce ? "instant" : "smooth" });
  } catch { /* 스크롤을 못 해도 화면은 그대로 쓸 수 있다. */ }
  document.querySelector<HTMLElement>("[data-wc64-focus]")?.focus({ preventScroll: true });
}

export default function WeddingCode64Client() {
  const [draft, setDraft] = useState<Wc64Draft>(() => createWc64Draft());
  const [saved, setSaved] = useState<Wc64Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** 시작하거나 이어 한 뒤부터만 저장한다(시작 화면의 빈 기록으로 저장된 답을 덮지 않는다). */
  const [active, setActive] = useState(false);
  const [autosave, setAutosave] = useState(false);
  const [canStore, setCanStore] = useState(true);
  const [status, setStatus] = useState("");
  const [locked, setLocked] = useState(false);
  const timer = useRef<number | null>(null);
  /** 시작 화면에서 이어 할 기록: 이번에 풀던 답이 있으면 그것, 없으면 불러온 기록 */
  const hasProgress = draft.plan !== null || Object.keys(draft.answers).length > 0;
  const resumable: Wc64Draft | null = active ? (hasProgress ? draft : null) : saved;

  useEffect(() => {
    // 브라우저 저장은 첫 화면을 그린 뒤에 읽는다(서버 화면과 어긋나지 않게).
    const frame = window.requestAnimationFrame(() => {
      const storage = storageOrNull();
      if (!storage) {
        setCanStore(false);
        setStatus("이 브라우저에서는 답을 저장하기 어려워요. 지금 탭에서는 계속 풀 수 있어요.");
      } else {
        const on = readWc64Autosave(storage);
        setAutosave(on);
        setSaved(on ? readWc64Draft(storage) : null);
      }
      setLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  // 진행 저장: 자동 저장이 켜져 있을 때만 io 가 쓴다.
  // 저장 시각은 draft.updatedAt 그대로 쓴다. 이 값은 답·식 계획·묶음 넘기기·자리가 바뀔 때(update·start·restart)만
  // 새로 찍히므로, 이어 하기만 누르거나 자동 저장을 다시 켜는 것으로는 30일 보관 기간이 늘지 않는다.
  useEffect(() => {
    if (!loaded || !active || !autosave || !canStore) return;
    const storage = storageOrNull();
    if (!storage) return;
    writeWc64Draft(storage, draft);
  }, [draft, loaded, active, autosave, canStore]);

  useEffect(() => {
    if (loaded) focusScreen();
  }, [loaded, draft.screen, draft.cursor]);

  const update = useCallback((fn: (d: Wc64Draft) => Wc64Draft) => {
    setDraft((d) => ({ ...fn(d), updatedAt: nowIso() }));
  }, []);

  function start() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setLocked(false);
    setStatus("");
    setDraft({ ...createWc64Draft(), screen: "plan" });
    setActive(true);
  }

  function resume() {
    if (!resumable) return;
    setStatus("");
    // 저장본의 마지막 저장 시각을 그대로 둔다(읽거나 다시 열기만 해서는 기간을 늘리지 않는다).
    setDraft(normalize(resumable));
    setActive(true);
  }

  function pickPlan(plan: Wc64Plan) {
    update((d) => moveDraft({ ...d, plan }, -1, 1));
  }

  function back() {
    update((d) => {
      if (d.screen === "plan") return { ...d, screen: "intro" };
      if (d.screen === "result") return moveDraft(d, STEPS.length, -1);
      return moveDraft(d, d.cursor, -1);
    });
  }

  function forward() {
    update((d) => moveDraft(d, d.cursor, 1));
  }

  function beginSection(sid: string, showAlt: boolean) {
    update((d) => {
      const skipped = { ...(d.skipped ?? {}) };
      if (showAlt) skipped[sid] = false;
      else delete skipped[sid];
      return moveDraft({ ...d, skipped }, d.cursor, 1);
    });
  }

  function skipSection(sid: string) {
    update((d) => {
      const answers = { ...d.answers };
      for (const it of sectionOf(sid).items) answers[it.id] = 0;
      return moveDraft({ ...d, answers, skipped: { ...(d.skipped ?? {}), [sid]: true } }, d.cursor, 1);
    });
  }

  function pick(itemId: string, value: Wc64Rating) {
    if (locked) return;
    setLocked(true);
    update((d) => ({ ...d, answers: { ...d.answers, [itemId]: value } }));
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setLocked(false);
      forward();
    }, PICK_DELAY_MS);
  }

  function notApplicable(itemId: string) {
    if (locked) return;
    update((d) => moveDraft({ ...d, answers: { ...d.answers, [itemId]: 0 } }, d.cursor, 1));
  }

  function restart() {
    const storage = storageOrNull();
    if (storage) clearWc64Draft(storage);
    setSaved(null);
    setDraft({ ...createWc64Draft(), screen: "plan" });
    setActive(true);
  }

  function clearAnswers() {
    const storage = storageOrNull();
    const ok = storage ? clearWc64Draft(storage) : false;
    setSaved(null);
    setActive(false);
    setDraft(createWc64Draft());
    setStatus(ok ? "이 브라우저에 저장한 답을 지웠어요." : "저장한 답을 지우지 못했어요. 브라우저의 사이트 데이터 설정에서 확인해 주세요.");
  }

  function toggleAutosave(on: boolean) {
    const storage = storageOrNull();
    const ok = storage ? setWc64Autosave(storage, on) : false;
    setAutosave(on && ok);
    if (!on) setSaved(null);
    setStatus(!ok
      ? "브라우저 저장 설정을 바꾸지 못했어요. 자동 저장은 멈췄어요."
      : on ? "이 브라우저에 자동 저장을 켰어요." : "저장한 답을 지우고 자동 저장을 껐어요. 지금 화면의 답은 남아 있어요.");
  }

  const considered = useMemo(
    () => wc64ConsideredAnswers(draft.answers, draft.plan, draft.skipped ?? {}),
    [draft.answers, draft.plan, draft.skipped],
  );
  const report = useMemo(
    () => (draft.screen === "result" ? buildWc64Report(draft.answers, draft.plan, draft.skipped ?? {}) : null),
    [draft.screen, draft.answers, draft.plan, draft.skipped],
  );
  const progress = countVisible(draft);
  const savedProgress = resumable ? countVisible(resumable) : null;

  let screen: ReactNode = null;
  if (!loaded) {
    screen = <p className="mt-8" role="status">저장된 답을 확인하고 있어요.</p>;
  } else if (draft.screen === "intro") {
    screen = <Intro64 saved={savedProgress} onStart={start} onResume={resume} />;
  } else if (draft.screen === "plan" || draft.plan === null) {
    screen = <Plan64 plan={draft.plan} onPick={pickPlan} onBack={back} />;
  } else if (draft.screen === "questions") {
    const step = STEPS[draft.cursor];
    if (step?.type === "section") {
      const sec = sectionOf(step.sid);
      const showAlt = draft.plan === "none" && Boolean(sec.noceremony_alt);
      const count = showAlt ? sec.items.length : nonCeremonyCount(sec, draft.plan);
      screen = (
        <Section64 key={`s-${sec.id}`} section={sec} count={count} showAlt={showAlt} progress={progress}
          onBack={back} onStart={() => beginSection(sec.id, showAlt)}
          onSkipAll={showAlt || sec.skip_all ? () => skipSection(sec.id) : undefined} />
      );
    } else if (step?.type === "item") {
      const item = wc64ItemById(step.id);
      if (item) {
        screen = (
          <Question64 key={`i-${item.id}`} item={item} section={sectionOf(step.sid)} answer={draft.answers[item.id]}
            locked={locked} progress={progress} onPick={(v) => pick(item.id, v)}
            onNotApplicable={() => notApplicable(item.id)} onBack={back} />
        );
      }
    }
  } else if (draft.screen === "result" && report && draft.plan) {
    screen = (
      <div className="mt-3 flex min-w-0 flex-col gap-4" data-wc64-screen="result">
        <Report64 report={report} answers={considered} plan={draft.plan} skipped={draft.skipped ?? {}}
          compareSlot={<Compare64 myAnswers={considered} myPlan={draft.plan} mySkipped={draft.skipped ?? {}} />}
          onRestart={restart} onClearAnswers={clearAnswers} />
        <div>
          <Button type="button" variant="secondary" size="md" onClick={back} className={wc64Secondary}>마지막 문장으로</Button>
        </div>
      </div>
    );
  }

  return (
    <main className={wc64Page} data-wedding-code-version={WC64_BANK.meta.version}>
      <div className={wc64Column}>
        {screen}
        {status ? <p className={`mt-6 ${wc64Meta}`} role="status">{status}</p> : null}
        {loaded && draft.screen !== "result" ? (
          <section className="mt-10 border-t border-[#E2DED2] pt-5" aria-label="이 브라우저의 답 저장">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[#5A4742]">
              <input type="checkbox" checked={autosave} disabled={!canStore}
                onChange={(e) => toggleAutosave(e.target.checked)} className="size-5 accent-[#8F6662]" />
              이 브라우저에 내 답 자동 저장
            </label>
            <p className={`mt-1 ${wc64Meta}`}>
              답은 이 브라우저에만 두고, 마지막 저장부터 30일 동안 이어 할 수 있어요. 서버로 보내지 않아요. 끄면 저장한 답을 바로 지워요.
            </p>
            <Button type="button" variant="secondary" size="md" onClick={clearAnswers} className={`mt-1 ${wc64Quiet} px-0!`}>
              답 지우기
            </Button>
          </section>
        ) : null}
      </div>
    </main>
  );
}
