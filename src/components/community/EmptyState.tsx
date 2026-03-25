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
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-white border border-[#ccc]/40 rounded">
      <div className="text-[#878A8C] mb-3">
        {icon ?? <Inbox className="w-8 h-8" />}
      </div>
      <p className="text-sm font-medium text-[#1A1A1F]">{message}</p>
      {description && (
        <p className="mt-1 text-xs text-[#878A8C]">{description}</p>
      )}
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="mt-4 inline-flex items-center px-4 py-2 text-sm font-bold text-white bg-[#1A1A1F] hover:bg-[#333] rounded transition-colors"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
