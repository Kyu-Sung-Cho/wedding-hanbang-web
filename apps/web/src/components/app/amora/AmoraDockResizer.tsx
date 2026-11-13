"use client";

import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import {
  AMORA_DOCK_RATIO_MAX,
  AMORA_DOCK_RATIO_MIN,
  AMORA_DOCK_RATIO_STEP,
  amoraDockRatioFromPointer,
  clampAmoraDockRatio,
  snapAmoraDockRatio,
} from "./amoraDock";

interface AmoraDockResizerProps {
  /** 지금 아모라가 차지한 몫(1/3 ~ 1/2). */
  ratio: number;
  /** 본문과 아모라를 함께 담은 줄. 손잡이 자리를 이 줄의 너비로 나눈다. */
  rowRef: RefObject<HTMLElement | null>;
  /**
   * 아모라 칸. 끄는 동안에는 상태를 거치지 않고 이 칸의 너비만 바로 바꾼다. 대화 화면은 크고 무거워서
   * 손가락이 움직일 때마다 다시 그리면 끌기가 끊긴다. 손을 떼면 `onCommit` 으로 한 번만 반영한다.
   */
  paneRef: RefObject<HTMLElement | null>;
  paneId: string;
  onCommit: (ratio: number) => void;
}

/**
 * 본문과 아모라 사이의 경계. 끌거나 화살표로 아모라 너비를 정한다.
 *
 * 값은 WAI-ARIA 창 나누기 방식대로 **왼쪽 칸(본문)의 몫**이다. 왼쪽 화살표는 경계를 왼쪽으로
 * 옮겨 본문이 줄고 아모라가 넓어진다.
 */
export default function AmoraDockResizer({ ratio, rowRef, paneRef, paneId, onCommit }: AmoraDockResizerProps) {
  const dragRatioRef = useRef<number | null>(null);

  const measure = (clientX: number): number | null => {
    const row = rowRef.current;
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    return amoraDockRatioFromPointer({ rowLeft: rect.left, rowWidth: rect.width, clientX });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // 끄는 동안 본문 글자가 선택되지 않게 한다.
    event.preventDefault();
    try {
      // 손잡이 밖으로 손가락이 나가도 끌기가 이어지게 한다. 잡을 수 없는 포인터면 그냥 이 요소에서만 받는다.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 잡기에 실패해도 끌기 자체는 된다.
    }
    dragRatioRef.current = ratio;
  };

  const endDrag = (target: HTMLDivElement, pointerId: number) => {
    const last = dragRatioRef.current;
    if (last === null) return;
    dragRatioRef.current = null;
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
    const snapped = snapAmoraDockRatio(last);
    // 끄는 동안 칸 너비를 직접 바꿨다. 붙인 값이 끌기 전 값과 같으면 상태가 그대로라 React 가 너비를
    // 다시 쓰지 않고, 칸은 끌던 너비에 남는다. 그래서 여기서 붙인 값으로 맞춘다.
    if (paneRef.current) paneRef.current.style.width = `${snapped * 100}%`;
    onCommit(snapped);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRatioRef.current === null) return;
    // 손잡이를 잡지 못한 채 밖에서 손을 떼면 놓았다는 소식이 이 요소에 오지 않는다. 단추를 누르지 않은
    // 채 다시 지나가면 그때 끌기를 끝낸다. 안 그러면 지나가기만 해도 너비가 바뀐다.
    if (event.buttons === 0) {
      endDrag(event.currentTarget, event.pointerId);
      return;
    }
    const next = measure(event.clientX);
    if (next === null) return;
    dragRatioRef.current = next;
    if (paneRef.current) paneRef.current.style.width = `${next * 100}%`;
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => endDrag(event.currentTarget, event.pointerId);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowLeft" ? ratio + AMORA_DOCK_RATIO_STEP
        : event.key === "ArrowRight" ? ratio - AMORA_DOCK_RATIO_STEP
          // Home·End 는 왼쪽 칸(본문)을 가장 작게·가장 크게 한다.
          : event.key === "Home" ? AMORA_DOCK_RATIO_MAX
            : event.key === "End" ? AMORA_DOCK_RATIO_MIN
              : null;
    if (next === null) return;
    event.preventDefault();
    onCommit(clampAmoraDockRatio(next));
  };

  const amoraPercent = Math.round(ratio * 100);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="본문과 아모라 사이 너비 조절"
      aria-controls={paneId}
      aria-valuemin={Math.round((1 - AMORA_DOCK_RATIO_MAX) * 100)}
      aria-valuemax={Math.round((1 - AMORA_DOCK_RATIO_MIN) * 100)}
      aria-valuenow={100 - amoraPercent}
      aria-valuetext={`아모라가 ${amoraPercent}%를 차지해요`}
      tabIndex={0}
      data-amora-dock-resizer=""
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onKeyDown={handleKeyDown}
      className="group sticky top-0 flex h-[100dvh] w-3 shrink-0 cursor-col-resize touch-none select-none items-center justify-center outline-none focus-visible:bg-[var(--amora-warm)]"
    >
      <span
        aria-hidden="true"
        className="h-12 w-1 rounded-full bg-[var(--amora-line)] transition-colors group-hover:bg-[var(--amora-soft)] group-focus-visible:bg-[var(--amora-accent)]"
      />
    </div>
  );
}
