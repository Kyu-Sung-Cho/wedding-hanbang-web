"use client";

import { useId, useState } from "react";
import { V40_COPY, perspectiveChangedAnnouncement } from "@/lib/weddingCode/v40/copy";
import type { Perspective } from "@/lib/weddingCode/v40/types";
import { bodyText, cx, noteText, srOnly } from "./styles";

export interface CouplePerspectiveSwitchProps {
  /**
   * 이 기기에 저장된 본인 답이 링크의 a(first)나 b(second)와 같다고 부모가 알려 준 값. 맞는 것이 없으면 null.
   * 이 컴포넌트는 저장소를 읽지 않는다. 판정은 부모가 한다(코어의 detectPerspective).
   */
  readonly detected: Perspective | null;
  /** 지금 기준: 사람이 고른 것이 있으면 그것, 없으면 detected. 아직 모르면 null. */
  readonly value: Perspective | null;
  /** 사람이 라디오를 골랐다. 이 기기에만 남기고 링크에는 싣지 않는다(저장은 부모의 몫). */
  readonly onChange: (perspective: Perspective) => void;
  /** 한 화면 안에서 겹치지 않는 접두어. 없으면 자동. */
  readonly idPrefix?: string;
}

const OPTIONS = [
  { value: "first", label: V40_COPY.couple.perspective.iAmFirstOption },
  { value: "second", label: V40_COPY.couple.perspective.iAmSecondOption },
] as const;

const focusWithinRing =
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--hb-focus-ring)] has-[:focus-visible]:ring-offset-2";

/**
 * 「나 기준으로 보기」 전환. 링크에는 누가 누구인지 신원이 없어서 화면이 나와 상대를 알아야 할 때만 쓴다.
 * - 저장된 내 답이 a나 b와 같으면 자동으로 「나」를 정하고 그 사실을 한 줄로 알린다. 라디오는 그대로 있어서 바꿀 수 있고
 *   바꾸면 자동으로 정했다는 말은 사라진다(더는 참이 아니다).
 * - 맞는 것이 없고 아직 아무것도 고르지 않았으면 먼저 답한 사람 / 나중에 답한 사람 중 누가 나인지 고르게 한다.
 *   고르기 전에는 화면이 두 사람을 그 이름으로 부른다. 고르고 나면 안내 글은 사라진다(이미 정했다).
 * 색만으로 뜻을 전하지 않는다: 고른 쪽은 굵은 테두리와 라디오 표식이 함께 보인다.
 * 사람이 기준을 고르면 아래 주제별 줄과 질문 목록의 나와 상대가 바뀐다. 바뀐 것을 낭독기에도 알리려고 늘 문서에 있는 알림 자리(status)의 글을 바꾼다.
 */
export function CouplePerspectiveSwitch({ detected, value, onChange, idPrefix }: CouplePerspectiveSwitchProps) {
  const uid = useId();
  const prefix = idPrefix ?? `wc40-perspective${uid}`;
  const autoActive = detected !== null && value === detected;
  const note = value === null ? V40_COPY.couple.perspective.askNote : autoActive ? V40_COPY.couple.perspective.autoNote : null;
  const noteId = `${prefix}-note`;
  const [announcement, setAnnouncement] = useState("");

  return (
    <fieldset className="min-w-0 border-b border-[var(--hb-hairline)] pb-6">
      <legend className={cx(bodyText, "font-semibold text-[var(--hb-text-strong)]")}>{V40_COPY.couple.perspective.groupLabel}</legend>
      {note !== null ? (
        <p id={noteId} className={cx(noteText, "mt-1")}>
          {note}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {OPTIONS.map((entry) => {
          const selected = value === entry.value;
          return (
            <label key={entry.value} className={cx("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2", selected ? "border-[var(--hb-selected-line)] bg-[var(--hb-selected-bg)] font-semibold" : "border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]", focusWithinRing)}>
              <input
                type="radio"
                name={`${prefix}-perspective`}
                value={entry.value}
                checked={selected}
                onChange={() => {
                  onChange(entry.value);
                  setAnnouncement(perspectiveChangedAnnouncement(entry.value));
                }}
                aria-describedby={note !== null ? noteId : undefined}
                className="size-5 shrink-0 accent-[var(--hb-action)]"
              />
              <span className="text-sm font-medium text-[var(--hb-text-strong)]">{entry.label}</span>
            </label>
          );
        })}
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" data-perspective-status="" className={srOnly}>
        {announcement}
      </p>
    </fieldset>
  );
}

export default CouplePerspectiveSwitch;
