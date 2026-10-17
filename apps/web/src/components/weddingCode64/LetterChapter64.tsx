"use client";

// 글자별 장. 원본 page6-shell.html renderReport 의 chapters 를 순서 그대로 옮겼다.
// '맞아요/달라요'는 이 화면 state 에만 두고 저장하지 않는다.
// 뺄 표식(hiddenSections = report.hiddenTags: 넘긴 묶음 id, 식 없이 하면 "예식")이 붙은 설명·줄은 wc64DimCopy·wc64LetterCopy 로 뺀다.
// 공개 화면에서는 '웨딩한방에서 이어 해 볼 것'으로 부르고, 첫 장 한 곳에만 아모라 소개와 로그인 링크를 둔다(2026-10-16 DEC-3).
// 앱 웹뷰 안에서는 아모라 소개와 로그인 링크를 두지 않는다(2026-10-17 상품 심사 M2: 앱 홈이 세션 없는 웹뷰로 공개 주소를 열어,
// 이미 로그인한 사람에게 웹 로그인 화면이 결과를 덮거나 시스템 브라우저가 열린다).
import { useState } from "react";
import Button from "@/components/ui/Button";
import { useInsideMobileApp } from "@/hooks/useInsideMobileApp";
import { WC64_BANK, isWc64CeremonyOff, wc64SectionById } from "@/lib/weddingCode/wc64/bank";
import { WC64_NO_CEREMONY_FACET_ONE_SIDE_TEXT, WC64_NO_CEREMONY_FACET_TEXT } from "@/lib/weddingCode/wc64/copy";
import { wc64DimCopy, wc64LetterCopy } from "@/lib/weddingCode/wc64/model";
import type {
  Wc64Dim, Wc64DimResult, Wc64FacetResult, Wc64FacetSkipReason, Wc64Plan, Wc64Quote, Wc64TieRule,
} from "@/lib/weddingCode/wc64/types";
import AxisBar64 from "./AxisBar64";
import {
  LEVEL_TEXT, POS_TEXT, WC64_UNDECIDED_TEXT, bodyClass, cardClass, h2Class, h3Class, isShaky, kickerClass, levelChipClass,
  linkClass, listClass, metaClass, noteClass, posTagClass, quoted, summaryClass, wc64OutsideTitle, withDirectionParticle,
  withObjectParticle, withSubjectParticle,
} from "./reportStyles";

/** 공개 결과의 글자 장 할 일 제목(라운지 안은 '앱에서 바로 해 볼 것' 그대로) */
export const WC64_PUBLIC_ACTIONS_TITLE = "웨딩한방에서 이어 해 볼 것";
export const WC64_EMBEDDED_ACTIONS_TITLE = "앱에서 바로 해 볼 것";
/** 공개 결과에 한 번 두는 로그인 링크 주소 */
export const WC64_LOGIN_HREF = "/login";

type Decided = Extract<Wc64DimResult, { decided: true }>;

export interface LetterChapter64Props {
  dim: Wc64Dim;
  result: Wc64DimResult;
  /** 1~4 */
  index: number;
  plan: Wc64Plan | null;
  /** 뺄 표식(보통 report.hiddenTags). 그 표식이 붙은 설명과 줄을 뺀다. */
  hiddenSections?: readonly string[];
  /** 라운지 안이면 true(할 일 제목을 그대로 두고 로그인 링크를 두지 않는다) */
  embedded?: boolean;
  /** 공개 결과에서 아모라 소개와 로그인 링크를 둘 장(결과에 한 장만 true) */
  appIntro?: boolean;
}

const SCALE = WC64_BANK.meta.scale;

/**
 * 동점일 때 글자를 붙인 까닭. model 의 tieRule(계약 §3.3 순서)마다 실제로 쓴 기준을 적는다.
 * 칸 이름은 은행의 다섯 칸 이름을 그대로 쓴다.
 */
export function wc64TieReason(rule: Wc64TieRule | null, dim: Pick<Wc64Dim, "letter_a">): string {
  switch (rule) {
    case "five": return `그래서 ${quoted(SCALE[4])}를 고른 비율이 더 높은 쪽 글자를 붙였어요.`;
    case "agree": return `그래서 ${quoted(SCALE[3])}나 ${quoted(SCALE[4])}를 고른 비율이 더 높은 쪽 글자를 붙였어요.`;
    case "disagree": return `그래서 ${quoted(SCALE[0])}나 ${quoted(SCALE[1])}를 고른 비율이 더 낮은 쪽 글자를 붙였어요.`;
    case "facet": return "그래서 묶음마다 기운 쪽을 세어, 더 많은 묶음이 기운 쪽 글자를 붙였어요.";
    case "default": return `다른 기준도 모두 같아서 정해 둔 순서대로 앞 글자 ${withObjectParticle(dim.letter_a)} 붙였어요.`;
    default: return "그래서 한쪽 글자를 임시로 붙였어요.";
  }
}

