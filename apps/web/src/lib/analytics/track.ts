"use client";

import { isBrowserTrackingOptOut } from "@/lib/analyticsPrivacy";
import {
  isClientVendorEventType,
  type ClientVendorEventType,
  type VendorEventType,
} from "./eventWeights";
import {
  sanitizeVendorEventContext,
  type VendorEventContext,
  type VendorEventSurface,
} from "./vendorEvents";

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_SIZE = 20;
const MAX_BATCH_SIZE = 50;

type QueuedVendorEvent = {
  anon_id: string;
  session_id: string;
  event_type: ClientVendorEventType;
  vendor_id?: string;
  agency_id?: string;
  surface: VendorEventSurface;
  context: VendorEventContext;
};

type TrackOptions = {
  vendor_id?: string;
  agency_id?: string;
  surface: VendorEventSurface;
  context?: VendorEventContext;
};

const queue: QueuedVendorEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let listenersInstalled = false;
let anonymousId: string | null = null;
let sessionId: string | null = null;

function uuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    // Analytics is optional. Never synthesize a linkable identifier from a
    // predictable PRNG merely to keep telemetry alive on an unsupported host.
    throw new Error("secure_random_unavailable");
  }
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function getAnonId(): string {
  anonymousId ??= uuidV4();
  return anonymousId;
}

function getSessionId(): string {
  sessionId ??= uuidV4();
  return sessionId;
}

function scheduleFlush(): void {
  if (flushTimer !== null || queue.length === 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushVendorEvents();
  }, FLUSH_INTERVAL_MS);
}

async function postBatch(batch: QueuedVendorEvent[]): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
      if (response.ok) return;
    } catch {
      // One retry is allowed; analytics never blocks the product experience.
    }
  }
}

export async function flushVendorEvents(): Promise<void> {
  if (flushing || queue.length === 0 || typeof window === "undefined") return;
  flushing = true;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_BATCH_SIZE);
      await postBatch(batch);
    }
  } finally {
    flushing = false;
    scheduleFlush();
  }
}

function beaconFlush(): void {
  if (queue.length === 0 || typeof navigator.sendBeacon !== "function") return;
  while (queue.length > 0) {
    const batch = queue.splice(0, MAX_BATCH_SIZE);
    const payload = new Blob(
      [JSON.stringify({ events: batch })],
      { type: "application/json" },
    );
    navigator.sendBeacon("/api/events", payload);
  }
}

function installLifecycleListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") beaconFlush();
  });
  window.addEventListener("pagehide", beaconFlush);
}

export function track(
  eventType: VendorEventType,
  options: TrackOptions,
): void {
  if (
    typeof window === "undefined"
    || isBrowserTrackingOptOut()
    || !isClientVendorEventType(eventType)
  ) return;
  try {
    installLifecycleListeners();
    const context = sanitizeVendorEventContext(options.context);
    if (!context.referrer_host && document.referrer) {
      try {
        context.referrer_host = new URL(document.referrer).hostname;
      } catch {
        // Invalid referrers are discarded.
      }
    }
    queue.push({
      anon_id: getAnonId(),
      session_id: getSessionId(),
      event_type: eventType,
      ...(options.vendor_id ? { vendor_id: options.vendor_id } : {}),
      ...(options.agency_id ? { agency_id: options.agency_id } : {}),
      surface: options.surface,
      context,
    });
    if (queue.length >= FLUSH_SIZE) void flushVendorEvents();
    else scheduleFlush();
  } catch {
    // Analytics is intentionally lossy and must never interrupt the user.
  }
}

export function __resetVendorEventTrackerForTests(): void {
  queue.splice(0, queue.length);
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  flushing = false;
  anonymousId = null;
  sessionId = null;
}

/** Rotate tab-memory analytics identities when the authenticated actor changes. */
export function resetVendorEventIdentity(): void {
  __resetVendorEventTrackerForTests();
}
