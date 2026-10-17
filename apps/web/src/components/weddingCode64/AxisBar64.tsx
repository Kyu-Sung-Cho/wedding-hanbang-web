import type { ReactNode } from "react";

// 한 축 막대: 왼쪽 끝이 앞 글자(X), 오른쪽 끝이 뒷 글자(Y). 가운데 선, 점, 흔들림 띠(있을 때).
// 원본 page6-shell.html 의 bar()를 옮겼다. 위치 값은 계산된 %라 인라인 style 로 둔다.

export interface AxisBar64Props {
  /** 앞 글자 쪽 정수 % (0~100). 뒷 글자 쪽은 100 - pctX. */
  pctX: number;
  /** 다시 계산한 앞 글자 쪽 %의 10%~90% 폭 */
  band?: readonly [number, number] | null;
  /** 막대를 읽어 줄 이름(예: "D 미리 매듭짓는 쪽 69%, O 열어 두고 살피는 쪽 31%"). 띠가 있으면 띠 범위도 여기에 넣는다. */
  label: string;
  /** 양 끝 이름 줄. 없으면 막대만 그린다. */
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export default function AxisBar64({ pctX, band, label, left, right, className }: AxisBar64Props) {
  const x = clamp(100 - pctX); // 왼쪽이 X(앞 글자) 끝
  const fill = pctX >= 50 ? { left: `${x}%`, width: `${50 - x}%` } : { left: "50%", width: `${x - 50}%` };
  const bandStyle = band
    ? { left: `${clamp(100 - band[1]).toFixed(1)}%`, width: `${Math.max(0, band[1] - band[0]).toFixed(1)}%` }
    : null;
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}>
      {(left || right) && (
        <div className="flex min-w-0 justify-between gap-3 text-[13px] leading-5 text-[var(--hb-text-body)]">
          <span className="min-w-0">{left}</span>
          <span className="min-w-0 text-right">{right}</span>
        </div>
      )}
      <div role="img" aria-label={label} className="relative h-[22px]" data-pct-x={pctX}>
        <span aria-hidden="true" className="absolute inset-x-0 top-[9px] h-1 rounded bg-[var(--hb-surface-hover)]" />
        {bandStyle && (
          // 띠 범위는 글과 aria-label 이 숫자로 알린다. 그래서 띠는 3:1 까지 진하게 하지 않고(점이 묻힌다) 가장자리만 보이게 둔다.
          <span aria-hidden="true" data-band="true" className="absolute top-[5px] h-3 rounded-md border border-[rgba(143,102,98,0.5)] bg-[rgba(143,102,98,0.3)]" style={bandStyle} />
        )}
        <span aria-hidden="true" data-fill="true" className="absolute top-[9px] h-1 rounded bg-[var(--hb-primary)]" style={fill} />
        <span aria-hidden="true" className="absolute left-1/2 top-1 h-3.5 w-px bg-[var(--hb-text-muted)] opacity-50" />
        <span
          aria-hidden="true"
          data-dot="true"
          className="absolute top-[3px] -ml-2 h-4 w-4 rounded-full border-[3px] border-white bg-[var(--hb-primary)] shadow-[0_0_0_1px_var(--hb-primary)]"
          style={{ left: `${x}%` }}
        />
      </div>
    </div>
  );
}
