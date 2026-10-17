"use client";

// 둘이 같이 보기: 서버 없이 '답 코드'를 주고받아 두 사람의 답을 나란히 놓는다.
// 상대 답은 이 화면의 state 에만 있고 저장소·주소·서버 어디에도 쓰지 않는다.
// 점수 합치기·일치율·잘 맞는지 판정은 만들지 않는다. 같은 답과 다른 답, 갈린 글자에서 할 대화만 보여 준다.
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import Button from "@/components/ui/Button";
import { copyText } from "@/lib/clipboard";
import { WC64_BANK, WC64_DIMS, WC64_ITEMS, isWc64ItemAsked, wc64SectionById, wc64SectionIdOfItem } from "@/lib/weddingCode/wc64/bank";
import {
  WC64_NO_CEREMONY_DIM_TEXT, WC64_NO_CEREMONY_FACET_ONE_SIDE_TEXT, WC64_NO_CEREMONY_FACET_TEXT, WC64_NO_CEREMONY_LEAD,
} from "@/lib/weddingCode/wc64/copy";
import { axis, buildWc64Report, isWc64Rating, wc64ConsideredAnswers, wc64FacetSkipReason } from "@/lib/weddingCode/wc64/model";
import {
  decodeWc64PairCode, encodeWc64PairCode, normalizeWc64PairCode, wc64PairShareMessage,
} from "@/lib/weddingCode/wc64/pairCode";
import {
  WC64_CEREMONY_TAG,
  type Wc64Answers, type Wc64Dim, type Wc64DimResult, type Wc64DimSkipReason, type Wc64FacetSkipReason, type Wc64FundCopy, type Wc64Item,
  type Wc64Plan, type Wc64Rating, type Wc64Report, type Wc64Section, type Wc64Skipped,
} from "@/lib/weddingCode/wc64/types";
import {
  LEVEL_TEXT, WC64_UNDECIDED_TEXT, bodyClass, cardClass, h2Class, h3Class, isShaky, kickerClass, metaClass, noteClass,
  primaryButtonClass, secondaryButtonClass, summaryClass,
} from "./reportStyles";
import { wc64ReferenceNotice } from "./Report64";

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
    considered: wc64ConsideredAnswers(answers, plan),
  };
}

const ME = "나";
const THEM = "상대";
const SCALE = WC64_BANK.meta.scale;
/** 복사하는 안내 글에 넣는 시작 화면 주소(답을 싣지 않는다). 라운지에서 복사해도 받는 사람이 열 수 있는 공개 주소를 쓴다. */
const START_ADDRESS = `${process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://hanbang.ai"}/wedding-code`;
/**
 * 비교 줄의 식 계획 이름: 보기 이름에서 끝의 괄호 설명을 뗀 것('올릴 거예요(작은 식·가족끼리 하는 식 포함)' → '올릴 거예요').
 * 괄호째 실으면 한 줄이 너무 길었다(2026-10-17 점검).
 */
const PLAN_LABEL: Record<Wc64Plan, string> = Object.fromEntries(
  WC64_BANK.meta.plan_question.options.map(o => [o.value, o.label.replace(/\([^()]*\)$/, "")]),
) as Record<Wc64Plan, string>;
/** 식 계획이 없으면 계산과 답 코드처럼 'maybe' 로 본다 */
const planOf = (p: Wc64Plan | null): Wc64Plan => p ?? "maybe";
/** 같은 글자라도 두 사람의 앞 글자 쪽 %가 이만큼 벌어지면 대화 질문을 보인다(%p, 사람 자료로 다시 정할 값) */
const SAME_LETTER_GAP = 20;
/**
 * 식 없이 하기로 했을 때 묻는 문장 수(지금 은행 37). 그때 답 코드에는 묻지 않은 '예식' 문장의 답이 실리지 않아서
 * 코드 고지를 '64문항'이 아니라 이 수로 적는다(2026-10-17 심사 UX-2).
 */
const ASKED_WITHOUT_CEREMONY = WC64_ITEMS.filter(it => isWc64ItemAsked(it.id, "none")).length;

