import type {
  ParsedCommunityRemoteReplyPushData,
  ParsedCommunityReplyPushHref,
} from "@hanbang/shared/community-notification";

export type CommunityPushAuthContext = {
  ownerId: string;
  accessToken: string;
};

export type ResolvedCommunityPushTarget = {
  deliveryId: string;
  notificationId: string;
  href: string;
};

export type CommunityPushNavigationGuard = {
  validate(data: unknown): Promise<boolean>;
  handleTap(data: unknown): Promise<boolean>;
  invalidateForAuthChange(): void;
};

export declare function createCommunityPushTargetResolver(input: {
  configuredSiteUrl: string | undefined;
  isDevelopment: boolean;
  fetchImpl?: typeof fetch;
}): (
  target: ParsedCommunityRemoteReplyPushData,
  auth: CommunityPushAuthContext,
) => Promise<ResolvedCommunityPushTarget | null>;

export declare function createCommunityPushNavigationGuard(input: {
  getAuthContext(): Promise<CommunityPushAuthContext | null>;
  resolveTarget(
    target: ParsedCommunityRemoteReplyPushData,
    auth: CommunityPushAuthContext,
  ): Promise<ResolvedCommunityPushTarget | null>;
  navigate(target: ParsedCommunityReplyPushHref): void;
}): CommunityPushNavigationGuard;
