"use client";

import { Check } from "lucide-react";
import { Fragment, useRef, useState, type KeyboardEvent } from "react";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { BestWorstInputProps, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { V40_INPUT_LOCAL_COPY } from "./localCopy";
import {
  card,
  cardSelected,
  cx,
  itemIds,
  nextRadioIndex,
  noticeBox,
  noticeText,
  radioMark,
  radioMarkSelected,
  radioRow,
  srOnly,
} from "./styles";

/**
 * 가장 나 같은 것 / 가장 나 같지 않은 것 (bestworst).
 *
 * 카드 네 장을 라디오 그룹 두 개로 함께 보여 준다. 두 그룹은 이름이 달라서 브라우저 라디오 규칙이 서로를 지우지 않으므로
 * 같은 카드를 두 그룹에서 고르는 경우는 이 컴포넌트가 정한다: 나중에 고른 쪽만 남기고 앞의 선택을 지운 뒤
 * `view.duplicateAnnounce` 를 aria-live 로 읽는다. 어떤 카드도 비활성으로 만들지 않는다(disabled, aria-disabled 모두 없음).
 *
 * 다른 그룹에서 이미 고른 카드에는 눈에 보이는 작은 표시(「가장 나 같지 않은 것」에서 골랐어요)와 낭독 설명(여기서 고르면 그쪽 선택은 지워져요)이
 * 붙는다. 그래서 누르기 전에 무슨 일이 생길지 알 수 있고, 화면 아래쪽의 낭독 문장을 못 본 채 다른 그룹의 선택이 말없이 사라지지 않는다.
 *
 * 라디오는 브라우저 기본 라디오다(화면에서만 가리고 낭독기와 키보드에는 그대로 있다). 탭은 그룹마다 한 자리(고른 카드, 없으면 첫 카드)에 서고
 * 스페이스는 브라우저가 처리한다. 방향키와 엔터만 이 컴포넌트가 맡는다:
 * - 방향키는 카드를 옮기며 고른다(브라우저 기본 라디오와 같고 끝에서 반대쪽 끝으로 돈다). 다만 지나가는 카드가 다른 그룹에서 고른 카드이면
 *   초점만 옮기고 고르지 않는다. 방향키로 걷다가 지나친 카드 때문에 앞의 선택이 지워지지 않게 하기 위해서다. 그 카드를 정말 고르려면 스페이스, 엔터, 누르기로 한다.
 * - 엔터는 초점이 있는 카드를 고른다(다른 형식의 단추 라디오와 같다).
 *
 * 뷰는 이미 폼 비트가 반영된 화면 순서다. 이 컴포넌트는 극, 값, 키, 폼 비트를 모르고 화면 색인만 다룬다.
 * 값은 `value` 가 정한다(제어 컴포넌트). 하나만 고른 중간 상태도 `{ best, worst }` 에 null 을 담아 그때그때 `onAnswer` 로 알린다.
 * 넘기기(escape) 답이 들어 있으면 이미 답한 것이라 「하나씩 골라 주세요」 안내를 하지 않는다.
 */

type Kind = "best" | "worst";

const GROUPS: readonly Kind[] = ["best", "worst"];

/**
 * 라디오가 초점을 받으면 카드 전체에 링을 두른다. 숨긴 라디오 자신은 링을 그릴 수 없어서 카드가 대신 그린다.
 * 링은 그림자라 윈도 고대비에서 사라지므로 투명 윤곽선을 함께 둔다.
 */
const CARD_FOCUS =
  "relative cursor-pointer has-[:focus-visible]:outline-hidden has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--hb-focus-ring)] has-[:focus-visible]:ring-offset-2";

function validIndex(candidate: unknown, size: number): number | null {
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0 && candidate < size ? candidate : null;
}

/** 지금 화면 답에서 고른 카드 색인 둘. 이 형식의 답이 아니거나 범위 밖이면 null. */
function readSelection(value: ViewAnswer | null, size: number): { readonly best: number | null; readonly worst: number | null } {
  if (value === null || value.fmt !== "bestworst") return { best: null, worst: null };
  return { best: validIndex(value.best, size), worst: validIndex(value.worst, size) };
}

export function BestWorstInput({ view, value, onAnswer, idPrefix, incomplete = false }: BestWorstInputProps) {
  const ids = itemIds(idPrefix);
  const size = view.cards.length;
  const { best, worst } = readSelection(value, size);
  const complete = best !== null && worst !== null && best !== worst;
  // 넘기기(잘 모르겠어요, 제 상황과 안 맞아요)도 답이다. 틀이 따로 「넘어갔어요」를 알리므로 덜 골랐다는 안내를 겹치지 않는다.
  const escaped = value !== null && value.fmt === "escape";
  const inputs = useRef<Record<Kind, (HTMLInputElement | null)[]>>({ best: [], worst: [] });

  // 같은 카드를 두 그룹에서 골라 앞의 선택을 지웠는가. seq 는 같은 문장이 이어져도 다시 낭독되게 문장을 새로 끼워 넣는 열쇠다.
  const [note, setNote] = useState<{ readonly seq: number; readonly duplicate: boolean }>({ seq: 0, duplicate: false });

  function choose(kind: Kind, index: number) {
    let nextBest = best;
    let nextWorst = worst;
    let cleared = false;
    if (kind === "best") {
      nextBest = index;
      if (worst === index) {
        nextWorst = null;
        cleared = true;
      }
    } else {
      nextWorst = index;
      if (best === index) {
        nextBest = null;
        cleared = true;
      }
    }
    setNote((previous) => ({ seq: previous.seq + 1, duplicate: cleared }));
    onAnswer({ fmt: "bestworst", best: nextBest, worst: nextWorst });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, kind: Kind, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = kind === "best" ? best : worst;
    const elsewhere = kind === "best" ? worst : best;
    if (event.key === "Enter") {
      // 라디오는 엔터로 아무것도 하지 않는 것이 기본이라, 다른 형식의 라디오처럼 고르게 한다(폼 안이어도 엔터가 제출로 새지 않는다).
      event.preventDefault();
      if (index !== current) choose(kind, index);
      return;
    }
    const next = nextRadioIndex(event.key, index, size);
    if (next === null) return;
    event.preventDefault();
    inputs.current[kind][next]?.focus();
    // 다른 그룹에서 고른 카드는 지나가기만 한다. 고르는 것은 스페이스, 엔터, 누르기다.
    if (next !== elsewhere && next !== current) choose(kind, next);
  }

  // 다음을 눌렀는데 덜 골랐을 때의 안내가 먼저이고, 그 밖에는 앞의 선택을 지웠다는 말이다.
  const showIncomplete = incomplete && !complete && !escaped;
  const showDuplicate = !showIncomplete && note.duplicate && value !== null && value.fmt === "bestworst";
  const message = showIncomplete ? V40_COPY.question.incompleteBestWorst : showDuplicate ? view.duplicateAnnounce : "";

  return (
    <div className="flex flex-col gap-6" data-bestworst="">
      {GROUPS.map((kind) => {
        const chosen = kind === "best" ? best : worst;
        const elsewhere = kind === "best" ? worst : best;
        // 이 그룹에서 보면 다른 그룹의 이름이다.
        const otherLabel = kind === "best" ? view.worstLabel : view.bestLabel;
        return (
          <Fragment key={kind}>
            {/* 두 그룹은 같은 카드 넷이라 제목 글자만으로는 어느 목록인지 흐려진다(작은 화면에서는 둘째 그룹이 화면 밖이다). 가는 선으로 두 목록을 가른다. */}
            {kind === "worst" ? <div aria-hidden="true" data-group-divider="" className="border-t border-[var(--hb-hairline)]" /> : null}
            <fieldset
              role="radiogroup"
              aria-describedby={ids.stem}
              className="m-0 min-w-0 border-0 p-0"
              data-group={kind}
            >
              <legend className="mb-2 p-0 text-sm font-semibold text-[var(--hb-text-strong)]">
                {kind === "best" ? view.bestLabel : view.worstLabel}
              </legend>
              <div className="space-y-2">
                {view.cards.map((cardView, index) => {
                  const checked = chosen === index;
                  const taken = !checked && elsewhere === index;
                  const takenId = `${idPrefix}-${kind}-${index}-taken`;
                  return (
                    <div key={index}>
                      <label className={cx(card, radioRow, CARD_FOCUS, checked && cardSelected)}>
                        <input
                          id={`${idPrefix}-${kind}-${index}`}
                          type="radio"
                          name={`${idPrefix}-${kind}`}
                          checked={checked}
                          aria-describedby={taken ? takenId : undefined}
                          ref={(element) => {
                            inputs.current[kind][index] = element;
                          }}
                          onChange={() => choose(kind, index)}
                          onKeyDown={(event) => onKeyDown(event, kind, index)}
                          className={srOnly}
                        />
                        <span aria-hidden="true" className={cx(radioMark, checked && radioMarkSelected)}>
                          {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-keep" data-card-text="">
                            {cardView.text}
                          </span>
                          {taken ? (
                            <span
                              aria-hidden="true"
                              className="mt-1.5 inline-block rounded-full border border-paper-outline px-2 py-0.5 text-xs font-medium text-[var(--hb-text-muted)]"
                              data-card-taken=""
                            >
                              {V40_INPUT_LOCAL_COPY.bestWorstTakenChip(otherLabel)}
                            </span>
                          ) : null}
                        </span>
                      </label>
                      {/* 카드의 이름(카드 글)에는 섞이지 않게 라벨 밖에 둔다. 초점이 오면 설명으로 읽힌다. */}
                      {taken ? (
                        <span id={takenId} className={srOnly}>
                          {V40_INPUT_LOCAL_COPY.bestWorstTakenHelp(otherLabel)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </Fragment>
        );
      })}
      {/* 처음부터 화면에 있어야 나중에 들어온 문장이 낭독된다. 문장은 눈에도 보인다. id 는 화면이 덜 채운 문항으로 스크롤할 때 쓴다. */}
      <div id={ids.incomplete} role="status" aria-live="polite" aria-atomic="true" data-bestworst-live="">
        {message === "" ? null : (
          <p key={`${note.seq}:${showIncomplete ? "incomplete" : "duplicate"}`} className={cx(noticeBox, noticeText)}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

export default BestWorstInput;
