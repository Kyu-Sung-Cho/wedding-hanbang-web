export interface PushDeliveryReleaseDependencies {
  releaseServerToken: () => Promise<unknown>;
  unregisterDeviceToken: () => Promise<unknown>;
  clearCachedNotifications: () => Promise<unknown>;
}

export interface PushDeliveryReleaseResult {
  serverReleased: boolean;
  deviceUnregistered: boolean;
  cacheCleared: boolean;
}

export function releasePushDeliveryOwnership(
  dependencies: PushDeliveryReleaseDependencies,
): Promise<PushDeliveryReleaseResult>;
