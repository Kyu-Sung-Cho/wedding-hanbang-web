import { Check, Star, Megaphone } from "lucide-react";
import { AD_DISCLOSURE_OPTIONS } from "@/constants/communityCategories";
import type { AdDisclosure } from "@/types/community.types";

interface AdDisclosureBadgeProps {
  adDisclosure: AdDisclosure;
  sponsorshipDetail?: string | null;
  size?: "sm" | "md";
}

// 색맹 친화 — 색 + 아이콘 모양으로 이중 구분.
const ICON_MAP = {
  check: Check,
  star: Star,
  megaphone: Megaphone,
} as const;

export default function AdDisclosureBadge({
  adDisclosure,
  sponsorshipDetail,
  size = "sm",
}: AdDisclosureBadgeProps) {
  const opt = AD_DISCLOSURE_OPTIONS.find((o) => o.key === adDisclosure);
  if (!opt) return null;

  const Icon = ICON_MAP[opt.icon as keyof typeof ICON_MAP] ?? Check;

  const sizeClass =
    size === "sm"
      ? "text-[11px] px-2 py-0.5 gap-1"
      : "text-xs px-2.5 py-1 gap-1.5";
  const iconSize = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full font-medium border ${sizeClass}`}
        style={{
          backgroundColor: opt.bgColor,
          color: opt.color,
          borderColor: opt.borderColor,
        }}
        aria-label={`광고 표시: ${opt.label}`}
      >
        <Icon className={iconSize} strokeWidth={2.5} aria-hidden />
        {opt.label}
      </span>
      {adDisclosure === "sponsored" && sponsorshipDetail && (
        <span className="max-w-full break-words text-[11px] font-medium leading-[1.45] text-[#8F6662]">
          받은 혜택: {sponsorshipDetail}
        </span>
      )}
    </span>
  );
}
