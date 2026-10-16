"use client";

// 글자별 장. 원본 page6-shell.html renderReport 의 chapters 를 순서 그대로 옮겼다.
// '맞아요/달라요'는 이 화면 state 에만 두고 저장하지 않는다.
import { useState } from "react";
import Button from "@/components/ui/Button";
import type { Wc64Dim, Wc64DimResult, Wc64FacetResult, Wc64Plan, Wc64Quote } from "@/lib/weddingCode/wc64/types";
import AxisBar64 from "./AxisBar64";
import {
  LEVEL_TEXT, POS_TEXT, bodyClass, cardClass, h2Class, h3Class, isShaky, kickerClass, levelChipClass, listClass,
  metaClass, noteClass, posTagClass, summaryClass, withSubjectParticle,
} from "./reportStyles";

type Decided = Extract<Wc64DimResult, { decided: true }>;

export interface LetterChapter64Props {
  dim: Wc64Dim;
  result: Wc64DimResult;
  /** 1~4 */
  index: number;
  plan: Wc64Plan | null;
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

function FacetRow({ dim, facet }: { dim: Wc64Dim; facet: Wc64FacetResult }) {
  if (!facet.decided) {
    return (
      <div className="flex flex-col gap-1 border-t border-[var(--hb-hairline)] py-2.5" data-facet={facet.section}>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <span className="text-[var(--hb-text-strong)]">{facet.title}</span>
          <span className={posTagClass(null)}>답이 적어 %를 내지 않았어요</span>
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
        <span>{facet.pctX}%</span><span>문장 {n}개로 낸 값</span><span>{facet.pctY}%</span>
      </div>
    </div>
  );
}

function UndecidedChapter({ dim, result, index, plan }: LetterChapter64Props) {
  const noCeremony = result.decided === false && (result.reason === "no-ceremony" || (plan === "none" && dim.id === "CIRCLE"));
  return (
    <section className={cardClass} aria-labelledby={`wc64-ch-${dim.id}`} data-dim={dim.id} data-decided="false">
      <Kicker index={index} dim={dim} />
      <h2 id={`wc64-ch-${dim.id}`} className={h2Class}>{dim.question}</h2>
      <p className={noteClass}>
        이 글자는 정하지 않았어요. {noCeremony ? "식을 올리지 않기로 해서 식 관련 문장이 빠졌어요." : "답한 문장이 적어서예요."}
      </p>
    </section>
  );
}

function DecidedChapter({ dim, r, index }: { dim: Wc64Dim; r: Decided; index: number }) {
  const [check, setCheck] = useState<"yes" | "no" | null>(null);
  const L = dim.letters[r.letter];
  const other = dim.letters[r.letterSide === "X" ? dim.letter_b : dim.letter_a];
  const shaky = isShaky(r.level);
  const fr = r.firm;
  const firmLine = r.tie
    ? "양쪽 문장에 동의한 정도가 똑같아서 딱 반반이에요."
    : `문장을 반씩 골라 다시 계산한 ${fr.total}가지 중 ${fr.agree}가지에서 ${withSubjectParticle(r.letter)} 나와요.${Number.isFinite(fr.dist) && fr.dist > 0 ? ` 답을 ${fr.dist}칸 옮기면 반반이 돼요.` : ""}`;
  const headingId = `wc64-ch-${dim.id}`;
  return (
    <section className={cardClass} aria-labelledby={headingId} data-dim={dim.id} data-decided="true" data-level={r.level}>
      <Kicker index={index} dim={dim} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="font-mono text-[40px] font-semibold leading-none text-[var(--hb-text-strong)]" aria-label={`${index}번째 글자 ${r.letter}`}>{r.letter}</p>
        <span className={levelChipClass(r.level)}>{LEVEL_TEXT[r.level]}</span>
      </div>
      <h2 id={headingId} className={h2Class}>{dim.question}</h2>
      <p className={metaClass}>이 글자가 정하는 것: {dim.decisions.join(", ")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {([["X", dim.letter_a, dim.name_a, dim.desc_a], ["Y", dim.letter_b, dim.name_b, dim.desc_b]] as const).map(([side, letter, name, desc]) => {
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
          band={r.band}
          label={`${dim.letter_a} ${dim.name_a} ${r.pctX}%, ${dim.letter_b} ${dim.name_b} ${r.pctY}%`}
          left={<><b className="font-semibold text-[var(--hb-text-strong)]">{dim.letter_a}</b> {dim.name_a}</>}
          right={<>{dim.name_b} <b className="font-semibold text-[var(--hb-text-strong)]">{dim.letter_b}</b></>}
        />
        <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
          <span><b className="text-base">{r.pctX}</b>%</span>
          <span className={metaClass}>{r.n}/{r.total}문장으로 계산</span>
          <span><b className="text-base">{r.pctY}</b>%</span>
        </div>
        <p className={metaClass}>
          {dim.letter_a}쪽 문장에 동의한 정도 {r.agreeX}%, {dim.letter_b}쪽 문장에 동의한 정도 {r.agreeY}%예요. 옅은 띠는 문장을 반씩 골라 다시 계산했을 때 %가 오간 폭이에요(가운데 80%).
        </p>
        <p className={metaClass} data-testid={`wc64-firm-${dim.id}`}>
          {firmLine}{r.tie ? " 두 쪽이 같은 무게라 완전히 그래요를 더 많이 고른 쪽 글자를 붙였어요." : ""}
        </p>
      </div>
      {shaky && <p className={noteClass}>{dim.balanced}</p>}
      <h3 className={h3Class}>묶음별로 보면</h3>
      <div>{r.facets.map(f => <FacetRow key={f.section} dim={dim} facet={f} />)}</div>
      <h3 className={h3Class}>이렇게 고르셨어요</h3>
      {r.quotes.pro.map(q => <QuoteLine key={q.itemId} q={q} />)}
      {r.quotes.con.length > 0 && (
        <>
          <p className={metaClass}>반대쪽으로 고른 문장</p>
          {r.quotes.con.map(q => <QuoteLine key={q.itemId} q={q} />)}
        </>
      )}
      {L && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className={h3Class}>{r.letter} 쪽이 편하게 여기는 것</h3>
            <ul className={listClass}>{L.comfy.map(x => <li key={x}>{x}</li>)}</ul>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className={h3Class}>챙겨 볼 것</h3>
            <ul className={listClass}>
              {L.watch.map(w => (
                <li key={w.text}>{w.text}{w.source ? <> <span className="text-xs text-[var(--hb-text-muted)]">({w.source})</span></> : null}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {shaky && other && (
        <details className="border-t border-[var(--hb-hairline)] pt-2">
          <summary className={summaryClass}>{other.letter} 쪽 설명도 보기</summary>
          <ul className={`mt-2 ${listClass}`}>{other.comfy.map(x => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
      {L && (
        <>
          <h3 className={h3Class}>앱에서 바로 해 볼 것</h3>
          <ul className={listClass}>{L.app_actions.map(x => <li key={x}>{x}</li>)}</ul>
          <p className="rounded-r-lg border-l-[3px] border-[var(--hb-primary)] bg-[var(--hb-surface-hover)] px-3 py-1.5 text-sm leading-7 text-[var(--hb-text-body)]">
            아모라에게: “{L.amora_line}”
          </p>
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
      {check === "no" && (
        <p className={noteClass} role="status">반대쪽 설명도 읽어 보고, 2~3주 뒤 다시 해 보세요. 준비가 진행되면 답이 달라지는 게 자연스러워요.</p>
      )}
    </section>
  );
}

export default function LetterChapter64(props: LetterChapter64Props) {
  const { result } = props;
  if (!result.decided) return <UndecidedChapter {...props} />;
  return <DecidedChapter dim={props.dim} r={result} index={props.index} />;
}
