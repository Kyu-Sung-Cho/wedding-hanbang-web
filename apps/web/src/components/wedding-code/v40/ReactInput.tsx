"use client";

import { Check } from "lucide-react";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ReactInputProps } from "@/lib/weddingCode/v40/types";
import { V40_INPUT_LOCAL_COPY } from "./localCopy";
import { useRadioGroup } from "./radioGroup";
import { bodyText, cx, focusRing, itemIds, noteText, noticeBox, noticeText, srOnly, stemText } from "./styles";

// 다섯 칸 한 칸의 모양. 칸 전체(가로로 나눈 한 칸, 높이 48픽셀 이상)가 눌리는 자리이고 안의 동그라미는 표식이다.
// 색만으로 알리지 않는다: 고른 칸은 채워지고 체크가 보이며 테두리가 굵어진다. 뜻은 낭독 이름(aria-label)이 말한다.
const cellBase = `flex min-h-12 items-center justify-center rounded-lg ${focusRing}`;
const markBase =
  "flex size-8 items-center justify-center rounded-full border-2 border-paper-outline bg-[var(--hb-surface-raised)] text-[var(--hb-on-primary)]";
const markChecked = "border-[var(--hb-action)]! bg-[var(--hb-action)]! shadow-[0_0_0_2px_var(--hb-selected-bg)]";

/**
 * 이럴 때 내 마음의 입력. 사연이 있으면 인용 블록(말한 사람 + 인용문)으로 따로 보이고, 물음 아래에 다섯 칸을 놓는다.
 * 양끝 이름은 뷰가 준 화면 기준 그대로 왼쪽 끝과 오른쪽 끝 아래에 보인다(폼 비트 1이면 뷰에서 이미 자리가 바뀌어 있다).
 * 라디오 그룹 하나이고 이름은 물음, 설명은 (사연이 있으면 말한 사람과 인용문, 그리고) 뷰의 groupDescription 이다. 그래서 폼 컨트롤만 훑는 낭독기
 * 사용자도 그룹에 들어올 때 무슨 말을 듣고 답하는지 듣는다. 칸마다 낭독 이름(예: 다섯 칸 중 가운데)이 있고 보이는 글자에는 번호가 없다.
 * 답은 왼쪽부터 칸 번호(cell 0에서 4)로 알린다.
 */
export function ReactInput({ view, value, onAnswer, idPrefix, incomplete = false }: ReactInputProps) {
  const ids = itemIds(idPrefix);
  const cells = view.cells;
  const foundIndex = value !== null && value.fmt === "react" ? cells.findIndex((cell) => cell.cell === value.cell) : -1;
  const checkedIndex = foundIndex >= 0 ? foundIndex : null;
  const answered = checkedIndex !== null || value?.fmt === "escape";

  const select = (index: number) => {
    const target = cells[index];
    if (target) onAnswer({ fmt: "react", cell: target.cell });
  };
  const radio = useRadioGroup(cells.length, checkedIndex, select);
  const showIncomplete = incomplete && !answered;

  return (
    <div>
      {view.quote ? (
        <figure aria-labelledby={ids.speaker} className="rounded-xl bg-[var(--hb-surface-hover)] px-4 py-3">
          <figcaption id={ids.speaker} className={noteText}>
            <span className={srOnly}>{V40_INPUT_LOCAL_COPY.quoteSpeakerLabel}: </span>
            {view.quote.speaker}
          </figcaption>
          <blockquote id={ids.quote} className={cx(bodyText, "mt-1 text-[var(--hb-text-strong)]")}>
            「{view.quote.text}」
          </blockquote>
        </figure>
      ) : null}
      <p id={ids.question} className={cx(stemText, view.quote !== null && "mt-4")}>
        {view.question}
      </p>
      <span id={ids.groupHelp} className={srOnly}>
        {view.groupDescription}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={ids.question}
        aria-label={view.question}
        aria-describedby={view.quote !== null ? `${ids.speaker} ${ids.quote} ${ids.groupHelp}` : ids.groupHelp}
        className="mt-3"
      >
        <div className="grid grid-cols-5 gap-1">
          {cells.map((cell, index) => {
            const checked = index === checkedIndex;
            return (
              <button
                key={cell.cell}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={cell.accessibleName}
                tabIndex={radio.tabIndex(index)}
                ref={radio.ref(index)}
                onClick={() => select(index)}
                onKeyDown={(event) => radio.onKeyDown(event, index)}
                className={cx(cellBase, "hover:bg-[var(--hb-surface-hover)]")}
              >
                <span aria-hidden="true" className={cx(markBase, checked && markChecked)}>
                  {checked ? <Check className="size-4" /> : null}
                </span>
              </button>
            );
          })}
        </div>
        {/* 양끝 이름은 칸의 낭독 이름과 그룹 설명에 이미 들어 있어서 눈에만 보이게 한다. */}
        <div aria-hidden="true" className="mt-1 flex justify-between gap-4">
          <span className={cx(bodyText, "max-w-[46%] text-left text-balance font-medium")}>{view.ends.left}</span>
          <span className={cx(bodyText, "max-w-[46%] text-right text-balance font-medium")}>{view.ends.right}</span>
        </div>
      </div>
      <p id={ids.incomplete} role="status" aria-live="polite" className={cx(noticeText, showIncomplete && cx("mt-3", noticeBox))}>
        {showIncomplete ? V40_COPY.question.incomplete : ""}
      </p>
    </div>
  );
}

export default ReactInput;
