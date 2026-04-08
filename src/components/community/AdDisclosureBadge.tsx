import { AD_DISCLOSURE_OPTIONS } from "@/constants/communityCategories";
import type { AdDisclosure } from "@/types/community.types";

interface AdDisclosureBadgeProps {
  adDisclosure: AdDisclosure;
  sponsorshipDetail?: string | null;
  size?: "sm" | "md";
}

export default function AdDisclosureBadge({
  adDisclosure,
  sponsorshipDetail,
  size = "sm",
}: AdDisclosureBadgeProps) {
  const opt = AD_DISCLOSURE_OPTIONS.find((o) => o.key === adDisclosure);
  if (!opt) return null;

  const sizeClass =
    size === "sm"
      ? "text-[23px] px-2 py-0.5"
      : "text-xs px-2.5 py-1";

  return (
    <div className="relative inline-block group">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizeClass}`}
        style={{ backgroundColor: opt.bgColor, color: opt.color }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: opt.color }}
        />
        {opt.label}
      </span>
      {adDisclosure === "sponsored" && sponsorshipDetail && (
        <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-10 min-w-[200px] max-w-[350px] bg-[#1A1A1F] text-white text-xs rounded-lg p-2.5 shadow-lg">
          {sponsorshipDetail}
        </div>
      )}
    </div>
  );
}
