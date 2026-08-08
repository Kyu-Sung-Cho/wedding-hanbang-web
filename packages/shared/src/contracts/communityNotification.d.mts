export type CommunityReplyNotificationKind = "post_reply" | "comment_reply";

export interface CommunityReplyNotificationTarget {
  kind: CommunityReplyNotificationKind;
  postId: string;
  commentId: string;
}

export interface CommunityReplyPushPayload {
  readonly title: "웨딩한방 커뮤니티";
  readonly body:
    | "내 글에 새 답변이 도착했어요."
    | "내 답변에 새 답글이 도착했어요.";
  readonly data: {
    readonly type: "community_reply";
    readonly href: string;
  };
}

export interface CommunityRemoteReplyNotificationTarget
  extends CommunityReplyNotificationTarget {
  notificationId: string;
  deliveryId: string;
}

export interface CommunityRemoteReplyPushPayload {
  readonly title: CommunityReplyPushPayload["title"];
  readonly body: CommunityReplyPushPayload["body"];
  readonly data: {
    readonly type: "community_reply";
    readonly href: string;
    readonly notificationId: string;
    readonly deliveryId: string;
  };
}

export interface ParsedCommunityReplyPushHref {
  readonly postId: string;
  readonly commentId: string;
}

export interface ParsedCommunityRemoteReplyPushData
  extends ParsedCommunityReplyPushHref {
  readonly type: "community_reply";
  readonly href: string;
  readonly notificationId: string;
  readonly deliveryId: string;
}

export function buildCommunityReplyWebHref(
  postId: string,
  commentId: string,
): string;

export function isAllowedCommunityReplyWebHref(value: unknown): value is string;

export function isAllowedCommunityReplyPushHref(value: unknown): value is string;

export function parseCommunityReplyPushHref(
  value: unknown,
): ParsedCommunityReplyPushHref | null;

export function buildCommunityReplyPushPayload(
  target: CommunityReplyNotificationTarget,
): CommunityReplyPushPayload;

export function buildCommunityRemoteReplyPushPayload(
  target: CommunityRemoteReplyNotificationTarget,
): CommunityRemoteReplyPushPayload;

export function parseCommunityRemoteReplyPushData(
  value: unknown,
): ParsedCommunityRemoteReplyPushData | null;
