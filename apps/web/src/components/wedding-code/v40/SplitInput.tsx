"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import Button from "@/components/ui/Button";
import {
  V40_COPY,
  splitAddLabel,
  splitCountLabel,
  splitRemainingNotice,
  splitRemoveLabel,
  splitStatus,
} from "@/lib/weddingCode/v40/copy";
import type { SplitInputProps, SplitViewAnswer, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { bodyText, buttonFocusFix, card, cardSelected, cx, itemIds, noticeBox, noticeText, srOnly } from "./styles";

/**
 * 칸 나누기 (split). 항목 세 개에 view.total(6)칸을 - / + 단추로 나눠 놓는다.
 *
 * - 드래그가 없다. 단추는 모두 진짜 button 이라 키보드만으로 끝까지 할 수 있다.
 * - 누를 수 없는 단추(놓은 칸이 없는 항목의 -, 남은 칸이 없을 때의 +)는 disabled 가 아니라 aria-disabled 다.
 *   키보드 초점이 사라지지 않고, 눌러도 아무것도 바뀌지 않는 대신 이유를 문장으로 알린다(aria-describedby 로 미리, 누르면 aria-live 로).
 *   이유 문장은 누른 항목의 카드 안, 단추 바로 아래에 나온다. 작은 화면에서 손가락이 있는 곳에서 멀리 떨어진 아래쪽에 뜨면 단추가 죽은 것처럼 보이기 때문이다.
 * - 남은 칸과 다음을 눌렀을 때의 안내는 항목 목록 위, 앞말 바로 아래에 있다. 목록이 화면보다 길어도 첫 항목을 만지는 동안 함께 보인다.
 * - 남은 칸은 눈에 보이는 aria-live 문장으로 알린다. 방금 바꾼 항목의 새 칸 수(「항목」: 1칸)도 같은 영역에서 낭독기에만 함께 읽힌다.
 * - 합이 6 이 되기 전에도 `counts` 중간 상태를 그때그때 `onAnswer` 로 알린다. 칸을 다 놓았는지는 `splitRemaining` 이 준다.
 * - 넘기기(escape) 답이 들어 있으면 칸 수는 0에서 다시 시작하고, 이미 답한 것이라 남은 칸 안내와 「모두 놓아 주세요」 안내를 하지 않는다.
 *
 * 뷰는 이미 폼 비트가 반영된 화면 순서다(앞 두 항목의 자리가 바뀌었을 수 있다). 이 컴포넌트는 극, 값, 키를 모르고
 * 화면 순서의 칸 수만 다룬다. 값은 `value` 가 정한다(제어 컴포넌트).
 */

type Blocked = { readonly seq: number; readonly index: number; readonly reason: "full" | "empty" };

/**
 * 누를 수 없을 때 흐리게 한다. 초점과 클릭은 그대로 살아 있다(disabled 속성을 쓰지 않는다).
 * 같은 단추를 빠르게 두세 번 누르는 것이 이 형식의 핵심 동작이라, 손가락 두 번 탭이 화면 확대로 읽히지 않게 한다(핀치 확대는 그대로다).
 */
const STEP_BUTTON = cx(
  "touch-manipulation border border-paper-outline bg-[var(--hb-surface-raised)] text-[var(--hb-text-strong)]! aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
  buttonFocusFix,
);

function toCount(candidate: unknown): number {
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0 ? candidate : 0;
}

/** 지금 화면 답의 칸 수 셋(화면 순서). 이 형식의 답이 아니면 모두 0. */
function readCounts(value: ViewAnswer | null): readonly [number, number, number] {
  if (value === null || value.fmt !== "split") return [0, 0, 0];
  return [toCount(value.counts[0]), toCount(value.counts[1]), toCount(value.counts[2])];
}

/**
 * 아직 놓지 않은 칸 수(0 이상). 0 이면 칸을 다 놓은 것이다. 화면이 「다음」을 눌렀을 때 남은 칸을 알릴 때 쓴다.
 * 이 형식의 답이 아니면(아직 답이 없거나 넘기기) total 전부가 남았다.
 */
export function splitRemaining(value: ViewAnswer | null, total: number): number {
  const [a, b, c] = readCounts(value);
  return Math.max(0, total - (a + b + c));
}

export function SplitInput({ view, value, onAnswer, idPrefix, incomplete = false }: SplitInputProps) {
  const ids = itemIds(idPrefix);
  const counts = readCounts(value);
  const placed = counts[0] + counts[1] + counts[2];
  const remaining = Math.max(0, view.total - placed);
  // 넘기기도 답이다. 틀이 따로 「넘어갔어요」를 알리므로 칸이 남았다는 말을 겹치지 않는다.
  const escaped = value !== null && value.fmt === "escape";
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  // 마지막으로 칸을 바꾼 항목(낭독기에 새 칸 수를 함께 읽어 주려고 기억한다).
  const [changed, setChanged] = useState<number | null>(null);

  const fullReasonId = `${idPrefix}-reason-full`;
  const emptyReasonId = `${idPrefix}-reason-empty`;

  function change(index: number, step: 1 | -1) {
    if (step === 1 && remaining <= 0) {
      setBlocked((previous) => ({ seq: (previous?.seq ?? 0) + 1, index, reason: "full" }));
      return;
    }
    if (step === -1 && counts[index] <= 0) {
      setBlocked((previous) => ({ seq: (previous?.seq ?? 0) + 1, index, reason: "empty" }));
      return;
    }
    const next: [number, number, number] = [counts[0], counts[1], counts[2]];
    next[index] += step;
    setBlocked(null);
    setChanged(index);
    const answer: SplitViewAnswer = { fmt: "split", counts: next };
    onAnswer(answer);
  }

  // 밖에서 칸이 바뀌어 더는 맞지 않는 이유(남은 칸이 생겼는데 「남은 칸이 없어요」, 칸이 생겼는데 「놓은 칸이 없어요」)는 보이지 않는다.
  const activeBlock =
    blocked !== null && (blocked.reason === "empty" ? counts[blocked.index] <= 0 : remaining <= 0) ? blocked : null;

  const remainingText = escaped ? "" : splitStatus(remaining);
  // 방금 바꾼 항목의 새 칸 수. 넘기기나 다른 답으로 바뀌어 칸 수가 의미 없어지면 읽지 않는다.
  const changedEntry = changed !== null ? view.entries[changed] : undefined;
  const changedLabel =
    changed !== null && changedEntry !== undefined && value !== null && value.fmt === "split"
      ? splitCountLabel(changedEntry.text, counts[changed])
      : "";
  const incompleteNotice = incomplete && !escaped && remaining > 0 ? splitRemainingNotice(remaining) : "";

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" data-split="">
      <legend className={srOnly}>{V40_COPY.question.guides.split}</legend>
      {/* 눈에 보이는 남은 칸. 처음부터 화면에 있어서 바뀔 때마다 낭독된다. 방금 바꾼 항목의 새 칸 수는 낭독기에만 앞에 붙는다. */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={cx("text-sm font-semibold text-[var(--hb-text-strong)]", remainingText !== "" && "mb-3")}
        data-split-live=""
      >
        {changedLabel === "" ? null : (
          <span className={srOnly} data-split-changed="">
            {changedLabel}.{" "}
          </span>
        )}
        <span data-split-remaining="">{remainingText}</span>
      </p>
      {/* 다음을 눌렀는데 칸이 남았을 때의 안내. 처음부터 화면에 있어야 나중에 들어온 문장이 낭독된다. id 는 화면이 덜 채운 문항으로 스크롤할 때 쓴다. */}
      <div id={ids.incomplete} role="status" aria-live="polite" aria-atomic="true" data-split-notice="">
        {incompleteNotice === "" ? null : <p className={cx("mb-3", noticeBox, noticeText)}>{incompleteNotice}</p>}
      </div>
      <ul role="list" className="m-0 list-none space-y-3 p-0">
        {view.entries.map((entry, index) => {
          const count = counts[index];
          const countId = `${idPrefix}-count-${index}`;
          const cannotRemove = count <= 0;
          const cannotAdd = remaining <= 0;
          const blockedHere = activeBlock !== null && activeBlock.index === index ? activeBlock : null;
          return (
            <li key={index} className={cx(card, "px-5 py-5", count > 0 && cardSelected)}>
              <p className="break-keep text-[16px] leading-[1.7] text-[var(--hb-text-strong)]">{entry.text}</p>
              {/* 좁은 화면에서 칸 표시와 단추가 한 줄에 안 들어가면 칸 표시가 위로 접힌다. */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                {/* 놓은 칸을 눈으로 보는 줄. 뜻은 옆의 글자(몇 칸)가 전하므로 낭독에서는 뺀다. */}
                <span aria-hidden="true" className="flex items-center gap-1" data-pips="">
                  {Array.from({ length: view.total }, (_, slot) => (
                    <span
                      key={slot}
                      className={cx(
                        "size-2.5 rounded-[2px] border",
                        slot < count
                          ? "border-[var(--hb-action)] bg-[var(--hb-action)]"
                          : "border-paper-outline bg-[var(--hb-surface-raised)]",
                      )}
                    />
                  ))}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="icon"
                    label={splitRemoveLabel(entry.text)}
                    aria-disabled={cannotRemove ? "true" : undefined}
                    aria-describedby={cannotRemove ? `${countId} ${emptyReasonId}` : countId}
                    onClick={() => change(index, -1)}
                    className={STEP_BUTTON}
                    data-step="remove"
                  >
                    <Minus aria-hidden="true" className="size-4" />
                  </Button>
                  <span
                    id={countId}
                    className="min-w-10 text-center text-base font-semibold tabular-nums text-[var(--hb-text-strong)]"
                    data-count=""
                  >
                    {count}칸
                  </span>
                  <Button
                    variant="icon"
                    label={splitAddLabel(entry.text)}
                    aria-disabled={cannotAdd ? "true" : undefined}
                    aria-describedby={cannotAdd ? `${countId} ${fullReasonId}` : countId}
                    onClick={() => change(index, 1)}
                    className={STEP_BUTTON}
                    data-step="add"
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>
              {/* 누를 수 없는 단추를 눌렀을 때의 이유. 누른 항목의 카드 안에서 뜬다. 같은 이유를 또 눌러도 다시 읽히게 문장을 새로 끼워 넣는다. */}
              <div role="status" aria-live="polite" aria-atomic="true" data-split-blocked="">
                {blockedHere === null ? null : (
                  <p key={`blocked:${blockedHere.seq}`} className={cx("mt-3", noticeBox, bodyText)}>
                    {blockedHere.reason === "full" ? V40_COPY.inputs.splitNoRoomReason : V40_COPY.inputs.splitEmptyReason}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {/* aria-describedby 가 가리키는 이유 문장. hidden 이라 훑어 읽을 때는 나오지 않고 단추에 초점이 올 때만 읽힌다. */}
      <span id={fullReasonId} hidden>
        {V40_COPY.inputs.splitNoRoomReason}
      </span>
      <span id={emptyReasonId} hidden>
        {V40_COPY.inputs.splitEmptyReason}
      </span>
    </fieldset>
  );
}

export default SplitInput;
