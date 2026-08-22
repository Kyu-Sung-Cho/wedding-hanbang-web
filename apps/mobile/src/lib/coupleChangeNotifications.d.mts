export type CoupleChangeEventKind =
  | "approval_requested"
  | "approval_pending"
  | "approval_ready"
  | "approval_withdrawn"
  | "change_applied"
  | "change_rejected"
  | "change_stale";

export type CoupleChangeHref =
  | "/chat"
  | "/budget"
  | "/schedule"
  | "/dashboard"
  | "/settings"
  | "/lounge";

export type CoupleChangeNativeRoute =
  | "/(tabs)/chat"
  | "/budget"
  | "/schedule"
  | "/(tabs)/lounge"
  | "/settings";

export interface CoupleChangeNotification {
  id: string;
  eventKind: CoupleChangeEventKind;
  toolName: string;
  title: string;
  message: string;
  href: CoupleChangeHref;
  createdAt: string;
  readAt: string | null;
}

export interface CoupleChangeNotificationsEnvelope {
  ownerId: string | null;
  notifications: CoupleChangeNotification[];
}

export declare function parseCoupleChangeNotifications(
  value: unknown,
): CoupleChangeNotificationsEnvelope | null;

export declare function getCoupleChangeNativeRoute(
  href: unknown,
): CoupleChangeNativeRoute | null;

export declare function selectCoupleChangesForViewer(
  envelope: unknown,
  viewerUserId: unknown,
  limit?: number,
): {
  visible: CoupleChangeNotification[];
  unreadCount: number;
  hiddenCount: number;
};

export declare function canOpenCoupleChange(notification: unknown): boolean;

export declare function selectUnreadCoupleChanges(
  notifications: unknown,
  limit?: number,
): {
  visible: CoupleChangeNotification[];
  unreadCount: number;
  hiddenCount: number;
};

export declare function isAwaitingMyApproval(notification: unknown): boolean;

export declare function buildMarkReadBody(
  ids: string[] | "all",
): { ids: string[] } | { all: true } | null;
