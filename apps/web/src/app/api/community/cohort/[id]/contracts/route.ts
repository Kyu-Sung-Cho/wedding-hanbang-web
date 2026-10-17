import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/utils/log";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import type { CohortContractCategory } from "@/types/community.types";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_STATS_ROWS = 10_000;
const MIN_PARTICIPANTS = 5;
class IncompleteContractStatsError extends Error {}

interface ContractStatRow {
  category: string;
  user_id: string;
  base_price: number;
  extra_price: number | null;
}

function isContractStatRow(row: unknown): row is ContractStatRow {
  return typeof row === "object" && row !== null
    && "category" in row && typeof row.category === "string"
    && "user_id" in row && typeof row.user_id === "string"
    && "base_price" in row && typeof row.base_price === "number" && Number.isSafeInteger(row.base_price)
    && "extra_price" in row && (row.extra_price === null
      || (typeof row.extra_price === "number" && Number.isSafeInteger(row.extra_price)));
}

// PostgreSQL ROUND은 음수의 .5도 0에서 먼 쪽으로 반올림한다.
const sqlRound = (value: number) => value < 0 ? -Math.round(-value) : Math.round(value);

async function readContractStats(admin: ReturnType<typeof createAdminClient>, roomId: string) {
  // 사람 수와 평균을 같은 statement의 행 집합에서 계산한다. 별도 집계 뷰나
  // 여러 페이지의 snapshot을 섞으면 그 사이 변경된 표본으로 공개할 수 있다.
  const { data, error, count } = await admin
    .from("cohort_contracts")
    .select("category, user_id, base_price, extra_price", { count: "exact" })
    .eq("room_id", roomId)
    .limit(MAX_STATS_ROWS);
  if (error || !Array.isArray(data) || count === null || !Number.isSafeInteger(count)
    || count < 0 || count > MAX_STATS_ROWS || data.length !== count) {
    throw new IncompleteContractStatsError("계약 통계의 전체 표본을 확인하지 못했습니다.");
  }
  const groups = new Map<string, {
    users: Set<string>; rows: number; base: number; extra: number; extraRows: number; total: number;
  }>();
  for (const row of data) {
    if (!isContractStatRow(row)) throw new IncompleteContractStatsError("계약 통계 형식이 올바르지 않습니다.");
    const group = groups.get(row.category) ?? {
      users: new Set<string>(), rows: 0, base: 0, extra: 0, extraRows: 0, total: 0,
    };
    group.users.add(row.user_id);
    group.rows += 1;
    group.base += row.base_price;
    group.total += row.base_price + (row.extra_price ?? 0);
    if (row.extra_price !== null) { group.extra += row.extra_price; group.extraRows += 1; }
    if (![group.base, group.extra, group.total].every(Number.isSafeInteger)) {
      throw new IncompleteContractStatsError("계약 통계 금액 범위를 확인하지 못했습니다.");
    }
    groups.set(row.category, group);
  }
  return [...groups].map(([category, group]) => {
    const safeMetadata = { room_id: roomId, category, sample_size: group.users.size };
    if (group.users.size < MIN_PARTICIPANTS) return safeMetadata;
    // 평균은 기존처럼 계약 행 가중이며, 추가금 AVG의 null만 제외한다.
    return {
      ...safeMetadata,
      avg_base_price: sqlRound(group.base / group.rows),
      avg_extra_price: group.extraRows ? sqlRound(group.extra / group.extraRows) : null,
      avg_total: sqlRound(group.total / group.rows),
    };
  });
}

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

// GET: 계약 목록 + 카테고리별 5명 이상 익명 집계
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

    const stats = await readContractStats(admin, roomId);

    return NextResponse.json({
      contracts,
      my_contracts: myContracts,
      stats,
    });
  } catch (err) {
    if (err instanceof IncompleteContractStatsError) {
      return NextResponse.json(
        { error: "계약 통계의 전체 표본을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." },
        { status: 503 },
      );
    }
    log.error("api/community/cohort/[id]/contracts", err);
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
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
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

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status }
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
    log.error("api/community/cohort/[id]/contracts", err);
    console.error("Contract POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
