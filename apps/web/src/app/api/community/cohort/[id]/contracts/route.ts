import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { CohortContractCategory } from "@/types/community.types";

async function assertMember(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  roomId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}

// GET: 계약 목록 + 카테고리별 집계 (cohort_stats view)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const member = await assertMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "이 동기방 멤버가 아닙니다." },
        { status: 403 }
      );
    }

    const { data: contracts, error: contractsErr } = await supabase
      .from("cohort_contracts")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false });

    if (contractsErr) {
      console.error("Contracts GET error:", contractsErr);
      return NextResponse.json(
        { error: "계약 정보를 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    const { data: stats } = await supabase
      .from("cohort_stats")
      .select("*")
      .eq("room_id", roomId);

    return NextResponse.json({
      contracts: contracts ?? [],
      stats: stats ?? [],
    });
  } catch (err) {
    console.error("Contracts GET error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// POST: 계약 정보 등록
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const member = await assertMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "이 동기방 멤버가 아닙니다." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      vendor_name: string;
      category: CohortContractCategory;
      base_price: number;
      extra_price?: number;
      notes?: string;
    };

    if (!body.vendor_name?.trim() || !body.category || body.base_price == null) {
      return NextResponse.json(
        { error: "필수 항목을 입력해주세요." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("cohort_contracts")
      .insert({
        room_id: roomId,
        user_id: user.id,
        vendor_name: body.vendor_name.trim().slice(0, 200),
        category: body.category,
        base_price: Math.round(body.base_price),
        extra_price:
          body.extra_price != null ? Math.round(body.extra_price) : null,
        notes: body.notes?.slice(0, 1000) ?? null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Contract insert error:", error);
      return NextResponse.json(
        { error: "계약 정보 등록에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ contract: data }, { status: 201 });
  } catch (err) {
    console.error("Contract POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
