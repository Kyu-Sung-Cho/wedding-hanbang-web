"use client";

import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ProgressSegment } from "@/lib/weddingCode/v40/types";
import { cx } from "./styles";

export interface ProgressBarProps {
  /** flow.progressSegments 가 주는 다섯 칸(네 구간과 마지막 정리). */
  readonly segments: readonly ProgressSegment[];
  /** 낭독기가 읽는 말을 바꿀 때(예: 쉬는 카드). 없으면 지금 칸의 구간 알림. */
  readonly announcement?: string;
  readonly className?: string;
}

/** 칸 너비는 문항 수에 비례한다(구간 16개, 마지막 정리 4개). 칸이 이어져 하나의 막대처럼 보인다. */
function segmentStyle(total: number) {
  return { flexGrow: total > 0 ? total : 1, flexBasis: 0 } as const;
}

function fillPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
}

/**
 * 얇은 연속 막대 다섯 칸. 지금 있는 칸에만 이름이 붙고(나머지 칸 이름은 그리지 않는다), 칸 안이 저장된 문항 수만큼 차오른다.
 * 질문 번호, 화면 번호, n/N 같은 숫자 글자는 없다. 낭독기에는 progressbar 하나로 「지금 두 번째 구간이에요」처럼 읽힌다.
 * 막대는 문항 기준이라 화면 묶음이 바뀌어도 그대로다.
 *
 * 뜻은 색만으로 전하지 않는다: 지금 칸은 더 굵고 이름이 붙으며, 고대비 모드에서도 차오른 부분이 보이도록 강조색 대신 시스템 색을 쓴다.
 */
export function ProgressBar({ segments, announcement, className }: ProgressBarProps) {
  if (segments.length === 0) return null;
  const current = segments.find((segment) => segment.current) ?? null;
  const totalAll = segments.reduce((sum, segment) => sum + segment.total, 0);
  const doneAll = segments.reduce((sum, segment) => sum + segment.done, 0);
  const valueText = announcement ?? (current ? V40_COPY.progress.sectionAnnouncements[current.index] : undefined);

  return (
    <div
      role="progressbar"
      aria-label={V40_COPY.progress.regionLabel}
      aria-valuemin={0}
      aria-valuemax={totalAll}
      aria-valuenow={doneAll}
      aria-valuetext={valueText}
      data-progress=""
      className={cx("border-b border-[var(--hb-hairline)] pb-5", className)}
    >
      <div className="flex items-center gap-1.5">
        {segments.map((segment) => (
          <div
            key={segment.index}
            data-segment={segment.index}
            data-current={segment.current ? "" : undefined}
            style={segmentStyle(segment.total)}
            className={cx(
              "min-w-3 overflow-hidden rounded-full border border-paper-outline bg-[var(--hb-surface-raised)]",
              segment.current ? "h-2" : "h-1.5",
            )}
          >
            <div
              data-fill=""
              style={{ width: `${fillPercent(segment.done, segment.total)}%` }}
              className="h-full bg-[var(--hb-action)] forced-colors:bg-[Highlight]"
            />
          </div>
        ))}
      </div>
      {/* 이름 줄. 마지막 칸(마지막 정리)은 너비가 16px 남짓이라 이름이 칸 밖으로 넘친다. 칸 안에 넣지 않고 줄 오른쪽 끝에 한 번만 붙인다(가로 스크롤 방지). */}
      <div className="relative mt-2.5 flex min-h-4 gap-1.5 text-[13px] font-semibold leading-4 text-[var(--hb-text-strong)]">
        {segments.map((segment) => (
          <div key={segment.index} style={segmentStyle(segment.total)} className="min-w-3">
            {segment.current && segment.index !== segments.length - 1 ? (
              <span data-segment-name="" className="whitespace-nowrap">
                {V40_COPY.progress.segmentNames[segment.index]}
              </span>
            ) : null}
          </div>
        ))}
        {current !== null && current.index === segments.length - 1 ? (
          <span data-segment-name="" className="absolute right-0 top-0 whitespace-nowrap">
            {V40_COPY.progress.segmentNames[current.index]}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default ProgressBar;
