import AmoraMark from "./AmoraMark";

interface AmoraAvatarProps {
  sizeClassName?: string;
  className?: string;
}

// 테두리가 곧 나침반 고리다 — 표식의 고리는 빼고 별만 크게 넣는다(amora.ts).
export default function AmoraAvatar({ sizeClassName = "size-8", className = "" }: AmoraAvatarProps) {
  return (
    <span aria-hidden="true" data-amora-avatar="compass"
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--hb-amora-line,#8F6662)] bg-[var(--hb-amora-surface,#FBF8F2)] text-[var(--hb-amora-ink,#7D5753)] ${sizeClassName} ${className}`}>
      <AmoraMark ring={false} className="size-full" />
    </span>
  );
}
