import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { USER_RESEARCH_COHORT_CODE } from "@/constants/beta";
import { verifyResearchEmailVerificationToken } from "@/lib/researchEmailVerification";
import {
  checkRateLimit,
  checkRateLimitPersistentStrict,
} from "@/utils/rateLimit";

export const dynamic = "force-dynamic";

type ResultStatus = "verified" | "expired" | "invalid" | "unavailable";

const PRODUCTION_ORIGIN = "https://hanbang.ai";
const MAX_BODY_BYTES = 2 * 1024;
const LOCAL_REPLAY_LIMIT = { maxRequests: 5, windowMs: 10 * 60 * 1000 } as const;
const DISTRIBUTED_REPLAY_LIMIT = { maxRequests: 8, windowMs: 2 * 60 * 60 * 1000 } as const;

function applyPrivateHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Vary", "Origin");
  return response;
}

function resultResponse(status: ResultStatus, httpStatus = 200): NextResponse {
  return applyPrivateHeaders(NextResponse.json({ status }, { status: httpStatus }));
}

function limitedResult(response: NextResponse): NextResponse {
  const status = response.status === 429 ? 429 : 503;
  const result = resultResponse("unavailable", status);
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) result.headers.set("Retry-After", retryAfter);
  return result;
}

function redirectLegacyGet(request: NextRequest): NextResponse {
  const resultUrl = request.nextUrl.clone();
  resultUrl.pathname = "/beta/verify";
  resultUrl.search = "";
  resultUrl.searchParams.set("status", "invalid");
  return applyPrivateHeaders(NextResponse.redirect(resultUrl, 303));
}

function isSameOriginClientPost(request: NextRequest): boolean {
  const expectedOrigin = process.env.NODE_ENV === "production"
    ? PRODUCTION_ORIGIN
    : request.nextUrl.origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  return request.nextUrl.origin === expectedOrigin
    && request.headers.get("origin") === expectedOrigin
    && request.headers.get("x-research-email-verification") === "1"
    && (fetchSite === null || fetchSite === "same-origin");
}

type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; tooLarge: boolean };

async function readBoundedJson(request: NextRequest): Promise<BoundedJsonResult> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, tooLarge: true };
  }
  if (!request.body) return { ok: false, tooLarge: false };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request is already rejected; cancellation failure changes no state.
        }
        return { ok: false, tooLarge: true };
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function tokenFromBody(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.token !== "string") return null;
  return record.token;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  try {
    return createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch {
    return null;
  }
}

// Backward-compatible cleanup only. New email links carry their capability in
// a URL fragment and therefore never send it to this GET endpoint or edge logs.
export async function GET(request: NextRequest) {
  return redirectLegacyGet(request);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginClientPost(request)) {
    return resultResponse("invalid", 403);
  }
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return resultResponse("invalid", 415);
  }

  const parsedBody = await readBoundedJson(request);
  if (!parsedBody.ok) {
    return resultResponse("invalid", parsedBody.tooLarge ? 413 : 400);
  }
  const token = tokenFromBody(parsedBody.value);
  if (!token) return resultResponse("invalid", 400);

  const verification = verifyResearchEmailVerificationToken(token);
  if (!verification.ok) {
    if (verification.reason === "misconfigured") {
      return resultResponse("unavailable", 503);
    }
    return resultResponse(verification.reason === "expired" ? "expired" : "invalid");
  }
  if (verification.claims.cohortCode !== USER_RESEARCH_COHORT_CODE) {
    return resultResponse("invalid");
  }

  // The raw capability never becomes a limiter key. A local pre-gate absorbs
  // hot replay loops without a DB call; the distributed gate prevents replays
  // across serverless instances from reaching the application table.
  const fingerprint = createHash("sha256").update(token).digest("hex");
  const replayKey = `research-email-verification:${fingerprint}`;
  const locallyLimited = checkRateLimit(replayKey, LOCAL_REPLAY_LIMIT);
  if (locallyLimited) return limitedResult(locallyLimited);
  const persistentlyLimited = await checkRateLimitPersistentStrict(
    replayKey,
    DISTRIBUTED_REPLAY_LIMIT
  );
  if (persistentlyLimited) return limitedResult(persistentlyLimited);

  const supabase = getServiceClient();
  if (!supabase) return resultResponse("unavailable", 503);

  try {
    const { applicationId, cohortCode } = verification.claims;
    const verifiedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("research_cohort_applications")
      .update({ email_verified_at: verifiedAt })
      .eq("id", applicationId)
      .eq("cohort_code", cohortCode)
      .gt("expires_at", verifiedAt)
      .is("email_verified_at", null)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("RESEARCH_EMAIL_VERIFICATION_UPDATE_FAILED");
      return resultResponse("unavailable", 503);
    }
    if (updated) return resultResponse("verified");

    const { data: existing, error: lookupError } = await supabase
      .from("research_cohort_applications")
      .select("id,email_verified_at")
      .eq("id", applicationId)
      .eq("cohort_code", cohortCode)
      .gt("expires_at", verifiedAt)
      .maybeSingle();

    if (lookupError) {
      console.error("RESEARCH_EMAIL_VERIFICATION_LOOKUP_FAILED");
      return resultResponse("unavailable", 503);
    }
    if (existing?.email_verified_at) return resultResponse("verified");
    return resultResponse(existing ? "unavailable" : "invalid", existing ? 503 : 200);
  } catch {
    console.error("RESEARCH_EMAIL_VERIFICATION_UNEXPECTED_FAILURE");
    return resultResponse("unavailable", 503);
  }
}
