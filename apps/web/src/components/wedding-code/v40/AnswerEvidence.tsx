import { axisInfo, letterInfo, oppositeLetter, type Side } from "@/constants/weddingCodeV40";
import { V40_COPY, personName } from "@/lib/weddingCode/v40/copy";
import type { Axis, AxisResult, CoupleAxisRow, FacetTally, Perspective } from "@/lib/weddingCode/v40/types";
import { cx, noteText } from "./styles";
import { useWeddingCodeResultMetadata } from "./ResultEditionContext";

export type DirectionCounts = Readonly<{
  answered: number;
  frontCount: number;
  backCount: number;
  neutralCount: number;
}>;

export function answerPercent(count: number, answered: number): number | null {
  if (!Number.isInteger(count) || !Number.isInteger(answered) || answered <= 0 || count < 0 || count > answered) return null;
  return Math.round((count * 10000) / answered) / 100;
}

function countLine(count: number, answered: number): string {
  const percent = answerPercent(count, answered);
  return percent === null ? "비율 없음" : `${count}개 / ${answered}문항 · ${percent}%`;
}

type FacetEvidence = Pick<FacetTally, "facet" | "answered" | "frontCount" | "backCount" | "neutralCount" | "counted"> &
  Partial<Pick<FacetTally, "sum">>;

/** 칸 하나가 유효하게 답한 문항 하나다. 빈 답은 차트에 섞지 않고 차트 밖의 응답 범위에 따로 적는다. */
function AnswerTiles({ counts }: { readonly counts: DirectionCounts }) {
  if (counts.answered === 0) return null;
  return (
    <div aria-hidden="true" data-answer-tiles="" className="grid grid-flow-col auto-cols-fr gap-0.5">
      {Array.from({ length: counts.answered }, (_, index) => {
        const tone = index < counts.frontCount ? "bg-[var(--hb-action)]"
          : index < counts.frontCount + counts.backCount ? "bg-[var(--hb-text-muted)]"
          : "bg-[var(--hb-hairline)]";
        return <span key={index} className={cx("h-2.5 min-w-0 rounded-sm", tone)} />;
      })}
    </div>
  );
}

/**
 * 각 문항의 값이 향한 방향을 그대로 센다. 이 비율은 글자의 확률을 뜻하지 않는다.
 * 글자 자체는 네 측면을 같은 비중으로 두고 선택 강도를 합산해 정한다.
 */
