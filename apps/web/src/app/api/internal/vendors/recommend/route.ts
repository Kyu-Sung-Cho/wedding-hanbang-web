import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInternalVendorRequest } from "@/lib/vendors/internalAuth";
import { rankVendorRecommendations } from "@/lib/vendors/recommendation";
import {
  loadRecommendationCandidates,
  logRecommendationImpressions,
} from "@/lib/vendors/recommendationData";
import { parseVendorRecommendationRequest } from "@/lib/vendors/recommendationRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 16 * 1024;

type BoundedBodyResult =
  | { status: "ok"; text: string }
  | { status: "invalid" }
  | { status: "too_large" };

async function readBoundedBody(request: Request): Promise<BoundedBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return { status: "invalid" };
    if (parsed > MAX_BODY_BYTES) return { status: "too_large" };
  }
  if (!request.body) return { status: "ok", text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel("recommendation request too large").catch(() => undefined);
        return { status: "too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { status: "ok", text };
  } catch {
    return { status: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (!verifyInternalVendorRequest(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const body = await readBoundedBody(request);
  if (body.status === "too_large") {
    return NextResponse.json(
      { error: "Recommendation request too large" },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }
  if (body.status === "invalid") {
    return NextResponse.json(
      { error: "Invalid recommendation request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(body.text);
  } catch {
    return NextResponse.json(
      { error: "Invalid recommendation request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const parsed = parseVendorRecommendationRequest(input);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid recommendation request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const client = createAdminClient();
    const candidates = await loadRecommendationCandidates(client, parsed.data.category);
    const response = rankVendorRecommendations(parsed.data, candidates);

    try {
      const logged = await logRecommendationImpressions(client, parsed.data, response);
      if (!logged) console.warn("Vendor recommendation impression logging failed");
    } catch {
      console.warn("Vendor recommendation impression logging failed");
    }

    return NextResponse.json(response, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Vendor recommendation unavailable" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