function Kicker({ index, dim }: { index: number; dim: Wc64Dim }) {
  return (
    <p className={`flex flex-wrap gap-x-2 ${kickerClass}`}>
      <span>{index}번째 글자</span>
      <span aria-hidden="true">·</span>
      <span>{dim.name}</span>
    </p>
  );
}

function QuoteLine({ q }: { q: Wc64Quote }) {
  return (
    <p className={bodyClass} data-quote={q.itemId}>
      <q className="text-[var(--hb-text-strong)]">{q.text}</q>{" "}
      <span className="font-semibold text-[var(--hb-selected-text)]">{q.label}</span>
    </p>
  );
}

/**
 * 묶음 %를 내지 못한 까닭(넘긴 묶음은 따로 한 줄로 모은다). 식 없이 해서 뺀 묶음은 비교 화면과 같은 공용 문구(copy.ts)로,
 * 문장이 모두 빠졌는지(묻지 않았어요) 한쪽만 남았는지(%를 내지 않았어요)를 나눠 쓴다.
 */
function facetSkipText(reason: Exclude<Wc64FacetSkipReason, "skipped">, allOff: boolean): string {
  if (reason === "too-few") return "답이 적어 %를 내지 않았어요";
  return allOff ? WC64_NO_CEREMONY_FACET_TEXT : WC64_NO_CEREMONY_FACET_ONE_SIDE_TEXT;
}

function FacetRow({ dim, facet, ceremonyOff }: { dim: Wc64Dim; facet: Wc64FacetResult; ceremonyOff: number }) {
  if (!facet.decided) {
    const reason = facet.reason === "skipped" ? "too-few" : facet.reason;
    const allOff = ceremonyOff > 0 && ceremonyOff >= (wc64SectionById(facet.section)?.items.length ?? Infinity);
    return (
      <div className="flex flex-col gap-1 border-t border-[var(--hb-hairline)] py-2.5" data-facet={facet.section} data-facet-reason={reason}>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <span className="text-[var(--hb-text-strong)]">{facet.title}</span>
          <span className={posTagClass(null)}>{facetSkipText(reason, allOff)}</span>
        </div>
      </div>
    );
  }
  const n = facet.fx.length + facet.fy.length;
  return (
    <div className="flex flex-col gap-1 border-t border-[var(--hb-hairline)] py-2.5" data-facet={facet.section} data-pos={facet.pos}>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="text-[var(--hb-text-strong)]">{facet.title}</span>
        <span className={posTagClass(facet.pos)}>{POS_TEXT[facet.pos]}</span>
      </div>
      <AxisBar64
        pctX={facet.pctX}
        label={`${facet.title}: ${dim.letter_a} ${facet.xName} ${facet.pctX}%, ${dim.letter_b} ${facet.yName} ${facet.pctY}%`}
        left={<span className="text-xs text-[var(--hb-text-muted)]">{dim.letter_a} {facet.xName}</span>}
        right={<span className="text-xs text-[var(--hb-text-muted)]">{facet.yName} {dim.letter_b}</span>}
      />
      <div className="flex justify-between gap-2 text-xs tabular-nums text-[var(--hb-text-muted)]">
        <span>{facet.pctX}%</span>
        <span className="text-center">문장 {n}개로 낸 값{ceremonyOff > 0 ? `, 식 관련 문장 ${ceremonyOff}개는 뺐어요` : ""}</span>
        <span>{facet.pctY}%</span>
      </div>
    </div>
  );
}

/** 넘긴 묶음은 제목을 다시 꺼내지 않고 한 줄로 알린다(가족 묶음을 넘긴 사람에게 양가 이야기를 되풀이하지 않는다). */
function SkippedFacetsLine({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className={`border-t border-[var(--hb-hairline)] py-2.5 ${metaClass}`} data-facet-skipped={count}>
      넘기거나 ‘해당 없음’으로 고른 묶음 {count}개는 빼고, 남은 묶음으로 계산했어요.
    </p>
  );
}

