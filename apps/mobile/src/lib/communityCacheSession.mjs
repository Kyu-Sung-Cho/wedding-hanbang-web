const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toViewerKey(viewerId) {
  if (viewerId === null) return "guest";
  if (typeof viewerId !== "string" || !UUID_PATTERN.test(viewerId)) {
    throw new Error("INVALID_COMMUNITY_CACHE_VIEWER");
  }
  return `user:${viewerId.toLowerCase()}`;
}

/**
 * Fences account-bound community cache work. A captured token may commit only
 * while the authenticated viewer is unchanged.
 */
export function createCommunityCacheSession() {
  let generation = 0;
  let viewerKey = "unresolved";

  return {
    setViewer(viewerId) {
      const nextViewerKey = toViewerKey(viewerId);
      if (nextViewerKey === viewerKey) return false;

      generation += 1;
      viewerKey = nextViewerKey;
      return true;
    },

    capture() {
      return { generation, viewerKey };
    },

    isCurrent(token) {
      return token !== null
        && typeof token === "object"
        && Number.isSafeInteger(token.generation)
        && token.generation === generation
        && token.viewerKey === viewerKey;
    },
  };
}
