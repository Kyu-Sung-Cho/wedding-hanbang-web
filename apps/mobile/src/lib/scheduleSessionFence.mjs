const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("INVALID_SCHEDULE_SESSION_IDENTITY");
  }
  return value.toLowerCase();
}

export function createScheduleSessionFence() {
  let generation = 0;
  let ownerId = null;
  let coupleId = null;

  return {
    setOwner(nextOwnerId) {
      const normalizedOwnerId = nextOwnerId === null
        ? null
        : normalizeUuid(nextOwnerId);
      if (ownerId === normalizedOwnerId) return false;

      generation += 1;
      ownerId = normalizedOwnerId;
      coupleId = null;
      return true;
    },

    clearCouple(nextOwnerId) {
      const normalizedOwnerId = normalizeUuid(nextOwnerId);
      if (ownerId === normalizedOwnerId && coupleId === null) return false;

      generation += 1;
      ownerId = normalizedOwnerId;
      coupleId = null;
      return true;
    },

    setIdentity(nextOwnerId, nextCoupleId) {
      const normalizedOwnerId = normalizeUuid(nextOwnerId);
      const normalizedCoupleId = normalizeUuid(nextCoupleId);
      if (ownerId === normalizedOwnerId && coupleId === normalizedCoupleId) {
        return false;
      }

      generation += 1;
      ownerId = normalizedOwnerId;
      coupleId = normalizedCoupleId;
      return true;
    },

    capture() {
      if (ownerId === null || coupleId === null) return null;
      return { generation, ownerId, coupleId };
    },

    isCurrent(token) {
      return token !== null
        && typeof token === "object"
        && Number.isSafeInteger(token.generation)
        && token.generation === generation
        && token.ownerId === ownerId
        && token.coupleId === coupleId;
    },
  };
}
