import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";

const MAX_PATHS = 10;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function normalizeStoragePath(value: string) {
  return value.replace(/^\/+/, "").trim();
}

function isSafeChatImagePath(path: string, coupleId: string) {
  if (!path || path.includes("..") || path.includes("\\") || path.startsWith("/")) {
    return false;
  }

  return path.startsWith(`${coupleId}/`) && path.split("/").length >= 2;
}

export async function POST(request: Request) {
  try {
    const authClient = await createClientFromRequest(request);
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { paths?: unknown };
    const rawPaths = Array.isArray(body.paths) ? body.paths : [];
    const paths = [
      ...new Set(
        rawPaths
          .filter((path): path is string => typeof path === "string")
          .map(normalizeStoragePath)
          .filter(Boolean)
      ),
    ].slice(0, MAX_PATHS);

    if (paths.length === 0) {
      return NextResponse.json({ urls: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data: profile, error: profileError } = await authClient
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[chat image-urls] profile lookup failed:", profileError);
      return NextResponse.json({ error: "프로필 확인에 실패했습니다." }, { status: 500 });
    }

    const coupleId = profile?.couple_id;
    if (!coupleId || paths.some((path) => !isSafeChatImagePath(path, coupleId))) {
      return NextResponse.json({ error: "이미지 접근 권한이 없습니다." }, { status: 403 });
    }

    const { data, error } = await getServiceClient()
      .storage
      .from("chat-image")
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

    if (error) {
      console.error("[chat image-urls] signed URL failed:", error);
      return NextResponse.json({ error: "이미지 URL 생성에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json(
      {
        urls: (data ?? []).map((item) => ({
          path: item.path,
          signedUrl: item.signedUrl,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[chat image-urls] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
