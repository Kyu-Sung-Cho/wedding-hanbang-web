export default function BudgetProgress({ value, danger = false }: { value: number; danger?: boolean }) {
  return (
    <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="!h-1 w-full overflow-hidden rounded-full" aria-hidden="true">
      <rect width="100" height="4" fill="var(--amora-low, #f1e8da)" />
      <rect width={Math.max(0, Math.min(value, 100))} height="4" fill={danger ? "#d95f5f" : "var(--amora-rose, #a77b74)"} />
    </svg>
  );
}