// 코드는 하이픈에서만 줄을 바꾼다(묶음 여섯 글자가 둘로 쪼개지지 않게). 고정폭 글꼴과 자간은 값에만 주고,
// 안내 글(placeholder)은 보통 글꼴로 둔다.
const textareaClass =
  "w-full min-w-0 resize-none break-normal [overflow-wrap:normal] [word-break:normal] rounded-lg border border-[var(--hb-hairline)] bg-white px-3 py-2.5 font-mono text-[13px] leading-6 tracking-wide text-[var(--hb-text-strong)] placeholder:font-sans placeholder:tracking-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]";
// 보낼 글 칸(복사가 막혔을 때만): 안내 글은 보통 글꼴, 긴 주소는 어디서든 줄을 바꾼다.
const shareBoxClass =
  "w-full min-w-0 resize-none break-words rounded-lg border border-[var(--hb-hairline)] bg-white px-3 py-2.5 text-[13px] leading-6 text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]";

/* ---------------- 계산(화면용) ---------------- */

const isNone = (p: Person) => p.plan === "none";

/**
 * 글자 밖 막대로 보는 묶음과 그 이름·질문. 리포트의 report.fund·report.budget 과 같은 묶음이고, 식 계획과 상관없이 늘 글자 밖이다
 * (BUDGET 은 2026-10-17 파운더 결정으로 SPEND 에서 빠졌다. DEC-7 뒤집기).
 */
const OUTSIDE_COPY: Readonly<Record<string, Wc64FundCopy>> = { FUND: WC64_BANK.fund, BUDGET: WC64_BANK.budget_bar };

/**
 * 막대 왼쪽 끝에 둘 쪽. 리포트의 글자 장(LetterChapter64)과 같게 글자 앞쪽(letter_a)이 가리키는 쪽을 왼쪽에 둔다.
 * 묶음이 글자에 거꾸로 붙어 있으면(a_is = "B") pole_b 가 왼쪽이다.
 * 글자 밖 묶음(FUND·BUDGET)은 결과 화면의 글자 밖 막대(OutsideBar)처럼 늘 pole_a 를 왼쪽에 둔다(2026-10-17 심사 UX-7:
 * 예산 막대가 내 결과와 비교 화면에서 좌우가 뒤집혀 있었다). 은행이 이 묶음을 다시 글자에 넣어도 두 화면이 어긋나지 않게 먼저 본다.
 */
function leftPole(sec: Wc64Section): "A" | "B" {
  if (OUTSIDE_COPY[sec.id]) return "A";
  for (const d of WC64_DIMS) {
    const f = d.facets.find(x => x.axis === sec.id);
    if (f) return f.a_is;
  }
  return "A";
}

/** 한 묶음의 왼쪽 끝 %. 두 쪽 문장에 모두 답이 있어야 낸다. */
function sectionPctLeft(sec: Wc64Section, considered: Wc64Answers, left: "A" | "B" = leftPole(sec)): number | null {
  const xs: number[] = [], ys: number[] = [];
  for (const it of sec.items) {
    const v = considered[it.id];
    if (isWc64Rating(v)) (it.pole === left ? xs : ys).push(v);
  }
  const a = axis(xs, ys);
  if (!a) return null;
  return a.N >= 0 ? a.shown : 100 - a.shown;
}

/** 묶음 %가 비었을 때 그 까닭(%가 있으면 null). 답과 식 계획만 보므로 답 코드로 받은 상대에게도 같다. */
function sectionWhy(sec: Wc64Section, p: Person, pct: number | null): Wc64FacetSkipReason | null {
  return pct === null ? wc64FacetSkipReason(sec.id, p.plan, p.considered, p.skipped) : null;
}

interface SectionRow {
  sec: Wc64Section;
  /** 막대 왼쪽 끝 쪽(두 사람 같은 방향) */
  left: "A" | "B";
  mine: number | null; theirs: number | null;
  mineWhy: Wc64FacetSkipReason | null; theirsWhy: Wc64FacetSkipReason | null;
  gap: number | null;
}

