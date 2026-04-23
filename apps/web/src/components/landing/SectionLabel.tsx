interface SectionLabelProps {
  label: string;        // 한국어 라벨 ("다시 보기", "다섯 가지 역할" ...)
  tone?: "dark" | "light";
}

// 절제된 한국어 섹션 마커: rose rule + tracked label
export default function SectionLabel({ label, tone = "dark" }: SectionLabelProps) {
  const isDark = tone === "dark";
  const ruleCls = isDark ? "bg-rose-500" : "bg-rose-light";
  const labelCls = isDark ? "text-rose-500" : "text-rose-light";

  return (
    <div className="inline-flex items-center gap-4 mb-8">
      <span className={`h-px w-8 ${ruleCls}`} aria-hidden />
      <span className={`text-[11px] tracking-[0.3em] ${labelCls} font-medium`}>
        {label}
      </span>
    </div>
  );
}
