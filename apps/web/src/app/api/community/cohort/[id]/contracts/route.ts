import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { COHORT_CONTRACT_CATEGORIES } from "@/constants/communityCategories";
import {
  cleanIntegerInRange,
  cleanOptionalEnum,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { NextRequest, NextResponse } from "next/server";
import type { CohortContractCategory } from "@/types/community.types";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_PRICE_MANWON = 1_000_000;
const MAX_TOTAL_PRICE_MANWON = MAX_PRICE_MANWON * 2;
const MIN_DISTINCT_CONTRIBUTORS = 5;
const CONTRACT_CATEGORIES = COHORT_CONTRACT_CATEGORIES.map(
  (category) => category.key
) as readonly CohortContractCategory[];

type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string };

function logDatabaseError(label: string, error: unknown): void {
  const code = isRecord(error) && typeof error.code === "string"
    ? error.code.slice(0, 16)
    : "unknown";
  console.error(label, code);
}

async function readBoundedJson(
  request: NextRequest,
  maxBytes: number
): Promise<BoundedJsonResult> {
  if (isBodyTooLarge(request, maxBytes)) {
    return { ok: false, status: 413, error: "요청 데이터가 너무 큽니다." };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: false, status: 400, error: "요청 형식이 올바르지 않습니다." };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "요청 데이터가 너무 큽니다." };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "요청 형식이 올바르지 않습니다." };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "요청 형식이 올바르지 않습니다." };
  }
}

async function assertMember(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  roomId: string,
  userId: string
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    logDatabaseError("Cohort membership lookup error code:", error);
    return null;
  }
  return Boolean(data);
}

function authorizedAggregateCount(raw: unknown): number | null {
  if (
    (typeof raw !== "number" && typeof raw !== "string") ||
    raw === ""
  ) {
    return null;
  }
  return (
    cleanIntegerInRange(
      raw,
      MIN_DISTINCT_CONTRIBUTORS,
      Number.MAX_SAFE_INTEGER
    ) ?? null
  );
}

function authorizedAverage(
  raw: unknown,
  min: number,
  max = MAX_PRICE_MANWON
): number | null {
  if (
    (typeof raw !== "number" && typeof raw !== "string") ||
    raw === ""
  ) {
    return null;
  }
  return cleanIntegerInRange(raw, min, max) ?? null;
}

