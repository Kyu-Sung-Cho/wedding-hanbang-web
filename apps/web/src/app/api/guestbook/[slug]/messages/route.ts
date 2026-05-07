import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import type { GuestRelation, GuestbookMessageType } from "@/types/community.types";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function hashIp(req: NextRequest): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const service = getServiceClient();

    const { data: guestbook } = await service
      .from("guestbooks")
      .select("id, is_active")
      .eq("slug", slug)
      .maybeSingle();

    if (!guestbook || !guestbook.is_active) {
      return NextResponse.json(
        { error: "방명록을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { guest_name, relation, message, message_type, image_url } = body as {
      guest_name?: string;
      relation?: GuestRelation;
      message?: string;
      message_type?: GuestbookMessageType;
      image_url?: string;
    };

    if (!guest_name?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: "이름과 메시지를 입력해주세요." },
        { status: 400 }
      );
    }

    // image_url 검증: 우리 Supabase Storage의 guestbook-uploads 버킷만 허용 — 외부 URL 차단으로 hotlink/spam 방지
    let safeImageUrl: string | null = null;
    if (typeof image_url === "string" && image_url.length > 0) {
      const supabaseHost = (() => {
        try {
          return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;
        } catch {
          return null;
        }
      })();
      let parsed: URL | null = null;
      try {
        parsed = new URL(image_url);
      } catch {
        parsed = null;
      }
      if (
        parsed &&
        supabaseHost &&
        parsed.host === supabaseHost &&
        parsed.pathname.includes("/guestbook-uploads/")
      ) {
        safeImageUrl = parsed.toString();
      } else {
        return NextResponse.json(
          { error: "허용되지 않은 이미지 URL입니다." },
          { status: 400 }
        );
      }
    }

    const ipHash = hashIp(req);

    // Rate limit: 최근 24시간 동안 같은 IP가 같은 방명록에 5개 초과 작성 불가
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await service
      .from("guestbook_messages")
      .select("id", { count: "exact", head: true })
      .eq("guestbook_id", guestbook.id)
      .eq("ip_hash", ipHash)
      .gte("created_at", since);

    if ((count ?? 0) >= 5) {
      return NextResponse.json(
        { error: "너무 많은 메시지를 작성하셨어요. 잠시 후 다시 시도해주세요." },
        { status: 429 }
      );
    }

    const { data: inserted, error } = await service
      .from("guestbook_messages")
      .insert({
        guestbook_id: guestbook.id,
        guest_name: guest_name.trim().slice(0, 40),
        relation: relation ?? null,
        message: message.trim().slice(0, 2000),
        message_type: message_type ?? "general",
        image_url: safeImageUrl,
        is_approved: true,
        ip_hash: ipHash,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Insert message error:", error);
      return NextResponse.json(
        { error: "메시지 작성에 실패했습니다." },
        { status: 500 }
      );
    }

    // message_count 증가 (비차단)
    void service
      .rpc("increment_guestbook_message_count", { p_guestbook_id: guestbook.id })
      .then(
        () => {},
        () => {
          // RPC 없으면 직접 증가
          void service
            .from("guestbooks")
            .select("message_count")
            .eq("id", guestbook.id)
            .single()
            .then(({ data }) => {
              if (data) {
                void service
                  .from("guestbooks")
                  .update({ message_count: (data.message_count ?? 0) + 1 })
                  .eq("id", guestbook.id)
                  .then(() => {}, () => {});
              }
            }, () => {});
        }
      );

    return NextResponse.json({ message: inserted }, { status: 201 });
  } catch (err) {
    console.error("Guestbook message POST error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
