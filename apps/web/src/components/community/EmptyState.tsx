import { MessageSquare } from "lucide-react";
import Link from "next/link";

interface EmptyStateProps {
  icon?: React.ReactNode;
  message: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export default function EmptyState({
  icon,
  message,
  description,
  ctaLabel,
  ctaHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="text-[var(--hb-text-muted)] mb-5">
        {icon ?? <MessageSquare className="w-12 h-12" />}
      </div>

      <h3 className="text-lg font-medium text-[var(--hb-text-strong)] mb-2">
        {message}
      </h3>
      {description && (
        <p className="text-base text-[var(--hb-text-muted)] max-w-sm leading-relaxed">
          {description}
        </p>
      )}

      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="mt-7 inline-flex items-center gap-2 px-6 py-3 text-base font-medium text-white bg-[var(--hb-primary)] shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] rounded-xl transition-all duration-200"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
