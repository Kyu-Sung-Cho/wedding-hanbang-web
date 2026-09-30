"use client";

import { Check } from "lucide-react";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ChoiceInputProps } from "@/lib/weddingCode/v40/types";
import { useRadioGroup } from "./radioGroup";
import { card, cardSelected, cx, itemIds, noticeBox, noticeText, radioMark, radioMarkSelected, radioRow } from "./styles";

/**
 * 고르기(지난 일 떠올리기 recall, 그때 나는 instant)의 입력. 보기 네 개를 라디오 카드로 세로로 쌓는다.
 * 지난 일 떠올리기에는 뷰에 noneLabel(이런 일이 없었어요)이 있어 같은 그룹의 다섯 번째 카드로 놓고, 고르면 제 상황과 안 맞아요와 같은 값(escape na)을 알린다.
 * 그때 나는은 noneLabel 이 null 이라 카드가 없다.
 * 긴 보기는 줄바꿈된다. 카드 앞의 표식은 동그라미와 체크이며 번호, 극, 세기 표시는 없다. 뷰가 이미 폼 비트를 반영한 순서다.
 * 답은 화면 위에서부터 보기 번호(option 0에서 3)로 알리고 뷰의 fmt(recall 또는 instant)를 그대로 싣는다.
 */
export function ChoiceInput({ view, value, onAnswer, idPrefix, incomplete = false }: ChoiceInputProps) {
  const ids = itemIds(idPrefix);
  const texts = view.options.map((option) => option.text);
  const noneIndex = view.noneLabel !== null ? texts.length : -1;
  const rowTexts = noneIndex >= 0 && view.noneLabel !== null ? [...texts, view.noneLabel] : texts;

  let checkedIndex: number | null = null;
  if (value !== null && (value.fmt === "recall" || value.fmt === "instant")) {
    checkedIndex = value.option >= 0 && value.option < texts.length ? value.option : null;
  } else if (value !== null && value.fmt === "escape" && value.which === "na" && noneIndex >= 0) {
    checkedIndex = noneIndex;
  }
  const answered = checkedIndex !== null || value?.fmt === "escape";

  const select = (index: number) => {
    if (index === noneIndex) onAnswer({ fmt: "escape", which: "na" });
    else if (index >= 0 && index < texts.length) onAnswer({ fmt: view.fmt, option: index });
  };
  const radio = useRadioGroup(rowTexts.length, checkedIndex, select);
  const showIncomplete = incomplete && !answered;

  return (
    <div>
      <div role="radiogroup" aria-labelledby={ids.stem} aria-label={view.caption} className="flex flex-col gap-2">
        {rowTexts.map((text, index) => {
          const checked = index === checkedIndex;
          const none = index === noneIndex;
          return (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={radio.tabIndex(index)}
              ref={radio.ref(index)}
              onClick={() => select(index)}
              onKeyDown={(event) => radio.onKeyDown(event, index)}
              className={cx(card, radioRow, "hover:bg-[var(--hb-surface-hover)]", none && "mt-2 border-dashed", checked && cardSelected)}
            >
              <span aria-hidden="true" className={cx(radioMark, checked && radioMarkSelected)}>
                {checked ? <Check className="size-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">{text}</span>
            </button>
          );
        })}
      </div>
      <p id={ids.incomplete} role="status" aria-live="polite" className={cx(noticeText, showIncomplete && cx("mt-3", noticeBox))}>
        {showIncomplete ? V40_COPY.question.incomplete : ""}
      </p>
    </div>
  );
}

export default ChoiceInput;