export function AnswerDistribution({
  axis,
  counts,
  compact = false,
}: {
  readonly axis: Axis;
  readonly counts: DirectionCounts;
  readonly compact?: boolean;
}) {
  const info = axisInfo(axis);
  const omitted = Math.max(0, 16 - counts.answered);
  const entries = [
    { label: `${info.front} ${letterInfo(info.front).name}`, count: counts.frontCount, tone: "bg-[var(--hb-action)]" },
    { label: `${info.back} ${letterInfo(info.back).name}`, count: counts.backCount, tone: "bg-[var(--hb-text-muted)]" },
    { label: V40_COPY.evidence.neutralLabel, count: counts.neutralCount, tone: "bg-[var(--hb-hairline)]" },
  ];
  return (
    <div data-answer-distribution={axis} className={compact ? "mt-4" : "mt-6"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-[var(--hb-text-strong)]">{V40_COPY.evidence.distributionLabel}</p>
        <p className="text-xs font-medium tabular-nums text-[var(--hb-text-muted)]">답한 {counts.answered} / 16문항</p>
      </div>
      {counts.answered === 0 ? (
        <p className={cx(noteText, "mt-3")}>{V40_COPY.evidence.noAnswers}</p>
      ) : (
        <>
          <div className="mt-3"><AnswerTiles counts={counts} /></div>
          <p className={cx(noteText, "mt-1 text-xs!")}>{V40_COPY.evidence.tilesNote}</p>
          <dl className={cx("mt-4", compact ? "space-y-3" : "grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3")}>
            {entries.map((entry, index) => (
              <div key={entry.label} className={cx("min-w-0 border-t border-[var(--hb-hairline)] pt-3", compact ? "flex items-center justify-between gap-2" : index === 2 && "col-span-2 sm:col-span-1")}>
                <dt className="min-w-0 break-keep text-xs leading-snug text-[var(--hb-text-muted)]">
                  <span aria-hidden="true" className={cx("mr-1.5 inline-block h-2 w-2 rounded-sm", entry.tone)} />{entry.label}
                </dt>
                <dd className={cx("tabular-nums text-[var(--hb-text-strong)]", compact ? "flex shrink-0 flex-col items-end gap-1" : "mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5")}>
                  <span className={cx("font-semibold leading-none", index === 2 ? "text-xl" : "text-2xl")}>{answerPercent(entry.count, counts.answered)}%</span>
                  <span className="text-xs font-medium text-[var(--hb-text-muted)]">{entry.count}개 / {counts.answered}문항</span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <p className={cx(noteText, "mt-3")}>비율에서 뺀 답 {omitted}문항{omitted > 0 || !compact ? " · 미응답·건너뜀·해당 없음" : ""}</p>
      {!compact && counts.answered > 0 ? <p className={cx(noteText, "mt-2")}>{V40_COPY.evidence.precisionNote}</p> : null}
    </div>
  );
}

function contribution(facet: FacetEvidence): number | null {
  return facet.counted && facet.answered > 0 && typeof facet.sum === "number"
    ? (facet.sum * 12) / facet.answered
    : null;
}

function countForSide(facet: FacetEvidence, side: Side): number {
  return side === "front" ? facet.frontCount : facet.backCount;
}

/** 글자 계산에 실제로 포함된 장면 중, 어느 장면이 같은 쪽 또는 반대쪽으로 작용했는지 고른다. */
export function axisFacetClues(axis: AxisResult): { support: FacetTally; counter: FacetTally | null } | null {
  if (axis.letter === null || axis.shownBand === "even" || axis.shownBand === null || axis.tieLevel !== 0) return null;
  const side = axis.letter === axisInfo(axis.axis).front ? 1 : -1;
  const facets = axis.facets
    .map((facet) => ({ facet, value: contribution(facet) }))
    .filter((entry): entry is { facet: FacetTally; value: number } => entry.value !== null);
  const support = facets.filter((entry) => entry.value * side > 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  if (!support) return null;
  const counter = facets.filter((entry) => entry.value * side < 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  return { support: support.facet, counter: counter?.facet ?? null };
}

/** 글자 하나로 압축되기 전에, 장면별로 어떤 답이 반대 방향으로 움직였는지 보여 준다. */
function AxisFacetClues({ axis }: { readonly axis: AxisResult }) {
  const { facetInfo } = useWeddingCodeResultMetadata();
  const clues = axisFacetClues(axis);
  if (!clues || axis.letter === null) return null;
  const selected = letterInfo(axis.letter);
  const opposite = letterInfo(oppositeLetter(axis.letter));
  const supportingCount = countForSide(clues.support, selected.side);
  const counterCount = clues.counter ? countForSide(clues.counter, opposite.side) : 0;
  return (
    <div data-axis-facet-clues={axis.axis} className="border-l-[3px] border-[var(--hb-summary-accent)] pl-4">
      <p className="text-sm font-semibold text-[var(--hb-text-strong)]">이 글자에 힘을 실은 장면</p>
      <p className={cx(noteText, "mt-1")}>
        {facetInfo(clues.support.facet).name}에서 답한 {clues.support.answered}문항 중 {supportingCount}문항이 「{selected.letter} {selected.name}」 쪽이었어요. 이 묶음의 답도 글자 계산에서 같은 쪽으로 작용했어요.
      </p>
      {clues.counter ? (
        <p className={cx(noteText, "mt-1")}>
          한편 {facetInfo(clues.counter.facet).name}에서는 「{opposite.letter} {opposite.name}」 쪽 답도 {counterCount}개 / {clues.counter.answered}문항 있었어요. 한 글자가 모든 장면의 선택을 뜻하지는 않아요.
        </p>
      ) : null}
    </div>
  );
}

function countMajority(facet: FacetEvidence): Side | null {
  if (!facet.counted || facet.answered < 2) return null;
  if (facet.frontCount > facet.answered / 2) return "front";
  if (facet.backCount > facet.answered / 2) return "back";
  return null;
}

/** 두 사람 모두 답한 장면 묶음에서 문항 수의 다수 방향이 서로 다른 곳 하나를 고른다. */
export function coupleFacetContrast(row: CoupleAxisRow): { first: FacetEvidence; second: FacetEvidence; firstSide: Side; secondSide: Side } | null {
  if (row.excluded) return null;
  const contrasts = row.first.facets.flatMap((first) => {
    const second = row.second.facets.find((facet) => facet.facet === first.facet);
    if (!second) return [];
    const firstSide = countMajority(first);
    const secondSide = countMajority(second);
    if (!firstSide || !secondSide || firstSide === secondSide) return [];
    const firstMargin = Math.abs(first.frontCount - first.backCount) / first.answered;
    const secondMargin = Math.abs(second.frontCount - second.backCount) / second.answered;
    return [{ first, second, firstSide, secondSide, strength: firstMargin + secondMargin }];
  });
  contrasts.sort((a, b) => b.strength - a.strength);
  return contrasts[0] ?? null;
}

export function CoupleFacetContrast({ row, perspective }: { readonly row: CoupleAxisRow; readonly perspective: Perspective | null }) {
  const { facetInfo, facetTalk } = useWeddingCodeResultMetadata();
  const contrast = coupleFacetContrast(row);
  if (!contrast) return null;
  const info = axisInfo(row.axis);
  const orderedPeople = perspective === "second" ? (["second", "first"] as const) : (["first", "second"] as const);
  const lines = orderedPeople.map((person) => {
    const facet = contrast[person];
    const side = person === "first" ? contrast.firstSide : contrast.secondSide;
    const letter = letterInfo(side === "front" ? info.front : info.back);
    return `${personName(perspective, person)} · 「${letter.letter} ${letter.name}」 쪽 ${countForSide(facet, side)}개 / ${facet.answered}문항 · ${answerPercent(countForSide(facet, side), facet.answered)}%`;
  });
  return (
    <div data-couple-facet-contrast={contrast.first.facet} className="mt-5 border-l-[3px] border-[var(--hb-summary-accent)] pl-4">
      <p className="text-xs font-semibold text-[var(--hb-text-strong)]">같은 주제 안에서 갈린 장면 · {facetInfo(contrast.first.facet).name}</p>
      <ul className={cx(noteText, "mt-1 space-y-1")}>
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className={cx(noteText, "mt-1")}>{facetTalk[contrast.first.facet]}</p>
    </div>
  );
}

export function tieReason(axis: AxisResult): string | null {
  const chosen = axis.letter ?? "앞";
  switch (axis.tieLevel) {
    case 1: return `장면 묶음의 계산 결과가 동점이어서, 고르기 문항에서 선택한 방향과 강도를 비교해 ${chosen} 쪽 글자를 적었어요.`;
    case 2: return `장면 묶음과 고르기 문항에서도 동점이어서, 반응 문항에서 선택한 방향과 강도를 비교해 ${chosen} 쪽 글자를 적었어요.`;
    case 3: return `앞선 기준이 모두 동점이어서, 계산에 포함한 장면 묶음 중 ${chosen} 쪽으로 기운 묶음이 더 많아 그 글자를 적었어요.`;
    case 4: return `앞선 기준에서도 차이가 없어, 마지막에 직접 고른 ${chosen} 글자를 적었어요.`;
    case 5: return `앞선 기준과 직접 고른 쪽으로도 정할 수 없어, ${chosen} 글자를 임시로 적었어요.`;
    default: return null;
  }
}

export function FacetBreakdown({
  axis,
  facets,
  showCalculation = false,
  compact = false,
}: {
  readonly axis: Axis;
  readonly facets: readonly FacetEvidence[];
  readonly showCalculation?: boolean;
  readonly compact?: boolean;
}) {
  const { facetInfo } = useWeddingCodeResultMetadata();
  const info = axisInfo(axis);
  return (
    <ul className={cx("mt-4 grid gap-x-8 gap-y-0", !compact && "min-[640px]:grid-cols-2")}>
      {facets.map((facet) => {
        const value = contribution(facet);
        return (
          <li key={facet.facet} className="min-w-0 border-t border-[var(--hb-hairline)] py-4" data-facet-evidence={facet.facet}>
            <p className="text-sm font-semibold text-[var(--hb-text-strong)]">{facetInfo(facet.facet).name} · 4문항 중 {facet.answered}문항 답함</p>
            {facet.answered > 0 ? (
              <div className="mt-2">
                <AnswerTiles counts={facet} />
                <p className={cx(noteText, "mt-1 text-xs!")}>{V40_COPY.evidence.tilesNote}</p>
              </div>
            ) : null}
            <p className={cx(noteText, "mt-1")}>
              {facet.answered === 0
                ? V40_COPY.evidence.noAnswers
                : `${info.front} ${letterInfo(info.front).name} 쪽 ${countLine(facet.frontCount, facet.answered)}, ${info.back} ${letterInfo(info.back).name} 쪽 ${countLine(facet.backCount, facet.answered)}, ${V40_COPY.evidence.neutralLabel} ${countLine(facet.neutralCount, facet.answered)}`}
            </p>
            {!facet.counted ? <p className={cx(noteText, "mt-2 font-medium text-[var(--hb-text-strong)]")}>{V40_COPY.evidence.excludedFacetLabel}{facet.answered > 0 ? ` · ${V40_COPY.evidence.excludedFacetNote}` : ""}</p> : null}
            {showCalculation && value !== null ? <p className={cx(noteText, "mt-1")}>선택 강도를 반영한 측면 계산값: {value > 0 ? "+" : ""}{value}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** 네 측면의 응답 분포와 실제 글자 계산 기여를 함께 보여 준다. */
export function AxisAnswerEvidence({ axis }: { readonly axis: AxisResult }) {
  const { facetInfo } = useWeddingCodeResultMetadata();
  const info = axisInfo(axis.axis);
  return (
    <div data-axis-answer-evidence={axis.axis} className="space-y-4">
      <AxisFacetClues axis={axis} />
      <AnswerDistribution axis={axis.axis} counts={axis} />
      <div className="mt-4 border-t border-[var(--hb-hairline)] pt-4">
        <p className="text-sm font-semibold text-[var(--hb-text-strong)]">장면에 따라 어떻게 달랐을까요?</p>
        <p className={cx(noteText, "mt-1")}>한 칸은 답 한 개예요. 각 묶음의 비율은 그 묶음에서 답한 문항만 세었어요.</p>
        <FacetBreakdown axis={axis.axis} facets={axis.facets} />
      </div>
      <details className="mt-3 border-t border-[var(--hb-hairline)] pt-3">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-[var(--hb-text-strong)]">
          장면 묶음별 답과 글자 계산
        </summary>
        <p className={cx(noteText, "mt-2")}>
          {info.title}에는 장면 묶음 네 개가 있어요. 각 묶음에서 답한 문항의 강도를 평균내어 같은 비중으로 더했어요. 두 문항 이상 답한 묶음만 묶음 평균 계산에 넣었어요.
        </p>
        <ul className={cx(noteText, "mt-3 space-y-2")}>
          {axis.facets.map((facet) => {
            const value = contribution(facet);
            return <li key={facet.facet}>{facetInfo(facet.facet).name} · {value === null ? facet.answered === 0 ? V40_COPY.evidence.noAnswers : V40_COPY.evidence.excludedFacetNote : `선택 강도를 반영한 측면 계산값: ${value > 0 ? "+" : ""}${value}`}</li>;
          })}
        </ul>
        {axis.weighted !== null ? (
          <p className={cx(noteText, "mt-3")}>
            글자 계산에 들어간 묶음의 계산값 합계는 {axis.weighted > 0 ? "+" : ""}{axis.weighted}예요. 양수는 {info.front}, 음수는 {info.back} 쪽이에요.
            {tieReason(axis) ? ` ${tieReason(axis)}` : ""}
          </p>
        ) : null}
      </details>
    </div>
  );
}
