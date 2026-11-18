import type { InvitationRouteKey } from "@hanbang/shared/invitation";

export type InvitationTabRouteKey = Extract<InvitationRouteKey, "home" | "chat" | "journey" | "status">;
export type InvitationTabScreenName = "lounge" | "chat" | "journey" | "schedule";

export const INVITATION_LIVE_ROUTES: Readonly<Record<InvitationRouteKey, string>>;
export const INVITATION_TAB_SCREENS: Readonly<Record<InvitationTabRouteKey, InvitationTabScreenName>>;

export function isInvitationRouteKey(value: unknown): value is InvitationRouteKey;
export function invitationLiveHref(key: InvitationRouteKey): string;
export function invitationTabKeyForScreen(name: string | undefined): InvitationTabRouteKey | null;

/** expo-router 의 `router`. 메서드 꼴로 적어 타입이 정해진 주소(typedRoutes)도 받는다. */
export type InvitationRouter = {
  navigate(href: string): void;
  push(href: string): void;
  dismissTo(href: string): void;
};

export function navigateInvitationRoute(router: InvitationRouter, key: InvitationRouteKey, from: "tabs" | "stack"): void;
