import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { requestMatchesExpectedCommunityActor } from "@/lib/community/actorFence";
import { PrivateNextResponse as NextResponse } from "@/lib/http/privateResponse";
import type { CohortContractCategory } from "@/types/community.types";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanIntegerInRange,
  cleanOptionalEnum,
  cleanOptionalText,
  isRecord,
  isUuid,
  readBoundedJsonValue,
} from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import type { NextRequest } from "next/server";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

const MAX_BODY_BYTES = 16 * 1024;
const MIN_DISTINCT_CONTRIBUTORS = 5;
const MAX_CONTRACT_PRICE = 100_000; // 만원 단위(최대 10억원)
const MAX_ROOM_MEMBERS = 30;
const CONTRACT_CATEGORIES = [
  "venue",
  "studio",
  "dress",
  "makeup",
  "snap",
  "ring",
  "honeymoon",
  "other",
] as const satisfies readonly CohortContractCategory[];
const CONTRACT_CATEGORY_SET = new Set<string>(CONTRACT_CATEGORIES);
const MAX_CONTRACTS_PER_ROOM = MAX_ROOM_MEMBERS * CONTRACT_CATEGORIES.length;

type ContractRow = {
  id: string;
  category: CohortContractCategory;
  created_at: string | null;
  user_id: string;
  vendor_name: string;
  base_price: number | null;
  extra_price: number | null;
  notes: string | null;
};

type StatRow = {
  room_id: string;
  category: CohortContractCategory;
  sample_size: number;
  avg_base_price: number | null;
  avg_extra_price: number | null;
  avg_total: number | null;
};

type RpcContract = Omit<ContractRow, "user_id"> & { room_id: string };

function parseContractRow(value: unknown): ContractRow | null {
  if (!isRecord(value)) return null;
  const basePrice = value.base_price === null
    ? null
    : typeof value.base_price === "number" && Number.isInteger(value.base_price)
      ? value.base_price
      : undefined;
  const extraPrice = value.extra_price === null
    ? null
    : typeof value.extra_price === "number" && Number.isInteger(value.extra_price)
      ? value.extra_price
      : undefined;
  if (
    !isUuid(value.id)
    || !isUuid(value.user_id)
    || typeof value.category !== "string"
    || !CONTRACT_CATEGORY_SET.has(value.category)
    || typeof value.vendor_name !== "string"
    || (value.created_at !== null && typeof value.created_at !== "string")
    || basePrice === undefined
    || extraPrice === undefined
    || (value.notes !== null && typeof value.notes !== "string")
  ) {
    return null;
  }

  return {
    id: value.id,
    category: value.category as CohortContractCategory,
    created_at: value.created_at,
    user_id: value.user_id,
    vendor_name: value.vendor_name,
    base_price: basePrice,
    extra_price: extraPrice,
    notes: value.notes,
  };
}

function parseStatRow(value: unknown): StatRow | null {
  if (!isRecord(value)) return null;
  if (
    !isUuid(value.room_id)
    || typeof value.category !== "string"
    || !CONTRACT_CATEGORY_SET.has(value.category)
    || !Number.isInteger(value.sample_size)
    || Number(value.sample_size) < 0
  ) {
    return null;
  }

  const parseAverage = (average: unknown): number | null | undefined => {
    if (average === null) return null;
    return Number.isInteger(average) ? Number(average) : undefined;
  };
  const avgBasePrice = parseAverage(value.avg_base_price);
  const avgExtraPrice = parseAverage(value.avg_extra_price);
  const avgTotal = parseAverage(value.avg_total);
  if (avgBasePrice === undefined || avgExtraPrice === undefined || avgTotal === undefined) {
    return null;
  }

  return {
    room_id: value.room_id,
    category: value.category as CohortContractCategory,
    sample_size: Number(value.sample_size),
    avg_base_price: avgBasePrice,
    avg_extra_price: avgExtraPrice,
    avg_total: avgTotal,
  };
}

function parseRpcContract(value: unknown, expectedUserId: string): RpcContract | null {
  if (!isRecord(value) || !isUuid(value.room_id)) return null;
  const row = parseContractRow(value);
  if (!row || row.user_id !== expectedUserId) return null;
  const { user_id: _ignored, ...contract } = row;
  void _ignored;
  return { ...contract, room_id: value.room_id };
}

