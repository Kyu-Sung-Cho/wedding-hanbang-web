import {
  BriefcaseBusiness,
  CircleHelp,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  getContentOriginPresentation,
  normalizeCommunityContentOrigin,
} from "@/lib/community/contentOrigin";
import type { CommunityContentOrigin } from "@/types/community.types";

type ContentOriginBadgeProps = {
  origin: CommunityContentOrigin | null | undefined;
  size?: "sm" | "md";
  className?: string;
};

const ORIGIN_ICONS = {
  member: UserRound,
  operator: ShieldCheck,
  ai: Sparkles,
  industry_professional: BriefcaseBusiness,
  legacy_unverified: CircleHelp,
} as const;

export default function ContentOriginBadge({
  origin,
  size = "sm",
  className = "",
}: ContentOriginBadgeProps) {
  const normalizedOrigin = normalizeCommunityContentOrigin(origin);
  const presentation = getContentOriginPresentation(normalizedOrigin);
  const Icon = ORIGIN_ICONS[normalizedOrigin];

  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border font-semibold leading-none ${
        size === "sm"
          ? "px-1.5 py-1 text-[9.5px]"
          : "px-2 py-1.5 text-[11px]"
      } ${presentation.className} ${className}`}
      title={presentation.description}
      aria-label={`작성 출처: ${presentation.label}. ${presentation.description}`}
      data-content-origin={normalizedOrigin}
    >
      <Icon
        aria-hidden="true"
        className={size === "sm" ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"}
      />
      <span className="truncate">{presentation.label}</span>
    </span>
  );
}
