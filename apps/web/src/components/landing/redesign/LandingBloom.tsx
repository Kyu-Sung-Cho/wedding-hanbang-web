/** 2026-09-03 첨부 Main.dc.html·LandingMobile.dc.html의 세 송이 꽃가지. */
const branches = {
  left: {
    viewBox: "0 0 420 300",
    stems: [
      ["M-10 250 C 70 236, 130 200, 178 150 C 212 114, 244 74, 300 40", 1.3],
      ["M120 218 C 140 190, 150 156, 148 120", 1.1],
    ],
    leaves: [
      ["M0 0 Q10 -6 20 0 Q10 6 0 0Z", "translate(48,240) rotate(-18)"],
      ["M0 0 Q10 -6 20 0 Q10 6 0 0Z", "translate(96,224) rotate(-32)"],
      ["M0 0 Q9 -6 18 0 Q9 6 0 0Z", "translate(152,182) rotate(-52)"],
      ["M0 0 Q9 -6 18 0 Q9 6 0 0Z", "translate(196,132) rotate(-58)"],
      ["M0 0 Q8 -5 16 0 Q8 5 0 0Z", "translate(238,88) rotate(-44)"],
      ["M0 0 Q8 -5 16 0 Q8 5 0 0Z", "translate(134,168) rotate(122)"],
    ],
    flowers: [
      ["translate(78,206)", 1],
      ["translate(172,146) scale(0.82)", 1.2],
      ["translate(258,58) scale(0.66)", 1.5],
    ],
  },
  right: {
    viewBox: "0 0 460 300",
    stems: [
      ["M470 260 C 390 242, 322 206, 268 152 C 232 116, 196 72, 140 36", 1.3],
      ["M352 226 C 330 196, 320 160, 322 124", 1.1],
    ],
    leaves: [
      ["M0 0 Q10 -6 20 0 Q10 6 0 0Z", "translate(416,248) rotate(198)"],
      ["M0 0 Q10 -6 20 0 Q10 6 0 0Z", "translate(366,230) rotate(212)"],
      ["M0 0 Q9 -6 18 0 Q9 6 0 0Z", "translate(304,186) rotate(232)"],
      ["M0 0 Q9 -6 18 0 Q9 6 0 0Z", "translate(258,134) rotate(238)"],
      ["M0 0 Q8 -5 16 0 Q8 5 0 0Z", "translate(212,86) rotate(224)"],
      ["M0 0 Q8 -5 16 0 Q8 5 0 0Z", "translate(326,166) rotate(58)"],
    ],
    flowers: [
      ["translate(392,212)", 1],
      ["translate(284,150) scale(0.85)", 1.2],
      ["translate(186,52) scale(0.68)", 1.5],
    ],
  },
  mobile: {
    viewBox: "0 0 250 200",
    stems: [["M258 178 C 208 162, 168 130, 138 92 C 116 66, 92 38, 56 18", 1.2]],
    leaves: [
      ["M0 0 Q9 -5 18 0 Q9 5 0 0Z", "translate(214,168) rotate(200)"],
      ["M0 0 Q9 -5 18 0 Q9 5 0 0Z", "translate(176,140) rotate(218)"],
      ["M0 0 Q8 -5 16 0 Q8 5 0 0Z", "translate(140,100) rotate(234)"],
      ["M0 0 Q8 -4 15 0 Q8 4 0 0Z", "translate(108,60) rotate(228)"],
    ],
    flowers: [
      ["translate(196,150)", 1],
      ["translate(126,78) scale(0.8)", 1.2],
      ["translate(78,32) scale(0.64)", 1.5],
    ],
  },
} as const;

export function LandingBloom({
  variant = "right",
  className = "",
}: {
  variant?: keyof typeof branches;
  className?: string;
}) {
  const branch = branches[variant];
  const mobile = variant === "mobile";

  return (
    <svg
      viewBox={branch.viewBox}
      fill="none"
      className={`pointer-events-none ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="var(--color-paper-divider)">
        {branch.stems.map(([d, strokeWidth]) => (
          <path key={d} d={d} strokeWidth={strokeWidth} />
        ))}
      </g>
      <g
        stroke="var(--color-paper-gyp)"
        strokeWidth={mobile ? 0.9 : 1}
        fill="var(--color-sage-pale)"
      >
        {branch.leaves.map(([d, transform]) => (
          <path key={transform} d={d} transform={transform} />
        ))}
      </g>
      {branch.flowers.map(([transform, strokeWidth]) => (
        <g
          key={transform}
          transform={transform}
          stroke="var(--color-rose-light)"
          strokeWidth={strokeWidth}
          fill="var(--color-rose-pale)"
        >
          {[0, 72, 144, 216, 288].map((angle) => (
            <ellipse
              key={angle}
              cx="0"
              cy={mobile ? -9 : -10}
              rx={mobile ? 5 : 5.4}
              ry={mobile ? 8 : 9}
              transform={`rotate(${angle})`}
            />
          ))}
          <circle cx="0" cy="0" r={mobile ? 3.1 : 3.4} fill="var(--color-rose-light)" />
        </g>
      ))}
    </svg>
  );
}
