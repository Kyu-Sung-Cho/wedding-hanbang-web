import { createAdminClient } from "@/lib/supabase/admin";
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

    // 익명성 원칙: 본인 행 외 원본(업체명·금액·user_id)은 절대 반환하지 않는다.
    // RLS가 본인 행만 허용하므로(20260610110000 마이그레이션) 방 전체 읽기는
    // service role로만 — 브라우저의 anon key 직접 호출 경로가 데이터 계층에서 막힌다.
    const admin = createAdminClient();
    const { data: rawContracts, error: contractsErr } = await admin
      .from("cohort_contracts")
      .select("id, category, created_at, user_id, vendor_name, base_price, extra_price, notes")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false });

    if (contractsErr) {
      console.error("Contracts GET error:", contractsErr);
      return NextResponse.json(
        { error: "계약 정보를 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    const rows = rawContracts ?? [];
    const contracts = rows.map((row) => ({
      id: row.id,
      category: row.category,
      created_at: row.created_at,
      is_mine: row.user_id === user.id,
    }));
    const myContracts = rows
      .filter((row) => row.user_id === user.id)
      .map(({ user_id, ...rest }) => {
        void user_id;
        return rest;
      });

    const MIN_SAMPLE = 5;
    const { data: rawStats } = await admin
      .from("cohort_stats")
      .select("*")
      .eq("room_id", roomId);

    const stats = (rawStats ?? []).map((stat) =>
      (stat.sample_size ?? 0) >= MIN_SAMPLE
        ? stat
        : { room_id: stat.room_id, category: stat.category, sample_size: stat.sample_size }
    );

    return NextResponse.json({
      contracts,
      my_contracts: myContracts,
      stats,
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
