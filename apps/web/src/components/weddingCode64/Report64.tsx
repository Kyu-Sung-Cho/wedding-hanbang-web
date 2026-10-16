"use client";

// wc64 리포트. 원본 page6-shell.html 의 renderReport 를 순서 그대로 React 로 옮겼다.
// 결과 카드 → 한눈에 보기 → 이 리포트 읽는 법 → 웨딩 이해도 → 글자별 장 4개 → 유형 → 장면 → 네 글자 밖
// → (비교 자리) → 다음에 해 볼 것 → 내 답 전체 → 이 결과의 한계 → 다시 하기·답 지우기.
// 이 파일은 저장소(io)·주소 해시·fetch 를 쓰지 않는다. 답을 지우고 다시 하는 일은 부모가 받은 콜백으로 한다.
import type { ReactNode } from "react";
import Button from "@/components/ui/Button";
import { WC64_BANK, WC64_ORDER, wc64SectionById } from "@/lib/weddingCode/wc64/bank";
import { wc64ConsideredAnswers, isWc64Rating } from "@/lib/weddingCode/wc64/model";
import type { Wc64Answers, Wc64DimId, Wc64DimResult, Wc64Plan, Wc64Report, Wc64Skipped } from "@/lib/weddingCode/wc64/types";
import AxisBar64 from "./AxisBar64";
import Knowledge64 from "./Knowledge64";
import LetterChapter64 from "./LetterChapter64";
import Scenes64 from "./Scenes64";
import TypeCard64 from "./TypeCard64";
import {
  LEVEL_TEXT, POS_TEXT, bodyClass, cardClass, h2Class, kickerClass, levelChipClass, listClass, metaClass, noteClass,
  primaryButtonClass, secondaryButtonClass, summaryClass,
} from "./reportStyles";

/** 결과 화면에 한 번 두는 고지 */
export const WC64_RESULT_NOTICE = "아직 실제 사람에게 확인하지 않은 새 질문이에요.";

export interface Report64Props {
  report: Wc64Report;
  answers: Wc64Answers;
  plan: Wc64Plan | null;
  /** 묶음 넘기기 상태(있으면 '내 답 전체 보기'가 계산과 같은 답을 보여 준다) */
  skipped?: Wc64Skipped;
  /** 두 사람 비교 자리(트랙 G 의 Compare64) */
  compareSlot?: ReactNode;
  onRestart: () => void;
  onClearAnswers: () => void;
}

type Decided = Extract<Wc64DimResult, { decided: true }>;

const DIM_BY_ID = new Map(WC64_BANK.dims.map(d => [d.id, d]));
const dimOf = (id: Wc64DimId) => DIM_BY_ID.get(id)!;
const sideName = (r: Decided) => (r.letterSide === "X" ? dimOf(r.dim).name_a : dimOf(r.dim).name_b);

