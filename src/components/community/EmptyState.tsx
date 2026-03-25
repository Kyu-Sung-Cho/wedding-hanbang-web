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
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#F5F2ED] flex items-center justify-center mb-4 text-[#B5ADA3]">
        {icon ?? <Inbox className="w-7 h-7" />}
      </div>
      <p className="text-[#1A1A1F] font-medium">{message}</p>
      {description && (
        <p className="mt-1.5 text-sm text-[#928980] max-w-xs">{description}</p>
      )}
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="mt-5 inline-flex items-center px-5 py-2.5 text-sm font-medium text-white bg-[#C4967E] hover:bg-[#9A6B62] rounded-xl transition-colors"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
