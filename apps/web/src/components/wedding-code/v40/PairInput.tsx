"use client";

import { Check } from "lucide-react";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { PairCellView, PairInputProps } from "@/lib/weddingCode/v40/types";
import { V40_INPUT_LOCAL_COPY } from "./localCopy";
import { useRadioGroup } from "./radioGroup";
import { bodyText, card, cardSelected, cx, focusRing, itemIds, noticeBox, noticeText, srOnly } from "./styles";

// 칸 하나(조금, 꽤, 아주)의 모양. 눌러서 카드와 세기를 함께 고른다.
// 색만으로 알리지 않는다: 세기는 점 세 개(찬 점 수), 선택은 체크 표식과 채움으로 보이고, 뜻은 낭독 이름(aria-label)이 전부 말한다.
const cellBase = `flex min-h-14 flex-col items-center justify-center gap-1 rounded-[8px] border px-1 py-2 text-sm font-semibold transition-[background-color,border-color,color] duration-150 ${focusRing}`;
const cellIdle =
  "border-paper-outline bg-[var(--hb-surface-raised)] text-[var(--hb-text-strong)] hover:bg-[var(--hb-surface-hover)]";
const cellChecked = "border-[var(--hb-selected-line)]! bg-[var(--hb-selected-bg)]! text-[var(--hb-selected-text)]! shadow-[inset_0_0_0_1px_var(--hb-selected-line)]";

function StrengthDots({ level }: { readonly level: 1 | 2 | 3 }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {[1, 2, 3].map((n) => (
        <span key={n} className={cx("size-2 rounded-full border border-current", n <= level && "bg-current")} />
      ))}
    </span>
  );
}

/**
 * 두 가지 중 고르기와 자기 선택의 입력. 카드 두 장을 위아래로 쌓고 카드마다 세 칸을 둔다.
 * 라디오 그룹 하나에 칸 여섯 개이고 DOM 순서는 뷰의 cells 순서(위 아주, 꽤, 조금, 아래 조금, 꽤, 아주)라서 방향키가 척도를 따라 걷는다.
 * 뷰가 이미 폼 비트를 반영했으므로 여기서는 위아래가 어느 극인지 모른다. 화면에 A/B 나 번호 라벨을 쓰지 않는다.
 * 답은 화면 칸 번호(cell 0에서 5)로 알리고 뷰의 fmt(pair 또는 self)를 그대로 싣는다.
 *
 * 칸의 이름은 「위 카드에 가까워요, 아주」처럼 위치만 말하므로, 카드 글은 그 카드의 세 칸에 설명(aria-describedby)으로 붙인다.
 * 그래서 폼 컨트롤만 훑는 낭독기 사용자도 칸에 초점이 올 때 카드가 무슨 말인지 듣는다.
 */
export function PairInput({ view, value, onAnswer, idPrefix, incomplete = false }: PairInputProps) {
  const ids = itemIds(idPrefix);
  // 뷰의 칸 순서를 그대로 이어 DOM 순서로 쓴다(위 카드 세 칸, 아래 카드 세 칸).
  const rows: readonly (readonly PairCellView[])[] = [
    view.cells.filter((cell) => cell.cardIndex === 0),
    view.cells.filter((cell) => cell.cardIndex === 1),
  ];
  const ordered = [...rows[0], ...rows[1]];

  const pickedCell = value !== null && (value.fmt === "pair" || value.fmt === "self") ? value.cell : null;
  const foundIndex = pickedCell === null ? -1 : ordered.findIndex((cell) => cell.cell === pickedCell);
  const checkedIndex = foundIndex >= 0 ? foundIndex : null;
  const answered = checkedIndex !== null || value?.fmt === "escape";

  const select = (index: number) => {
    const target = ordered[index];
    if (target) onAnswer({ fmt: view.fmt, cell: target.cell });
  };
  const radio = useRadioGroup(ordered.length, checkedIndex, select);
  const showIncomplete = incomplete && !answered;
  const cardTextIds = [ids.card0, ids.card1] as const;

  return (
    <div>
      <div role="radiogroup" aria-labelledby={ids.stem} aria-label={view.caption} className="space-y-4">
        {rows.map((cells, cardIndex) => {
          const cardChosen = checkedIndex !== null && ordered[checkedIndex].cardIndex === cardIndex;
          const cardText = view.cards[cardIndex]?.text ?? "";
          return (
            <div key={cardIndex} className={cx(card, "p-5 sm:p-6", cardChosen && cardSelected)}>
              <p id={cardTextIds[cardIndex]} className={cx(bodyText, "text-[16px]! leading-[1.7]! text-[var(--hb-text-strong)]")}>
                <span className={srOnly}>{V40_INPUT_LOCAL_COPY.pairCardNames[cardIndex]}. </span>
                {cardText}
              </p>
              <div className="mt-5 grid grid-cols-3 gap-2.5">
                {cells.map((cell) => {
                  const index = ordered.indexOf(cell);
                  const checked = index === checkedIndex;
                  return (
                    <button
                      key={cell.cell}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      aria-label={cell.accessibleName}
                      aria-describedby={cardTextIds[cardIndex]}
                      tabIndex={radio.tabIndex(index)}
                      ref={radio.ref(index)}
                      onClick={() => select(index)}
                      onKeyDown={(event) => radio.onKeyDown(event, index)}
                      className={cx(cellBase, checked ? cellChecked : cellIdle)}
                    >
                      <StrengthDots level={cell.level} />
                      <span className="flex items-center gap-1">
                        {checked ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
                        <span>{cell.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p id={ids.incomplete} role="status" aria-live="polite" className={cx(noticeText, showIncomplete && cx("mt-3", noticeBox))}>
        {showIncomplete ? V40_COPY.question.incomplete : ""}
      </p>
    </div>
  );
}

export default PairInput;
