import type { ReactNode } from "react";

import type { ChecklistItem } from "@/types/database.types";

/**
 * 체크리스트 항목의 글자 — 할 일(label)과 놓치기 쉬운 것(note).
 *
 * 같은 항목을 웹에서 세 화면이 그린다. 준비 목록의 모달, 일정 화면의 시간축,
 * 아모라 옆 정보 패널이다. 2026-08-19에 note를 넣을 때 모달에만 마크업을 붙여서,
 * **체크가 실제로 일어나는 시간축에서는 안내가 안 보였다.** 검색은 note까지 훑는데
 * 화면에는 없는 상태이기도 했다.
 *
 * 그래서 글자를 한 곳에서 만든다. 화면마다 다른 것은 label의 크기·색뿐이라 그것만
 * 밖에서 받고, note는 어디서나 같은 모양으로 붙는다.
 */
export default function ChecklistItemText({
  item,
  idPrefix,
  labelClassName,
  compact = false,
  labelSuffix,
  noteClassName,
  hideNoteWhenDone = false,
}: {
  item: ChecklistItem;
  /**
   * 이 글자가 체크박스 **안에** 들어갈 때만 준다.
   *
   * note를 그냥 두면 스크린 리더가 체크박스 이름으로 label과 note를 이어 읽는다.
   * id를 붙여 이름은 label, 설명은 note로 갈라 준다 — 호출부가 `aria-labelledby`와
   * `aria-describedby`를 그 id로 가리킨다.
   */
  idPrefix?: string;
  /** 화면마다 이미 정해진 label의 크기·색. 통일하지 않는다 — 이번 변경의 범위가 아니다. */
  labelClassName: string;
  /** 좁은 자리(시간축·패널)에서는 note를 한 단계 작게. */
  compact?: boolean;
  /**
   * note 의 크기·행간·최대폭을 부르는 쪽이 정한다.
   *
   * 2026-09-03 시안의 준비 목록 모달은 `.item-desc` 를 12.5px/1.6/최대 560px 로 그린다.
   * `compact` 는 13px 이라 시안과 다르고, 이 컴포넌트는 시간축·아모라 패널도 쓰므로
   * 기본값을 바꿀 수 없다. 그래서 그 화면만 값을 넘긴다.
   */
  noteClassName?: string;
  /**
   * 끝난 항목에서 note 를 감춘다.
   *
   * 시안의 완료 행은 전부 한 줄이다(네 시안에서 note 가 있는 완료 6행 모두 설명이
   * 없다). 목록이 길어질수록 끝난 것이 화면을 더 먹는 것을 막는다.
   *
   * **기본값은 감추지 않는 것이다.** 시간축·패널에서는 체크를 되돌릴지 판단할 때
   * 그 한 줄이 필요하다 — 2026-08-19 에 그 이유로 넣은 자리다.
   */
  hideNoteWhenDone?: boolean;
  /**
   * label 바로 옆에 붙는 작은 표시(「필수」·「해당 시」·「다음 할 일」).
   *
   * 안 주면 마크업이 **예전 그대로**다. 표시를 쓰는 화면은 준비 목록 모달 하나인데,
   * 그 하나 때문에 시간축·패널의 줄 모양이 바뀌면 안 된다. 그래서 표시가 있을 때만
   * 가로 상자로 감싼다.
   *
   * label 자체는 한 번만 정의한다 — 두 갈래에 각각 적으면 id·클래스가 조용히 갈린다.
   */
  labelSuffix?: ReactNode;
}) {
  const label = (
    <span id={idPrefix ? `${idPrefix}-label` : undefined} className={`block ${labelClassName}`}>
      {item.label}
    </span>
  );

  return (
    <span className="min-w-0 flex-1">
      {labelSuffix ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {label}
          {labelSuffix}
        </span>
      ) : (
        label
      )}
      {item.note && !(hideNoteWhenDone && item.done) && (
        <span
          id={idPrefix ? `${idPrefix}-note` : undefined}
          // 색은 테마 토큰에 매핑된 값을 쓴다. 생 hex를 쓰면 globals.css의 서비스 테마가
          // 덮어주지 못해 이 줄만 테마를 안 따라간다.
          className={
            noteClassName
              ?? `mt-1 block text-[var(--hb-text-muted)] ${compact ? "text-[13px] leading-[1.5]" : "text-[15px] leading-[1.55]"}`
          }
        >
          {item.note}
        </span>
      )}
    </span>
  );
}
