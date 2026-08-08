import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid } from "@/utils/requestValidation";

const MAX_ACTIVE_REQUESTS = 20;
const MAX_SUMMARY_CHARS = 240;
const MAX_BASE_REVISION = Number.MAX_SAFE_INTEGER - 1;
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function privateNoStore(response: Response) {
  response.headers.set(
    "Cache-Control",
    PRIVATE_NO_STORE_HEADERS["Cache-Control"],
  );
  response.headers.set("Vary", PRIVATE_NO_STORE_HEADERS.Vary);
  return response;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isSafeSummary(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && Array.from(value).length <= MAX_SUMMARY_CHARS
    && value === value.trim()
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function isBaseRevision(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= MAX_BASE_REVISION;
}

function readActiveSurface(request: Request): "/schedule" | "/budget" | null {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (entries.length === 0) return "/schedule";
  if (
    entries.length === 1
    && entries[0][0] === "surface"
    && entries[0][1] === "/budget"
  ) return "/budget";
  return null;
}

export async function GET(request: Request) {
  try {
    const surface = readActiveSurface(request);
    if (surface === null) {
      return json({ error: "허용되지 않은 조회 조건입니다." }, 400);
    }
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !isUuid(user.id)) {
      return json({ error: "로그인이 필요합니다." }, 401);
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-plan-change:active", request, user.id),
      { maxRequests: 60, windowMs: 60_000 },
      { failClosed: true },
    );
    if (limited) return privateNoStore(limited);

    const ownerId = user.id.toLowerCase();
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", ownerId)
      .single();
    if (profileError) {
      return json({ error: "커플 연결 상태를 확인하지 못했습니다." }, 503);
    }
    if (!isRecord(profile) || !isUuid(profile.couple_id)) {
      return json({ error: "커플 연결이 필요합니다." }, 403);
    }
    const profileCoupleId = profile.couple_id.toLowerCase();

    const admin = createAdminClient();
    const { data: coupleRows, error: coupleError } = await admin
      .from("couples")
      .select("id, bride_id, groom_id")
      .eq("id", profileCoupleId)
      .or(`bride_id.eq.${ownerId},groom_id.eq.${ownerId}`)
      .limit(2);

    if (coupleError || !Array.isArray(coupleRows)) {
      return json({ error: "커플 연결 상태를 확인하지 못했습니다." }, 503);
    }
    if (coupleRows.length === 0) {
      return json({ error: "커플 연결이 필요합니다." }, 403);
    }
    if (coupleRows.length !== 1) {
      return json({ error: "커플 연결 상태를 다시 확인해 주세요." }, 409);
    }

    const couple = coupleRows[0];
    if (
      !isRecord(couple)
      || !isUuid(couple.id)
      || couple.id.toLowerCase() !== profileCoupleId
      || !(couple.bride_id === null || isUuid(couple.bride_id))
      || !(couple.groom_id === null || isUuid(couple.groom_id))
      || (
        couple.bride_id?.toLowerCase() !== ownerId
        && couple.groom_id?.toLowerCase() !== ownerId
      )
    ) {
      return json({ error: "커플 연결 상태를 다시 확인해 주세요." }, 409);
    }

    const coupleId = couple.id.toLowerCase();
    const brideId = couple.bride_id?.toLowerCase() ?? null;
    const groomId = couple.groom_id?.toLowerCase() ?? null;
    const { data: requestRows, error: requestError } = await admin
      .from("couple_plan_change_requests")
      .select(
        surface === "/budget"
          ? "id, actor_user_id, base_revision, summary, created_at"
          : "id, actor_user_id, created_at",
      )
      .eq("couple_id", coupleId)
      .eq("status", "pending")
      .eq("required_count", 2)
      .eq("surface_href", surface)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_ACTIVE_REQUESTS);

    if (requestError || !Array.isArray(requestRows)) {
      return json({ error: "공동 확인 요청을 불러오지 못했습니다." }, 503);
    }

    const requests: Array<
      | {
          requestId: string;
          role: "requester" | "reviewer";
          createdAt: string;
        }
      | {
          requestId: string;
          role: "requester" | "reviewer";
          baseRevision: number;
          summary: string;
          createdAt: string;
        }
    > = [];
    const seen = new Set<string>();
    for (const row of requestRows) {
      if (
        !isRecord(row)
        || !isUuid(row.id)
        || !isUuid(row.actor_user_id)
        || !isTimestamp(row.created_at)
      ) {
        return json({ error: "공동 확인 요청 형식을 확인하지 못했습니다." }, 503);
      }
      const requestId = row.id.toLowerCase();
      const actorId = row.actor_user_id.toLowerCase();
      if (
        seen.has(requestId)
        || (actorId !== brideId && actorId !== groomId)
      ) {
        return json({ error: "공동 확인 요청의 소유자를 확인하지 못했습니다." }, 503);
      }
      seen.add(requestId);
      const common = {
        requestId,
        role: actorId === ownerId ? "requester" as const : "reviewer" as const,
        createdAt: row.created_at,
      };
      if (surface === "/budget") {
        if (!isBaseRevision(row.base_revision) || !isSafeSummary(row.summary)) {
          return json({ error: "공동 확인 요청 형식을 확인하지 못했습니다." }, 503);
        }
        requests.push({
          ...common,
          baseRevision: row.base_revision,
          summary: row.summary,
        });
      } else {
        requests.push(common);
      }
    }

    return json(surface === "/budget"
      ? { ownerId, coupleId, surface, requests }
      : { ownerId, coupleId, requests });
  } catch {
    return json({ error: "공동 확인 요청을 불러오지 못했습니다." }, 503);
  }
}