function sectionRows(me: Person, them: Person): SectionRow[] {
  const rows = WC64_BANK.sections.filter(s => s.kind === "bipolar").map(sec => {
    const left = leftPole(sec);
    const mine = sectionPctLeft(sec, me.considered, left);
    const theirs = sectionPctLeft(sec, them.considered, left);
    return {
      sec, left, mine, theirs,
      mineWhy: sectionWhy(sec, me, mine), theirsWhy: sectionWhy(sec, them, theirs),
      gap: mine !== null && theirs !== null ? Math.abs(mine - theirs) : null,
    };
  });
  // 차이가 큰 순. 한쪽이라도 %가 없으면 맨 뒤(원래 순서 유지).
  return rows
    .map((r, i) => ({ r, i }))
    .sort((p, q) => (q.r.gap ?? -1) - (p.r.gap ?? -1) || p.i - q.i)
    .map(x => x.r);
}

interface ItemPair { item: Wc64Item; mine: Wc64Rating; theirs: Wc64Rating }

/** 성향 문장(bipolar 묶음)만, 답 코드 순서대로. 이해도(KNOW)는 원하는 쪽이 아니라 아는지를 물어서 따로 본다. */
const kindOfItem = (it: Wc64Item) => wc64SectionById(wc64SectionIdOfItem(it.id) ?? "")?.kind;
const TENDENCY_ITEMS: readonly Wc64Item[] = WC64_ITEMS.filter(it => kindOfItem(it) === "bipolar");
const KNOW_ITEMS: readonly Wc64Item[] = WC64_ITEMS.filter(it => kindOfItem(it) === "knowledge");

function itemPairs(me: Person, them: Person): { apart: ItemPair[]; same: ItemPair[] } {
  const apart: { p: ItemPair; i: number }[] = [];
  const same: ItemPair[] = [];
  TENDENCY_ITEMS.forEach((item, i) => {
    const a = me.considered[item.id], b = them.considered[item.id];
    if (!isWc64Rating(a) || !isWc64Rating(b)) return;
    if (Math.abs(a - b) >= 2) apart.push({ p: { item, mine: a, theirs: b }, i });
    else if (a === b) same.push({ item, mine: a, theirs: b });
  });
  apart.sort((p, q) => Math.abs(q.p.mine - q.p.theirs) - Math.abs(p.p.mine - p.p.theirs) || p.i - q.i);
  return { apart: apart.map(x => x.p), same };
}

/**
 * 이해도 문장 나누기: 둘 다 잘 모른다고 고른 것(둘 다 1~2), 한 사람만 안다고 고른 것(한쪽 4~5, 다른 쪽 1~2).
 * 누가 더 아는지 겨루는 목록이 아니라 누가 무엇을 알아볼지 나누려는 목록이다.
 */
function knowPairs(me: Person, them: Person): { bothLow: ItemPair[]; oneKnows: ItemPair[] } {
  const bothLow: ItemPair[] = [], oneKnows: ItemPair[] = [];
  for (const item of KNOW_ITEMS) {
    const a = me.considered[item.id], b = them.considered[item.id];
    if (!isWc64Rating(a) || !isWc64Rating(b)) continue;
    if (a <= 2 && b <= 2) bothLow.push({ item, mine: a, theirs: b });
    else if ((a >= 4 && b <= 2) || (b >= 4 && a <= 2)) oneKnows.push({ item, mine: a, theirs: b });
  }
  return { bothLow, oneKnows };
}

/**
 * 글자를 정하지 못한 까닭별 문구. 까닭은 리포트(buildWc64Report → wc64DimSkipReason)가 정한 값을 그대로 쓴다.
 * 내 결과 화면과 같은 판정이라, 같은 답이면 두 화면이 같은 까닭을 말한다.
 * 문구도 따로 두지 않는다: 넘김·답 모자람은 결과 카드와 같은 `WC64_UNDECIDED_TEXT`, 식 없이 하기는 공용 `WC64_NO_CEREMONY_DIM_TEXT`
 * (2026-10-16 2단계 검토: 같은 선택을 화면마다 다른 말로 부르던 것).
 * 식 없이 하면 CIRCLE·SPEND 는 남은 문장을 다 답해도 정할 수 없어 늘 no-ceremony 다(DEC-1, 결과는 두 글자).
 */
const DIM_EMPTY_TEXT: Record<Wc64DimSkipReason, string> = {
  ...WC64_UNDECIDED_TEXT,
  "no-ceremony": WC64_NO_CEREMONY_DIM_TEXT,
};

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

