interface SectionLabelProps {
  label: string;        // 한국어 라벨 ("다시 보기", "다섯 가지 역할" ...)
  tone?: "dark" | "light";
}

// 절제된 한국어 섹션 마커: rose rule + tracked label
export default function SectionLabel({ label, tone = "dark" }: SectionLabelProps) {
  const isDark = tone === "dark";
  const ruleCls = isDark ? "bg-[var(--hb-primary)]" : "bg-rose-light";
  // 글자는 rose-500 이 아니라 **rose-700** 이다. 12–13px 이라 rose-500 은 흰 카드에서
  // 3.67:1 밖에 안 나온다(2026-08-28 화면 실측). DESIGN.md 가 이미 이 규칙을 적어 뒀다 —
  // "`#7D5753` … use it for small mauve text (12–14px) where `#8F6662` misses 4.5:1".
  // 규칙이 없어서가 아니라 지켜지지 않아서 생긴 자리였다.
  //
  // 왼쪽 규칙선(`ruleCls`)은 그대로 rose-500 이다. 장식이라 대비 기준이 없고,
  // 여기까지 어둡게 하면 라벨과 선의 위계가 뒤집힌다.
  const labelCls = isDark ? "text-[var(--color-rose-700)]" : "text-rose-light";

  return (
    <div className="inline-flex items-center gap-4 mb-8">
      <span className={`h-px w-8 ${ruleCls}`} aria-hidden />
      <span className={`text-[12px] md:text-[13px] tracking-[0.28em] ${labelCls} font-medium`}>
        {label}
      </span>
    </div>
  );
}
