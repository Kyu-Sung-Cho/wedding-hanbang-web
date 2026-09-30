"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import Button from "@/components/ui/Button";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ItemView, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { buttonFocusFix, captionText, cx, itemIds, noteText, stemText } from "./styles";

export interface ItemFrameProps {
  /** 캡션, 앞말, 두 넘기기 이름만 읽는다. 형식별 필드는 아래 입력 컴포넌트가 읽는다. */
  readonly view: ItemView;
  /** 지금 화면 답. 넘기기를 눌렀는지 보고 단추 상태와 안내 한 줄을 정한다. */
  readonly value: ViewAnswer | null;
  readonly onAnswer: (answer: ViewAnswer) => void;
  /** 한 화면 안에서 겹치지 않는 접두어. 안의 입력 컴포넌트에도 같은 값을 준다. */
  readonly idPrefix: string;
  /** 그 형식이 처음 나오는 화면에서만 화면 묶음이 넘기는 형식 안내 한 줄. 없으면 그리지 않는다. */
  readonly hint?: string | null;
  /**
   * 한 화면에 두 문항이 있을 때 둘째 문항에 준다. 위에 가는 선과 넉넉한 빈칸을 얹어, 첫 문항의 넘기기 단추와 둘째 문항의 캡션이
   * 빈칸만으로 갈리지 않게 한다(단추가 어느 문항 것인지 모호해지는 것을 막는다). 첫 문항과 한 문항짜리 화면에는 주지 않는다.
   */
  readonly separated?: boolean;
  /** 형식 입력(PairInput, ReactInput, ChoiceInput 등). */
  readonly children: ReactNode;
}

/** 넘기기 뒤에 문항 아래에 한 줄로 알리는 말. 지난 일 떠올리기에서 해당 없음은 「이런 일이 없었어요」 문장을 쓴다. */
function escapeStatus(view: ItemView, value: ViewAnswer | null): string {
  if (value === null || value.fmt !== "escape") return "";
  if (value.which === "unsure") return V40_COPY.question.escapeChosenUnsure;
  return view.fmt === "recall" && view.noneLabel !== null
    ? V40_COPY.question.escapeChosenRecallNone
    : V40_COPY.question.escapeChosenNotApplicable;
}

const escapeButtonClass = cx(
  "min-h-11! whitespace-normal! border border-paper-outline px-3! text-[13px]! font-normal!",
  buttonFocusFix,
);
const escapeButtonPressed = "border-[var(--hb-selected-line)]! bg-[var(--hb-selected-bg)]!";

/**
 * 문항 하나를 감싸는 틀. 캡션(작은 글씨, 번호 없음), 앞말, 형식 안내 한 줄(선택), 형식 입력 자리, 작은 넘기기 단추 둘, 안내 한 줄(aria-live)을 그린다.
 * 넘기기는 저장값이 빠진 값이다: 잘 모르겠어요는 unsure, 제 상황과 안 맞아요는 na. 눌러도 다음으로 넘어가지 않는다.
 * 안내 자리는 처음부터 문서에 있어야 낭독기가 바뀐 글을 읽으므로 비어 있어도 그린다.
 *
 * 넘기기 단추는 aria-pressed 를 쓰지만 다시 눌러도 풀리지 않는다: 계약에 답을 비우는 값이 없어서, 푸는 방법은 다른 답을 고르는 것이다
 * (그러면 넘기기가 풀리고 안내 한 줄이 사라진다). 지난 일 떠올리기에서는 「이런 일이 없었어요」 카드와 「제 상황과 안 맞아요」 단추가 같은
 * 값(escape na)이라 둘이 함께 눌린 모양이 된다. 같은 값이 두 곳에 같이 보이는 것이 오히려 일관되어 그대로 둔다.
 */
export function ItemFrame({ view, value, onAnswer, idPrefix, hint = null, separated = false, children }: ItemFrameProps) {
  const ids = itemIds(idPrefix);
  const status = escapeStatus(view, value);
  const unsurePressed = value?.fmt === "escape" && value.which === "unsure";
  const naPressed = value?.fmt === "escape" && value.which === "na";

  const escapeButton = (which: "unsure" | "na", label: string, pressed: boolean) => (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={pressed}
      aria-describedby={ids.escapeHelp}
      onClick={() => onAnswer({ fmt: "escape", which })}
      className={cx(escapeButtonClass, pressed && escapeButtonPressed)}
    >
      {pressed ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
      <span>{label}</span>
    </Button>
  );

  return (
    <div role="group" aria-labelledby={ids.caption} className={separated ? "mt-8 border-t border-[var(--hb-hairline)] pt-8" : undefined}>
      <p id={ids.caption} className={captionText}>
        {view.caption}
      </p>
      <p id={ids.stem} className={cx(stemText, "mt-1")}>
        {view.stem}
      </p>
      {hint ? (
        <p id={ids.hint} className={cx(noteText, "mt-2")}>
          {hint}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {escapeButton("unsure", view.escapes.unsure, unsurePressed)}
        {escapeButton("na", view.escapes.notApplicable, naPressed)}
      </div>
      {/* 숨긴 글이라 훑어 읽을 때는 문항마다 나오지 않고, 넘기기 단추에 초점이 올 때만 설명으로 읽힌다. */}
      <span id={ids.escapeHelp} hidden>
        {V40_COPY.question.escapeDescription}
      </span>
      <p id={ids.status} role="status" aria-live="polite" aria-atomic="true" className={cx(noteText, status !== "" && "mt-2")}>
        {status}
      </p>
    </div>
  );
}

export default ItemFrame;
