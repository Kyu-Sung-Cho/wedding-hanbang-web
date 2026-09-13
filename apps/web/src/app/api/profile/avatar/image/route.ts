import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isUuid } from "@/utils/requestValidation";
import { log } from "@/utils/log";
import { PROFILE_AVATAR_BUCKET, PROFILE_AVATAR_HEADERS, readAuthorizedProfileAvatar } from "@/lib/profileAvatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(status: number) {
  if (status >= 500) log.error("profile-avatar:image-unavailable");
  return NextResponse.json({ error: "프로필 이미지를 불러올 수 없어요." }, { status, headers: PROFILE_AVATAR_HEADERS });
}
export async function GET(request: Request) {
  try {
    const client = await createClientFromRequest(request);
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user || user.is_anonymous) return failure(401);
    const query = new URL(request.url).searchParams;
    const userId = query.get("userId"); const version = query.get("version");
    if (!isUuid(userId) || !isUuid(version)) return failure(400);
    const admin = createAdminClient();
    const row = await readAuthorizedProfileAvatar(admin, user.id, userId!);
    if (!row || row.kind !== "photo" || row.revision !== version || !row.object_path) return failure(404);
    const { data, error } = await admin.storage.from(PROFILE_AVATAR_BUCKET).download(row.object_path);
    if (error) return failure(503);
    if (!data || data.type !== "image/webp" || data.size > 1024 * 1024) return failure(404);
    const current = await readAuthorizedProfileAvatar(admin, user.id, userId!);
    if (!current || current.revision !== row.revision || current.object_path !== row.object_path) return failure(404);
    return new Response(await data.arrayBuffer(), { headers: { ...PROFILE_AVATAR_HEADERS, "Content-Type": "image/webp", "Content-Disposition": "inline", "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch { return failure(503); }
}