function isBoundedContribution(row: ContractRow): boolean {
  return row.vendor_name.trim().length > 0
    && row.vendor_name.trim().length <= 200
    && row.base_price !== null
    && row.base_price >= 0
    && row.base_price <= MAX_CONTRACT_PRICE
    && (row.extra_price === null
      || (row.extra_price >= 0 && row.extra_price <= MAX_CONTRACT_PRICE))
    && row.base_price + (row.extra_price ?? 0) <= MAX_CONTRACT_PRICE
    && (row.notes === null || row.notes.length <= 1000);
}

function parseRequestPrice(value: unknown): number | undefined {
  return typeof value === "number"
    ? cleanIntegerInRange(value, 0, MAX_CONTRACT_PRICE)
    : undefined;
}

async function assertMember(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  roomId: string,
  userId: string,
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return NextResponse.json({ error: "올바른 동기방 ID가 필요합니다." }, { status: 400 });
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    if (!requestMatchesExpectedCommunityActor(req, user.id)) {
      return NextResponse.json({ error: "계정이 변경되었습니다. 다시 시도해주세요." }, { status: 409 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:cohort-contracts:list", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    if (limited) return limited;

    if (!(await assertMember(supabase, roomId, user.id))) {
      return NextResponse.json({ error: "이 동기방의 활성 멤버가 아닙니다." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: rawActiveMembers, error: activeMembersError } = await admin
      .from("cohort_members")
      .select("user_id")
      .eq("room_id", roomId)
      .eq("is_active", true)
      .limit(MAX_ROOM_MEMBERS + 1);
    if (activeMembersError) {
      console.error("Contract active-member check error:", safeErrorDiagnostic(activeMembersError));
      return NextResponse.json({ error: "동기방 멤버를 확인할 수 없습니다." }, { status: 500 });
    }

    const activeMemberIds = new Set(
      (rawActiveMembers ?? []).flatMap((member) =>
        isRecord(member) && isUuid(member.user_id) ? [member.user_id] : []),
    );
    if ((rawActiveMembers?.length ?? 0) > MAX_ROOM_MEMBERS) {
      console.error("Cohort active-member capacity invariant exceeded");
      return NextResponse.json({ error: "동기방 멤버를 안전하게 확인할 수 없습니다." }, { status: 503 });
    }
    if (!activeMemberIds.has(user.id)) {
      return NextResponse.json({ error: "이 동기방의 활성 멤버가 아닙니다." }, { status: 403 });
    }

    const { data: rawContracts, error: contractsError } = await admin
      .from("cohort_contracts")
      .select("id, category, created_at, user_id, vendor_name, base_price, extra_price, notes")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTRACTS_PER_ROOM + 1);

    if (contractsError) {
      console.error("Contracts GET error:", safeErrorDiagnostic(contractsError));
      return NextResponse.json({ error: "계약 정보를 불러올 수 없습니다." }, { status: 500 });
    }
    if ((rawContracts?.length ?? 0) > MAX_CONTRACTS_PER_ROOM) {
      console.error("Cohort contract uniqueness/capacity invariant exceeded");
      return NextResponse.json({ error: "계약 정보를 안전하게 불러올 수 없습니다." }, { status: 503 });
    }

    const rows = (rawContracts ?? [])
      .map(parseContractRow)
      .filter((row): row is ContractRow => row !== null);
    const myContracts = rows
      .filter((row) => row.user_id === user.id)
      .map(({ user_id: _userId, ...rest }) => {
        void _userId;
        return rest;
      });

    const contributorsByCategory = new Map<
      CohortContractCategory,
      Map<string, ContractRow>
    >();
    const duplicateContributionCategories = new Set<CohortContractCategory>();
    for (const row of rows) {
      if (!activeMemberIds.has(row.user_id) || !isBoundedContribution(row)) continue;
      const contributors = contributorsByCategory.get(row.category) ?? new Map<string, ContractRow>();
      if (contributors.has(row.user_id)) {
        duplicateContributionCategories.add(row.category);
      } else {
        contributors.set(row.user_id, row);
      }
      contributorsByCategory.set(row.category, contributors);
    }

    const { data: rawStats, error: statsError } = await admin
      .from("cohort_stats")
      .select("room_id, category, sample_size, avg_base_price, avg_extra_price, avg_total")
      .eq("room_id", roomId)
      .limit(CONTRACT_CATEGORIES.length + 1);
    if (statsError) {
      console.error("Contract stats GET error:", safeErrorDiagnostic(statsError));
      return NextResponse.json({ error: "계약 통계를 불러올 수 없습니다." }, { status: 500 });
    }

    const stats = (rawStats ?? []).flatMap((value) => {
      const stat = parseStatRow(value);
      if (!stat || stat.room_id !== roomId) return [];

      const contributions = contributorsByCategory.get(stat.category) ?? new Map<string, ContractRow>();
      const distinctContributors = contributions.size;
      const sampleOnly = {
        room_id: roomId,
        category: stat.category,
        sample_size: distinctContributors,
      };

      // 뷰와 원본 행을 독립적으로 대조한다. 하나라도 불일치하면 평균은 숨긴다.
      if (
        distinctContributors < MIN_DISTINCT_CONTRIBUTORS
        || duplicateContributionCategories.has(stat.category)
        || stat.sample_size !== distinctContributors
        || stat.avg_base_price === null
        || stat.avg_total === null
      ) {
        return [sampleOnly];
      }

      return [{
        ...sampleOnly,
        avg_base_price: stat.avg_base_price,
        avg_extra_price: stat.avg_extra_price,
        avg_total: stat.avg_total,
      }];
    });

    return NextResponse.json({
      contract_count: rows.filter((row) =>
        activeMemberIds.has(row.user_id) && isBoundedContribution(row)).length,
      my_contracts: myContracts,
      stats,
    });
  } catch (error) {
    console.error("Contracts GET error:", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return NextResponse.json({ error: "올바른 동기방 ID가 필요합니다." }, { status: 400 });
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    if (!requestMatchesExpectedCommunityActor(req, user.id)) {
      return NextResponse.json({ error: "계정이 변경되었습니다. 다시 시도해주세요." }, { status: 409 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:cohort-contracts:upsert", req, user.id),
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    if (limited) return limited;

    if (!(await assertMember(supabase, roomId, user.id))) {
      return NextResponse.json({ error: "이 동기방의 활성 멤버가 아닙니다." }, { status: 403 });
    }

    const bodyResult = await readBoundedJsonValue(req, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    if (!isRecord(bodyResult.value)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const vendorName = cleanOptionalText(bodyResult.value.vendor_name, 200);
    const category = cleanOptionalEnum(bodyResult.value.category, CONTRACT_CATEGORIES);
    const basePrice = parseRequestPrice(bodyResult.value.base_price);
    const extraPrice = bodyResult.value.extra_price === null
      || bodyResult.value.extra_price === undefined
      ? null
      : parseRequestPrice(bodyResult.value.extra_price);
    const notes = cleanOptionalText(bodyResult.value.notes, 1000);

    if (
      !vendorName
      || !category
      || basePrice === undefined
      || extraPrice === undefined
      || (bodyResult.value.notes !== null
        && bodyResult.value.notes !== undefined
        && typeof bodyResult.value.notes !== "string")
      || basePrice + (extraPrice ?? 0) > MAX_CONTRACT_PRICE
    ) {
      return NextResponse.json({ error: "계약 정보의 형식이나 금액 범위가 올바르지 않습니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("community_upsert_cohort_contract", {
      p_expected_user_id: user.id,
      p_user_id: user.id,
      p_room_id: roomId,
      p_vendor_name: vendorName,
      p_category: category,
      p_base_price: basePrice,
      p_extra_price: extraPrice,
      p_notes: notes,
    });

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      const message = error.message?.toLowerCase() ?? "";
      if (message.includes("actor_mismatch") || message.includes("membership_required")) {
        return NextResponse.json({ error: "계약 정보를 등록할 권한이 없습니다." }, { status: 403 });
      }
      if (message.includes("_invalid")) {
        return NextResponse.json({ error: "계약 정보의 형식이나 금액 범위가 올바르지 않습니다." }, { status: 400 });
      }
      console.error("Contract upsert error:", safeErrorDiagnostic(error));
      return NextResponse.json({ error: "계약 정보 등록에 실패했습니다." }, { status: 500 });
    }

    const contract = parseRpcContract(data, user.id);
    if (!contract || contract.room_id !== roomId) {
      console.error("Contract upsert RPC returned an invalid actor-bound result");
      return NextResponse.json({ error: "계약 정보 등록 결과를 확인할 수 없습니다." }, { status: 503 });
    }

    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    console.error("Contract POST error:", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
