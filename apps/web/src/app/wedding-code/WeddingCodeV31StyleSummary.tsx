"use client";

import Button from "@/components/ui/Button";
import type { V31Draft } from "@/constants/weddingCodeV31";
import { buildV31StatementScales, buildV31StyleSummary } from "@/lib/weddingCode/v31StyleSummary";
import { v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";

type EditHandler = (id?: string) => void;
type StatementScale = ReturnType<typeof buildV31StatementScales>[number]["items"][number];

function meterWidth(percent: number): string {
  if (percent === 100) return "w-full";
  if (percent === 75) return "w-3/4";
  if (percent === 50) return "w-1/2";
  if (percent === 25) return "w-1/4";
  return "w-0";
}

function Statement({ item, onEdit }: { item: StatementScale; onEdit?: EditHandler }) {
  return <div className="min-w-0 py-4 first:pt-0 last:pb-0" data-statement-scale={item.id}>
    <p className={v31Body}>{item.statement}</p>
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className={`text-sm ${v31Title}`}>{item.responseLabel}</p>
      {item.percent !== null ? <p className={`text-sm tabular-nums ${v31Title}`}>{item.percent}%</p> : null}
    </div>
    {item.percent !== null ? <div
      role="meter"
      aria-label={`${item.shortLabel} 동의 정도`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={item.percent}
      aria-valuetext={`${item.percent}% · ${item.responseLabel}`}
      className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--hb-surface-hover)]"
    ><div aria-hidden="true" className={`h-full rounded-full bg-[var(--hb-action)] ${meterWidth(item.percent)}`} /></div> : null}
    {onEdit ? <Button variant="ghost" size="sm" onClick={() => onEdit(item.id)} aria-label={`${item.shortLabel} 답 수정`} className="mt-2">답 수정</Button> : null}
  </div>;
}

export default function WeddingCodeV31StyleSummary({ draft, label, onEdit, compact = false }: {
  draft: V31Draft;
  label?: string;
  onEdit?: EditHandler;
  compact?: boolean;
}) {
  const summary = buildV31StyleSummary(draft);
  const coreIds = new Set(summary.dimensions.flatMap(dimension => dimension.items.map(item => item.id)));
  const extraGroups = buildV31StatementScales(draft)
    .map(group => ({ ...group, items: group.items.filter(item => !coreIds.has(item.id)) }))
    .filter(group => group.items.length > 0);
  const coreGroups = summary.dimensions
    .map(dimension => ({ ...dimension, items: dimension.items.filter(item => item.response !== undefined) }))
    .filter(dimension => dimension.items.length > 0);

  return <section
    aria-label={label ?? "내 웨딩코드 응답 요약"}
    data-style-summary={summary.code}
    data-summary-version={summary.version}
    className={`${v31Surface} min-w-0 ${compact ? "p-4 sm:p-5" : "p-5 sm:p-7"}`}
  >
    <p className="text-xs font-semibold text-[var(--hb-success)]">{label ?? "내 웨딩코드"}</p>
    <p className={`mt-3 break-words font-mono text-4xl leading-tight tracking-widest ${v31Title}`} aria-label={`네 주제 응답 요약 코드 ${summary.dimensions.map(dimension => dimension.letter === "?" ? "요약 보류" : dimension.letter).join(", ")}`}>
      {summary.code}
    </p>
    <h2 className={`mt-3 text-xl leading-snug ${v31Title}`}>{summary.name}</h2>
    <p className={`mt-2 ${v31Body}`}>{summary.headline}</p>
    <p className={`mt-3 ${v31Body}`}>예산, 일 나누기, 가족과 상의, 받고 싶은 도움. 네 주제에 답한 내용을 한 글자씩 묶었어요.</p>
    {summary.hasIncomplete ? <p className={`mt-2 ${v31Body}`}>지금 답한 부분의 요약이에요. ‘?’가 있는 주제는 아래에서 각 문장에 남긴 답을 확인해 주세요.</p> : null}
    <p className="mt-2 text-xs leading-relaxed text-[var(--hb-text-muted)]">답이 바뀌면 코드도 달라질 수 있어요. 결혼식의 구체적인 취향은 아래 개인 결과에서 함께 확인해 주세요.</p>

    <dl className="mt-5 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">
      {summary.dimensions.map(dimension => <div key={dimension.key} className="py-4" data-summary-topic={dimension.key}>
        <dt className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={`text-sm ${v31Title}`}>{dimension.title}</span>
          <span className={`text-sm ${v31Title}`}><span className="font-mono">{dimension.letter}</span> · {dimension.englishLabel}</span>
        </dt>
        <dd className={`mt-2 ${v31Body}`}>{dimension.label}</dd>
        <dd className="mt-2 text-xs leading-relaxed text-[var(--hb-text-muted)]">요약 근거 · {dimension.basis}</dd>
      </div>)}
    </dl>

    <details open={!compact} className="mt-4" data-core-statement-scales>
      <summary className={`flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4 ${v31Title}`}>코드를 만든 문장 동의 정도</summary>
      <div className="pt-3">
        <p className={v31Body}>다섯 보기를 0%·25%·50%·75%·100% 눈금으로 옮겼어요. 각 문장에 얼마나 동의했는지 보여주는 표시예요. 성격 비율이나 정확도가 아니에요.</p>
        <p className={`mt-2 ${v31Body}`}>두 값의 합이 100%가 될 필요는 없어요. 0%라고 반대 취향인 것은 아니며, 모름·계획 없음·건너뜀은 숫자로 바꾸지 않았어요.</p>
        {coreGroups.length ? coreGroups.map(group => <section key={group.key} className="mt-5" aria-label={`${group.title} 문장 동의 정도`}>
          <h3 className={`mb-3 text-sm ${v31Title}`}>{group.title}</h3>
          <div className="divide-y divide-[var(--hb-hairline)]">{group.items.map(item => <Statement key={item.id} item={item} onEdit={onEdit} />)}</div>
        </section>) : <p className={`mt-4 ${v31Body}`}>이 요약에 쓰는 문장은 아직 답하지 않았어요. 답을 남기면 고른 보기와 동의 정도를 여기서 볼 수 있어요.</p>}
      </div>
    </details>

    {extraGroups.length ? <details className="mt-3 border-t border-[var(--hb-hairline)] pt-3" data-extra-statement-scales>
      <summary className={`flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4 ${v31Title}`}>다른 문장에 답한 정도도 보기</summary>
      <p className={`mt-3 ${v31Body}`}>이 답들은 네 글자에는 넣지 않았어요. 취향이나 함께 준비하는 방식을 더 살펴볼 때 참고해 주세요.</p>
      {extraGroups.map(group => <section key={group.key} className="mt-5" aria-label={`${group.title}의 다른 문장 동의 정도`}>
        <h3 className={`mb-3 text-sm ${v31Title}`}>{group.title}</h3>
        <div className="divide-y divide-[var(--hb-hairline)]">{group.items.map(item => <Statement key={item.id} item={item} onEdit={onEdit} />)}</div>
      </section>)}
    </details> : null}
  </section>;
}
