export type AmoraPushKind = "today_one" | "task_done";
export type AmoraPushRoute = "home" | "chat";

export declare const AMORA_PUSH_COPY: {
  readonly title: "웨딩한방";
  readonly body: "아모라가 정리한 게 있어요.";
};
export declare const AMORA_PUSH_DAILY_CAP: 2;
export declare const AMORA_PUSH_WINDOW: { readonly startHour: 9; readonly endHour: 20 };
export declare const AMORA_PUSH_KINDS: readonly AmoraPushKind[];
export declare const AMORA_PUSH_ROUTES: readonly AmoraPushRoute[];

export interface AmoraPushData {
  readonly type: "amora";
  readonly deliveryId: string;
  readonly route: AmoraPushRoute;
}

export interface AmoraPushMessage {
  readonly to: string;
  readonly title: (typeof AMORA_PUSH_COPY)["title"];
  readonly body: (typeof AMORA_PUSH_COPY)["body"];
  readonly data: AmoraPushData;
  readonly sound: "default";
  readonly collapseId: "amora";
  readonly tag: "amora";
  readonly ttl: number;
  readonly priority: "normal";
}

export declare function kstHour(date?: Date): number;
export declare function isWithinAmoraPushWindow(date?: Date): boolean;
export declare function isAmoraPushKind(value: unknown): value is AmoraPushKind;
export declare function isAmoraPushRoute(value: unknown): value is AmoraPushRoute;
export declare function buildAmoraPushMessage(input: {
  to: string;
  deliveryId: string;
  route: AmoraPushRoute;
}): AmoraPushMessage;
export declare function parseAmoraPushData(
  value: unknown,
): { readonly deliveryId: string; readonly route: AmoraPushRoute } | null;
