import { MessageSquare, PenLine } from "lucide-react";
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
    <div className="relative flex flex-col items-center justify-center py-16 px-6 text-center bg-white rounded-xl shadow-sm border border-[#E5E7EB] overflow-hidden">
      {/* 배경 장식 */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-[#2563EB]/5" />
        <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-[#2563EB]/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-[#F4F6F8]/50" />
      </div>

      {/* 아이콘 */}
      <div className="relative z-10 w-14 h-14 rounded-xl bg-[#F4F6F8] border border-[#E5E7EB] flex items-center justify-center mb-4">
        <div className="text-[#6B7280]">
          {icon ?? <MessageSquare className="w-6 h-6" />}
        </div>
      </div>

      {/* 텍스트 */}
      <h3 className="relative z-10 text-base font-bold text-[#1c1c1e] mb-1">
        {message}
      </h3>
      {description && (
        <p className="relative z-10 text-base text-[#6B7280] max-w-xs leading-relaxed">
          {description}
        </p>
      )}

      {/* CTA 버튼 */}
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="relative z-10 mt-6 inline-flex items-center gap-2 px-4 py-2 text-base font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-all duration-200 shadow-sm"
        >
          <PenLine className="w-4 h-4" />
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
