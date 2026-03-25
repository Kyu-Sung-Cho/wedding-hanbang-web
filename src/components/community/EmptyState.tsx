import { Inbox } from "lucide-react";
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
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center bg-white rounded-lg shadow-sm border border-[#E5E7EB]">
      <div className="text-[#6B7280] mb-3">
        {icon ?? <Inbox className="w-8 h-8" />}
      </div>
      <p className="text-sm font-medium text-[#1c1c1e]">{message}</p>
      {description && (
        <p className="mt-1 text-xs text-[#6B7280]">{description}</p>
      )}
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="mt-4 inline-flex items-center px-4 py-2.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
