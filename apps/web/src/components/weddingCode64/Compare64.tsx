"use client";

// 둘이 같이 보기: 서버 없이 '답 코드'를 주고받아 두 사람의 답을 나란히 놓는다.
// 상대 답은 이 화면의 state 에만 있고 저장소·주소·서버 어디에도 쓰지 않는다.
// 점수 합치기·일치율·잘 맞는지 판정은 만들지 않는다. 같은 답과 다른 답, 갈린 글자에서 할 대화만 보여 준다.
import { useMemo, useRef, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { WC64_BANK, WC64_DIMS, WC64_ITEMS } from "@/lib/weddingCode/wc64/bank";
import { axis, buildWc64Report, isWc64Rating, wc64ConsideredAnswers } from "@/lib/weddingCode/wc64/model";
import { decodeWc64PairCode, encodeWc64PairCode, normalizeWc64PairCode } from "@/lib/weddingCode/wc64/pairCode";
import type {
  Wc64Answers, Wc64Dim, Wc64DimResult, Wc64Item, Wc64Plan, Wc64Rating, Wc64Report, Wc64Section, Wc64Skipped,
} from "@/lib/weddingCode/wc64/types";
import {
  LEVEL_TEXT, bodyClass, cardClass, h2Class, h3Class, kickerClass, metaClass, noteClass,
  primaryButtonClass, secondaryButtonClass,
} from "./reportStyles";

export interface Compare64Props {
  myAnswers: Wc64Answers;
  myPlan: Wc64Plan | null;
  /** 묶음 넘기기 상태(없으면 {}). 내 결과 화면과 같은 값을 넘겨야 상대가 보는 내 결과도 같다. */
  mySkipped?: Wc64Skipped;
}

interface Person {
  answers: Wc64Answers;
  plan: Wc64Plan | null;
  skipped: Wc64Skipped;
  report: Wc64Report;
  considered: Wc64Answers;
}

function person(answers: Wc64Answers, plan: Wc64Plan | null, skipped: Wc64Skipped): Person {
  return {
    answers, plan, skipped,
    report: buildWc64Report(answers, plan, skipped),
    considered: wc64ConsideredAnswers(answers, plan, skipped),
  };
}

const ME = "나";
const THEM = "상대";
const SCALE = WC64_BANK.meta.scale;
// 코드는 하이픈에서만 줄을 바꾼다(묶음 여섯 글자가 둘로 쪼개지지 않게). 고정폭 글꼴과 자간은 값에만 주고,
// 안내 글(placeholder)은 보통 글꼴로 둔다.
const textareaClass =
  "w-full min-w-0 resize-none break-normal [overflow-wrap:normal] [word-break:normal] rounded-lg border border-[var(--hb-hairline)] bg-white px-3 py-2.5 font-mono text-[13px] leading-6 tracking-wide text-[var(--hb-text-strong)] placeholder:font-sans placeholder:tracking-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]";

/* ---------------- 계산(화면용) ---------------- */

/**
 * 막대 왼쪽 끝에 둘 쪽. 리포트의 글자 장(LetterChapter64)과 같게 글자 앞쪽(letter_a)이 가리키는 쪽을 왼쪽에 둔다.
 * 묶음이 글자에 거꾸로 붙어 있으면(a_is = "B") pole_b 가 왼쪽이다. 글자 밖 묶음(FUND)은 pole_a 그대로.
 */
function leftPole(sec: Wc64Section): "A" | "B" {
  for (const d of WC64_DIMS) {
    const f = d.facets.find(x => x.axis === sec.id);
    if (f) return f.a_is;
  }
  return "A";
}

/** 한 묶음의 왼쪽 끝 %. 두 쪽 문장에 모두 답이 있어야 낸다. */
function sectionPctLeft(sec: Wc64Section, considered: Wc64Answers): number | null {
  const left = leftPole(sec);
  const xs: number[] = [], ys: number[] = [];
  for (const it of sec.items) {
    const v = considered[it.id];
    if (isWc64Rating(v)) (it.pole === left ? xs : ys).push(v);
  }
  const a = axis(xs, ys);
  if (!a) return null;
  return a.N >= 0 ? a.shown : 100 - a.shown;
}

interface SectionRow { sec: Wc64Section; mine: number | null; theirs: number | null; gap: number | null }

function sectionRows(me: Person, them: Person): SectionRow[] {
  const rows = WC64_BANK.sections.filter(s => s.kind === "bipolar").map(sec => {
    const mine = sectionPctLeft(sec, me.considered);
    const theirs = sectionPctLeft(sec, them.considered);
    return { sec, mine, theirs, gap: mine !== null && theirs !== null ? Math.abs(mine - theirs) : null };
  });
  // 차이가 큰 순. 한쪽이라도 %가 없으면 맨 뒤(원래 순서 유지).
  return rows
    .map((r, i) => ({ r, i }))
    .sort((p, q) => (q.r.gap ?? -1) - (p.r.gap ?? -1) || p.i - q.i)
    .map(x => x.r);
}

interface ItemPair { item: Wc64Item; mine: Wc64Rating; theirs: Wc64Rating }

function itemPairs(me: Person, them: Person): { apart: ItemPair[]; same: ItemPair[] } {
  const apart: { p: ItemPair; i: number }[] = [];
  const same: ItemPair[] = [];
  WC64_ITEMS.forEach((item, i) => {
    const a = me.considered[item.id], b = them.considered[item.id];
    if (!isWc64Rating(a) || !isWc64Rating(b)) return;
    if (Math.abs(a - b) >= 2) apart.push({ p: { item, mine: a, theirs: b }, i });
    else if (a === b) same.push({ item, mine: a, theirs: b });
  });
  apart.sort((p, q) => Math.abs(q.p.mine - q.p.theirs) - Math.abs(p.p.mine - p.p.theirs) || p.i - q.i);
  return { apart: apart.map(x => x.p), same };
}

function undecidedText(r: Extract<Wc64DimResult, { decided: false }>): string {
  return r.reason === "no-ceremony"
    ? "식을 올리지 않기로 해서 이 글자는 정하지 않았어요."
    : "답한 문장이 모자라 이 글자는 정하지 않았어요.";
}

/* ---------------- 그림 ---------------- */

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** 한 막대에 두 사람 점. 왼쪽 끝이 앞쪽(pctLeft = 100). '나' 이름표는 위, '상대' 이름표는 아래. */
function PairBar({ mine, theirs, label }: { mine: number | null; theirs: number | null; label: string }) {
  const pos = (pctLeft: number) => clamp(100 - pctLeft);
  return (
    <div role="img" aria-label={label} className="relative h-[60px] min-w-0">
      <span aria-hidden="true" className="absolute inset-x-0 top-[28px] h-1 rounded bg-[var(--hb-surface-hover)]" />
      <span aria-hidden="true" className="absolute left-1/2 top-[23px] h-3.5 w-px bg-[var(--hb-text-muted)] opacity-50" />
      {mine !== null && (
        <>
          <span aria-hidden="true" className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold leading-4 text-[var(--hb-primary)]" style={{ left: `${clamp(pos(mine), 5, 95)}%` }}>{ME}</span>
          <span aria-hidden="true" data-dot="me" className="absolute top-[22px] -ml-2 h-4 w-4 rounded-full border-[3px] border-white bg-[var(--hb-primary)] shadow-[0_0_0_1px_var(--hb-primary)]" style={{ left: `${pos(mine)}%` }} />
        </>
      )}
      {theirs !== null && (
        <>
          <span aria-hidden="true" data-dot="them" className="absolute top-[22px] -ml-2 h-4 w-4 rounded-full border-[3px] border-[var(--hb-text-strong)] bg-white" style={{ left: `${pos(theirs)}%` }} />
          <span aria-hidden="true" className="absolute top-[42px] -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold leading-4 text-[var(--hb-text-strong)]" style={{ left: `${clamp(pos(theirs), 5, 95)}%` }}>{THEM}</span>
        </>
      )}
    </div>
  );
}

function Ends({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="flex min-w-0 justify-between gap-3 text-[13px] leading-5 text-[var(--hb-text-body)]">
      <span className="min-w-0 break-words">{left}</span>
      <span className="min-w-0 break-words text-right">{right}</span>
    </div>
  );
}

function dimLine(who: string, d: Wc64Dim, r: Wc64DimResult): string {
  if (!r.decided) return `${who}: ${undecidedText(r)}`;
  return `${who} ${r.letter} ${r.letterPct}%, ${LEVEL_TEXT[r.level]}`;
}

function DimRow({ d, mine, theirs }: { d: Wc64Dim; mine: Wc64DimResult; theirs: Wc64DimResult }) {
  const split = mine.decided && theirs.decided && mine.letter !== theirs.letter;
  const label = `${d.name}. ${dimLine(ME, d, mine)}. ${dimLine(THEM, d, theirs)}.`;
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--hb-hairline)] pt-4 first:border-t-0 first:pt-0" data-testid={`wc64-compare-dim-${d.id}`}>
      <h4 className="text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">{d.name}</h4>
      <Ends left={<><b>{d.letter_a}</b> {d.name_a}</>} right={<>{d.name_b} <b>{d.letter_b}</b></>} />
      <PairBar mine={mine.decided ? mine.pctX : null} theirs={theirs.decided ? theirs.pctX : null} label={label} />
      <ul className="flex flex-col gap-0.5 text-sm leading-6 text-[var(--hb-text-body)]">
        <li data-testid={`wc64-compare-dim-${d.id}-me`}>{dimLine(ME, d, mine)}</li>
        <li data-testid={`wc64-compare-dim-${d.id}-them`}>{dimLine(THEM, d, theirs)}</li>
      </ul>
      {split && (
        <div className={noteClass} data-testid={`wc64-compare-questions-${d.id}`}>
          <p className="font-semibold text-[var(--hb-text-strong)]">글자가 갈렸어요. 이렇게 물어봐요</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            {d.couple_questions.map(q => <li key={q}>{q}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function pctText(who: string, pctA: number | null): string {
  return pctA === null ? `${who}: 답이 적어 %를 내지 않았어요` : `${who} ${pctA}% 대 ${100 - pctA}%`;
}

function SectionRowView({ row }: { row: SectionRow }) {
  const { sec, mine, theirs } = row;
  const isFund = sec.id === "FUND";
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-[var(--hb-hairline)] pt-4 first:border-t-0 first:pt-0" data-testid={`wc64-compare-section-${sec.id}`}>
      <h4 className="text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">
        {sec.title}{isFund && <span className="ml-2 text-xs font-medium text-[var(--hb-text-muted)]">네 글자 밖</span>}
      </h4>
      <Ends
        left={isFund ? WC64_BANK.fund.a_name : leftPole(sec) === "A" ? sec.pole_a.name : sec.pole_b.name}
        right={isFund ? WC64_BANK.fund.b_name : leftPole(sec) === "A" ? sec.pole_b.name : sec.pole_a.name}
      />
      <PairBar mine={mine} theirs={theirs} label={`${sec.title}. ${pctText(ME, mine)}. ${pctText(THEM, theirs)}.`} />
      <p className={metaClass}>{pctText(ME, mine)}<br />{pctText(THEM, theirs)}</p>
      {isFund && <p className={bodyClass}>이렇게 물어봐요: {WC64_BANK.fund.couple_question}</p>}
    </li>
  );
}

function ItemPairView({ pair }: { pair: ItemPair }) {
  return (
    <li className="min-w-0 border-t border-[var(--hb-hairline)] pt-4 first:border-t-0 first:pt-0">
      <p className="break-words text-sm font-medium leading-7 text-[var(--hb-text-strong)]">{pair.item.text}</p>
      <dl className="mt-2 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <dt className={metaClass}>{ME}</dt>
          <dd className="text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">{SCALE[pair.mine - 1]}</dd>
        </div>
        <div className="min-w-0">
          <dt className={metaClass}>{THEM}</dt>
          <dd className="text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">{SCALE[pair.theirs - 1]}</dd>
        </div>
      </dl>
    </li>
  );
}

function SideBySide({ me, them }: { me: Person; them: Person }) {
  const sections = useMemo(() => sectionRows(me, them), [me, them]);
  const pairs = useMemo(() => itemPairs(me, them), [me, them]);
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="wc64-compare-result">
      <p className={noteClass}>같은 쪽을 골랐다고 합의한 건 아니에요. %는 각자 고른 답의 비율이에요.</p>

      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="wc64-compare-letters">
        <h3 id="wc64-compare-letters" className={h3Class}>네 글자 나란히</h3>
        <p className={metaClass}>{ME} {me.report.code}<br />{THEM} {them.report.code}</p>
        {WC64_DIMS.map(d => (
          <DimRow
            key={d.id}
            d={d}
            mine={me.report.dims.find(r => r.dim === d.id) as Wc64DimResult}
            theirs={them.report.dims.find(r => r.dim === d.id) as Wc64DimResult}
          />
        ))}
      </section>

      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="wc64-compare-sections">
        <h3 id="wc64-compare-sections" className={h3Class}>묶음별로 보면</h3>
        <p className={metaClass}>둘의 답이 많이 다른 묶음부터 놓았어요.</p>
        <ol className="flex min-w-0 flex-col gap-4">
          {sections.map(row => <SectionRowView key={row.sec.id} row={row} />)}
        </ol>
      </section>

      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="wc64-compare-items">
        <h3 id="wc64-compare-items" className={h3Class}>2칸 이상 다르게 고른 문장</h3>
        {pairs.apart.length > 0
          ? <ol className="flex min-w-0 flex-col gap-4" data-testid="wc64-compare-apart">{pairs.apart.map(p => <ItemPairView key={p.item.id} pair={p} />)}</ol>
          : <p className={bodyClass}>2칸 이상 다르게 고른 문장은 없어요.</p>}
        {pairs.same.length > 0 && (
          <details className="min-w-0">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[var(--hb-text-strong)]">같은 칸을 고른 문장 보기</summary>
            <ol className="mt-3 flex min-w-0 flex-col gap-4" data-testid="wc64-compare-same">{pairs.same.map(p => <ItemPairView key={p.item.id} pair={p} />)}</ol>
          </details>
        )}
      </section>
    </div>
  );
}

/* ---------------- 화면 ---------------- */

export default function Compare64({ myAnswers, myPlan, mySkipped }: Compare64Props) {
  const skipped = useMemo(() => mySkipped ?? {}, [mySkipped]);
  const myCode = useMemo(() => encodeWc64PairCode(myAnswers, myPlan, skipped), [myAnswers, myPlan, skipped]);
  const me = useMemo(() => person(myAnswers, myPlan, skipped), [myAnswers, myPlan, skipped]);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [them, setThem] = useState<Person | null>(null);
  const [sameAsMine, setSameAsMine] = useState(false);

  function selectMyCode() {
    const el = codeRef.current;
    if (!el) return;
    el.focus();
    el.select();
    try { el.setSelectionRange(0, el.value.length); } catch { /* 일부 브라우저는 읽기 전용 칸에서 막는다 */ }
  }

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(myCode);
      setCopyState("copied");
    } catch {
      selectMyCode();
      setCopyState("manual");
    }
  }

  function showSideBySide() {
    const r = decodeWc64PairCode(input);
    if (!r.ok) { setError(r.reason); setThem(null); return; }
    setError(null);
    setSameAsMine(normalizeWc64PairCode(input) === normalizeWc64PairCode(myCode));
    setThem(person(r.answers, r.plan, r.skipped));
  }

  function clearPartner() {
    setInput("");
    setThem(null);
    setError(null);
    setSameAsMine(false);
  }

  return (
    <section className={cardClass} aria-labelledby="wc64-compare-title" data-testid="wc64-compare">
      <span className={kickerClass}>두 사람</span>
      <h2 id="wc64-compare-title" className={h2Class}>둘이 같이 보기</h2>
      <p className={bodyClass}>내 답 코드를 상대에게 보내고, 상대 코드를 아래에 붙여 넣으면 둘의 결과를 나란히 볼 수 있어요. 코드는 서버로 가지 않아요. 코드를 받은 사람은 내 답 전체를 볼 수 있어요.</p>

      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="wc64-my-code" className="text-sm font-semibold text-[var(--hb-text-strong)]">내 답 코드</label>
        <textarea id="wc64-my-code" ref={codeRef} readOnly rows={4} value={myCode} className={textareaClass} spellCheck={false} onFocus={e => e.currentTarget.select()} />
        <p className={metaClass}>코드에는 내 답이 담겨요. 보낼 사람에게만 보내 주세요.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="md" className={secondaryButtonClass} onClick={copy}>내 코드 복사하기</Button>
          <span role="status" className="text-sm leading-6 text-[var(--hb-text-body)]">
            {copyState === "copied" ? "복사했어요." : copyState === "manual" ? "길게 눌러 복사해 주세요." : ""}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="wc64-their-code" className="text-sm font-semibold text-[var(--hb-text-strong)]">상대 코드</label>
        <textarea
          id="wc64-their-code"
          rows={4}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="WC64로 시작하는 코드를 붙여 넣어 주세요"
          className={textareaClass}
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
        />
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="lg" className={primaryButtonClass} onClick={showSideBySide}>나란히 보기</Button>
          {(them || input) && <Button variant="secondary" size="md" className={secondaryButtonClass} onClick={clearPartner}>상대 코드 지우기</Button>}
        </div>
        {error && <p role="alert" className="rounded-lg border border-[#D8B8B2] bg-[#FFF7F5] p-4 text-sm leading-7 text-[#7D4540]">{error}</p>}
        {them && sameAsMine && <p role="status" className={metaClass}>내 코드와 같아요. 상대 코드인지 한 번 더 봐 주세요.</p>}
      </div>

      {them && <SideBySide me={me} them={them} />}
    </section>
  );
}