function UndecidedChapter({ dim, result, index, plan, hiddenSections = [] }: LetterChapter64Props) {
  if (result.decided) return null;
  const copy = wc64DimCopy(dim, hiddenSections);
  // 예산 4문장은 식 계획과 상관없이 늘 글자 밖 막대로 따로 보여 준다(2026-10-17 파운더 결정, DEC-7 뒤집기). 비워 둔 SPEND 장도 그곳을 가리킨다.
  const budgetElsewhere = dim.id === "SPEND";
  return (
    <section className={cardClass} aria-labelledby={`wc64-ch-${dim.id}`} data-dim={dim.id} data-decided="false" data-reason={result.reason}>
      <Kicker index={index} dim={dim} />
      <h2 id={`wc64-ch-${dim.id}`} className={h2Class}>{copy.question}</h2>
      <p className={noteClass} data-testid={`wc64-undecided-${dim.id}`}>
        {WC64_UNDECIDED_TEXT[result.reason]}
        {budgetElsewhere ? ` 예산을 지키는 정도는 아래 ${quoted(wc64OutsideTitle(plan))}에 따로 적었어요.` : ""}
      </p>
    </section>
  );
}

function DecidedChapter({ dim, r, index, plan, hiddenSections = [], embedded = false, appIntro = false }: {
  dim: Wc64Dim; r: Decided; index: number; plan: Wc64Plan | null; hiddenSections?: readonly string[];
  embedded?: boolean; appIntro?: boolean;
}) {
  const [check, setCheck] = useState<"yes" | "no" | null>(null);
  const insideApp = useInsideMobileApp();
  const otherLetter = r.letterSide === "X" ? dim.letter_b : dim.letter_a;
  const L = dim.letters[r.letter] ? wc64LetterCopy(dim, r.letter, hiddenSections) : null;
  const other = dim.letters[otherLetter] ? wc64LetterCopy(dim, otherLetter, hiddenSections) : null;
  const copy = wc64DimCopy(dim, hiddenSections);
  const shaky = isShaky(r.level);
  const fr = r.firm;
  // 같은 글자가 나온 수(same)와 반반이 나온 수(tie)를 따로 쓴다. 반반을 절반으로 쳐서 더한 agree 는 쓰지 않는다(2026-10-17 심사 HON-1).
  // 칸을 옮긴 끝은 꼭 반반이 아니다: 양쪽 문장 수가 다르면 반반을 건너뛰어 반대 글자로 넘어간다(HON-6).
  const firmLine = r.tie
    ? "양쪽 문장에 동의한 정도가 똑같아서 딱 반반이에요."
    : `그렇게 계산한 ${fr.total}번 중 ${fr.same}번은 ${withSubjectParticle(r.letter)}${fr.tie > 0 ? `, ${fr.tie}번은 반반이` : ""} 나왔어요.`
      + (Number.isFinite(fr.dist) && fr.dist > 0 ? ` 답을 ${fr.dist}칸 옮기면 반반이 되거나 반대 글자로 넘어가요.` : "");
  const tieLine = r.tie ? ` ${wc64TieReason(r.tieRule, dim)} 반대 글자 ${withDirectionParticle(otherLetter)} 읽어도 틀리지 않아요.` : "";
  // 다시 계산한 폭은 이 사람 글자 쪽 %로 적는다(r.band 는 앞 글자 쪽 %의 10%~90% 폭). 한 장에 뜻이 다른 %를 늘리지 않으려고
  // 동의 정도 %와 '양 끝 10%' 말은 쓰지 않는다(2026-10-17 심사 COPY-2).
  const onX = r.letterSide === "X";
  const band0 = Math.round(onX ? r.band[0] : 100 - r.band[1]);
  const band1 = Math.round(onX ? r.band[1] : 100 - r.band[0]);
  // 폭이 한 점이면(모두 '반반이에요'처럼) '50~50%'로 쓰지 않고 띠도 그리지 않는다.
  const bandPoint = band0 === band1;
  const bandRange = bandPoint ? `${band0}%` : `${band0}~${band1}%`;
  const headingId = `wc64-ch-${dim.id}`;
  const ceremonyOffIn = (sid: string) => {
    const sec = wc64SectionById(sid);
    return sec ? sec.items.filter(it => isWc64CeremonyOff(it.id, plan)).length : 0;
  };
  const shownFacets = r.facets.filter(f => f.decided || f.reason !== "skipped");
  const skippedFacets = r.facets.length - shownFacets.length;
  const noQuotes = r.quotes.pro.length === 0 && r.quotes.con.length === 0;
  return (
    <section className={cardClass} aria-labelledby={headingId} data-dim={dim.id} data-decided="true" data-level={r.level}>
      <Kicker index={index} dim={dim} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="font-mono text-[40px] font-semibold leading-none text-[var(--hb-text-strong)]" aria-label={`${index}번째 글자 ${r.letter}`}>{r.letter}</p>
        <span className={levelChipClass(r.level)}>{LEVEL_TEXT[r.level]}</span>
      </div>
      <h2 id={headingId} className={h2Class}>{copy.question}</h2>
      {copy.decisions.length > 0 && <p className={metaClass} data-testid={`wc64-decisions-${dim.id}`}>이 글자와 이어지는 결정: {copy.decisions.join(", ")}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {([["X", dim.letter_a, dim.name_a, copy.desc_a], ["Y", dim.letter_b, dim.name_b, copy.desc_b]] as const).map(([side, letter, name, desc]) => {
          const on = r.letterSide === side;
          return (
            <div
              key={side}
              className={`flex min-w-0 flex-col gap-1 rounded-lg px-3 py-2.5 text-[13px] leading-6 text-[var(--hb-text-body)] ${on ? "bg-[var(--hb-selected-bg)]" : "bg-[var(--hb-surface-hover)]"}`}
              data-pole={letter}
              data-on={on ? "true" : "false"}
            >
              <b className="text-sm font-semibold text-[var(--hb-text-strong)]">{letter} {name}</b>
              {desc}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1.5">
        <AxisBar64
          pctX={r.pctX}
          band={bandPoint ? null : r.band}
          label={`${dim.letter_a} ${dim.name_a} ${r.pctX}%, ${dim.letter_b} ${dim.name_b} ${r.pctY}%. 다시 계산해도 대부분 ${r.letter}쪽 ${bandRange}`}
          left={<><b className="font-semibold text-[var(--hb-text-strong)]">{dim.letter_a}</b> {dim.name_a}</>}
          right={<>{dim.name_b} <b className="font-semibold text-[var(--hb-text-strong)]">{dim.letter_b}</b></>}
        />
        <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
          <span><b className="text-base">{r.pctX}</b>%</span>
          <span className={metaClass}>{r.n}/{r.total}문장으로 계산</span>
          <span><b className="text-base">{r.pctY}</b>%</span>
        </div>
        <p className={metaClass} data-testid={`wc64-band-${dim.id}`}>
          {bandPoint
            ? <>문장을 반씩 나눠 여러 번 다시 계산해 봐도 대부분 {r.letter}쪽 {bandRange}라서 옅은 띠는 없어요.</>
            : <>문장을 반씩 나눠 여러 번 다시 계산해 보면 대부분 {r.letter}쪽 {bandRange} 사이예요. 옅은 띠가 그 폭이에요.</>}
        </p>
        <p className={bodyClass} data-testid={`wc64-firm-${dim.id}`}>
          {firmLine}{tieLine}
        </p>
        {/* 단단함은 한결같은 정도라 기울기 말('한쪽으로 모였어도')로 부르지 않는다(재판정) */}
        {r.cappedByN && (
          <p className={bodyClass} data-testid={`wc64-capped-${dim.id}`}>
            계산에 들어간 문장이 {r.n}개뿐이라, 답이 한결같아도 {quoted(LEVEL_TEXT.clear)} 대신 {quoted(LEVEL_TEXT.lean)}로 보여 드려요.
          </p>
        )}
      </div>
      {shaky && <p className={noteClass} data-testid={`wc64-balanced-${dim.id}`}>{dim.balanced}</p>}
      <h3 className={h3Class}>묶음별로 보면</h3>
      <div>
        {shownFacets.map(f => <FacetRow key={f.section} dim={dim} facet={f} ceremonyOff={ceremonyOffIn(f.section)} />)}
        <SkippedFacetsLine count={skippedFacets} />
      </div>
      {noQuotes
        ? (
          <p className={bodyClass} data-testid={`wc64-no-quotes-${dim.id}`}>
            이 글자에 들어간 문장을 모두 {quoted(SCALE[2])}로 골라서, 한쪽으로 기운 문장이 없어요.
          </p>
        )
        : (
          <>
            <h3 className={h3Class}>이렇게 고르셨어요</h3>
            {r.quotes.pro.map(q => <QuoteLine key={q.itemId} q={q} />)}
            {r.quotes.con.length > 0 && (
              <>
                <p className={metaClass}>반대쪽으로 고른 문장</p>
                {r.quotes.con.map(q => <QuoteLine key={q.itemId} q={q} />)}
              </>
            )}
          </>
        )}
      {/* 표식으로 줄이 모두 빠진 목록은 제목도 그리지 않는다(빈 목록 위에 제목만 남지 않게). */}
      {L && (L.comfy.length > 0 || L.watch.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {L.comfy.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1.5" data-testid={`wc64-comfy-${dim.id}`}>
              <h3 className={h3Class}>{r.letter} 쪽이 편하게 여기는 것</h3>
              <ul className={listClass}>{L.comfy.map(x => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          {L.watch.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1.5" data-testid={`wc64-watch-${dim.id}`}>
              <h3 className={h3Class}>챙겨 볼 것</h3>
              <ul className={listClass}>
                {L.watch.map(w => (
                  <li key={w.text}>{w.text}{w.source ? <> <span className="text-xs text-[var(--hb-text-muted)]">({w.source})</span></> : null}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {shaky && other && other.comfy.length > 0 && (
        <details className="border-t border-[var(--hb-hairline)] pt-2">
          <summary className={summaryClass}>{otherLetter} 쪽 설명도 보기</summary>
          <ul className={`mt-2 ${listClass}`}>{other.comfy.map(x => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
      {L && (
        <>
          {L.app_actions.length > 0 && (
            <>
              <h3 className={h3Class} data-testid={`wc64-actions-title-${dim.id}`}>{embedded ? WC64_EMBEDDED_ACTIONS_TITLE : WC64_PUBLIC_ACTIONS_TITLE}</h3>
              <ul className={listClass}>{L.app_actions.map(x => <li key={x}>{x}</li>)}</ul>
            </>
          )}
          <p className="rounded-r-lg border-l-[3px] border-[var(--hb-primary)] bg-[var(--hb-surface-hover)] px-3 py-1.5 text-sm leading-7 text-[var(--hb-text-body)]">
            아모라에게: “{L.amora_line}”
          </p>
          {appIntro && !embedded && !insideApp && (
            <p className={metaClass} data-testid="wc64-app-intro">
              아모라는 웨딩한방의 결혼 준비 동반자예요. 로그인하면 아모라와 예산·일정·할 일을 함께 정리할 수 있어요. 웨딩코드 답은 로그인해도 계정이나 아모라로 넘어가지 않아요.{" "}
              <a href={WC64_LOGIN_HREF} target="_blank" rel="noopener noreferrer" className={linkClass} data-wc64-login>
                로그인하기(새 창)
              </a>
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`wc64-check-${dim.id}`} className={metaClass}>이 글자가 나와 맞나요?</span>
        <div className="flex gap-2" role="group" aria-labelledby={`wc64-check-${dim.id}`}>
          <Button
            variant="secondary"
            size="md"
            aria-pressed={check === "yes"}
            onClick={() => setCheck("yes")}
            className={`rounded-full! text-[13px] ${check === "yes" ? "border-[var(--hb-text-strong)]! bg-[var(--hb-text-strong)]! text-white!" : ""}`}
          >
            맞아요
          </Button>
          <Button
            variant="secondary"
            size="md"
            aria-pressed={check === "no"}
            onClick={() => setCheck("no")}
            className={`rounded-full! text-[13px] ${check === "no" ? "border-[var(--hb-text-strong)]! bg-[var(--hb-text-strong)]! text-white!" : ""}`}
          >
            달라요
          </Button>
        </div>
      </div>
      {check === "yes" && (
        <p className={metaClass} role="status" data-testid={`wc64-check-yes-${dim.id}`}>맞다고 표시했어요. 이 표시는 이 화면에만 남고 저장하지 않아요.</p>
      )}
      {check === "no" && (
        <p className={noteClass} role="status">반대쪽 설명도 읽어 보고, 2~3주 뒤 다시 해 보세요.</p>
      )}
    </section>
  );
}

export default function LetterChapter64(props: LetterChapter64Props) {
  const { result } = props;
  if (!result.decided) return <UndecidedChapter {...props} />;
  return (
    <DecidedChapter
      dim={props.dim} r={result} index={props.index} plan={props.plan} hiddenSections={props.hiddenSections}
      embedded={props.embedded} appIntro={props.appIntro}
    />
  );
}