/** 읽어 주는 이름에서 문장 끝 마침표가 두 번 붙지 않게 한다 */
const sentence = (t: string) => (t.endsWith(".") ? t : `${t}.`);

function dimLine(who: string, r: Wc64DimResult): string {
  if (!r.decided) return `${who}: ${DIM_EMPTY_TEXT[r.reason]}`;
  return `${who} ${r.letter} ${r.letterPct}%, ${LEVEL_TEXT[r.level]}`;
}

type Talk = { kind: "split" | "near-middle" | "same-gap"; title: string };

/**
 * 축마다 대화 질문을 띄울지와 그 머리말.
 * - 글자가 다르고 둘 다 가운데 근처(아슬·반반·동점)가 아니면: 글자가 갈렸어요.
 * - 글자가 달라도 한쪽이라도 가운데 근처면: '갈렸다'고 하지 않는다. 가운데 근처인 사람을 그대로 적는다.
 * - 글자가 같아도 앞 글자 쪽 %가 SAME_LETTER_GAP 이상 벌어지면: 같은 글자지만 기우는 정도가 달라요.
 */
function talkOf(mine: Wc64DimResult, theirs: Wc64DimResult): Talk | null {
  if (!mine.decided || !theirs.decided) return null;
  const nearMine = mine.tie || isShaky(mine.level);
  const nearTheirs = theirs.tie || isShaky(theirs.level);
  if (mine.letter !== theirs.letter) {
    if (!nearMine && !nearTheirs) return { kind: "split", title: "글자가 갈렸어요. 이렇게 물어봐요" };
    const who = nearMine && nearTheirs ? "둘 다" : nearMine ? `${ME}는` : `${THEM}는`;
    return { kind: "near-middle", title: `글자는 다르게 나왔지만 ${who} 가운데 근처예요. 한 번 이야기해 봐요` };
  }
  if (Math.abs(mine.pctX - theirs.pctX) >= SAME_LETTER_GAP) {
    return { kind: "same-gap", title: "같은 글자지만 기우는 정도가 꽤 달라요. 어디서 갈리는지 물어봐요" };
  }
  return null;
}

