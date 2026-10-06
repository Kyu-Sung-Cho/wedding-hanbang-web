import { axisInfo, letterInfo } from "@/constants/weddingCodeV40";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { AxisResult } from "@/lib/weddingCode/v40/types";
import { tieReason } from "./AnswerEvidence";
import { cx, noteText } from "./styles";

/** 실제 판정·동점·표시 세기만 설명하며 횟수 비율을 글자의 확률로 바꾸지 않는다. */
export function axisReadingReasons(axis: AxisResult): readonly string[] {
  if (axis.letter === null) return [V40_COPY.evidence.unsetReason];
  const info = axisInfo(axis.axis);
  const majority = axis.frontCount > axis.backCount ? info.front : axis.backCount > axis.frontCount ? info.back : null;
  const tie = tieReason(axis);
  const lines: string[] = [];
  if (majority !== null && majority !== axis.letter) {
    lines.push(`선택 개수는 ${majority} ${letterInfo(majority).name} 쪽이 더 많아요. 글자는 선택 횟수만으로 정하지 않아요.`);
  }
  lines.push(tie ?? `${axis.countedFacets}개 장면 묶음의 평균 선택 강도를 같은 비중으로 더한 결과, ${axis.letter} ${letterInfo(axis.letter).name} 쪽으로 나왔어요.`);
  if (axis.band !== axis.shownBand) lines.push(V40_COPY.evidence.demotedReason);
  else if (axis.shownBand === "even" && axis.tieLevel === 0) lines.push(V40_COPY.evidence.evenReason);
  return lines;
}

export function AxisReadingReason({ axis }: { readonly axis: AxisResult }) {
  return (
    <div data-axis-reading-reason={axis.axis} className="mt-4 border-l-2 border-[var(--hb-summary-accent)] pl-3">
      <p className="text-xs font-semibold text-[var(--hb-text-strong)]">{V40_COPY.evidence.reasonLabel}</p>
      {axisReadingReasons(axis).map((line) => <p key={line} className={cx(noteText, "mt-1 break-keep")}>{line}</p>)}
    </div>
  );
}

export default AxisReadingReason;
