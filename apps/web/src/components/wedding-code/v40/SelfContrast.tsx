import { axisInfo } from "@/constants/weddingCodeV40";
import { V40_COPY, selfContrastSentence } from "@/lib/weddingCode/v40/copy";
import type { AxisResult } from "@/lib/weddingCode/v40/types";
import { cx } from "./styles";
import { bodyLine, panel, sectionTitle, subTitle } from "./resultStyles";

export interface SelfContrastProps {
  /** 힌트를 반영한 뒤의 네 주제 결과(V40Result.axes). 대비가 있는 주제만 그린다. */
  readonly axes: readonly AxisResult[];
  readonly idPrefix?: string;
}

/**
 * 직접 고른 쪽 대비. 마지막에 직접 고른 쪽과 여러 질문에서 답이 모인 쪽이 다르고, 모인 쪽이 뚜렷해요나 기울어요이면서 직접 고른 세기가 꽤 이상일 때만
 * 코어가 대비를 만든다(score.buildResult). 이 화면은 그 조건을 다시 판단하지 않고 있는 것만 주제별로 적는다. 하나도 없으면 아무것도 그리지 않는다.
 * 판단 문장이 아니라 「직접 고른 쪽은 ○였어요」 사실만 적고 어느 쪽이 맞는지 정하지 않는다.
 */
export function SelfContrast({ axes, idPrefix = "wc40-contrast" }: SelfContrastProps) {
  const items = axes.flatMap((axis) => (axis.contrast === null ? [] : [axis.contrast]));
  if (items.length === 0) return null;
  const titleId = `${idPrefix}-title`;
  return (
    <section data-result-section="contrast" aria-labelledby={titleId} className={panel}>
      <h2 id={titleId} className={sectionTitle}>
        {V40_COPY.block.selfChoiceHeading}
      </h2>
      <ul className="mt-2 divide-y divide-[var(--hb-hairline)]">
        {items.map((contrast) => (
          <li key={contrast.axis} data-contrast-axis={contrast.axis} className="space-y-2 py-4 first:pt-2 last:pb-0">
            <p className={subTitle}>{axisInfo(contrast.axis).title}</p>
            <p className={cx(bodyLine, "break-keep")}>{selfContrastSentence(contrast)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default SelfContrast;
