import { NextResponse } from "next/server";

import { normalizeVendorEventBatch, sanitizeVendorEventContext } from "@/lib/analytics/vendorEvents";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  checkRateLimitPersistent,
  rateLimitKey,
} from "@/utils/rateLimit";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import {
  cleanIntegerInRange,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 64 * 1024;
const LEGACY_LOW_TRUST_TYPES = new Set([
  "vendor_view", "product_view", "search", "comparison", "view_duration",
  "page_view", "click",
]);

function isVendorBatch(value: unknown): boolean {
  return Array.isArray(value)
    || (isRecord(value) && Array.isArray(value.events));
}

type JsonReadResult =
  | { kind: "ok"; value: unknown }
  | { kind: "invalid" }
  | { kind: "too_large" };

async function readJson(request: Request, maxBytes: number): Promise<JsonReadResult> {
  const reader = request.body?.getReader();
  if (!reader) return { kind: "invalid" };
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { kind: "ok", value: JSON.parse(text) };
  } catch {
    return { kind: "invalid" };
  }
}

async function writeVendorBatch(request: Request, body: unknown) {
  let events;
  try {
    events = normalizeVendorEventBatch(body);
  } catch {
    return NextResponse.json(
      { error: "이벤트 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const anonIds = new Set(events.map((event) => event.anon_id));
  const sessionIds = new Set(events.map((event) => event.session_id));
  if (anonIds.size !== 1 || sessionIds.size !== 1) {
    return NextResponse.json(
      { error: "한 요청에는 동일한 익명 사용자와 세션의 이벤트만 보낼 수 있습니다." },
      { status: 400 },
    );
  }

  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  // Never trust a client-rotatable anon_id as an abuse-control identity.
  // Authenticated traffic is bucketed by server-verified user id; anonymous
  // traffic by the trusted proxy IP (or one conservative shared fallback).
  const abuseGates = [
    {
      key: rateLimitKey("events:vendor", request, user?.id),
      maxRequests: 60,
      windowMs: 60 * 1000,
    },
    {
      key: rateLimitKey("events:vendor:daily", request, user?.id),
      maxRequests: 1_000,
      windowMs: 24 * 60 * 60 * 1000,
    },
  ];
  for (const gate of abuseGates) {
    const limited = await checkRateLimitPersistent(
      gate.key,
      {
        maxRequests: gate.maxRequests,
        windowMs: gate.windowMs,
        cost: events.length,
      },
    );
    if (limited) return limited;
  }

  const { error } = await createAdminClient().from("events").insert(
    events.map((event) => ({
      ...event,
      // Browser telemetry remains pseudonymous even when the request carries
      // a valid session. The verified user id is used only for abuse-control
      // bucketing and is never persisted in the untrusted event lane.
      user_id: null,
      ingestion_trust: "client_untrusted",
    })),
  );
  if (error) {
    console.error("[vendor events] insert failed", { code: error.code });
    return NextResponse.json(
      { error: "이벤트를 기록하지 못했습니다." },
      { status: 503 },
    );
  }
  return NextResponse.json({ accepted: events.length });
}

async function writeLegacyEvent(request: Request, body: unknown) {
  if (!isRecord(body)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const eventType = cleanOptionalText(body.eventType, 40);
  if (!eventType || !LEGACY_LOW_TRUST_TYPES.has(eventType)) {
    return NextResponse.json(
      { error: "유효하지 않은 이벤트 타입입니다." },
      { status: 400 },
    );
  }

  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: true, skipped: "unauthenticated" });
  }

  const legacyAbuseGates = [
    {
      key: rateLimitKey("events:legacy", request, user.id),
      maxRequests: 60,
      windowMs: 60 * 1000,
    },
    {
      key: rateLimitKey("events:legacy:daily", request, user.id),
      maxRequests: 500,
      windowMs: 24 * 60 * 60 * 1000,
    },
  ];
  for (const gate of legacyAbuseGates) {
    const limited = await checkRateLimitPersistent(
      gate.key,
      { maxRequests: gate.maxRequests, windowMs: gate.windowMs },
    );
    if (limited) return limited;
  }

  const vendorId = body.vendorId == null || body.vendorId === "" ? null : body.vendorId;
  const productId = body.productId == null || body.productId === "" ? null : body.productId;
  if (vendorId !== null && !isUuid(vendorId)) {
    return NextResponse.json({ error: "vendorId가 올바르지 않습니다." }, { status: 400 });
  }
  if (productId !== null && !isUuid(productId)) {
    return NextResponse.json({ error: "productId가 올바르지 않습니다." }, { status: 400 });
  }
  const sessionId = body.sessionId == null || body.sessionId === "" ? null : body.sessionId;
  if (sessionId !== null && !isUuid(sessionId)) {
    return NextResponse.json({ error: "sessionId가 올바르지 않습니다." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", user.id)
    .single();
  const { error } = await createAdminClient().from("customer_events").insert({
    user_id: user.id,
    couple_id: profile?.couple_id || null,
    event_type: eventType,
    vendor_id: vendorId,
    product_id: productId,
    // Legacy metadata is reduced to the same non-PII whitelist as new events.
    metadata: sanitizeVendorEventContext(body.metadata),
    duration_seconds: cleanIntegerInRange(
      body.durationSeconds,
      0,
      24 * 60 * 60,
    ) ?? null,
    session_id: sessionId,
  });
  if (error) {
    console.error("[legacy events] insert failed", { code: error.code });
    return NextResponse.json({ error: "이벤트 기록 실패" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function POST(request: Request) {
  const ingressLimited = await checkRateLimitPersistent(
    rateLimitKey("events:ingress", request),
    { maxRequests: 120, windowMs: 60 * 1000 },
  );
  if (ingressLimited) return ingressLimited;

  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return NextResponse.json(
      { error: "요청 본문이 너무 큽니다." },
      { status: 413 },
    );
  }
  const parsedBody = await readJson(request, MAX_BODY_BYTES);
  if (parsedBody.kind === "too_large") {
    return NextResponse.json(
      { error: "요청 본문이 너무 큽니다." },
      { status: 413 },
    );
  }
  if (parsedBody.kind === "invalid") {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const body = parsedBody.value;
  try {
    return isVendorBatch(body)
      ? await writeVendorBatch(request, body)
      : await writeLegacyEvent(request, body);
  } catch (error) {
    console.error("[events] unexpected failure", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
