import { NextRequest, NextResponse } from "next/server";

import { COMMUNITY_VENDOR_TAG_PUBLIC_SELECT } from "@/lib/community/vendorTagPublicFields";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkPublicServiceReadRateLimit } from "@/lib/http/publicServiceReadRateLimit";
import { cleanPostgrestSearchTerm } from "@/utils/requestValidation";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function publicJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function getServiceClient() {
  return createAdminClient();
}

export async function GET(req: NextRequest) {
  try {
    const limited = await checkPublicServiceReadRateLimit(req, "community-vendor-tags");
    if (limited) {
      limited.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
      return limited;
    }

    const { searchParams } = new URL(req.url);
    const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(parsedLimit, 100))
      : 20;
    const rawCategory = searchParams.get("category");
    const category = rawCategory === null ? null : cleanPostgrestSearchTerm(rawCategory, 50);
    if (rawCategory !== null && !category) {
      return publicJson({ error: "잘못된 카테고리입니다." }, 400);
    }

    const service = getServiceClient();
    let query = service
      .from("community_vendor_tags")
      .select(COMMUNITY_VENDOR_TAG_PUBLIC_SELECT)
      .order("mention_count", { ascending: false })
      .limit(limit);

    if (category) query = query.eq("category", category);

    const { data, error } = await query;
    if (error) {
      console.error("Vendor tags list error", safeErrorDiagnostic(error));
      return publicJson({ error: "목록을 불러올 수 없습니다." }, 500);
    }

    return publicJson({ tags: data ?? [] });
  } catch (err) {
    console.error("Vendor tags error", safeErrorDiagnostic(err));
    return publicJson({ error: "서버 오류가 발생했습니다." }, 500);
  }
}
