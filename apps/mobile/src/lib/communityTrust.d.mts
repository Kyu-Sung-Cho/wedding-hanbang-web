export type CommunityContentOrigin =
  | "member"
  | "operator"
  | "ai"
  | "industry_professional"
  | "legacy_unverified";

export type CommunityAdDisclosure = "general" | "sponsored" | "ad";

export type CommunityPostTrust = {
  contentOrigin: CommunityContentOrigin;
  adDisclosure: CommunityAdDisclosure;
  sponsorshipDetail: string | null;
  isResolved: boolean;
  underReview: boolean;
};

export type CommunityPostLoadFailure =
  | "auth_required"
  | "unavailable"
  | "load_failed";

export function parseCommunityPostTrust(value: unknown): CommunityPostTrust | null;
export function parseCommunityCommentOrigin(value: unknown): CommunityContentOrigin | null;
export function communityContentOriginLabel(origin: CommunityContentOrigin): string;
export function buildCommunitySourceDisclosure(
  value: Readonly<{
    contentOrigin: CommunityContentOrigin;
    adDisclosure: CommunityAdDisclosure;
  }>,
  asOfDate: string,
): Readonly<AmoraSourceDisclosure> | null;
export function communityPostLoadFailure(status: number): CommunityPostLoadFailure;
import type { AmoraSourceDisclosure } from "@hanbang/shared/amora-source-disclosure";
