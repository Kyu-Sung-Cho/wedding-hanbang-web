/**
 * A logout may proceed only after at least one delivery boundary is closed:
 * either the server no longer owns the token or the device token is revoked.
 * Both actions are always attempted so a transient failure has a recovery path.
 */
export async function releasePushDeliveryOwnership({
  releaseServerToken,
  unregisterDeviceToken,
  clearCachedNotifications,
}) {
  if (
    typeof releaseServerToken !== "function"
    || typeof unregisterDeviceToken !== "function"
    || typeof clearCachedNotifications !== "function"
  ) {
    throw new Error("INVALID_PUSH_RELEASE_DEPENDENCIES");
  }

  const [server, device, cache] = await Promise.allSettled([
    releaseServerToken(),
    unregisterDeviceToken(),
    clearCachedNotifications(),
  ]);
  const serverReleased = server.status === "fulfilled";
  const deviceUnregistered = device.status === "fulfilled";
  const cacheCleared = cache.status === "fulfilled";
  if ((!serverReleased && !deviceUnregistered) || !cacheCleared) {
    throw new AggregateError(
      [server.reason, device.reason, cache.reason],
      "PUSH_DELIVERY_OWNERSHIP_RELEASE_UNCONFIRMED",
    );
  }

  return { serverReleased, deviceUnregistered, cacheCleared };
}
