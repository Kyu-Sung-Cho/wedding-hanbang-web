/* global AbortController, clearTimeout, setTimeout */

import {
  parseCommunityRemoteReplyPushData,
  parseCommunityReplyPushHref,
} from "@hanbang/shared/community-notification";
import { buildMobileSiteUrl, resolveMobileSiteOrigin } from "./siteUrl.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONSUMED_DELIVERIES = 100;

export function createCommunityPushTargetResolver({
  configuredSiteUrl,
  isDevelopment,
  fetchImpl = globalThis.fetch,
}) {
  return async function resolveCommunityPushTarget(target, auth) {
    let siteOrigin;
    try {
      siteOrigin = resolveMobileSiteOrigin(configuredSiteUrl, { isDevelopment });
    } catch {
      return null;
    }

    const path =
      "/api/community/notifications/push-target"
      + `?deliveryId=${encodeURIComponent(target.deliveryId)}`
      + `&notificationId=${encodeURIComponent(target.notificationId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetchImpl(buildMobileSiteUrl(path, siteOrigin), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > 8 * 1024) return null;
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseResolvedTarget(value, expected) {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3
    || keys[0] !== "deliveryId"
    || keys[1] !== "href"
    || keys[2] !== "notificationId"
    || !isUuid(value.deliveryId)
    || value.deliveryId.toLowerCase() !== expected.deliveryId
    || !isUuid(value.notificationId)
    || value.notificationId.toLowerCase() !== expected.notificationId
    || value.href !== expected.href
  ) {
    return null;
  }
  const route = parseCommunityReplyPushHref(value.href);
  if (
    !route
    || route.postId !== expected.postId
    || route.commentId !== expected.commentId
  ) {
    return null;
  }
  return route;
}

export function createCommunityPushNavigationGuard({
  getAuthContext,
  resolveTarget,
  navigate,
}) {
  let generation = 0;
  const consumed = new Set();
  const inFlight = new Set();
  const validationCache = new Map();

  function invalidateForAuthChange() {
    generation += 1;
    consumed.clear();
    inFlight.clear();
    validationCache.clear();
  }

  async function resolve(data) {
    const parsed = parseCommunityRemoteReplyPushData(data);
    if (!parsed) return null;
    const startGeneration = generation;
    const before = await getAuthContext();
    if (
      startGeneration !== generation
      || !before
      || !isUuid(before.ownerId)
      || typeof before.accessToken !== "string"
      || before.accessToken.length < 1
    ) {
      return null;
    }

    let response;
    try {
      response = await resolveTarget(parsed, before);
    } catch {
      return null;
    }
    if (startGeneration !== generation) return null;

    const after = await getAuthContext();
    if (
      startGeneration !== generation
      || !after
      || !isUuid(after.ownerId)
      || after.ownerId.toLowerCase() !== before.ownerId.toLowerCase()
    ) {
      return null;
    }
    return parseResolvedTarget(response, parsed);
  }

  async function validate(data) {
    const parsed = parseCommunityRemoteReplyPushData(data);
    if (!parsed) return false;
    const now = Date.now();
    const cached = validationCache.get(parsed.deliveryId);
    if (cached && cached.generation === generation && cached.expiresAt > now) {
      return cached.promise;
    }
    const cacheGeneration = generation;
    const promise = resolve(data).then((target) => target !== null);
    validationCache.set(parsed.deliveryId, {
      generation: cacheGeneration,
      expiresAt: now + 5_000,
      promise,
    });
    return promise;
  }

  async function handleTap(data) {
    const parsed = parseCommunityRemoteReplyPushData(data);
    if (!parsed || consumed.has(parsed.deliveryId) || inFlight.has(parsed.deliveryId)) {
      return false;
    }
    const startGeneration = generation;
    inFlight.add(parsed.deliveryId);
    try {
      const route = await resolve(data);
      if (!route || startGeneration !== generation) return false;
      consumed.add(parsed.deliveryId);
      if (consumed.size > MAX_CONSUMED_DELIVERIES) {
        consumed.delete(consumed.values().next().value);
      }
      navigate(route);
      return true;
    } finally {
      inFlight.delete(parsed.deliveryId);
    }
  }

  return Object.freeze({
    validate,
    handleTap,
    invalidateForAuthChange,
  });
}
