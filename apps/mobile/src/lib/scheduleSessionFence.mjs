const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SCHEDULE_IDENTITY_RECONCILIATION_INTERVAL_MS = 45_000;

function normalizeUuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("INVALID_SCHEDULE_SESSION_IDENTITY");
  }
  return value.toLowerCase();
}

function normalizeUuidOrNull(value) {
  try {
    return normalizeUuid(value);
  } catch {
    return null;
  }
}

export function buildScheduleIdentitySnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const ownerId = normalizeUuidOrNull(input.ownerId);
  const coupleId = normalizeUuidOrNull(input.coupleId);
  const roster = input.roster;
  if (
    !ownerId
    || !coupleId
    || !roster
    || typeof roster !== "object"
    || Array.isArray(roster)
    || normalizeUuidOrNull(roster.id) !== coupleId
  ) return null;

  const memberIds = [];
  for (const memberId of [roster.bride_id ?? null, roster.groom_id ?? null]) {
    if (memberId === null) continue;
    const normalizedMemberId = normalizeUuidOrNull(memberId);
    if (!normalizedMemberId) return null;
    memberIds.push(normalizedMemberId);
  }
  memberIds.sort();
  if (
    memberIds.length < 1
    || new Set(memberIds).size !== memberIds.length
    || !memberIds.includes(ownerId)
  ) return null;

  return { ownerId, coupleId, memberIds };
}

export function isSameScheduleIdentitySnapshot(current, next) {
  return current !== null
    && typeof current === "object"
    && next !== null
    && typeof next === "object"
    && current.ownerId === next.ownerId
    && current.coupleId === next.coupleId
    && Array.isArray(current.memberIds)
    && Array.isArray(next.memberIds)
    && current.memberIds.length === next.memberIds.length
    && current.memberIds.every((memberId, index) => memberId === next.memberIds[index]);
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
