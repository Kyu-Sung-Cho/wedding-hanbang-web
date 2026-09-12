import AmoraMark from "./AmoraMark";

interface AmoraAvatarProps {
  sizeClassName?: string;
  className?: string;
}

export default function AmoraAvatar({ sizeClassName = "size-8", className = "" }: AmoraAvatarProps) {
  return (
    <span aria-hidden="true" data-amora-avatar="ribbon"
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--hb-amora-line,#8F6662)] bg-[var(--hb-amora-surface,#FBF8F2)] text-[var(--hb-amora-ink,#7D5753)] ${sizeClassName} ${className}`}>
      <AmoraMark className="size-[68%]" />
    </span>
  );
}