function CodeCard({ report }: { report: Wc64Report }) {
  const t = report.type;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[var(--hb-hairline)] border-t-2 border-t-[var(--hb-primary)] bg-[var(--hb-surface-raised)] px-5 pb-5 pt-6 sm:px-6" aria-labelledby="wc64-code">
      <p className={kickerClass}>내 웨딩코드</p>
      <h1 id="wc64-code" className="flex gap-1.5 font-mono text-[46px] font-semibold leading-none tracking-[0.08em] text-[var(--hb-text-strong)] sm:text-[56px]">
        <span className="sr-only">웨딩코드 </span>
        {report.dims.map(r =>
          r.decided
            ? (
              <span
                key={r.dim}
                data-letter-slot={r.dim}
                data-tie={r.tie ? "true" : "false"}
                className={r.tie ? "underline decoration-dotted decoration-2 underline-offset-8" : undefined}
              >
                {r.letter}
              </span>
            )
            : <span key={r.dim} data-letter-slot={r.dim} data-tie="false" className="text-[var(--hb-text-muted)]">·</span>,
        )}
      </h1>
      {t && (
        <div>
          <p className="text-xl font-semibold leading-snug text-[var(--hb-text-strong)]" data-testid="wc64-type-title">{t.title}</p>
          <p className={`mt-1 ${bodyClass}`}>{t.sub}</p>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {report.dims.map(r => {
          const d = dimOf(r.dim);
          const left = <><b className="font-semibold text-[var(--hb-text-strong)]">{d.letter_a}</b> {d.name_a}</>;
          const right = <>{d.name_b} <b className="font-semibold text-[var(--hb-text-strong)]">{d.letter_b}</b></>;
          if (!r.decided) {
            return (
              <div key={r.dim} className="flex flex-col gap-1.5" data-axis={r.dim} data-decided="false">
                <div className="flex justify-between gap-3 text-[13px] leading-5 text-[var(--hb-text-body)]"><span>{left}</span><span className="text-right">{right}</span></div>
                <p className={metaClass}>
                  {r.reason === "no-ceremony" ? "식을 올리지 않기로 해서 이 글자는 정하지 않았어요." : "답한 문장이 모자라 이 글자는 정하지 않았어요."}
                </p>
              </div>
            );
          }
          return (
            <div key={r.dim} className="flex flex-col gap-1.5" data-axis={r.dim} data-decided="true">
              <AxisBar64 pctX={r.pctX} label={`${d.letter_a} ${d.name_a} ${r.pctX}%, ${d.letter_b} ${d.name_b} ${r.pctY}%`} left={left} right={right} />
              <div className="flex items-center justify-between gap-2 text-sm tabular-nums">
                <span data-pct-side="x"><b className="text-base">{r.pctX}</b>%</span>
                <span className={levelChipClass(r.level)}>{LEVEL_TEXT[r.level]}</span>
                <span data-pct-side="y"><b className="text-base">{r.pctY}</b>%</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className={metaClass}>고른 답을 네 글자로 줄였어요. 다른 사람과 비교한 점수가 아니에요.</p>
      <p className={metaClass} data-testid="wc64-result-notice">{WC64_RESULT_NOTICE}</p>
    </section>
  );
}

function Glance({ report }: { report: Wc64Report }) {
  const decided = report.dims.filter((r): r is Decided => r.decided);
  const byId = new Map(decided.map(r => [r.dim, r]));
  const strong = report.glance.strong.map(id => byId.get(id)).filter((r): r is Decided => !!r);
  const shaky = report.glance.shaky.map(id => byId.get(id)).filter((r): r is Decided => !!r);
  const { opposite, both } = report.glance;
  return (
    <section className={cardClass} aria-labelledby="wc64-glance">
      <h2 id="wc64-glance" className={h2Class}>한눈에 보기</h2>
      {report.type && <p className={bodyClass}>{report.type.one_liner}</p>}
      <ul className={listClass}>
        {strong.length > 0
          ? (
            <li>
              가장 또렷하게 기운 글자:{" "}
              {strong.map((r, i) => (
                <span key={r.dim}>{i > 0 ? ", " : ""}<b className="font-semibold text-[var(--hb-text-strong)]">{r.letter} {sideName(r)}</b>({r.letterPct}%)</span>
              ))}
            </li>
          )
          : <li>네 글자 모두 가운데 가까이 나왔어요. 두 쪽 설명을 같이 읽어 보세요.</li>}
        {shaky.map(r => (
          <li key={r.dim}><b className="font-semibold text-[var(--hb-text-strong)]">{dimOf(r.dim).name}</b> 글자는 {LEVEL_TEXT[r.level]}. 두 쪽 설명을 같이 읽어 보세요.</li>
        ))}
        {opposite.length > 0 && <li>글자와 반대쪽으로 기운 묶음: {opposite.map(f => f.title).join(", ")}</li>}
        {both.length > 0 && <li>두 쪽 문장에 비슷하게 답한 묶음: {both.map(f => `${f.title}(${POS_TEXT[f.pos]})`).join(", ")}</li>}
      </ul>
      {report.patterns.includes("same") && <p className={noteClass}>같은 칸을 많이 고르셨어요. 다시 해 보시면 더 또렷해질 수 있어요.</p>}
      {report.patterns.includes("agree") && <p className={noteClass}>대부분 문장에 그래요를 골라 %가 50 가까이 모일 수 있어요.</p>}
    </section>
  );
}

function ReadHow() {
  return (
    <details className={cardClass}>
      <summary className={summaryClass}><h2 className="text-base font-semibold">이 리포트 읽는 법</h2></summary>
      <div className={`flex flex-col gap-2 ${bodyClass}`}>
        <p>%는 한쪽 문장에 동의한 정도와 반대쪽 문장에 동의한 정도의 차이를 0~100으로 옮긴 값이에요. 50이 가운데이고, 100은 한쪽 문장 전부에 완전히 그래요, 반대쪽 전부에 전혀 아니에요를 고른 경우예요.</p>
        <p>다른 사람과 비교한 순위나 맞힌 비율은 아니에요. 같은 답이면 언제나 같은 %가 나와요.</p>
        <p>양쪽 문장을 같은 수만큼 넣고 따로 평균을 내서, 무엇이든 그래요를 고르는 버릇은 지워져요.</p>
        <p>글자 단단함은 내 답끼리 얼마나 한쪽으로 모였는지예요. 문장을 반씩 골라 모든 경우로 다시 계산해 보고, 반반이 되려면 답을 몇 칸 옮겨야 하는지 봐요.</p>
      </div>
    </details>
  );
}

function FundCard({ report }: { report: Wc64Report }) {
  const fs = report.fund;
  const f = WC64_BANK.fund;
  return (
    <section className={cardClass} aria-labelledby="wc64-fund">
      <div>
        <h2 id="wc64-fund" className={h2Class}>네 글자 밖에서 본 것</h2>
        <p className={`mt-1 ${kickerClass}`}>결혼 비용 마련</p>
      </div>
      {fs.decided
        ? (
          <div className="flex flex-col gap-1.5" data-testid="wc64-fund-bar">
            <AxisBar64 pctX={fs.pctA} label={`${f.a_name} ${fs.pctA}%, ${f.b_name} ${fs.pctB}%`} left={f.a_name} right={f.b_name} />
            <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
              <span><b className="text-base">{fs.pctA}</b>%</span>
              <span className={metaClass}>문장 {fs.n}개로 낸 값</span>
              <span><b className="text-base">{fs.pctB}</b>%</span>
            </div>
          </div>
        )
        : <p className={metaClass}>한쪽 문장만 남아 %를 내지 않았어요.</p>}
      <p className={metaClass}>{f.why_outside}</p>
    </section>
  );
}

function NextCard({ report }: { report: Wc64Report }) {
  if (!report.type) return null;
  return (
    <section className={cardClass} aria-labelledby="wc64-next">
      <h2 id="wc64-next" className={h2Class}>다음에 해 볼 것</h2>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-7 text-[var(--hb-text-body)]">
        {report.type.tips.map(x => <li key={x}>{x}</li>)}
      </ol>
      <p className={metaClass}>준비가 진행되면 답이 달라져도 자연스러워요. 2~3주 뒤 다시 해 보세요.</p>
    </section>
  );
}

function AllAnswers({ answers }: { answers: Wc64Answers }) {
  const scale = WC64_BANK.meta.scale;
  return (
    <details className={cardClass}>
      <summary className={summaryClass}><h2 className="text-base font-semibold">내 답 전체 보기</h2></summary>
      <ul className="flex flex-col">
        {WC64_ORDER.flatMap(sid => {
          const sec = wc64SectionById(sid);
          if (!sec) return [];
          const d = WC64_BANK.dims.find(dd => dd.facets.some(f => f.axis === sid));
          const facet = d?.facets.find(f => f.axis === sid);
          return sec.items.map(it => {
            const v = answers[it.id];
            const where = d && facet
              ? `${it.pole === facet.a_is ? d.letter_a : d.letter_b} 쪽`
              : sid === "KNOW" ? "이해도" : sid === "FUND" ? "글자 밖" : "";
            const label = isWc64Rating(v) ? scale[v - 1] : v === 0 ? "해당 없음" : "건너뜀";
            return (
              <li key={it.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2.5 border-t border-[var(--hb-hairline)] py-2" data-answer-item={it.id}>
                <span className="text-xs leading-6 tabular-nums text-[var(--hb-text-muted)]">{where}</span>
                <div className="text-sm leading-6 text-[var(--hb-text-body)]">
                  {it.text} <span className="text-xs font-semibold text-[var(--hb-selected-text)]">{label}</span>
                </div>
              </li>
            );
          });
        })}
      </ul>
    </details>
  );
}

function Limits() {
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-[var(--hb-surface-hover)] px-5 py-4 text-sm leading-7 text-[var(--hb-text-body)]" aria-labelledby="wc64-limits">
      <h2 id="wc64-limits" className="text-base font-semibold text-[var(--hb-text-strong)]">이 결과의 한계</h2>
      <p>사람 응답 없이 만든 초안이라, 묶음들이 한 글자로 같이 움직인다는 건 아직 가정이에요.</p>
      <p>%는 고른 답으로 계산한 값이지만 다른 사람과 비교한 점수나 맞힌 비율이 아니에요. 아슬한 글자는 다시 하면 바뀔 수 있어요.</p>
      <p>결혼 준비에서 고른 선호이지 성격 판정이나 두 사람 관계를 내다보는 결과가 아니에요. 채용, 매칭, 남에게 꼬리표 붙이기에 쓰지 말아 주세요.</p>
    </section>
  );
}

export default function Report64({ report, answers, plan, skipped, compareSlot, onRestart, onClearAnswers }: Report64Props) {
  const shown = wc64ConsideredAnswers(answers, plan, skipped ?? {});
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5 break-keep text-[var(--hb-text-strong)] [overflow-wrap:anywhere]" data-testid="wc64-report">
      <CodeCard report={report} />
      <Glance report={report} />
      <ReadHow />
      <Knowledge64 knowledge={report.knowledge} />
      {WC64_BANK.dims.map((d, i) => {
        const r = report.dims.find(x => x.dim === d.id);
        return r ? <LetterChapter64 key={d.id} dim={d} result={r} index={i + 1} plan={plan} /> : null;
      })}
      {report.type && <TypeCard64 type={report.type} />}
      {report.scenes.length > 0 && <Scenes64 scenes={report.scenes} />}
      <FundCard report={report} />
      {compareSlot}
      <NextCard report={report} />
      <AllAnswers answers={shown} />
      <Limits />
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" size="lg" onClick={onRestart} className={primaryButtonClass}>처음부터 다시 하기</Button>
        <Button variant="secondary" size="md" onClick={onClearAnswers} className={secondaryButtonClass}>이 브라우저의 답 지우기</Button>
      </div>
    </div>
  );
}
