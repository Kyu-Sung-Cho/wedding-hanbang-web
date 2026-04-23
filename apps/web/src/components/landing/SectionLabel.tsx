interface SectionLabelProps {
  number: string;       // "01", "02", ...
  label: string;        // "REFRAMED", "ROLES", ...
  tone?: "dark" | "light";
}

// 에디토리얼 매거진 스타일 섹션 마커
// 예시:  01 ——  REFRAMED
export default function SectionLabel({ number, label, tone = "dark" }: SectionLabelProps) {
  const isDark = tone === "dark";
  const numberCls = isDark ? "text-rose-500" : "text-white/80";
  const ruleCls = isDark ? "bg-taupe-400/50" : "bg-white/30";
  const labelCls = isDark ? "text-noir-800" : "text-white/90";

  return (
    <div className="inline-flex items-center gap-4 mb-8">
      <span className={`font-display text-xl ${numberCls} tracking-tight`}>{number}</span>
      <span className={`h-px w-10 ${ruleCls}`} aria-hidden />
      <span className={`text-[11px] tracking-[0.22em] uppercase font-medium ${labelCls}`}>
        {label}
      </span>
    </div>
  );
}
