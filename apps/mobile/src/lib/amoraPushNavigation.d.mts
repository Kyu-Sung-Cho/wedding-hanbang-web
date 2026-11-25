export declare function isAmoraPushData(data: unknown): boolean;
export declare function amoraPushHref(data: unknown): "/(tabs)/lounge" | "/(tabs)/chat" | null;
export declare function createAmoraPushTapGuard(input: {
  navigate: (href: "/(tabs)/lounge" | "/(tabs)/chat") => void;
  limit?: number;
}): { handleTap(data: unknown): boolean };
