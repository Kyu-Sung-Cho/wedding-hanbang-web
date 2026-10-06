import { V40_COPY, collectedSentence, type CodeLineEntry } from "@/lib/weddingCode/v40/copy";
import { axisInfo } from "@/constants/weddingCodeV40";
import { cx } from "./styles";
import { bodyLine, sectionTitle } from "./resultStyles";

export interface GatheredSentencesProps {
  /** 주제 순서 네 개. codeLineEntries(result) 를 그대로 준다. */
  readonly entries: readonly CodeLineEntry[];
  readonly idPrefix?: string;
}

/**
 * 「답을 모아 보니」 네 문장(주제마다 하나).
 * 뚜렷해요, 기울어요 주제는 그 글자 쪽으로 답했다는 문장, 반반이에요 주제(임시 글자 포함)는 두 쪽이 비슷하게 나왔다는 문장,
 * 글자를 못 정한 주제는 답할 수 있는 질문이 적었다는 문장이다. 반반이에요 주제에는 한쪽으로 답했다는 말이 나오지 않는다.
 */
export function GatheredSentences({ entries, idPrefix = "wc40-collected" }: GatheredSentencesProps) {
  const titleId = `${idPrefix}-title`;
  return (
    <section data-result-section="collected" aria-labelledby={titleId}>
      <h2 id={titleId} className={sectionTitle}>
        {V40_COPY.collected.title}
      </h2>
      <ul className={cx(bodyLine, "mt-6 grid gap-x-12 gap-y-0 min-[760px]:grid-cols-2")}>
        {entries.map((entry) => (
          <li key={entry.axis} className="border-t border-[var(--hb-hairline)] py-5 sm:py-6">
            <span className="mb-2 block text-sm font-semibold text-[var(--hb-text-muted)]">{axisInfo(entry.axis).title}</span>
            <span data-collected-axis={entry.axis} className="block max-w-[36rem] text-base font-medium leading-relaxed text-[var(--hb-text-strong)]">{collectedSentence(entry.axis, entry.letter, entry.band, entry.lowered === true)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default GatheredSentences;
