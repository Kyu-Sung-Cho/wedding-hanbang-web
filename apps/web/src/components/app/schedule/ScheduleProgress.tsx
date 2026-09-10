interface Props {
  value: number;
  label: string;
  className?: string;
}

export default function ScheduleProgress({ value, label, className = "" }: Props) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      viewBox="0 0 100 4"
      preserveAspectRatio="none"
      className={`block !h-1 w-full overflow-hidden rounded-full ${className}`}
    >
      <rect width="100" height="4" className="fill-[var(--amora-low)]" />
      <rect width={percent} height="4" rx="2" className="fill-[var(--amora-rose)]" />
    </svg>
  );
}