// GET: 본인 계약 원문 + DB가 익명성 기준을 통과시킨 카테고리 집계
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return NextResponse.json(
        { error: "잘못된 동기방입니다." },
        { status: 400 }
      );
    }

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

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:cohort-contracts:read", req, user.id),
      { maxRequests: 120, windowMs: 60 * 1000 },
      user.id
    );
    if (limited) return limited;

    const member = await assertMember(supabase, roomId, user.id);
    if (member === null) {
      return NextResponse.json(
        { error: "동기방 멤버를 확인하지 못했습니다." },
        { status: 500 }
      );
    }
    if (!member) {
      return NextResponse.json(
        { error: "이 동기방 멤버가 아닙니다." },
        { status: 403 }
      );
    }

    // RLS가 본인 행만 허용한다. 다른 멤버의 업체명·금액·메모 원문은
    // service role로도 읽지 않고, 아래의 임계치 적용 집계 view만 사용한다.
    const { data: myContracts, error: contractsError } = await supabase
      .from("cohort_contracts")
      .select(
        "id, room_id, vendor_name, category, base_price, extra_price, notes, created_at"
      )
      .eq("room_id", roomId)
      .order("created_at", { ascending: false });

    if (contractsError) {
      logDatabaseError("Contracts GET error code:", contractsError);
      return NextResponse.json(
        { error: "계약 정보를 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    const admin = createAdminClient();
    const { data: roomContributorStats, error: contributorError } = await admin
      .from("cohort_room_contributor_stats")
      .select("contributor_count, threshold_met")
      .eq("room_id", roomId)
      .maybeSingle();

    if (contributorError) {
      logDatabaseError("Cohort contributor count GET error code:", contributorError);
      return NextResponse.json(
        { error: "가격 통계를 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    const { data: rawStats, error: statsError } = await admin
      .from("cohort_stats")
      .select("category, sample_size, avg_base_price, avg_extra_price, avg_total")
      .eq("room_id", roomId);

    if (statsError) {
      logDatabaseError("Cohort stats GET error code:", statsError);
      return NextResponse.json(
        { error: "가격 통계를 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // DB가 distinct contributor 임계치를 통과시킨 셀만 API에 남긴다.
    // NULL/1~4 표본은 카테고리 존재 여부나 정확한 건수까지 숨기기 위해 제외한다.
    const stats = (rawStats ?? []).flatMap((rawStat) => {
      const category = cleanOptionalEnum(rawStat.category, CONTRACT_CATEGORIES);
      const sampleSize = authorizedAggregateCount(rawStat.sample_size);
      const averageBasePrice = authorizedAverage(rawStat.avg_base_price, 1);
      if (!category || sampleSize === null || averageBasePrice === null) return [];

      return [
        {
          category,
          sample_size: sampleSize,
          avg_base_price: averageBasePrice,
          avg_extra_price: authorizedAverage(rawStat.avg_extra_price, 0),
          avg_total: authorizedAverage(
            rawStat.avg_total,
            1,
            MAX_TOTAL_PRICE_MANWON
          ),
        },
      ];
    });

    const contributorCount =
      roomContributorStats?.threshold_met === true
        ? authorizedAggregateCount(roomContributorStats.contributor_count)
        : null;

    return NextResponse.json({
      my_contracts: myContracts ?? [],
      stats,
      total_contributor_count: contributorCount,
      total_contributor_count_suppressed: contributorCount === null,
    });
  } catch {
    console.error("Contracts GET unexpected error");
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// POST: 본인의 계약 정보만 RLS client로 등록
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return NextResponse.json(
        { error: "잘못된 동기방입니다." },
        { status: 400 }
      );
    }

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

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:cohort-contracts:create", req, user.id),
      { maxRequests: 20, windowMs: 60 * 1000 },
      user.id
    );
    if (limited) return limited;

    const member = await assertMember(supabase, roomId, user.id);
    if (member === null) {
      return NextResponse.json(
        { error: "동기방 멤버를 확인하지 못했습니다." },
        { status: 500 }
      );
    }
    if (!member) {
      return NextResponse.json(
        { error: "이 동기방 멤버가 아닙니다." },
        { status: 403 }
      );
    }

    const bodyResult = await readBoundedJson(req, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.error },
        { status: bodyResult.status }
      );
    }

    if (!isRecord(bodyResult.value)) {
      return NextResponse.json(
        { error: "요청 형식이 올바르지 않습니다." },
        { status: 400 }
      );
    }

    const rawBody = bodyResult.value;
    const vendorName = cleanOptionalText(rawBody.vendor_name, 200);
    const category = cleanOptionalEnum(rawBody.category, CONTRACT_CATEGORIES);
    const basePrice = cleanIntegerInRange(
      rawBody.base_price,
      1,
      MAX_PRICE_MANWON
    );
    const extraPrice =
      rawBody.extra_price == null || rawBody.extra_price === ""
        ? null
        : cleanIntegerInRange(rawBody.extra_price, 0, MAX_PRICE_MANWON);
    const notes = cleanOptionalText(rawBody.notes, 1000);
    const notesTypeIsValid =
      rawBody.notes == null || typeof rawBody.notes === "string";

    if (
      !vendorName ||
      !category ||
      basePrice === undefined ||
      extraPrice === undefined ||
      !notesTypeIsValid
    ) {
      return NextResponse.json(
        { error: "업체명·카테고리·금액을 다시 확인해주세요." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("cohort_contracts")
      .insert({
        room_id: roomId,
        user_id: user.id,
        vendor_name: vendorName,
        category,
        base_price: basePrice,
        extra_price: extraPrice,
        notes,
      })
      .select(
        "id, room_id, vendor_name, category, base_price, extra_price, notes, created_at"
      )
      .single();

    if (error) {
      logDatabaseError("Contract insert error code:", error);
      return NextResponse.json(
        { error: "계약 정보 등록에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ contract: data }, { status: 201 });
  } catch {
    console.error("Contract POST unexpected error");
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
