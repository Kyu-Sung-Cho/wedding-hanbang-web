// 네 글자가 함께 보이는 모습: 이름(형용사 + 동물)·네 글자·유형 제목(제목과 부제를 한 줄로)·한 줄·글자끼리 만나는 곳·먼저/미루기 쉬운 것.
// 2026-10-17 파운더 결정(결과 이름): 머리 제목은 이름이고, 네 글자와 유형 제목은 그 아래 작게 둔다. 그림 없이 글로만 쓰고,
// 이름 둘레에 성격 풀이를 붙이지 않는다.
// 넘긴 묶음에 기댄 줄(가족 묶음의 양가 이야기)은 wc64TypeCopy 가 report.hiddenTags 로 뺀다.
// 가운데 가까운 글자가 많거나 답 모양 알림이 있으면(참고로만 표시, 2026-10-16 DEC-2) 이름과 유형 제목만 두고 설명은 접어 둔다.
// 다시 하면 이름이 달라질 수 있다는 말은 결과 카드(Report64 의 다시 하기 줄) 한 곳에만 둔다(2026-10-17 점검: 같은 화면에서 두 번 나왔다).
import type { ReactNode } from "react";
import { wc64TypeCopy } from "@/lib/weddingCode/wc64/model";
import type { Wc64TypeCard } from "@/lib/weddingCode/wc64/types";
import {
  bodyClass, cardClass, foldClosedText, foldOpenText, h2Class, h3Class, kickerClass, listClass, summaryClass,
  WC64_REFERENCE_FOLD_LABEL, wc64NameLabel, wc64TypeTitle,
} from "./reportStyles";

export interface TypeCard64Props {
  type: Wc64TypeCard;
  /** 이 유형의 네 글자(보통 report.code). 유형 카드는 네 글자를 모두 정했을 때만 그려서 가운뎃점이 없다. */
  code: string;
  /** 뺄 표식(보통 report.hiddenTags) */
  hiddenTags?: readonly string[];
  /** 참고로만 표시: 설명을 접어 둔다 */
  referenceOnly?: boolean;
}

export default function TypeCard64({ type, code, hiddenTags = [], referenceOnly = false }: TypeCard64Props) {
  const copy = wc64TypeCopy(type, hiddenTags);
  const sides = ([["먼저 챙기기 쉬운 것", copy.first], ["미루기 쉬운 것", copy.later]] as const).filter(([, text]) => text !== "");
  const body: ReactNode = (
    <div className="flex flex-col gap-4">
      <p className={bodyClass} data-testid="wc64-type-one-liner">{copy.one_liner}</p>
      {copy.meets.length > 0 && (
        <>
          <h3 className={h3Class}>글자끼리 만나는 곳</h3>
          <ul className={listClass}>{copy.meets.map(x => <li key={x}>{x}</li>)}</ul>
        </>
      )}
      {sides.length > 0 && (
        <div className={`grid gap-4 ${sides.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {sides.map(([title, text]) => (
            <div key={title} className="flex min-w-0 flex-col gap-1.5"><h3 className={h3Class}>{title}</h3><p className={bodyClass}>{text}</p></div>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <section className={cardClass} aria-labelledby="wc64-type" data-reference-only={referenceOnly ? "true" : "false"}>
      <p className={kickerClass}>네 글자가 함께 보이는 모습</p>
      <div className="flex flex-col gap-1">
        <h2 id="wc64-type" className={h2Class}>{wc64NameLabel(type.name)}</h2>
        <p className="font-mono text-sm font-semibold leading-6 tracking-[0.12em] text-[var(--hb-text-muted)]" data-testid="wc64-type-code">
          <span className="sr-only">웨딩코드 </span>{code}
        </p>
        <p className={bodyClass} data-testid="wc64-type-subtitle">{wc64TypeTitle(type)}</p>
      </div>
      {referenceOnly
        ? (
          <details>
            <summary className={summaryClass}>
              <span className="sr-only">유형 설명 </span>
              <span className={foldClosedText}>{WC64_REFERENCE_FOLD_LABEL}</span>
              <span className={foldOpenText}>접기</span>
            </summary>
            <div className="mt-2">{body}</div>
          </details>
        )
        : body}
    </section>
  );
}