function DimRow({ d, mine, theirs }: { d: Wc64Dim; mine: Wc64DimResult; theirs: Wc64DimResult }) {
  const talk = talkOf(mine, theirs);
  const label = `${d.name}. ${sentence(dimLine(ME, mine))} ${sentence(dimLine(THEM, theirs))}`;
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--hb-hairline)] pt-4 first:border-t-0 first:pt-0" data-testid={`wc64-compare-dim-${d.id}`}>
      <h4 className="text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">{d.name}</h4>
      <Ends left={<><b>{d.letter_a}</b> {d.name_a}</>} right={<>{d.name_b} <b>{d.letter_b}</b></>} />
      <PairBar mine={mine.decided ? mine.pctX : null} theirs={theirs.decided ? theirs.pctX : null} label={label} />
      <ul className="flex flex-col gap-0.5 text-sm leading-6 text-[var(--hb-text-body)]">
        <li data-testid={`wc64-compare-dim-${d.id}-me`}>{dimLine(ME, mine)}</li>
        <li data-testid={`wc64-compare-dim-${d.id}-them`}>{dimLine(THEM, theirs)}</li>
      </ul>
      {talk && (
        <div className={noteClass} data-testid={`wc64-compare-questions-${d.id}`} data-talk={talk.kind}>
          <p className="font-semibold text-[var(--hb-text-strong)]">{talk.title}</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            {d.couple_questions.map(q => <li key={q}>{q}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 문장이 모두 '예식'이라 식 없이 하면 통째로 묻지 않는 묶음인가(지금 은행: FORM·GUESTS·DAY·EYES·WEIGHT) */
const isCeremonyOnly = (sec: Wc64Section) => sec.items.every(it => it.skip_tag === WC64_CEREMONY_TAG);

/**
 * 묶음 %가 빈 까닭별 문구. no-ceremony 는 묶음이 통째로 빠졌는지(식 문장뿐), 한쪽 문장만 남았는지로 나눈다.
 * 지금 은행에는 한쪽만 남는 묶음이 없지만(2단계에서 EYES 네 문장이 모두 '예식'이 됐다) 은행 표식으로 가르므로 갈래는 둔다.
 */
function sectionEmptyText(sec: Wc64Section, why: Wc64FacetSkipReason): string {
  if (why === "no-ceremony") {
    return isCeremonyOnly(sec) ? WC64_NO_CEREMONY_FACET_TEXT : WC64_NO_CEREMONY_FACET_ONE_SIDE_TEXT;
  }
  return why === "skipped" ? "이 묶음은 넘겼거나 모두 해당 없음으로 골랐어요" : "답이 적어 %를 내지 않았어요";
}

function pctText(who: string, sec: Wc64Section, pctLeft: number | null, why: Wc64FacetSkipReason | null): string {
  return pctLeft === null ? `${who}: ${sectionEmptyText(sec, why ?? "too-few")}` : `${who} ${pctLeft}% 대 ${100 - pctLeft}%`;
}

/**
 * 글자 밖 묶음(FUND·BUDGET) 이름 옆 표시. 두 묶음 모두 식 계획과 상관없이 글자 밖이라 같은 표시를 쓴다.
 * 한 사람이라도 식 없이 하면 그 사람 결과는 두 글자라 '네'를 붙이지 않는다(결과 화면의 `wc64OutsideTitle` 과 같은 기준).
 */
const OUTSIDE_TAG_FOUR = "네 글자 밖";
const OUTSIDE_TAG_NONE = "글자 밖";

function SectionRowView({ row, outsideTag }: { row: SectionRow; outsideTag: string }) {
  const { sec, left, mine, theirs, mineWhy, theirsWhy } = row;
  const outside = OUTSIDE_COPY[sec.id];
  // 글자 밖 막대의 끝 이름은 결과 화면(OutsideBar)과 같은 문구를 쓴다
  const leftName = outside ? outside.a_name : left === "A" ? sec.pole_a.name : sec.pole_b.name;
  const rightName = outside ? outside.b_name : left === "A" ? sec.pole_b.name : sec.pole_a.name;
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-[var(--hb-hairline)] pt-4 first:border-t-0 first:pt-0" data-testid={`wc64-compare-section-${sec.id}`}>
      <h4 className="text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">
        {sec.title}{outside && <span className="ml-2 text-xs font-medium text-[var(--hb-text-muted)]">{outsideTag}</span>}
      </h4>
      <Ends left={leftName} right={rightName} />
      <PairBar mine={mine} theirs={theirs} label={`${sec.title}. ${pctText(ME, sec, mine, mineWhy)}. ${pctText(THEM, sec, theirs, theirsWhy)}.`} />
      <p className={metaClass}>{pctText(ME, sec, mine, mineWhy)}<br />{pctText(THEM, sec, theirs, theirsWhy)}</p>
      {outside && <p className={bodyClass} data-testid={`wc64-compare-outside-question-${sec.id}`}>이렇게 물어봐요: {outside.couple_question}</p>}
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

/** 비교 화면 코드 줄에 붙이는 참고로만 표시(나·상대 같은 꼴, codeLine) */
export const WC64_COMPARE_REFERENCE_TEXT = "참고로만 볼 결과예요.";

/**
 * 코드 줄. 결과 이름(report.name)이 있으면 이름을 앞에 두고 글자를 괄호에 넣는다(2026-10-17 파운더 결정: 이름이 메인).
 * 이름이 없으면(글자가 하나라도 정해지지 않으면) 예전처럼 글자만 적는다. 식 없이 하면 비워 둔 두 자리('·')가 무엇인지 함께 적는다.
 * 이름을 적을 때 그 결과가 참고로만 결과(wc64ReferenceNotice 가 안내를 낸다)면 이름 바로 뒤에 `WC64_COMPARE_REFERENCE_TEXT` 를 붙인다.
 * 결과 화면의 안내 문장('같은 칸을 많이 고르셔서…', '다시 해 보시면…')을 그대로 붙이면 상대 줄에서도 존댓말과 권유가 화면을 보는
 * 나에게 가서 누구 이야기인지 흐려졌다(재판정). 까닭은 각자 자기 결과 화면에 있으니 비교 줄에는 '참고로만 볼 결과'라는 사실만 싣는다.
 */
function codeLine(who: string, p: Person): string {
  const blank = isNone(p) ? `${WC64_NO_CEREMONY_LEAD} 두 자리는 비워 뒀어요` : null;
  const name = p.report.name;
  if (!name) return `${who} ${p.report.code}${blank ? ` (${blank})` : ""}`;
  const head = `${who} ${name.label}(${p.report.code}${blank ? `, ${blank}` : ""})`;
  return wc64ReferenceNotice(p.report) ? `${head}. ${WC64_COMPARE_REFERENCE_TEXT}` : head;
}

/** 식 없이 하면 비워 두는 두 글자의 이름(결혼식 기준, 돈 쓰는 곳 순서. 두 이름 모두 받침으로 끝나 '과'로 잇는다) */
const NO_CEREMONY_DIM_NAMES = (["CIRCLE", "SPEND"] as const)
  .map(id => WC64_DIMS.find(d => d.id === id)?.name)
  .filter((n): n is string => !!n)
  .map(n => `‘${n}’`)
  .join("과 ");

/**
 * 둘 다 식 없이 하면 결혼식 문장만 있는 묶음은 두 사람 모두 묻지 않아 막대가 비고 까닭 두 줄만 남는다.
 * 그런 묶음은 줄을 만들지 않고 몇 개 뺐는지만 한 줄로 적는다. 한 사람이라도 답했으면 그 사람의 점이 있으니 줄을 둔다.
 */
function shownSectionRows(rows: SectionRow[]): { shown: SectionRow[]; bothNotAsked: number } {
  const shown = rows.filter(r => !(isCeremonyOnly(r.sec) && r.mineWhy === "no-ceremony" && r.theirsWhy === "no-ceremony"));
  return { shown, bothNotAsked: rows.length - shown.length };
}

function SideBySide({ me, them, headingRef }: { me: Person; them: Person; headingRef: Ref<HTMLHeadingElement> }) {
  const { shown: sections, bothNotAsked } = useMemo(() => shownSectionRows(sectionRows(me, them)), [me, them]);
  const pairs = useMemo(() => itemPairs(me, them), [me, them]);
  const know = useMemo(() => knowPairs(me, them), [me, them]);
  const myPlan = planOf(me.plan), theirPlan = planOf(them.plan);
  const noneWho = isNone(me) && isNone(them) ? "둘 다" : isNone(me) ? `${ME}는` : isNone(them) ? `${THEM}는` : null;
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="wc64-compare-result">
      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="wc64-compare-letters">
        {/* '나란히 보기'를 누르면 초점이 이 제목으로 온다(결과가 단추 아래에 길게 생겨도 읽어 주는 기능이 알 수 있게) */}
        <h3 id="wc64-compare-letters" ref={headingRef} tabIndex={-1} className={`${h3Class} outline-none`}>
          {noneWho ? "글자 나란히" : "네 글자 나란히"}
        </h3>
        {myPlan !== theirPlan && (
          <div className={noteClass} data-testid="wc64-compare-plan-diff">
            <p className="font-semibold text-[var(--hb-text-strong)]">식 계획부터 다르게 답했어요. {ME}: {PLAN_LABEL[myPlan]} · {THEM}: {PLAN_LABEL[theirPlan]}</p>
            {noneWho && (
              <p className="mt-1">{noneWho} {WC64_NO_CEREMONY_LEAD} {NO_CEREMONY_DIM_NAMES} 글자가 비어 있어요.</p>
            )}
            <p className="mt-1">서로 물어봐요: 식을 올리고 싶어? 올린다면 누구까지 부르고 어떤 모습이면 좋겠어?</p>
          </div>
        )}
        <p className={noteClass}>같은 쪽을 골랐다고 합의한 건 아니에요. %는 두 사람이 각자 자기 답으로 따로 계산한 값이에요.</p>
        <p className={metaClass} data-testid="wc64-compare-codes">
          <span data-testid="wc64-compare-code-me">{codeLine(ME, me)}</span><br /><span data-testid="wc64-compare-code-them">{codeLine(THEM, them)}</span>
        </p>
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
        {bothNotAsked > 0 && (
          <p className={metaClass} data-testid="wc64-compare-sections-not-asked">
            둘 다 {WC64_NO_CEREMONY_LEAD} 결혼식만 묻는 묶음 {bothNotAsked}개는 뺐어요.
          </p>
        )}
        <ol className="flex min-w-0 flex-col gap-4">
          {sections.map(row => <SectionRowView key={row.sec.id} row={row} outsideTag={noneWho ? OUTSIDE_TAG_NONE : OUTSIDE_TAG_FOUR} />)}
        </ol>
      </section>

      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="wc64-compare-items">
        <h3 id="wc64-compare-items" className={h3Class}>2칸 이상 다르게 고른 문장</h3>
        {pairs.apart.length > 0
          ? <ol className="flex min-w-0 flex-col gap-4" data-testid="wc64-compare-apart">{pairs.apart.map(p => <ItemPairView key={p.item.id} pair={p} />)}</ol>
          : <p className={bodyClass}>2칸 이상 다르게 고른 문장은 없어요.</p>}
        {pairs.same.length > 0 && (
          <details className="min-w-0">
            <summary className={summaryClass}>같은 칸을 고른 문장 보기</summary>
            <ol className="mt-3 flex min-w-0 flex-col gap-4" data-testid="wc64-compare-same">{pairs.same.map(p => <ItemPairView key={p.item.id} pair={p} />)}</ol>
          </details>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="wc64-compare-know" data-testid="wc64-compare-know">
        <h3 id="wc64-compare-know" className={h3Class}>알아볼 거리 나누기</h3>
        <p className={metaClass}>웨딩 이해도 문장은 원하는 쪽이 아니라 아는지를 물어서 위 목록과 따로 모았어요. 누가 무엇을 알아볼지 나눌 때 보세요.</p>
        {know.bothLow.length === 0 && know.oneKnows.length === 0 && (
          <p className={bodyClass}>둘 다 잘 모른다고 고른 문장도, 한 사람만 안다고 고른 문장도 없어요.</p>
        )}
        {know.bothLow.length > 0 && (
          <div className="flex min-w-0 flex-col gap-3">
            <h4 className="text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">둘 다 잘 모른다고 고른 것</h4>
            <ol className="flex min-w-0 flex-col gap-4" data-testid="wc64-compare-know-low">{know.bothLow.map(p => <ItemPairView key={p.item.id} pair={p} />)}</ol>
          </div>
        )}
        {know.oneKnows.length > 0 && (
          <div className="flex min-w-0 flex-col gap-3">
            <h4 className="text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">한 사람만 안다고 고른 것</h4>
            <ol className="flex min-w-0 flex-col gap-4" data-testid="wc64-compare-know-one">{know.oneKnows.map(p => <ItemPairView key={p.item.id} pair={p} />)}</ol>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------- 화면 ---------------- */

export default function Compare64({ myAnswers, myPlan, mySkipped }: Compare64Props) {
  const skipped = useMemo(() => mySkipped ?? {}, [mySkipped]);
  const myCode = useMemo(() => encodeWc64PairCode(myAnswers, myPlan), [myAnswers, myPlan]);
  const shareMessage = useMemo(() => wc64PairShareMessage(myCode, START_ADDRESS), [myCode]);
  const me = useMemo(() => person(myAnswers, myPlan, skipped), [myAnswers, myPlan, skipped]);
  const shareRef = useRef<HTMLTextAreaElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const theirCodeRef = useRef<HTMLTextAreaElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  /** 복사가 막힐 때마다 늘려 보낼 글 칸을 다시 골라 둔다 */
  const [manualTick, setManualTick] = useState(0);
  /** '나란히 보기'로 결과를 그릴 때마다 늘려 결과 제목으로 초점을 옮긴다 */
  const [shownTick, setShownTick] = useState(0);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [them, setThem] = useState<Person | null>(null);
  const [sameAsMine, setSameAsMine] = useState(false);

  // 복사가 막히면 코드만이 아니라 보낼 글 전체(안내 글·시작 주소·코드)를 담은 칸을 보여 주고 골라 둔다.
  // 코드만 골라 두면 받은 사람이 어디서 무엇을 할지 모르는 상태로 돌아가서다.
  useEffect(() => {
    if (manualTick === 0) return;
    const el = shareRef.current;
    if (!el) return;
    el.focus();
    el.select();
    try { el.setSelectionRange(0, el.value.length); } catch { /* 일부 브라우저는 읽기 전용 칸에서 막는다 */ }
  }, [manualTick]);

  useEffect(() => {
    if (shownTick > 0) resultHeadingRef.current?.focus();
  }, [shownTick]);

  // 코드만 보내면 받은 사람이 어디서 무엇을 할지 몰라서, 안내 글과 시작 화면 주소를 함께 복사한다.
  // 받은 사람이 이 글을 통째로 붙여 넣어도 decodeWc64PairCode 가 코드 부분만 찾아 읽는다.
  async function copy() {
    if (await copyText(shareMessage)) {
      setCopyState("copied");
    } else {
      setCopyState("manual");
      setManualTick(n => n + 1);
    }
  }

  function showSideBySide() {
    // 대화방을 통째로 붙여 넣어 내 코드와 상대 코드가 같이 들어 있으면 내 코드가 아닌 쪽을 읽는다
    const r = decodeWc64PairCode(input, { mine: myCode });
    if (!r.ok) { setError(r.reason); setThem(null); return; }
    setError(null);
    // 붙여 넣은 글에서 찾아 읽은 코드로 견준다(앞뒤 안내 글이 붙어 있어도 내 코드를 알아본다)
    setSameAsMine(r.code === normalizeWc64PairCode(myCode));
    setThem(person(r.answers, r.plan, r.skipped));
    setShownTick(n => n + 1);
  }

  function clearPartner() {
    setInput("");
    setThem(null);
    setError(null);
    setSameAsMine(false);
    // '상대 코드 지우기' 단추는 지우면 사라지므로, 초점을 잃지 않게 상대 코드 칸으로 옮긴다(2026-10-17 심사 A11Y-2)
    theirCodeRef.current?.focus();
  }

  return (
    <section className={cardClass} aria-labelledby="wc64-compare-title" data-testid="wc64-compare">
      <span className={kickerClass}>두 사람</span>
      <h2 id="wc64-compare-title" className={h2Class}>둘이 같이 보기</h2>
      <p className={bodyClass}>내 답 코드를 상대에게 보내고, 상대 코드를 아래에 붙여 넣으면 둘의 결과를 나란히 볼 수 있어요. 코드는 서버로 가지 않아요.</p>

      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="wc64-my-code" className="text-sm font-semibold text-[var(--hb-text-strong)]">내 답 코드</label>
        <textarea id="wc64-my-code" readOnly rows={4} value={myCode} className={textareaClass} spellCheck={false} onFocus={e => e.currentTarget.select()} />
        <p className={metaClass} data-testid="wc64-compare-my-code-note">이 코드에는 {myPlan === "none" ? `두 글자 결과만이 아니라 ${ASKED_WITHOUT_CEREMONY}문항` : "네 글자 결과만이 아니라 64문항"}에서 고른 답 하나하나와 식 계획 답이 모두 담겨요. 받은 사람은 그 답을 전부 볼 수 있고, 보낸 코드는 되돌릴 수 없어요. 함께 볼 사람에게만 보내 주세요.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="md" className={secondaryButtonClass} onClick={copy}>내 코드 복사하기</Button>
          <span role="status" className="text-sm leading-6 text-[var(--hb-text-body)]">
            {copyState === "copied"
              ? "복사했어요. 안내 글과 주소도 함께 담았어요. 대화창에 붙여 넣어 보내 주세요."
              : copyState === "manual" ? "자동 복사가 되지 않아 보낼 글 전체를 아래 칸에 골라 두었어요. 복사해서 보내 주세요." : ""}
          </span>
        </div>
        {copyState === "manual" && (
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="wc64-share-text" className="text-sm font-semibold text-[var(--hb-text-strong)]">보낼 글(안내 글·주소·코드)</label>
            <textarea id="wc64-share-text" ref={shareRef} readOnly rows={6} value={shareMessage} className={shareBoxClass} spellCheck={false} onFocus={e => e.currentTarget.select()} />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="wc64-their-code" className="text-sm font-semibold text-[var(--hb-text-strong)]">상대 코드</label>
        <textarea
          id="wc64-their-code"
          ref={theirCodeRef}
          rows={4}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="받은 WC64 코드나 안내 글을 그대로 붙여 넣어 주세요"
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

      {them && <SideBySide me={me} them={them} headingRef={resultHeadingRef} />}
    </section>
  );
}
