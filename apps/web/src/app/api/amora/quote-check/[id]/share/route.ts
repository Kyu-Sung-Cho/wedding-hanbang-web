import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

type RouteContext = { params: Promise<{ id: string }> };

async function setPublicVisibility(
  req: NextRequest,
  context: RouteContext,
  isPublic: boolean
) {
  const supabase = await createClientFromRequest(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "로그인이 필요합니다." },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "잘못된 결과 ID입니다." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const publishedAt = isPublic ? new Date().toISOString() : null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("amora_quote_checks")
    .update({ is_public: isPublic, published_at: publishedAt })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, is_public, published_at")
    .maybeSingle();

  if (error) {
    console.error("Quote-check share visibility update failed:", error.message);
    return NextResponse.json(
      { error: "공개 설정을 변경하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "저장된 결과를 찾을 수 없습니다." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    {
      id: data.id,
      isPublic: data.is_public,
      publishedAt: data.published_at,
    },
    { headers: NO_STORE_HEADERS }
  );
}

// Explicitly publish a private, account-saved result.
export async function POST(req: NextRequest, context: RouteContext) {
  return setPublicVisibility(req, context, true);
}

// Revoke the bearer URL immediately. The public page/API both require is_public=true.
export async function DELETE(req: NextRequest, context: RouteContext) {
  return setPublicVisibility(req, context, false);
}
